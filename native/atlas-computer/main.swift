// Code Atlas: the native half of Claude's computer use on this Mac. It lists
// windows and posts mouse and keyboard events; screenshots use the system's
// screencapture. It runs as a child of Code Atlas, so it uses Code Atlas's own
// Screen Recording and Accessibility permissions and never asks for its own.
// Every command prints one JSON object on stdout.
//
//   atlas-computer permissions
//   atlas-computer windows
//   atlas-computer display
//   atlas-computer activate <pid>
//   atlas-computer click <x> <y> <left|right> <count>
//   atlas-computer move <x> <y>
//   atlas-computer drag <x1> <y1> <x2> <y2>
//   atlas-computer scroll <x> <y> <dx> <dy>
//   atlas-computer key <keycode> <flags> <holdMs>
//   atlas-computer type <text>
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func emit(_ object: Any) {
  let data = (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String) -> Never {
  emit(["ok": false, "error": message])
  exit(1)
}

func number(_ index: Int) -> Double {
  let args = CommandLine.arguments
  guard index < args.count, let value = Double(args[index]) else {
    fail("Missing or invalid argument \(index).")
  }
  return value
}

func post(_ event: CGEvent?) {
  event?.post(tap: .cghidEventTap)
}

// Events need a short gap: apps (and emulators especially) drop a down and up
// that arrive in the same instant.
func pause(_ milliseconds: Double) {
  usleep(useconds_t(max(0, milliseconds) * 1000))
}

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

func mouse(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, clickState: Int64 = 1) {
  let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
  event?.setIntegerValueField(.mouseEventClickState, value: clickState)
  post(event)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("No command.") }

switch args[1] {
case "permissions":
  emit([
    "ok": true,
    "screenRecording": CGPreflightScreenCaptureAccess(),
    "accessibility": AXIsProcessTrusted(),
  ])

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
  let point = CGPoint(x: number(2), y: number(3))
  let right = args.count > 4 && args[4] == "right"
  let count = max(1, min(3, Int(args.count > 5 ? number(5) : 1)))
  let button: CGMouseButton = right ? .right : .left
  mouse(.mouseMoved, point, button)
  pause(40)
  for index in 1...count {
    mouse(right ? .rightMouseDown : .leftMouseDown, point, button, clickState: Int64(index))
    pause(60)
    mouse(right ? .rightMouseUp : .leftMouseUp, point, button, clickState: Int64(index))
    pause(60)
  }
  emit(["ok": true])

case "move":
  mouse(.mouseMoved, CGPoint(x: number(2), y: number(3)), .left)
  emit(["ok": true])

case "drag":
  let from = CGPoint(x: number(2), y: number(3))
  let to = CGPoint(x: number(4), y: number(5))
  mouse(.mouseMoved, from, .left)
  pause(40)
  mouse(.leftMouseDown, from, .left)
  let steps = 12
  for step in 1...steps {
    let t = Double(step) / Double(steps)
    let point = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
    pause(16)
    mouse(.leftMouseDragged, point, .left)
  }
  pause(40)
  mouse(.leftMouseUp, to, .left)
  emit(["ok": true])

case "scroll":
  mouse(.mouseMoved, CGPoint(x: number(2), y: number(3)), .left)
  pause(40)
  let event = CGEvent(
    scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
    wheel1: Int32(number(5)), wheel2: Int32(number(4)), wheel3: 0)
  post(event)
  emit(["ok": true])

case "key":
  let keyCode = CGKeyCode(number(2))
  let flags = CGEventFlags(rawValue: UInt64(number(3)))
  let hold = args.count > 4 ? number(4) : 0
  let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true)
  down?.flags = flags
  post(down)
  pause(hold > 0 ? hold : 30)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
  up?.flags = flags
  post(up)
  emit(["ok": true])

case "type":
  guard args.count > 2 else { fail("No text.") }
  // In small chunks: some apps read only the first characters of one event.
  let units = Array(args[2].utf16)
  var index = 0
  while index < units.count {
    let chunk = Array(units[index..<min(index + 16, units.count)])
    for keyDown in [true, false] {
      let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: keyDown)
      event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
      post(event)
    }
    pause(20)
    index += 16
  }
  emit(["ok": true])

default:
  fail("Unknown command \(args[1]).")
}
