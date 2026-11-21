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
    private var lastMouseDown: NSEvent?
    private var compDragMouse: NSPoint?
    private var compResizeEdges: (left: Bool, right: Bool, bottom: Bool, top: Bool)?
    private var compResizeStartFrame: NSRect?
    var isCompanion: Bool { compSavedFrame != nil }
    var onFrameChanged: (() -> Void)?

    // Borderless windows normally can't take keyboard focus; ours must.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func setFrame(_ frameRect: NSRect, display flag: Bool) {
        super.setFrame(frameRect, display: flag)
        if isCompanion, frame.width >= 220, frame.width <= 720, frame.height >= 64, frame.height <= 360 {
            let ud = UserDefaults.standard
            ud.set(Double(frame.width), forKey: "companionHudWidth")
            ud.set(Double(frame.height), forKey: "companionHudHeight")
        } else if !isCompanion {
            onFrameChanged?()
        }
    }

    func startNativeDrag() {
        guard !isCovering, compResizeEdges == nil else { return }
        guard (NSEvent.pressedMouseButtons & 1) != 0, let ev = lastMouseDown else { return }
        performDrag(with: ev)
    }

    func toggleZoomWindow() {
        guard !isCovering, !isCompanion else { return }
        performZoom(nil)
    }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown {
            lastMouseDown = event
        }
        if isCompanion {
            switch event.type {
            case .leftMouseDown:
                let loc = event.locationInWindow
                let edge: CGFloat = 8
                let brCorner = loc.x >= frame.width - 14 && loc.y <= 14
                let onLeft = loc.x <= edge
                let onRight = loc.x >= frame.width - edge || brCorner
                let onBottom = loc.y <= edge || brCorner
                let onTop = loc.y >= frame.height - edge
                if onLeft || onRight || onBottom || onTop {
                    compDragMouse = NSEvent.mouseLocation
                    compResizeStartFrame = frame
                    compResizeEdges = (onLeft, onRight, onBottom, onTop)
                } else {
                    compResizeEdges = nil
                    compResizeStartFrame = nil
                    compDragMouse = nil
                }
            case .leftMouseDragged:
                if let edges = compResizeEdges, let startMouse = compDragMouse, let f0 = compResizeStartFrame {
                    let cur = NSEvent.mouseLocation
                    let dx = cur.x - startMouse.x, dy = cur.y - startMouse.y
                    if hypot(dx, dy) > 2 {
                        var nf = f0
                        if edges.right { nf.size.width = min(max(f0.width + dx, minSize.width), maxSize.width) }
                        if edges.left {
                            let w = min(max(f0.width - dx, minSize.width), maxSize.width)
                            nf.origin.x = f0.maxX - w
                            nf.size.width = w
                        }
                        if edges.top { nf.size.height = min(max(f0.height + dy, minSize.height), maxSize.height) }
                        if edges.bottom {
                            let h = min(max(f0.height - dy, minSize.height), maxSize.height)
                            nf.origin.y = f0.maxY - h
                            nf.size.height = h
                        }
                        setFrame(nf, display: true, animate: false)
                        invalidateShadow()
                        return
                    }
                }
            case .leftMouseUp:
                compDragMouse = nil
                compResizeEdges = nil
                compResizeStartFrame = nil
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

    /// Morph Rehearsal into a compact, draggable, resizable floating Mini-HUD at the bottom-right
    /// and activate the chosen desktop app at its normal full size.
    func enterCompanion(stripHeight: CGFloat = 96, bundleId: String?, pid: Int32?) {
        let screen = self.screen ?? NSScreen.main
        guard let s = screen else { return }
        if !isCompanion {
            compSavedCover = isCovering
            compSavedFrame = savedFrame ?? frame
            compSavedStyle = isCovering ? savedStyle : styleMask
            savedFrame = nil
        }
        let vf = s.visibleFrame
        let ud = UserDefaults.standard
        let savedW = ud.double(forKey: "companionHudWidth")
        let savedH = ud.double(forKey: "companionHudHeight")
        let hudW = min(max(savedW > 0 ? CGFloat(savedW) : 360, 220), 720)
        let hudH = min(max(savedH > 0 ? CGFloat(savedH) : 118, 64), 360)
        let pad: CGFloat = 16
        NSApp.presentationOptions = []
        styleMask = [.borderless, .resizable, .fullSizeContentView]
        level = .floating
        isMovableByWindowBackground = false
        hasShadow = true
        isOpaque = false
        backgroundColor = .clear
        minSize = NSSize(width: 220, height: 64)
        maxSize = NSSize(width: 720, height: 360)
        contentView?.wantsLayer = true
        contentView?.layer?.cornerRadius = 14
        contentView?.layer?.masksToBounds = true
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
        compDragMouse = nil
        compResizeEdges = nil; compResizeStartFrame = nil
        level = .normal
        isMovableByWindowBackground = false
        isOpaque = true
        backgroundColor = NSColor(red: 0.04, green: 0.22, blue: 0.33, alpha: 1)
        minSize = NSSize(width: 720, height: 480)
        maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
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
