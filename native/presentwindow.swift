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
