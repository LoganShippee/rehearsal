// Built-in Google Drive browser: the real drive.google.com in its own window.
// The teacher signs in exactly like in Safari (school SSO pages included) — no API keys,
// no OAuth app approval. "Use this file" hands the current Google file back to the app.

import Cocoa
import WebKit

let safariUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

/// Google embeds (Slides/Docs inside the Present screen) are third-party frames. WebKit's
/// tracking prevention would strip the school sign-in cookies from them, so turn it off for
/// this app's own data store. Uses a WebKit SPI; harmless no-op if unavailable.
func relaxThirdPartyCookies() {
    let store = WKWebsiteDataStore.default()
    let sel = NSSelectorFromString("_setResourceLoadStatisticsEnabled:")
    if store.responds(to: sel) {
        typealias Fn = @convention(c) (AnyObject, Selector, Bool) -> Void
        let imp = store.method(for: sel)
        unsafeBitCast(imp, to: Fn.self)(store, sel, false)
    }
}

final class DriveBrowser: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var web: WKWebView!
    private weak var requester: WKWebView?
    private let useButton = NSButton(title: "Use this file", target: nil, action: nil)
    private let hint = NSTextField(labelWithString: "Open a file in Drive, then click “Use this file”.")
    private var back: NSButton!
    private var fwd: NSButton!

    func open(url: String?, requester: WKWebView?) {
        self.requester = requester
        if window == nil { build() }
        if let s = url, let u = URL(string: s), u.scheme == "https" {
            web.load(URLRequest(url: u))
        } else if web.url == nil {
            web.load(URLRequest(url: URL(string: "https://drive.google.com/drive/my-drive")!))
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func button(_ symbol: String, _ tip: String, _ action: Selector) -> NSButton {
        let img = NSImage(systemSymbolName: symbol, accessibilityDescription: tip) ?? NSImage()
        let b = NSButton(image: img, target: self, action: action)
        b.bezelStyle = .texturedRounded
        b.toolTip = tip
        return b
    }

    private func build() {
        let cfg = WKWebViewConfiguration()
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        web = WKWebView(frame: .zero, configuration: cfg)
        web.customUserAgent = safariUA
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }

        back = button("chevron.left", "Back", #selector(goBack))
        fwd = button("chevron.right", "Forward", #selector(goForward))
        let home = button("house", "My Drive", #selector(goHome))
        let shared = NSButton(title: "Shared with me", target: self, action: #selector(goShared))
        shared.bezelStyle = .texturedRounded
        let reload = button("arrow.clockwise", "Reload", #selector(reloadPage))
        useButton.target = self
        useButton.action = #selector(useFile)
        useButton.bezelStyle = .rounded
        useButton.keyEquivalent = "\r"
        useButton.isEnabled = false
        hint.textColor = .secondaryLabelColor
        hint.lineBreakMode = .byTruncatingTail
        hint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let bar = NSStackView(views: [back, fwd, home, shared, reload, hint, useButton])
        bar.orientation = .horizontal
        bar.spacing = 8
        bar.edgeInsets = NSEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
        bar.setHuggingPriority(.defaultLow, for: .horizontal)

        let root = NSView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        web.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(bar); root.addSubview(web)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: root.topAnchor),
            bar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            web.topAnchor.constraint(equalTo: bar.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        w.title = "Google Drive"
        w.contentView = root
        w.isReleasedWhenClosed = false
        w.delegate = self
        w.setFrameAutosaveName("RehearsalDrive")
        if !w.setFrameUsingName("RehearsalDrive") { w.center() }
        window = w
    }

    @objc private func goBack() { web.goBack() }
    @objc private func goForward() { web.goForward() }
    @objc private func reloadPage() { web.reload() }
    @objc private func goHome() { web.load(URLRequest(url: URL(string: "https://drive.google.com/drive/my-drive")!)) }
    @objc private func goShared() { web.load(URLRequest(url: URL(string: "https://drive.google.com/drive/shared-with-me")!)) }

    /// Returns (kind, id) if the URL points at a single Google file or folder.
    static func parse(_ url: URL?) -> (String, String)? {
        guard let url, let host = url.host else { return nil }
        let parts = url.pathComponents
        if host == "docs.google.com", let i = parts.firstIndex(of: "d"), i + 1 < parts.count, i >= 1 {
            return (parts[i - 1], parts[i + 1])   // presentation / document / spreadsheets / forms
        }
        if host == "drive.google.com" {
            if let i = parts.firstIndex(of: "d"), i + 1 < parts.count, parts.contains("file") { return ("file", parts[i + 1]) }
            if let i = parts.firstIndex(of: "folders"), i + 1 < parts.count { return ("folder", parts[i + 1]) }
        }
        return nil
    }

    private func refresh() {
        back.isEnabled = web.canGoBack
        fwd.isEnabled = web.canGoForward
        let picked = DriveBrowser.parse(web.url)
        useButton.isEnabled = picked != nil
        if let p = picked {
            hint.stringValue = "Ready to add: \(cleanTitle()) (\(p.0))"
        } else {
            hint.stringValue = "Open a file in Drive, then click “Use this file”."
        }
    }

    private func cleanTitle() -> String {
        var t = web.title ?? "Google file"
        for suffix in [" - Google Slides", " - Google Docs", " - Google Sheets", " - Google Forms", " - Google Drive"] {
            if t.hasSuffix(suffix) { t = String(t.dropLast(suffix.count)) }
        }
        return t
    }

    @objc private func useFile() {
        guard let url = web.url, let p = DriveBrowser.parse(url) else { return }
        let payload: [String: String] = ["url": url.absoluteString, "title": cleanTitle(), "kind": p.0, "id": p.1]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        requester?.evaluateJavaScript("window.__drivePicked && window.__drivePicked(\(json))")
        requester?.window?.makeKeyAndOrderFront(nil)
    }

    // Keep everything (including school SSO hops and files Drive opens "in a new tab") in this window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url, u.absoluteString != "about:blank" { webView.load(URLRequest(url: u)) }
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { refresh() }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { refresh() }
    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation n: WKNavigation!) { refresh() }

    override init() {
        super.init()
        // Drive is a single-page app; catch URL changes that don't trigger navigations.
        Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { [weak self] _ in
            guard let self, self.window?.isVisible == true else { return }
            self.refresh()
        }
    }
}
