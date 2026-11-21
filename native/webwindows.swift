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
    private var lastSyncedURL: [String: String] = [:]
    private var lastURL: [String: URL] = [:]
    private var failedIDs = Set<String>()

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

    private func httpURL(_ raw: Any?) -> URL? {
        guard let s = (raw as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !s.isEmpty, s != "about:blank" else { return nil }
        if let u = URL(string: s), ["http", "https"].contains((u.scheme ?? "").lowercased()) { return u }
        if let enc = s.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed),
           let u = URL(string: enc), ["http", "https"].contains((u.scheme ?? "").lowercased()) { return u }
        return nil
    }

    private func htmlEsc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "<", with: "&lt;")
         .replacingOccurrences(of: ">", with: "&gt;")
         .replacingOccurrences(of: "\"", with: "&quot;")
         .replacingOccurrences(of: "'", with: "&#39;")
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
                let hide = (it["hidden"] as? Bool) ?? false
                if v.isHidden != hide { v.isHidden = hide }
                if !hide && r.width > 0 && r.height > 0 && v.frame != r { v.frame = r }
                if let wv = existing as? WKWebView, let u = httpURL(it["url"]) {
                    let force = (it["forceUrl"] as? Bool) ?? false
                    let urlChanged = lastSyncedURL[id] != u.absoluteString
                    let neverLoaded = wv.url == nil && !wv.isLoading && !failedIDs.contains(id)
                    if force || urlChanged || neverLoaded {
                        let prevTarget = lastURL[id]
                        lastSyncedURL[id] = u.absoluteString
                        lastURL[id] = u
                        failedIDs.remove(id)
                        let alreadyLoadingSame = wv.isLoading && (wv.url == u || prevTarget == u)
                        if !alreadyLoadingSame && (force || wv.url?.absoluteString != u.absoluteString || neverLoaded) {
                            wv.load(URLRequest(url: u))
                        }
                    }
                }
            } else if (it["kind"] as? String) == "app" {
                let m = AppMirrorView(windowID: CGWindowID((it["windowID"] as? NSNumber)?.uint32Value ?? 0),
                                      bundleId: it["bundleId"] as? String ?? "", title: it["title"] as? String ?? "")
                m.frame = r
                m.onState = { [weak self] st in self?.reportApp(id, st) }
                container.addSubview(m, positioned: .below, relativeTo: owner)
                views[id] = m
                lastOrder = []
                v = m
            } else {
                let cfg = WKWebViewConfiguration()
                cfg.preferences.isElementFullscreenEnabled = false
                cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
                cfg.mediaTypesRequiringUserActionForPlayback = []
                let initRect = CGRect(x: r.origin.x, y: r.origin.y, width: max(1, r.width), height: max(1, r.height))
                let wv = WKWebView(frame: initRect, configuration: cfg)
                if wv.responds(to: NSSelectorFromString("setDrawsBackground:")) || wv.responds(to: NSSelectorFromString("_setDrawsBackground:")) {
                    wv.setValue(true, forKey: "drawsBackground")
                }
                if #available(macOS 12.0, *) { wv.underPageBackgroundColor = .white }
                wv.wantsLayer = true
                wv.layer?.backgroundColor = NSColor.white.cgColor
                wv.layer?.isOpaque = true
                wv.customUserAgent = safariUA
                wv.navigationDelegate = self
                wv.uiDelegate = self
                wv.allowsBackForwardNavigationGestures = true
                wv.allowsMagnification = true   // full-browser windows pinch-zoom like Safari
                if #available(macOS 13.3, *) { wv.isInspectable = true }
                container.addSubview(wv, positioned: .below, relativeTo: owner)
                views[id] = wv
                lastOrder = []
                observations[id] = wv.observe(\.title, options: [.new]) { [weak self] w, _ in self?.report(w) }
                if let u = httpURL(it["url"]) ?? lastURL[id] {
                    lastSyncedURL[id] = u.absoluteString
                    lastURL[id] = u
                    failedIDs.remove(id)
                    wv.load(URLRequest(url: u))
                }
                v = wv
            }
            let hide = (it["hidden"] as? Bool) ?? false
            if v.isHidden != hide { v.isHidden = hide }
            if !hide && r.width > 0 && r.height > 0 && v.frame != r { v.frame = r }     // a hidden tab keeps its size (no re-layout)
        }
        for (id, v) in views where !seen.contains(id) {
            (v as? AppMirrorView)?.stop()
            v.removeFromSuperview()
            views[id] = nil
            observations[id] = nil
            lastSyncedURL[id] = nil
            lastURL[id] = nil
            failedIDs.remove(id)
            lastOrder = []
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
        guard let id = body["id"] as? String else { return }
        guard let view = views[id] else {
            if (body["action"] as? String) == "load", let u = httpURL(body["url"]) {
                lastURL[id] = u
            }
            return
        }
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
            if let u = httpURL(body["url"]) {
                lastSyncedURL[id] = u.absoluteString
                lastURL[id] = u
                failedIDs.remove(id)
                v.load(URLRequest(url: u))
            }
        case "back": v.goBack()
        case "forward": v.goForward()
        case "reload":
            if !failedIDs.contains(id), let u = v.url, ["http", "https"].contains((u.scheme ?? "").lowercased()) {
                v.reload()
            } else if let u = lastURL[id] {
                failedIDs.remove(id)
                v.load(URLRequest(url: u))
            } else {
                v.reload()
            }
        case "focus": v.window?.makeFirstResponder(v)
        case "zoom":
            if let z = (body["zoom"] as? NSNumber)?.doubleValue { v.pageZoom = z }
        default: break
        }
    }

    func removeAll() {
        for v in views.values { (v as? AppMirrorView)?.stop(); v.removeFromSuperview() }
        views.removeAll(); observations.removeAll()
        lastSyncedURL.removeAll(); lastURL.removeAll(); failedIDs.removeAll()
        owner?.holes = []; owner?.blockers = []; lastOrder = []
    }

    private func report(_ v: WKWebView) {
        guard let id = views.first(where: { $0.value === v })?.key else { return }
        let cur = v.url?.absoluteString ?? ""
        let cleanURL = (cur == "about:blank" || cur.isEmpty) ? (lastURL[id]?.absoluteString ?? "") : cur
        let payload: [String: Any] = ["id": id, "url": cleanURL, "title": v.title ?? "",
                                      "back": v.canGoBack, "forward": v.canGoForward]
        guard let d = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: d, encoding: .utf8) else { return }
        owner?.evaluateJavaScript("window.__webNav && window.__webNav(\(json))")
    }

    private func reportApp(_ id: String, _ st: [String: Any]) {
        var payload = st; payload["id"] = id
        guard let d = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: d, encoding: .utf8) else { return }
        owner?.evaluateJavaScript("window.__appWinState && window.__appWinState(\(json))")
    }

    private func recordCommittedURL(_ webView: WKWebView) {
        guard let u = webView.url, ["http", "https"].contains((u.scheme ?? "").lowercased()),
              let id = views.first(where: { $0.value === webView })?.key else { return }
        failedIDs.remove(id)
        lastURL[id] = u
    }

    private func showError(_ webView: WKWebView, error: Error) {
        let err = error as NSError
        if err.code == NSURLErrorCancelled { return }
        if err.domain == WKErrorDomain && err.code == 102 { return }
        let id = views.first(where: { $0.value === webView })?.key
        if let id { failedIDs.insert(id) }
        let failing = (err.userInfo[NSURLErrorFailingURLStringErrorKey] as? String)
            ?? (err.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.absoluteString
            ?? (webView.url?.absoluteString).flatMap({ $0 == "about:blank" ? nil : $0 })
            ?? (id.flatMap { lastURL[$0]?.absoluteString })
            ?? ""
        if let id, let u = httpURL(failing) { lastURL[id] = u }
        let isGoogle = failing.lowercased().contains("google.com")
        let hint = isGoogle
            ? "If this Google file needs your account, open <b>Drive window</b> in the bar above to sign in once, then press <b>Reload</b>."
            : "Check the web address or internet connection, then press <b>Reload</b>."
        let urlLine = failing.isEmpty ? "" : "<div class=\"url\">\(htmlEsc(failing))</div>"
        let reloadBtn = failing.isEmpty ? "" : "<button data-url=\"\(htmlEsc(failing))\" onclick=\"location.href=this.dataset.url\">↻ Reload</button>"
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;padding:24px;box-sizing:border-box}
        .card{max-width:460px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px 24px;box-shadow:0 6px 20px rgba(15,23,42,.06)}
        h3{margin:0 0 8px;font-size:16px;color:#0f172a}
        .msg{margin:0 0 10px;color:#334155}
        .url{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f5f9;color:#475569;padding:8px 10px;border-radius:8px;word-break:break-all;margin:0 0 12px}
        .hint{margin:0 0 14px;font-size:13px;color:#475569}
        button{background:#0f172a;color:#fff;border:0;border-radius:8px;padding:8px 14px;font:600 13px -apple-system,sans-serif;cursor:pointer}
        button:hover{background:#1e293b}
        </style></head><body><div class="card">
        <h3>Couldn’t load this page</h3>
        <p class="msg">\(htmlEsc(err.localizedDescription))</p>
        \(urlLine)
        <p class="hint">\(hint)</p>
        \(reloadBtn)
        </div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        recordCommittedURL(webView)
        report(webView)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        recordCommittedURL(webView)
        report(webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError(webView, error: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError(webView, error: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if let u = webView.url, ["http", "https"].contains((u.scheme ?? "").lowercased()) {
            webView.reload()
        } else if let id = views.first(where: { $0.value === webView })?.key, let u = lastURL[id] {
            webView.load(URLRequest(url: u))
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = navigationAction.request.url, (u.scheme ?? "").lowercased() == "mailto" {
            NSWorkspace.shared.open(u)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    // Links that want a new tab open in the same window; ignore empty/about:blank popups so they never wipe the page.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url, ["http", "https"].contains((u.scheme ?? "").lowercased()) {
            webView.load(URLRequest(url: u))
        }
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
