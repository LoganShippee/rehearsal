// Show another Mac app's window (e.g. MuseScore) live inside the Present screen, and pass
// clicks / scrolling / typing through to it. Uses ScreenCaptureKit for the picture (needs
// Screen Recording permission) and posts input events to that app (needs Accessibility).

import Cocoa
import ScreenCaptureKit
import ApplicationServices

/// Small diagnostic log: ~/Library/Application Support/Rehearsal/debug.log
func rehearsalLog(_ msg: String) {
    let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Rehearsal/debug.log")
    let line = "\(Date()) \(msg)\n"
    if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
    else { try? line.write(to: url, atomically: true, encoding: .utf8) }
}

enum AppCapture {
    static var hasScreenAccess: Bool { CGPreflightScreenCaptureAccess() }
    static var hasInputAccess: Bool { AXIsProcessTrusted() }
    static func requestScreen() { _ = CGRequestScreenCaptureAccess() }
    static func requestInput() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
    }

    /// Running desktop apps for Companion Split-Screen (needs zero Screen Recording permissions).
    static func listRunningApps() -> [[String: Any]] {
        let me = ProcessInfo.processInfo.processIdentifier
        let skip = Set(["com.apple.dock", "com.apple.controlcenter", "com.apple.systemuiserver", "com.apple.WindowManager", "com.apple.notificationcenterui", "com.apple.finder"])
        return NSWorkspace.shared.runningApplications.compactMap { app in
            guard app.activationPolicy == .regular, app.processIdentifier != me,
                  let name = app.localizedName, let bid = app.bundleIdentifier, !skip.contains(bid) else { return nil }
            return ["app": name, "bundleId": bid, "pid": Int(app.processIdentifier), "title": "", "onScreen": !app.isHidden]
        }.sorted { ($0["app"] as! String).localizedCaseInsensitiveCompare($1["app"] as! String) == .orderedAscending }
    }

    /// Windows of other apps that can be mirrored.
    static func listWindows() async -> [[String: Any]] {
        guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false) else { return [] }
        let me = ProcessInfo.processInfo.processIdentifier
        return content.windows.compactMap { w in
            guard let app = w.owningApplication, app.processID != me, w.windowLayer == 0,
                  w.frame.width > 120, w.frame.height > 90 else { return nil }
            let skip = ["com.apple.dock", "com.apple.controlcenter", "com.apple.systemuiserver", "com.apple.WindowManager", "com.apple.notificationcenterui"]
            if skip.contains(app.bundleIdentifier) { return nil }
            return ["windowID": Int(w.windowID), "app": app.applicationName, "bundleId": app.bundleIdentifier,
                    "title": w.title ?? "", "onScreen": w.isOnScreen]
        }.sorted { ($0["app"] as! String, $0["title"] as! String) < ($1["app"] as! String, $1["title"] as! String) }
    }

    static func bounds(of id: CGWindowID) -> CGRect? {
        guard let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]],
              let d = info.first?[kCGWindowBounds as String] as? NSDictionary,
              let r = CGRect(dictionaryRepresentation: d) else { return nil }
        return r
    }
}

final class AppMirrorView: NSView, SCStreamOutput, SCStreamDelegate {
    var windowID: CGWindowID
    let bundleId: String
    var wantedTitle: String
    var pid: pid_t = 0
    var onState: (([String: Any]) -> Void)?
    private var stream: SCStream?
    private let imageLayer = CALayer()
    private let label = NSTextField(wrappingLabelWithString: "")
    private var lastSize = CGSize.zero
    private var retryTimer: Timer?
    private var sizeTimer: Timer?
    private var tracking: NSTrackingArea?

    init(windowID: CGWindowID, bundleId: String, title: String) {
        self.windowID = windowID; self.bundleId = bundleId; self.wantedTitle = title
        super.init(frame: .zero)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor(white: 0.12, alpha: 1).cgColor
        imageLayer.contentsGravity = .resizeAspect
        imageLayer.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
        layer?.addSublayer(imageLayer)
        label.textColor = .white
        label.font = .systemFont(ofSize: 18, weight: .medium)
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, multiplier: 0.85),
        ])
        Task { await self.start() }
    }
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func layout() { super.layout(); imageLayer.frame = bounds }

    func stop() {
        retryTimer?.invalidate(); sizeTimer?.invalidate()
        stream?.stopCapture(completionHandler: nil); stream = nil
    }
    override func removeFromSuperview() { stop(); super.removeFromSuperview() }

    private func show(_ msg: String) {
        label.stringValue = msg
        label.isHidden = msg.isEmpty
    }

    @MainActor
    func start() async {
        guard AppCapture.hasScreenAccess else {
            show("Rehearsal needs Screen Recording permission to show other apps.\nSystem Settings → Privacy & Security → Screen & System Audio Recording")
            onState?(["status": "needs-screen"]); scheduleRetry(); return
        }
        guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false) else {
            show("Couldn't look up windows."); scheduleRetry(); return
        }
        let mine = content.windows.filter { $0.owningApplication?.bundleIdentifier == bundleId && $0.windowLayer == 0 && $0.frame.width > 120 }
        let w = mine.first(where: { $0.windowID == windowID })
            ?? mine.first(where: { ($0.title ?? "") == wantedTitle && !wantedTitle.isEmpty })
            ?? mine.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
        guard let w, let app = w.owningApplication else {
            let name = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId)?.deletingPathExtension().lastPathComponent ?? "The app"
            show("\(name) isn't open.\nOpen it and its window will appear here.")
            onState?(["status": "not-running"]); scheduleRetry(); return
        }
        retryTimer?.invalidate()
        windowID = w.windowID; pid = app.processID; wantedTitle = w.title ?? wantedTitle
        onState?(["status": "ok", "windowID": Int(w.windowID), "title": w.title ?? "", "app": app.applicationName])
        let cfg = makeConfig(size: w.frame.size)
        let s = SCStream(filter: SCContentFilter(desktopIndependentWindow: w), configuration: cfg, delegate: self)
        do {
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
            try await s.startCapture()
            stream = s; lastSize = w.frame.size; show("")
            onState?(["event": "size", "width": Double(w.frame.width), "height": Double(w.frame.height)])
            sizeTimer?.invalidate()
            sizeTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.checkSize() }
        } catch {
            show("Couldn't show this window: \(error.localizedDescription)"); scheduleRetry()
        }
    }

    private func makeConfig(size: CGSize) -> SCStreamConfiguration {
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        let cfg = SCStreamConfiguration()
        cfg.width = max(2, Int(size.width * scale)); cfg.height = max(2, Int(size.height * scale))
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.showsCursor = false
        cfg.queueDepth = 4
        if #available(macOS 14.0, *) {
            // Drop the window's soft shadow (it was being captured as a see-through border, which
            // also threw click positions off) and flatten translucent sidebars into solid pixels.
            cfg.ignoreShadowsSingleWindow = true
            cfg.shouldBeOpaque = true
        }
        return cfg
    }

    private func checkSize() {
        guard let b = AppCapture.bounds(of: windowID) else {
            stop(); show("The window was closed."); onState?(["status": "closed"]); scheduleRetry(); return
        }
        if abs(b.width - lastSize.width) > 1 || abs(b.height - lastSize.height) > 1 {
            lastSize = b.size
            stream?.updateConfiguration(makeConfig(size: b.size), completionHandler: nil)
            onState?(["event": "size", "width": Double(b.width), "height": Double(b.height)])
        }
    }

    private func scheduleRetry() {
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
            guard let self, self.superview != nil else { return }
            Task { await self.start() }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let pb = sb.imageBuffer else { return }
        if let att = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let raw = att.first?[.status] as? Int, let st = SCFrameStatus(rawValue: raw), st != .complete { return }
        if let surf = CVPixelBufferGetIOSurface(pb)?.takeUnretainedValue() { imageLayer.contents = surf }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { self.stream = nil; self.show("Reconnecting…"); self.scheduleRetry() }
    }

    // MARK: input → the other app
    private func fitRect(_ content: CGSize) -> CGRect {
        guard content.width > 0, content.height > 0, bounds.width > 0 else { return .zero }
        let s = min(bounds.width / content.width, bounds.height / content.height)
        let w = content.width * s, h = content.height * s
        return CGRect(x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, width: w, height: h)
    }

    /// Where a point in this view lands on the real window, in global screen coordinates.
    private func target(_ e: NSEvent) -> CGPoint? {
        guard let b = AppCapture.bounds(of: windowID) else { return nil }
        let p = convert(e.locationInWindow, from: nil)
        let f = fitRect(b.size)
        guard f.width > 0, f.contains(p) || e.type != .leftMouseDown else { return nil }
        let nx = min(max((p.x - f.minX) / f.width, 0), 1), ny = min(max((p.y - f.minY) / f.height, 0), 1)
        return CGPoint(x: b.minX + nx * b.width, y: b.minY + ny * b.height)
    }

    private var warned = false
    private func ensureInput() -> Bool {
        if AppCapture.hasInputAccess { return true }
        if !warned { warned = true; AppCapture.requestInput() }
        onState?(["status": "needs-input"])
        return false
    }

    private func tag(_ ev: CGEvent) {
        ev.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowID))
        ev.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowID))
    }

    // MARK: Edit in place
    // Many apps (MuseScore included) ignore clicks sent to them in the background. So a click on the
    // live view moves the REAL window exactly onto this spot, brings it to the front, and replays the
    // click there. Clicking anywhere in Rehearsal again ends editing (the live view takes over).
    private(set) var editing = false
    private var activeObserver: NSObjectProtocol?

    override func mouseDown(with e: NSEvent) { beginEditing(clickAt: NSEvent.mouseLocation) }
    override func rightMouseDown(with e: NSEvent) { beginEditing(clickAt: nil) }

    private func axFrame(_ w: AXUIElement) -> CGRect? {
        var pv: CFTypeRef?, sv: CFTypeRef?
        guard AXUIElementCopyAttributeValue(w, kAXPositionAttribute as CFString, &pv) == .success,
              AXUIElementCopyAttributeValue(w, kAXSizeAttribute as CFString, &sv) == .success else { return nil }
        var p = CGPoint.zero, s = CGSize.zero
        AXValueGetValue(pv as! AXValue, .cgPoint, &p)
        AXValueGetValue(sv as! AXValue, .cgSize, &s)
        return CGRect(origin: p, size: s)
    }

    /// The accessibility handle for the exact window we're showing.
    private func axWindow() -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &v) == .success,
              let wins = v as? [AXUIElement], !wins.isEmpty else { return nil }
        if let b = AppCapture.bounds(of: windowID) {
            for w in wins {
                if let f = axFrame(w), abs(f.minX - b.minX) < 4, abs(f.minY - b.minY) < 4,
                   abs(f.width - b.width) < 4, abs(f.height - b.height) < 4 { return w }
            }
        }
        for w in wins {
            var t: CFTypeRef?
            AXUIElementCopyAttributeValue(w, kAXTitleAttribute as CFString, &t)
            if let t = t as? String, !wantedTitle.isEmpty, t == wantedTitle { return w }
        }
        return wins.first
    }

    /// This view's rectangle in global top-left screen coordinates (what Accessibility uses).
    private func screenRectTopLeft() -> CGRect? {
        guard let win = window, let primary = NSScreen.screens.first else { return nil }
        let r = win.convertToScreen(convert(bounds, to: nil))
        return CGRect(x: r.minX, y: primary.frame.maxY - r.maxY, width: r.width, height: r.height)
    }

    func beginEditing(clickAt cocoaPoint: NSPoint?) {
        guard pid != 0 else { return }
        guard AppCapture.hasInputAccess else { _ = ensureInput(); return }
        guard let w = axWindow(), let r = screenRectTopLeft(), let real = axFrame(w) else {
            bringAppToFront(); return
        }
        // Never resize the app. Move it (same size) so it sits exactly where the live view draws it.
        AXUIElementSetAttributeValue(w, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        let fit = fitRect(real.size)   // where the picture is drawn inside this view
        var origin = CGPoint(x: r.minX + fit.minX, y: r.minY + fit.minY)
        if let pv = AXValueCreate(.cgPoint, &origin) { AXUIElementSetAttributeValue(w, kAXPositionAttribute as CFString, pv) }
        // Where the teacher clicked, as a fraction of the picture, mapped onto the real window.
        var replay: CGPoint? = nil
        if let pt = cocoaPoint, let win = window, fit.width > 0 {
            let local = convert(win.convertPoint(fromScreen: pt), from: nil)
            let nx = (local.x - fit.minX) / fit.width, ny = (local.y - fit.minY) / fit.height
            if nx >= 0, nx <= 1, ny >= 0, ny <= 1 {
                replay = CGPoint(x: origin.x + nx * real.width, y: origin.y + ny * real.height)
            }
        }
        AXUIElementPerformAction(w, kAXRaiseAction as CFString)
        AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
        makeFrontmost()
        editing = true
        onState?(["status": "editing"])
        watchForReturn()
        // Replay the click that started editing so it lands where the teacher aimed.
        if let cg = replay {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                for type in [CGEventType.leftMouseDown, .leftMouseUp] {
                    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: cg, mouseButton: .left)?.post(tap: .cghidEventTap)
                }
            }
        }
    }

    /// Editing ends as soon as Rehearsal becomes the active app again (the teacher clicked it).
    private func watchForReturn() {
        if activeObserver != nil { return }
        activeObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, self.editing else { return }
            self.editing = false
            self.onState?(["status": "ok", "windowID": Int(self.windowID), "title": self.wantedTitle])
        }
    }

    override func scrollWheel(with e: NSEvent) {
        // Scrolling the live view works for apps that accept background scrolling; otherwise click to edit.
        guard pid != 0, AppCapture.hasInputAccess, let pt = target(e) else { return }
        let precise = e.hasPreciseScrollingDeltas
        guard let ev = CGEvent(scrollWheelEvent2Source: nil, units: precise ? .pixel : .line, wheelCount: 2,
                               wheel1: Int32(e.scrollingDeltaY), wheel2: Int32(e.scrollingDeltaX), wheel3: 0) else { return }
        ev.location = pt
        tag(ev)
        ev.postToPid(pid)
    }

    /// macOS 14+ ignores one app simply asking another to come forward, so hand over activation
    /// politely and also ask through Accessibility (which is allowed once permission is granted).
    private func makeFrontmost() {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return }
        if #available(macOS 14.0, *) {
            NSApp.yieldActivation(to: app)
            app.activate(from: NSRunningApplication.current, options: [])
        } else {
            app.activate(options: [])
        }
        AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    }

    /// Tiling an app window: resize the real window (only when the teacher asks for it).
    func resizeReal(to size: CGSize) {
        guard AppCapture.hasInputAccess, let w = axWindow() else { return }
        var sz = size
        if let sv = AXValueCreate(.cgSize, &sz) { AXUIElementSetAttributeValue(w, kAXSizeAttribute as CFString, sv) }
    }

    func bringAppToFront() {
        if let w = axWindow() { AXUIElementPerformAction(w, kAXRaiseAction as CFString) }
        makeFrontmost()
    }
}
