// Code Atlas: the native half of Claude's computer use on this Mac, like
// Codex's: Claude gets its own gray cursor, and its clicks and keys go straight
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
//   atlas-computer activate <pid>
//   atlas-computer click <pid> <windowId> <background|foreground> <x> <y> <left|right> <count>
//   atlas-computer drag <pid> <windowId> <mode> <x1> <y1> <x2> <y2>
//   atlas-computer scroll <pid> <windowId> <mode> <x> <y> <dx> <dy>
//   atlas-computer key <pid> <mode> <keycode> <flags> <holdMs>
//   atlas-computer type <pid> <mode> <text>
//   atlas-computer cursor        (stdin: "move x y", "click x y", "hide", "quit")
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

/// Claude's own pointer: a gray arrow that glides to where Claude acts and
/// ripples on clicks. Click-through, above everything, on every Space, and
/// left out of screen captures so Claude's screenshots show the app alone.
final class CursorView: NSView {
  override var isFlipped: Bool { true }
  static let tip = CGPoint(x: 18, y: 18)

  override func draw(_ dirtyRect: NSRect) {
    let tip = CursorView.tip
    let arrow = NSBezierPath()
    arrow.move(to: tip)
    arrow.line(to: CGPoint(x: tip.x, y: tip.y + 21))
    arrow.line(to: CGPoint(x: tip.x + 5, y: tip.y + 16.5))
    arrow.line(to: CGPoint(x: tip.x + 8.5, y: tip.y + 24))
    arrow.line(to: CGPoint(x: tip.x + 11.5, y: tip.y + 22.5))
    arrow.line(to: CGPoint(x: tip.x + 8, y: tip.y + 15.5))
    arrow.line(to: CGPoint(x: tip.x + 14.5, y: tip.y + 15.5))
    arrow.close()
    arrow.lineJoinStyle = .round
    let shadow = NSShadow()
    shadow.shadowBlurRadius = 3
    shadow.shadowOffset = NSSize(width: 0, height: -1)
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.45)
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor(calibratedWhite: 0.42, alpha: 1).setFill()
    arrow.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSColor.white.setStroke()
    arrow.lineWidth = 1.5
    arrow.stroke()
  }
}

final class AgentCursor {
  let window: NSWindow
  let view = CursorView(frame: NSRect(x: 0, y: 0, width: 52, height: 52))
  var hideTimer: Timer?
  var shown = false

  init() {
    window = NSWindow(
      contentRect: view.frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .screenSaver
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    window.sharingType = .none
    window.contentView = view
    view.wantsLayer = true
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
      window.setFrameOrigin(target)
      window.orderFrontRegardless()
      shown = true
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.18
        window.animator().alphaValue = 1
      }
    } else {
      window.orderFrontRegardless()
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.32
        context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        window.animator().alphaValue = 1
        window.animator().setFrameOrigin(target)
      }
    }
    scheduleHide()
  }

  func click(at point: CGPoint) {
    move(to: point)
    guard let layer = view.layer else { return }
    let ring = CAShapeLayer()
    let radius: CGFloat = 14
    ring.path = CGPath(
      ellipseIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2),
      transform: nil)
    // The layer is not flipped: the tip sits `tip.y` below the top edge.
    ring.position = CGPoint(x: CursorView.tip.x, y: view.frame.height - CursorView.tip.y)
    ring.fillColor = NSColor(calibratedWhite: 0.42, alpha: 0.35).cgColor
    ring.strokeColor = NSColor.white.withAlphaComponent(0.8).cgColor
    ring.lineWidth = 1
    layer.addSublayer(ring)
    let scale = CABasicAnimation(keyPath: "transform.scale")
    scale.fromValue = 0.3
    scale.toValue = 1
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    let group = CAAnimationGroup()
    group.animations = [scale, fade]
    group.duration = 0.4
    group.timingFunction = CAMediaTimingFunction(name: .easeOut)
    ring.opacity = 0
    ring.add(group, forKey: "ripple")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { ring.removeFromSuperlayer() }
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

  // Fades out when Claude stops acting for a while.
  func scheduleHide() {
    hideTimer?.invalidate()
    hideTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
      self?.hide()
    }
  }
}

func runCursor() -> Never {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let cursor = AgentCursor()
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
  runCursor()

default:
  fail("Unknown command \(args[1]).")
}
