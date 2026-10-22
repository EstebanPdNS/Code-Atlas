// Code Atlas: the native half of Claude's computer use on this Mac, like
// Codex's: the agent gets its own cursor, and its clicks and keys go straight
// to the target app, so the user's own pointer and focus stay free. Apps that
// ignore input sent that way (games, emulators) get it in the foreground
// instead, and the user's pointer goes back where it was.
//
// It runs as a child of Code Atlas, so it uses Code Atlas's own Screen Recording
// and Accessibility permissions and never asks for its own. Every command
// prints one JSON object on stdout; `cursor` stays running and reads one cue
// per line on stdin.
//
//   atlas-computer permissions
//   atlas-computer request <screen|accessibility>
//   atlas-computer windows
//   atlas-computer display
//   atlas-computer tree <pid> <x> <y> <width> <height>
//   atlas-computer setvalue <pid> <x> <y> <text>
//   atlas-computer activate <pid>
//   atlas-computer click <pid> <windowId> <background|foreground> <x> <y> <left|right> <count>
//   atlas-computer drag <pid> <windowId> <mode> <x1> <y1> <x2> <y2>
//   atlas-computer scroll <pid> <windowId> <mode> <x> <y> <dx> <dy>
//   atlas-computer key <pid> <mode> <keycode> <flags> <holdMs>
//   atlas-computer type <pid> <mode> <text>
//   atlas-computer cursor <claude|codex>   (stdin: "move x y", "click x y", "hide", "quit")
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import QuartzCore

func emit(_ object: Any) {
  let data = (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String) -> Never {
  emit(["ok": false, "error": message])
  exit(1)
}

let args = CommandLine.arguments

func number(_ index: Int) -> Double {
  guard index < args.count, let value = Double(args[index]) else {
    fail("Missing or invalid argument \(index).")
  }
  return value
}

// Events need a short gap: apps (and emulators especially) drop a down and up
// that arrive in the same instant.
func pause(_ milliseconds: Double) {
  usleep(useconds_t(max(0, milliseconds) * 1000))
}

// MARK: - Delivery

/// Where an event goes: straight to one app (background), or through the
/// system like real input (foreground, which moves the real pointer).
struct Delivery {
  let pid: pid_t
  let windowId: Int64
  let background: Bool
  // A private source keeps Claude's modifier keys out of the user's keyboard state.
  let source = CGEventSource(stateID: .privateState)

  func post(_ event: CGEvent?) {
    guard let event else { return }
    if background {
      if windowId > 0 {
        // The window under the pointer, so AppKit routes the click to it even
        // though the app is not in front.
        event.setIntegerValueField(CGEventField(rawValue: 91)!, value: windowId)
        event.setIntegerValueField(CGEventField(rawValue: 92)!, value: windowId)
      }
      event.postToPid(pid)
    } else {
      event.post(tap: .cghidEventTap)
    }
  }

  func mouse(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, clickState: Int64 = 1) {
    let event = CGEvent(
      mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button)
    event?.setIntegerValueField(.mouseEventClickState, value: clickState)
    post(event)
  }

  func key(_ keyCode: CGKeyCode, down: Bool, flags: CGEventFlags) {
    let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: down)
    event?.flags = flags
    post(event)
  }

  /// Foreground input moves the real pointer: put it back afterwards.
  func keepingUserPointer(_ body: () -> Void) {
    let saved = CGEvent(source: nil)?.location
    body()
    if !background, let saved {
      pause(30)
      CGWarpMouseCursorPosition(saved)
      CGAssociateMouseAndMouseCursorPosition(1)
    }
  }
}

func delivery(pidAt: Int, windowAt: Int?, modeAt: Int) -> Delivery {
  Delivery(
    pid: pid_t(number(pidAt)),
    windowId: windowAt.map { Int64(number($0)) } ?? 0,
    background: args.count > modeAt && args[modeAt] != "foreground")
}

// MARK: - Accessibility

// Like Codex's computer use, background clicks and typing first go through the
// app's accessibility tree: the control under the point is pressed, or the
// focused field takes the text. Nothing moves and no event is synthesized;
// apps without accessible controls (games, emulators) get events instead.

/// Presses the accessible control at a global point, if the app has one there.
func pressAccessibleControl(pid: pid_t, at point: CGPoint, action: String) -> Bool {
  let app = AXUIElementCreateApplication(pid)
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &hit) == .success,
    let element = hit
  else { return false }
  var names: CFArray?
  guard AXUIElementCopyActionNames(element, &names) == .success,
    let actions = names as? [String], actions.contains(action)
  else { return false }
  return AXUIElementPerformAction(element, action as CFString) == .success
}

/// Inserts text at the caret of the app's focused field, if it accepts that.
func insertIntoFocusedField(pid: pid_t, text: String) -> Bool {
  let app = AXUIElementCreateApplication(pid)
  var focused: CFTypeRef?
  guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
    let value = focused, CFGetTypeID(value) == AXUIElementGetTypeID()
  else { return false }
  let element = value as! AXUIElement
  var settable = DarwinBoolean(false)
  guard AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success,
    settable.boolValue
  else { return false }
  return AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString) == .success
}

/// The window's accessible controls, front to back in reading order: what an
/// agent can press or type into, with frames in global points. Text-less
/// layout groups are walked through but not listed.
func accessibleElements(pid: pid_t, near frame: CGRect, limit: Int = 400) -> [[String: Any]] {
  let app = AXUIElementCreateApplication(pid)
  func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
  }
  func text(_ element: AXUIElement, _ name: String) -> String {
    guard let value = attribute(element, name) else { return "" }
    if let string = value as? String { return string }
    if let number = value as? NSNumber { return number.stringValue }
    return ""
  }
  func rect(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, kAXPositionAttribute),
      let size = attribute(element, kAXSizeAttribute)
    else { return nil }
    var point = CGPoint.zero
    var extent = CGSize.zero
    AXValueGetValue(position as! AXValue, .cgPoint, &point)
    AXValueGetValue(size as! AXValue, .cgSize, &extent)
    return CGRect(origin: point, size: extent)
  }
  // The AX window whose frame matches the screen window.
  let windows = (attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
  let root =
    windows.min { a, b in
      let fa = rect(a) ?? .zero
      let fb = rect(b) ?? .zero
      return abs(fa.minX - frame.minX) + abs(fa.minY - frame.minY)
        < abs(fb.minX - frame.minX) + abs(fb.minY - frame.minY)
    } ?? app
  var result: [[String: Any]] = []
  var stack: [(AXUIElement, Int)] = [(root, 0)]
  var visited = 0
  while let (element, depth) = stack.popLast(), result.count < limit, visited < 4000 {
    visited += 1
    let role = text(element, kAXRoleAttribute)
    let label = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute]
      .map { text(element, $0) }.first { !$0.isEmpty } ?? ""
    let value = String(text(element, kAXValueAttribute).prefix(80))
    var names: CFArray?
    AXUIElementCopyActionNames(element, &names)
    let actions = ((names as? [String]) ?? []).filter { !$0.hasPrefix("AXScroll") && $0 != "AXShowDefaultUI" }
    if let frame = rect(element), frame.width > 1, frame.height > 1,
      !label.isEmpty || !value.isEmpty || !actions.isEmpty || role == "AXTextField" || role == "AXTextArea",
      role != "AXWindow", role != "AXApplication"
    {
      result.append([
        "role": role, "label": label, "value": value, "actions": actions, "depth": depth,
        "x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height,
      ])
    }
    if depth < 30, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
      for child in children.reversed() { stack.append((child, depth + 1)) }
    }
  }
  return result
}

/// Sets an accessible field's value (a text field, a slider), focusing it first.
func setAccessibleValue(pid: pid_t, at point: CGPoint, text: String) -> Bool {
  let app = AXUIElementCreateApplication(pid)
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &hit) == .success,
    let element = hit
  else { return false }
  AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  return AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString) == .success
}

// MARK: - Windows

func windows() -> [[String: Any]] {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return []
  }
  var result: [[String: Any]] = []
  for info in list {
    guard (info[kCGWindowLayer as String] as? Int) == 0,
      let pid = info[kCGWindowOwnerPID as String] as? Int32,
      let number = info[kCGWindowNumber as String] as? Int,
      let boundsDictionary = info[kCGWindowBounds as String] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
      bounds.width >= 80, bounds.height >= 60
    else { continue }
    let app = NSRunningApplication(processIdentifier: pid)
    result.append([
      "windowId": number,
      "pid": Int(pid),
      "app": (info[kCGWindowOwnerName as String] as? String) ?? app?.localizedName ?? "",
      "bundleId": app?.bundleIdentifier ?? "",
      "title": (info[kCGWindowName as String] as? String) ?? "",
      "x": bounds.origin.x, "y": bounds.origin.y,
      "width": bounds.width, "height": bounds.height,
    ])
  }
  return result
}

// MARK: - Agent cursor

/// The agent's own pointer, in a Liquid Glass style: a rounded arrow of soft
/// colour (Claude's oranges, Codex's violets and pinks) under a white glass
/// rim. It glides to where the agent acts and presses with a ripple on clicks.
/// Click-through, above everything, on every Space, and left out of screen
/// captures so the agent's screenshots show the app alone.
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
  NSColor(calibratedRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}

/// Soft colour blobs laid over each other, like a mesh gradient.
struct GlassPalette {
  let tip: NSColor      // deep colour at the tip
  let middle: NSColor   // saturated band through the body
  let right: NSColor    // light toward the right point
  let lower: NSColor    // pastel toward the tail
  let rim: NSColor      // tint of the upper rim
}

let glassPalettes: [String: GlassPalette] = [
  "claude": GlassPalette(tip: rgb(0xD94400), middle: rgb(0xEE5A1E), right: rgb(0xFFC86B), lower: rgb(0xF08A4C), rim: rgb(0xFFC94A)),
  "codex": GlassPalette(tip: rgb(0x4A10D6), middle: rgb(0x8A35EE), right: rgb(0xD39CFF), lower: rgb(0xE05ADC), rim: rgb(0xC49BFF)),
]

/// The arrow: rounded tip up-left, a right point, a soft notch, a tail point.
func glassPath(tip: CGPoint, scale s: CGFloat) -> NSBezierPath {
  func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: tip.x + x * s, y: tip.y + y * s) }
  let a = p(0, 0), b = p(22.5, 7.6), c = p(13.4, 14.2), d = p(7.9, 22.4)
  let path = NSBezierPath()
  path.move(to: CGPoint(x: (a.x + d.x) / 2, y: (a.y + d.y) / 2))
  path.appendArc(from: a, to: b, radius: 3.6 * s)
  path.appendArc(from: b, to: c, radius: 2.6 * s)
  path.appendArc(from: c, to: d, radius: 1.6 * s)
  path.appendArc(from: d, to: a, radius: 3.0 * s)
  path.close()
  return path
}

func blob(_ color: NSColor, at c: CGPoint, radius r: CGFloat, alpha: CGFloat = 1) {
  NSGradient(colors: [color.withAlphaComponent(alpha), color.withAlphaComponent(alpha * 0.55), color.withAlphaComponent(0)],
             atLocations: [0, 0.45, 1], colorSpace: .deviceRGB)!
    .draw(fromCenter: c, radius: 0, toCenter: c, radius: r, options: [])
}

func drawGlassCursor(_ pal: GlassPalette, tip: CGPoint, scale s: CGFloat) {
  let path = glassPath(tip: tip, scale: s)
  func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: tip.x + x * s, y: tip.y + y * s) }
  // A faint drop shadow keeps it readable on white.
  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow(); shadow.shadowBlurRadius = 3 * s; shadow.shadowOffset = NSSize(width: 0, height: -1 * s)
  shadow.shadowColor = NSColor.black.withAlphaComponent(0.12); shadow.set()
  NSColor.white.setFill(); path.fill()
  NSGraphicsContext.restoreGraphicsState()
  // The colour body: a wash from the tip to the tail, then soft blobs.
  NSGraphicsContext.saveGraphicsState()
  path.addClip()
  NSGradient(colors: [pal.tip, pal.middle, pal.lower, NSColor.white], atLocations: [0, 0.4, 0.72, 1], colorSpace: .deviceRGB)!
    .draw(from: p(2, 2), to: p(10, 22), options: [.drawsBeforeStartingLocation, .drawsAfterEndingLocation])
  blob(pal.right, at: p(19, 8.5), radius: 10 * s, alpha: 1)
  blob(pal.right, at: p(13, 9), radius: 5 * s, alpha: 0.6)
  blob(pal.middle, at: p(8.5, 11), radius: 6 * s, alpha: 0.9)
  blob(pal.tip, at: p(3, 3), radius: 7 * s, alpha: 1)
  blob(NSColor.white, at: p(8.5, 21), radius: 6 * s, alpha: 1)
  // Glass: a thin white rim glowing inward from the edge.
  let rim = NSShadow(); rim.shadowBlurRadius = 1.6 * s; rim.shadowOffset = .zero; rim.shadowColor = NSColor.white.withAlphaComponent(0.85)
  rim.set()
  NSColor.white.withAlphaComponent(0.8).setStroke()
  path.lineWidth = 1.2 * s
  path.stroke()
  NSGraphicsContext.restoreGraphicsState()
  // A tinted highlight right on the top edge.
  NSGraphicsContext.saveGraphicsState()
  path.addClip()
  let top = NSBezierPath(); top.move(to: p(2.2, 0.75)); top.line(to: p(20.5, 6.92))
  pal.rim.setStroke(); top.lineWidth = 1.3 * s; top.lineCapStyle = .round; top.stroke()
  NSGraphicsContext.restoreGraphicsState()
}

final class CursorView: NSView {
  override var isFlipped: Bool { true }
  // The arrow's tip inside the view; room around it for the shadow and ripple.
  static let tip = CGPoint(x: 9, y: 8)
  var palette = glassPalettes["claude"]!

  override func draw(_ dirtyRect: NSRect) {
    drawGlassCursor(palette, tip: CursorView.tip, scale: 1)
  }
}

final class AgentCursor {
  let window: NSWindow
  let view = CursorView(frame: NSRect(x: 0, y: 0, width: 40, height: 40))
  // Real Liquid Glass (macOS 26+) in the arrow's shape under the colour, so
  // the cursor bends and frosts what is behind it; the window server renders
  // it, and the window is tiny and hidden when idle.
  let container = NSView(frame: NSRect(x: 0, y: 0, width: 40, height: 40))
  var hideTimer: Timer?
  var shown = false
  var position: CGPoint?

  init(agent: String) {
    view.palette = glassPalettes[agent] ?? glassPalettes["claude"]!
    window = NSWindow(
      contentRect: view.frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .screenSaver
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    window.sharingType = .none
    container.wantsLayer = true
    if #available(macOS 26.0, *) {
      let host = NSView(frame: container.bounds)
      host.wantsLayer = true
      let glass = NSGlassEffectView(frame: host.bounds)
      glass.cornerRadius = 0
      host.addSubview(glass)
      // The layer is not flipped, unlike the view the arrow is drawn in.
      let arrow = glassPath(tip: CursorView.tip, scale: 1)
      var flip = AffineTransform(translationByX: 0, byY: container.bounds.height)
      flip.scale(x: 1, y: -1)
      arrow.transform(using: flip)
      let mask = CAShapeLayer()
      mask.path = arrow.cgPath
      host.layer?.mask = mask
      container.addSubview(host)
      view.alphaValue = 0.74
    }
    container.addSubview(view)
    window.contentView = container
    window.alphaValue = 0
  }

  /// Global (top-left origin) point → the window origin that puts the tip there.
  func origin(for point: CGPoint) -> CGPoint {
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    return CGPoint(
      x: point.x - CursorView.tip.x,
      y: primaryHeight - point.y - (view.frame.height - CursorView.tip.y))
  }

  func move(to point: CGPoint) {
    let target = origin(for: point)
    if !shown {
      // Appears a little above and to the left, then glides in.
      window.setFrameOrigin(CGPoint(x: target.x - 24, y: target.y + 24))
      window.orderFrontRegardless()
      shown = true
    } else {
      window.orderFrontRegardless()
    }
    // Longer trips take a little longer, like a hand moving a mouse.
    let distance = position.map { hypot($0.x - point.x, $0.y - point.y) } ?? 40
    position = point
    NSAnimationContext.runAnimationGroup { context in
      context.duration = min(0.65, max(0.22, 0.18 + Double(distance) / 1800))
      context.timingFunction = CAMediaTimingFunction(controlPoints: 0.3, 0, 0.15, 1)
      window.animator().alphaValue = 1
      window.animator().setFrameOrigin(target)
    }
    scheduleHide()
  }

  func click(at point: CGPoint) {
    move(to: point)
    guard let layer = container.layer else { return }
    // The layer is not flipped: the tip sits `tip.y` below the top edge.
    let tipInLayer = CGPoint(x: CursorView.tip.x, y: view.frame.height - CursorView.tip.y)
    let ring = CAShapeLayer()
    let radius: CGFloat = 10
    ring.path = CGPath(
      ellipseIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2),
      transform: nil)
    ring.position = tipInLayer
    ring.fillColor = view.palette.middle.withAlphaComponent(0.3).cgColor
    ring.strokeColor = view.palette.tip.withAlphaComponent(0.8).cgColor
    ring.lineWidth = 1.2
    layer.insertSublayer(ring, at: 0)
    let scale = CABasicAnimation(keyPath: "transform.scale")
    scale.fromValue = 0.2
    scale.toValue = 1
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    let group = CAAnimationGroup()
    group.animations = [scale, fade]
    group.duration = 0.45
    group.timingFunction = CAMediaTimingFunction(name: .easeOut)
    ring.opacity = 0
    ring.add(group, forKey: "ripple")
    // The arrow itself presses in and springs back.
    let press = CAKeyframeAnimation(keyPath: "transform.scale")
    press.values = [1, 0.82, 1.04, 1]
    press.keyTimes = [0, 0.35, 0.75, 1]
    press.duration = 0.3
    layer.anchorPoint = CGPoint(x: tipInLayer.x / view.frame.width, y: tipInLayer.y / view.frame.height)
    layer.position = tipInLayer
    layer.add(press, forKey: "press")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { ring.removeFromSuperlayer() }
  }

  func hide() {
    hideTimer?.invalidate()
    guard shown else { return }
    shown = false
    NSAnimationContext.runAnimationGroup({ context in
      context.duration = 0.3
      window.animator().alphaValue = 0
    }, completionHandler: { [weak self] in
      if self?.shown == false { self?.window.orderOut(nil) }
    })
  }

  // Fades out when the agent stops acting for a while.
  func scheduleHide() {
    hideTimer?.invalidate()
    hideTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
      self?.hide()
    }
  }
}

func runCursor(agent: String) -> Never {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let cursor = AgentCursor(agent: agent)
  // Ends with Code Atlas's MCP server: its stdin closes.
  Thread.detachNewThread {
    while let line = readLine() {
      let parts = line.split(separator: " ").map(String.init)
      DispatchQueue.main.async {
        switch parts.first {
        case "move" where parts.count == 3:
          if let x = Double(parts[1]), let y = Double(parts[2]) { cursor.move(to: CGPoint(x: x, y: y)) }
        case "click" where parts.count == 3:
          if let x = Double(parts[1]), let y = Double(parts[2]) { cursor.click(at: CGPoint(x: x, y: y)) }
        case "hide":
          cursor.hide()
        case "quit":
          exit(0)
        default:
          break
        }
      }
    }
    exit(0)
  }
  app.run()
  exit(0)
}

// MARK: - Commands

guard args.count >= 2 else { fail("No command.") }

switch args[1] {
case "permissions":
  emit([
    "ok": true,
    "screenRecording": CGPreflightScreenCaptureAccess(),
    "accessibility": AXIsProcessTrusted(),
  ])

case "request":
  // The system prompts, attributed to Code Atlas: Screen Recording adds Code
  // Atlas to its list; Accessibility opens its own dialog.
  let which = args.count > 2 ? args[2] : ""
  var screen = CGPreflightScreenCaptureAccess()
  var accessibility = AXIsProcessTrusted()
  if which == "screen" && !screen {
    screen = CGRequestScreenCaptureAccess()
  }
  if which == "accessibility" && !accessibility {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    accessibility = AXIsProcessTrustedWithOptions(options)
  }
  emit(["ok": true, "screenRecording": screen, "accessibility": accessibility])

case "windows":
  emit(["ok": true, "windows": windows()])

case "display":
  let bounds = CGDisplayBounds(CGMainDisplayID())
  emit([
    "ok": true, "x": bounds.origin.x, "y": bounds.origin.y,
    "width": bounds.width, "height": bounds.height,
  ])

case "tree":
  // tree <pid> <x> <y> <width> <height>: the screen window's bounds pick the AX window.
  let frame = CGRect(x: number(3), y: number(4), width: number(5), height: number(6))
  emit(["ok": true, "elements": accessibleElements(pid: pid_t(number(2)), near: frame)])

case "setvalue":
  // setvalue <pid> <x> <y> <text>
  guard args.count > 5 else { fail("No text.") }
  let done = setAccessibleValue(pid: pid_t(number(2)), at: CGPoint(x: number(3), y: number(4)), text: args[5])
  emit(["ok": done, "error": done ? "" : "That element does not take a value; click it and use computer_type."])

case "activate":
  let pid = pid_t(number(2))
  guard let app = NSRunningApplication(processIdentifier: pid) else { fail("That app is not running.") }
  app.activate(options: [.activateAllWindows])
  pause(250)
  emit(["ok": true])

case "click":
  let target = delivery(pidAt: 2, windowAt: 3, modeAt: 4)
  let point = CGPoint(x: number(5), y: number(6))
  let right = args.count > 7 && args[7] == "right"
  let count = max(1, min(3, Int(args.count > 8 ? number(8) : 1)))
  let button: CGMouseButton = right ? .right : .left
  if target.background && count == 1
    && pressAccessibleControl(
      pid: target.pid, at: point, action: right ? kAXShowMenuAction : kAXPressAction)
  {
    emit(["ok": true, "via": "accessibility"])
    exit(0)
  }
  target.keepingUserPointer {
    target.mouse(.mouseMoved, point, button)
    pause(40)
    for index in 1...count {
      target.mouse(right ? .rightMouseDown : .leftMouseDown, point, button, clickState: Int64(index))
      pause(60)
      target.mouse(right ? .rightMouseUp : .leftMouseUp, point, button, clickState: Int64(index))
      pause(60)
    }
  }
  emit(["ok": true])

case "drag":
  let target = delivery(pidAt: 2, windowAt: 3, modeAt: 4)
  let from = CGPoint(x: number(5), y: number(6))
  let to = CGPoint(x: number(7), y: number(8))
  target.keepingUserPointer {
    target.mouse(.mouseMoved, from, .left)
    pause(40)
    target.mouse(.leftMouseDown, from, .left)
    let steps = 12
    for step in 1...steps {
      let t = Double(step) / Double(steps)
      pause(16)
      target.mouse(
        .leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t),
        .left)
    }
    pause(40)
    target.mouse(.leftMouseUp, to, .left)
  }
  emit(["ok": true])

case "scroll":
  let target = delivery(pidAt: 2, windowAt: 3, modeAt: 4)
  let point = CGPoint(x: number(5), y: number(6))
  target.keepingUserPointer {
    target.mouse(.mouseMoved, point, .left)
    pause(40)
    let event = CGEvent(
      scrollWheelEvent2Source: target.source, units: .pixel, wheelCount: 2,
      wheel1: Int32(number(8)), wheel2: Int32(number(7)), wheel3: 0)
    event?.location = point
    target.post(event)
  }
  emit(["ok": true])

case "key":
  let target = delivery(pidAt: 2, windowAt: nil, modeAt: 3)
  let keyCode = CGKeyCode(number(4))
  let flags = CGEventFlags(rawValue: UInt64(number(5)))
  let hold = args.count > 6 ? number(6) : 0
  target.key(keyCode, down: true, flags: flags)
  pause(hold > 0 ? hold : 30)
  target.key(keyCode, down: false, flags: flags)
  emit(["ok": true])

case "type":
  let target = delivery(pidAt: 2, windowAt: nil, modeAt: 3)
  guard args.count > 4 else { fail("No text.") }
  if target.background && insertIntoFocusedField(pid: target.pid, text: args[4]) {
    emit(["ok": true, "via": "accessibility"])
    exit(0)
  }
  // In small chunks: some apps read only the first characters of one event.
  let units = Array(args[4].utf16)
  var index = 0
  while index < units.count {
    let chunk = Array(units[index..<min(index + 16, units.count)])
    for keyDown in [true, false] {
      let event = CGEvent(keyboardEventSource: target.source, virtualKey: 0, keyDown: keyDown)
      event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
      target.post(event)
    }
    pause(20)
    index += 16
  }
  emit(["ok": true])

case "cursor":
  runCursor(agent: args.count > 2 ? args[2] : "claude")

default:
  fail("Unknown command \(args[1]).")
}
