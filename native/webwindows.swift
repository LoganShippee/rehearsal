// "Full browser" windows on the Present screen.
// Real WKWebViews sit *underneath* the (transparent) app page. The page cuts a hole where each
// one is, so timers, messages and annotation drawn by the page still appear on top. Clicks in a
// hole fall through to the browser view below, unless something on the page covers that spot.

import Cocoa
import WebKit

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

final class HoleWebView: WKWebView {
    /// Rect + stacking order (z). A click falls through a hole unless something on the page that
    /// is stacked ABOVE that hole (a higher window, a tool, the dock…) covers the spot.
    var holes: [(CGRect, Double)] = []
    var blockers: [(CGRect, Double)] = []

    override func hitTest(_ point: NSPoint) -> NSView? {
        if !holes.isEmpty {
            var p = convert(point, from: superview)
            if !isFlipped { p.y = bounds.height - p.y }
            let through = holes.contains { h in
                h.0.contains(p) && !blockers.contains { b in b.1 > h.1 && b.0.contains(p) }
            }
            if through { return nil }   // let the browser/app view underneath take it
        }
        return super.hitTest(point)
    }

    // Trackpad pinch: the page decides what to zoom (the window under the fingers), even when the
    // fingers are over an embedded page that would otherwise swallow the gesture.
    private func pagePoint(_ e: NSEvent) -> CGPoint {
        var p = convert(e.locationInWindow, from: nil)
        if !isFlipped { p.y = bounds.height - p.y }
        return p
    }
    override func magnify(with e: NSEvent) {
        let p = pagePoint(e)
        let phase = e.phase.contains(.ended) || e.phase.contains(.cancelled) ? "end" : (e.phase.contains(.began) ? "start" : "change")
        evaluateJavaScript("window.__pinch && window.__pinch(\(p.x), \(p.y), \(e.magnification), '\(phase)')")
    }
    override func smartMagnify(with e: NSEvent) {   // two-finger double-tap = reset / quick zoom
        let p = pagePoint(e)
        evaluateJavaScript("window.__pinch && window.__pinch(\(p.x), \(p.y), 0, 'toggle')")
    }

    func makeTransparent() {
        // WebKit SPI, widely used; only call it if present so we never crash.
        if responds(to: NSSelectorFromString("setDrawsBackground:")) || responds(to: NSSelectorFromString("_setDrawsBackground:")) {
            setValue(false, forKey: "drawsBackground")
        }
        if #available(macOS 12.0, *) { underPageBackgroundColor = .clear }
    }
}

final class WebWindows: NSObject, WKNavigationDelegate, WKUIDelegate {
    weak var owner: HoleWebView?
    private var views: [String: NSView] = [:]
    private var observations: [String: NSKeyValueObservation] = [:]

    init(owner: HoleWebView) { self.owner = owner }

    private var lastOrder: [String] = []

    private func zrect(_ a: Any?) -> (CGRect, Double)? {
        guard let n = a as? [NSNumber], n.count == 5 else { return nil }
        return (CGRect(x: n[0].doubleValue, y: n[1].doubleValue, width: n[2].doubleValue, height: n[3].doubleValue), n[4].doubleValue)
    }

    private func rect(_ a: Any?) -> CGRect? {
        guard let n = a as? [NSNumber], n.count == 4 else { return nil }
        return CGRect(x: n[0].doubleValue, y: n[1].doubleValue, width: n[2].doubleValue, height: n[3].doubleValue)
    }

    func sync(_ body: [String: Any]) {
        guard let owner, let container = owner.superview else { return }
        var seen = Set<String>()
        for it in body["items"] as? [[String: Any]] ?? [] {
            guard let id = it["id"] as? String, let r = rect(it["rect"]) else { continue }
            seen.insert(id)
            let v: NSView
            if let existing = views[id] {
                v = existing
            } else if (it["kind"] as? String) == "app" {
                let m = AppMirrorView(windowID: CGWindowID((it["windowID"] as? NSNumber)?.uint32Value ?? 0),
                                      bundleId: it["bundleId"] as? String ?? "", title: it["title"] as? String ?? "")
                m.frame = r
                m.onState = { [weak self] st in self?.reportApp(id, st) }
                container.addSubview(m, positioned: .below, relativeTo: owner)
                views[id] = m
                v = m
            } else {
                let wv = WKWebView(frame: r, configuration: WKWebViewConfiguration())
                wv.customUserAgent = safariUA
                wv.navigationDelegate = self
                wv.uiDelegate = self
                wv.allowsBackForwardNavigationGestures = true
                wv.allowsMagnification = true   // full-browser windows pinch-zoom like Safari
                if #available(macOS 13.3, *) { wv.isInspectable = true }
                container.addSubview(wv, positioned: .below, relativeTo: owner)
                views[id] = wv
                observations[id] = wv.observe(\.title, options: [.new]) { [weak self] w, _ in self?.report(w) }
                if let s = it["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme ?? "") {
                    wv.load(URLRequest(url: u))
                }
                v = wv
            }
            let hide = (it["hidden"] as? Bool) ?? false
            if v.isHidden != hide { v.isHidden = hide }
            if !hide && v.frame != r { v.frame = r }     // a hidden tab keeps its size (no re-layout)
        }
        for (id, v) in views where !seen.contains(id) {
            v.removeFromSuperview()
            views[id] = nil
            observations[id] = nil
        }
        owner.holes = (body["holes"] as? [Any] ?? []).compactMap(zrect)
        owner.blockers = (body["blockers"] as? [Any] ?? []).compactMap(zrect)
        // Stack the native views in the same order as the page's windows (items arrive lowest first).
        let order = (body["items"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
        if order != lastOrder {
            lastOrder = order
            for id in order { if let v = views[id] { container.addSubview(v, positioned: .below, relativeTo: owner) } }
        }
    }

    func command(_ body: [String: Any]) {
        guard let id = body["id"] as? String, let view = views[id] else { return }
        if let m = view as? AppMirrorView {
            switch body["action"] as? String {
            case "front": m.bringAppToFront()
            case "resize":
                if let w = (body["width"] as? NSNumber)?.doubleValue, let h = (body["height"] as? NSNumber)?.doubleValue {
                    m.resizeReal(to: CGSize(width: w, height: h))
                }
            case "reload": m.stop(); Task { await m.start() }
            case "focus": m.window?.makeFirstResponder(m)
            default: break
            }
            return
        }
        guard let v = view as? WKWebView else { return }
        switch body["action"] as? String {
        case "load":
            if let s = body["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme ?? "") {
                v.load(URLRequest(url: u))
            }
        case "back": v.goBack()
        case "forward": v.goForward()
        case "reload": v.reload()
        case "focus": v.window?.makeFirstResponder(v)
        default: break
        }
    }

    func removeAll() {
        for v in views.values { (v as? AppMirrorView)?.stop(); v.removeFromSuperview() }
        views.removeAll(); observations.removeAll()
        owner?.holes = []; owner?.blockers = []; lastOrder = []
    }

    private func report(_ v: WKWebView) {
        guard let id = views.first(where: { $0.value === v })?.key else { return }
        let payload: [String: Any] = ["id": id, "url": v.url?.absoluteString ?? "", "title": v.title ?? "",
                                      "back": v.canGoBack, "forward": v.canGoForward]
        guard let d = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: d, encoding: .utf8) else { return }
        owner?.evaluateJavaScript("window.__webNav && window.__webNav(\(json))")
    }

    private func reportApp(_ id: String, _ st: [String: Any]) {
        var payload = st; payload["id"] = id
        guard let d = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: d, encoding: .utf8) else { return }
        owner?.evaluateJavaScript("window.__appWinState && window.__appWinState(\(json))")
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { report(webView) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { report(webView) }

    // Links that want a new tab open in the same window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url { webView.load(URLRequest(url: u)) }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }
}
