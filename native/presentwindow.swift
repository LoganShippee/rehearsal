// "Full screen" that stays on the current desktop.
// macOS full screen moves a window to its own Space, so bringing another app (MuseScore) forward
// would yank the teacher to a different desktop. Instead we cover the screen with an ordinary
// window and auto-hide the menu bar and Dock while Rehearsal is in front.

import Cocoa
import WebKit

final class RehearsalWindow: NSWindow {
    private var savedFrame: NSRect?
    private var savedStyle: NSWindow.StyleMask = []
    var isCovering: Bool { savedFrame != nil }
    private var compSavedFrame: NSRect?
    private var compSavedStyle: NSWindow.StyleMask = []
    private var compSavedCover = false
    private var compDragMouse: NSPoint?
    private var compDragOrigin: NSPoint?
    var isCompanion: Bool { compSavedFrame != nil }

    // Borderless windows normally can't take keyboard focus; ours must.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func sendEvent(_ event: NSEvent) {
        if isCompanion {
            switch event.type {
            case .leftMouseDown:
                compDragMouse = NSEvent.mouseLocation
                compDragOrigin = frame.origin
            case .leftMouseDragged:
                if let startMouse = compDragMouse, let startOrigin = compDragOrigin {
                    let cur = NSEvent.mouseLocation
                    let dx = cur.x - startMouse.x, dy = cur.y - startMouse.y
                    if hypot(dx, dy) > 3 {
                        setFrameOrigin(NSPoint(x: startOrigin.x + dx, y: startOrigin.y + dy))
                    }
                }
            case .leftMouseUp:
                compDragMouse = nil
                compDragOrigin = nil
            default: break
            }
        }
        super.sendEvent(event)
    }

    /// The green button and ⌃⌘F come here instead of macOS full screen.
    override func toggleFullScreen(_ sender: Any?) { toggleCover() }

    func toggleCover() {
        if let f = savedFrame {
            styleMask = savedStyle
            setFrame(f, display: true, animate: false)
            savedFrame = nil
            NSApp.presentationOptions = []
            setSafeTop(0)
        } else {
            let screen = self.screen ?? NSScreen.main
            guard let s = screen else { return }
            savedFrame = frame
            savedStyle = styleMask
            styleMask = [.borderless, .fullSizeContentView]
            setFrame(s.frame, display: true, animate: false)
            NSApp.presentationOptions = [.autoHideMenuBar, .autoHideDock]
            makeKeyAndOrderFront(nil)
            // Keep content clear of the camera notch (0 on screens without one).
            var top: CGFloat = 0
            if #available(macOS 12.0, *) { top = s.safeAreaInsets.top }
            setSafeTop(top)
        }
    }

    /// Re-send the notch spacing (the page asks after every load/reload).
    func refreshSafeTop() {
        var top: CGFloat = 0
        if isCovering, let s = screen, #available(macOS 12.0, *) { top = s.safeAreaInsets.top }
        setSafeTop(top)
    }

    /// Tells the page how much space to leave at the top.
    private func setSafeTop(_ px: CGFloat) {
        let wv = contentView?.subviews.first(where: { $0 is HoleWebView }) as? WKWebView
        wv?.evaluateJavaScript("document.documentElement.style.setProperty('--safe-top', '\(Int(px.rounded(.up)))px')")
    }

    /// Morph Rehearsal into a compact, draggable 300x88 floating Mini-HUD at the bottom-right
    /// and activate the chosen desktop app at its normal full size.
    func enterCompanion(stripHeight: CGFloat = 88, bundleId: String?, pid: Int32?) {
        let screen = self.screen ?? NSScreen.main
        guard let s = screen else { return }
        if !isCompanion {
            compSavedCover = isCovering
            compSavedFrame = savedFrame ?? frame
            compSavedStyle = isCovering ? savedStyle : styleMask
            savedFrame = nil
        }
        let vf = s.visibleFrame
        NSApp.presentationOptions = []
        styleMask = [.borderless, .fullSizeContentView]
        level = .floating
        isMovableByWindowBackground = true
        hasShadow = true
        isOpaque = false
        backgroundColor = .clear
        minSize = NSSize(width: 200, height: 60)
        contentView?.wantsLayer = true
        contentView?.layer?.cornerRadius = 14
        contentView?.layer?.masksToBounds = true
        let hudW: CGFloat = 300, hudH: CGFloat = 88, pad: CGFloat = 16
        let hudFrame = NSRect(x: vf.maxX - hudW - pad, y: vf.minY + pad, width: hudW, height: hudH)
        setFrame(hudFrame, display: true, animate: false)
        invalidateShadow()
        setSafeTop(0)
        orderFrontRegardless()

        let targetApp: NSRunningApplication? = {
            if let pid, pid > 0, let a = NSRunningApplication(processIdentifier: pid) { return a }
            if let bundleId, !bundleId.isEmpty { return NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first }
            return nil
        }()
        if let targetApp {
            targetApp.unhide()
            targetApp.activate(options: [.activateIgnoringOtherApps])
        }
    }

    func exitCompanion() {
        guard let f = compSavedFrame else { return }
        let wasCover = compSavedCover
        let st = compSavedStyle
        compSavedFrame = nil; compSavedCover = false
        compDragMouse = nil; compDragOrigin = nil
        level = .normal
        isMovableByWindowBackground = false
        isOpaque = true
        backgroundColor = NSColor(red: 0.04, green: 0.22, blue: 0.33, alpha: 1)
        minSize = NSSize(width: 720, height: 480)
        contentView?.layer?.cornerRadius = 0
        contentView?.layer?.masksToBounds = false
        if wasCover, let s = self.screen ?? NSScreen.main {
            savedFrame = f; savedStyle = st
            styleMask = [.borderless, .fullSizeContentView]
            setFrame(s.frame, display: true, animate: false)
            NSApp.presentationOptions = [.autoHideMenuBar, .autoHideDock]
            refreshSafeTop()
        } else {
            styleMask = st
            setFrame(f, display: true, animate: false)
            NSApp.presentationOptions = []
            setSafeTop(0)
        }
        invalidateShadow()
        makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

extension AppDelegate {
    /// Re-hide the menu bar/Dock when coming back to Rehearsal while covering the screen,
    /// and let them show normally while another app (e.g. MuseScore) is in front.
    func watchPresentationOptions() {
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            if self.windows.contains(where: { ($0 as? RehearsalWindow)?.isCovering == true }) {
                NSApp.presentationOptions = [.autoHideMenuBar, .autoHideDock]
            }
        }
    }
}
