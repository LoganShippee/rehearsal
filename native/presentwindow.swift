// "Full screen" that stays on the current desktop.
// macOS full screen moves a window to its own Space, so bringing another app (MuseScore) forward
// would yank the teacher to a different desktop. Instead we cover the screen with an ordinary
// window and auto-hide the menu bar and Dock while Rehearsal is in front.

import Cocoa
import WebKit
import ApplicationServices

final class RehearsalWindow: NSWindow {
    private var savedFrame: NSRect?
    private var savedStyle: NSWindow.StyleMask = []
    var isCovering: Bool { savedFrame != nil }
    private var compSavedFrame: NSRect?
    private var compSavedStyle: NSWindow.StyleMask = []
    private var compSavedCover = false
    var isCompanion: Bool { compSavedFrame != nil }

    // Borderless windows normally can't take keyboard focus; ours must.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

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

    /// Dock Rehearsal into a slim 40px top control strip and bring the chosen desktop app forward below it.
    func enterCompanion(stripHeight: CGFloat = 40, bundleId: String?, pid: Int32?) {
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
        let stripFrame = NSRect(x: vf.minX, y: vf.maxY - stripHeight, width: vf.width, height: stripHeight)
        setFrame(stripFrame, display: true, animate: false)
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
            // Best-effort tile target app's front window below the 40px strip if Accessibility is trusted.
            if AXIsProcessTrusted() {
                let targetPid = targetApp.processIdentifier
                let primaryMaxY = NSScreen.screens.first?.frame.maxY ?? s.frame.maxY
                let axPos = CGPoint(x: vf.minX, y: (primaryMaxY - vf.maxY) + stripHeight)
                let axSize = CGSize(width: vf.width, height: max(200, vf.height - stripHeight))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    let axApp = AXUIElementCreateApplication(targetPid)
                    var ref: CFTypeRef?
                    if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &ref) == .success, let ref {
                        let win = ref as! AXUIElement
                        var p = axPos, sz = axSize
                        if let pv = AXValueCreate(.cgPoint, &p) { AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, pv) }
                        if let sv = AXValueCreate(.cgSize, &sz) { AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, sv) }
                    }
                }
            }
        }
    }

    func exitCompanion() {
        guard let f = compSavedFrame else { return }
        let wasCover = compSavedCover
        let st = compSavedStyle
        compSavedFrame = nil; compSavedCover = false
        level = .normal
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
