// Rehearsal — native macOS shell.
// Serves the bundled web app from a loopback-only HTTP server (so YouTube / Google embeds
// get a normal http origin) and hosts it in WKWebView windows.

import Cocoa
import WebKit
import Network
import UniformTypeIdentifiers

// MARK: - Local HTTP server

final class LocalServer {
    let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    var webRoot: URL                     // the app's own web folder, or a downloaded update (see Updater)
    let dataDir: URL
    var filesDir: URL { dataDir.appendingPathComponent("files", isDirectory: true) }
    var dataFile: URL { dataDir.appendingPathComponent("data.json") }
    var backupsDir: URL { dataDir.appendingPathComponent("backups", isDirectory: true) }

    // A dated copy of your data, once per day (plus any you make yourself); the newest 30 are kept.
    private func dailyBackup(force: Bool = false) -> String? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: dataFile.path) else { return nil }
        try? fm.createDirectory(at: backupsDir, withIntermediateDirectories: true)
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = force ? "yyyy-MM-dd-HHmmss" : "yyyy-MM-dd"
        let name = "data-\(f.string(from: Date()))\(force ? "-manual" : "").json"
        let dst = backupsDir.appendingPathComponent(name)
        if !force && fm.fileExists(atPath: dst.path) { return nil }
        try? fm.removeItem(at: dst)
        guard (try? fm.copyItem(at: dataFile, to: dst)) != nil else { return nil }
        let all = ((try? fm.contentsOfDirectory(atPath: backupsDir.path)) ?? []).filter { $0.hasPrefix("data-") && $0.hasSuffix(".json") }.sorted()
        if all.count > 30 { for old in all.prefix(all.count - 30) { try? fm.removeItem(at: backupsDir.appendingPathComponent(old)) } }
        return name
    }
    private func safeBackupName(_ s: String?) -> String? {
        guard let s, s.hasPrefix("data-"), s.hasSuffix(".json"), s.count < 80,
              s.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." }) else { return nil }
        return s
    }
    private var listener: NWListener?
    var onSave: ((String) -> Void)?

    init(webRoot: URL, dataDir: URL) {
        self.webRoot = webRoot
        self.dataDir = dataDir
        try? FileManager.default.createDirectory(at: filesDir, withIntermediateDirectories: true)
    }

    func start(preferredPort: UInt16, ready: @escaping (UInt16) -> Void) {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback
        params.allowLocalEndpointReuse = true
        let l: NWListener
        if let p = NWEndpoint.Port(rawValue: preferredPort), let lp = try? NWListener(using: params, on: p) {
            l = lp
        } else {
            l = try! NWListener(using: params)
        }
        listener = l
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                ready(l.port?.rawValue ?? 0)
            case .failed:
                // Port taken: fall back to any free port.
                self?.listener?.cancel()
                self?.start(preferredPort: 0, ready: ready)
            default: break
            }
        }
        l.start(queue: .main)
    }

    private final class Conn {
        let c: NWConnection
        var buf = Data()
        init(_ c: NWConnection) { self.c = c }
    }

    private func accept(_ c: NWConnection) {
        let conn = Conn(c)
        c.start(queue: .main)
        receive(conn)
    }

    private func receive(_ conn: Conn) {
        conn.c.receive(minimumIncompleteLength: 1, maximumLength: 4 << 20) { [weak self] data, _, done, err in
            guard let self else { return }
            if let d = data { conn.buf.append(d) }
            if let req = Request.parse(conn.buf) {
                self.route(req, conn.c)
                return
            }
            if done || err != nil { conn.c.cancel(); return }
            self.receive(conn)
        }
    }

    struct Request {
        var method: String
        var path: String
        var query: [String: String]
        var headers: [String: String]
        var body: Data

        static func parse(_ buf: Data) -> Request? {
            guard let r = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
            guard let head = String(data: buf[buf.startIndex..<r.lowerBound], encoding: .utf8) else { return nil }
            var lines = head.components(separatedBy: "\r\n")
            let first = lines.removeFirst().split(separator: " ")
            guard first.count >= 2 else { return nil }
            var headers: [String: String] = [:]
            for l in lines {
                if let i = l.firstIndex(of: ":") {
                    headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
                }
            }
            let len = Int(headers["content-length"] ?? "0") ?? 0
            let bodyStart = r.upperBound
            guard buf.count - (bodyStart - buf.startIndex) >= len else { return nil }
            let body = buf.subdata(in: bodyStart..<(bodyStart + len))
            let target = String(first[1])
            var comps = URLComponents(string: "http://x" + target)
            var q: [String: String] = [:]
            for item in comps?.queryItems ?? [] { q[item.name] = item.value ?? "" }
            comps?.query = nil
            let path = comps?.percentEncodedPath.removingPercentEncoding ?? "/"
            return Request(method: String(first[0]), path: path, query: q, headers: headers, body: body)
        }
    }

    private func send(_ c: NWConnection, _ status: Int, _ type: String, _ body: Data) {
        let text = [200: "OK", 204: "No Content", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed"][status] ?? "OK"
        var head = "HTTP/1.1 \(status) \(text)\r\n"
        head += "Content-Type: \(type)\r\nContent-Length: \(body.count)\r\n"
        head += "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
    }

    private func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    /// The videos on a YouTube results page: the page embeds them as JSON in `var ytInitialData = {…};`.
    static func ytResults(_ page: Data) -> [[String: String]] {
        guard let html = String(data: page, encoding: .utf8),
              let start = html.range(of: "var ytInitialData = ") ?? html.range(of: "ytInitialData = ") else { return [] }
        let rest = html[start.upperBound...]
        guard let end = rest.range(of: ";</script>") else { return [] }
        guard let root = try? JSONSerialization.jsonObject(with: Data(rest[..<end.lowerBound].utf8)) else { return [] }
        var out: [[String: String]] = [], seen = Set<String>()
        func text(_ o: Any?) -> String {
            guard let d = o as? [String: Any] else { return "" }
            if let s = d["simpleText"] as? String { return s }
            return ((d["runs"] as? [[String: Any]]) ?? []).compactMap { $0["text"] as? String }.joined()
        }
        func walk(_ o: Any) {
            if out.count >= 24 { return }
            if let d = o as? [String: Any] {
                if let v = d["videoRenderer"] as? [String: Any], let id = v["videoId"] as? String, !seen.contains(id) {
                    seen.insert(id)
                    out.append(["id": id, "title": text(v["title"]), "len": text(v["lengthText"]), "ch": text(v["ownerText"])])
                    return
                }
                for (_, x) in d { walk(x) }
            } else if let a = o as? [Any] { for x in a { walk(x) } }
        }
        walk(root)
        return out
    }

    private func safeId(_ s: String?) -> String? {
        guard let s, !s.isEmpty, s.count < 64, s.allSatisfy({ $0.isLetter || $0.isNumber }) else { return nil }
        return s
    }

    private func route(_ req: Request, _ c: NWConnection) {
        let p = req.path
        if p.hasPrefix("/api/") || p.hasPrefix("/files/") {
            let tok = req.headers["x-token"] ?? req.query["t"] ?? ""
            guard tok == token else { return send(c, 403, "text/plain", Data("forbidden".utf8)) }
        }
        switch (req.method, p) {
        case ("GET", "/api/data"):
            let d = (try? Data(contentsOf: dataFile)) ?? Data()
            return send(c, 200, "application/json", d)
        case ("POST", "/api/data"):
            guard (try? JSONSerialization.jsonObject(with: req.body)) != nil else {
                return send(c, 400, "text/plain", Data("bad json".utf8))
            }
            // keep one rolling backup
            let bak = dataDir.appendingPathComponent("data.backup.json")
            if FileManager.default.fileExists(atPath: dataFile.path) {
                try? FileManager.default.removeItem(at: bak)
                try? FileManager.default.copyItem(at: dataFile, to: bak)
            }
            _ = dailyBackup()                                  // first save of the day keeps yesterday's state
            try? req.body.write(to: dataFile, options: .atomic)
            onSave?(req.headers["x-client"] ?? "")
            return send(c, 204, "text/plain", Data())
        case ("GET", "/api/backups"):
            let fm = FileManager.default
            let names = ((try? fm.contentsOfDirectory(atPath: backupsDir.path)) ?? []).filter { $0.hasPrefix("data-") && $0.hasSuffix(".json") }.sorted().reversed()
            let list: [[String: Any]] = names.map { n in
                let a = (try? fm.attributesOfItem(atPath: backupsDir.appendingPathComponent(n).path)) ?? [:]
                return ["name": n, "size": (a[.size] as? NSNumber)?.intValue ?? 0, "modified": ((a[.modificationDate] as? Date) ?? Date()).timeIntervalSince1970]
            }
            let d = (try? JSONSerialization.data(withJSONObject: list)) ?? Data("[]".utf8)
            return send(c, 200, "application/json", d)
        case ("POST", "/api/backup-now"):
            let n = dailyBackup(force: true) ?? ""
            return send(c, 200, "text/plain", Data(n.utf8))
        case ("POST", "/api/restore"):
            guard let n = safeBackupName(req.query["name"]) else { return send(c, 400, "text/plain", Data()) }
            let src = backupsDir.appendingPathComponent(n)
            guard let d = try? Data(contentsOf: src), (try? JSONSerialization.jsonObject(with: d)) != nil else { return send(c, 404, "text/plain", Data()) }
            _ = dailyBackup(force: true)                          // keep what you had just before restoring
            try? d.write(to: dataFile, options: .atomic)
            onSave?("restore")                                   // other Rehearsal windows reload it too
            return send(c, 204, "text/plain", Data())
        case ("POST", "/api/file"):
            guard let id = safeId(req.query["id"]) else { return send(c, 400, "text/plain", Data()) }
            try? req.body.write(to: filesDir.appendingPathComponent(id), options: .atomic)
            return send(c, 204, "text/plain", Data())
        case ("GET", "/api/convert"):
            // MuseScore file -> MusicXML, using the MuseScore installed on this Mac (runs once per file)
            guard let id = safeId(req.query["id"]) else { return send(c, 400, "text/plain", Data()) }
            let ext = (req.query["ext"] ?? "mscz").lowercased() == "mscx" ? "mscx" : "mscz"
            let src = filesDir.appendingPathComponent(id)
            DispatchQueue.global(qos: .userInitiated).async {
                let apps = ["/Applications/MuseScore 4.app", "/Applications/MuseScore Studio 4.app", "/Applications/MuseScore 5.app", "/Applications/MuseScore Studio.app"]
                guard let app = apps.first(where: { FileManager.default.fileExists(atPath: $0 + "/Contents/MacOS/mscore") }) else {
                    return self.send(c, 404, "text/plain", Data("MuseScore not found".utf8))
                }
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("rehearsal-conv-" + UUID().uuidString)
                try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: tmp) }
                let inF = tmp.appendingPathComponent("score." + ext), outF = tmp.appendingPathComponent("score.musicxml")
                guard (try? FileManager.default.copyItem(at: src, to: inF)) != nil else { return self.send(c, 404, "text/plain", Data()) }
                let pr = Process()
                pr.executableURL = URL(fileURLWithPath: app + "/Contents/MacOS/mscore")
                pr.arguments = ["-o", outF.path, inF.path]
                pr.standardOutput = FileHandle.nullDevice; pr.standardError = FileHandle.nullDevice
                do { try pr.run() } catch { return self.send(c, 400, "text/plain", Data("could not run MuseScore".utf8)) }
                let deadline = Date().addingTimeInterval(180)
                while pr.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
                if pr.isRunning { pr.terminate() }
                guard let d = try? Data(contentsOf: outF) else { return self.send(c, 400, "text/plain", Data("conversion failed".utf8)) }
                self.send(c, 200, "application/xml", d)
            }
            return
        case ("GET", "/api/ytsearch"):
            // YouTube search for the YouTube window: reads the public results page (no account, no API key)
            // and returns the videos on it as [{id, title, len, ch}].
            let q = (req.query["q"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !q.isEmpty, q.count < 200, var comps = URLComponents(string: "https://www.youtube.com/results") else { return send(c, 400, "text/plain", Data()) }
            comps.queryItems = [URLQueryItem(name: "search_query", value: q)]
            guard let url = comps.url else { return send(c, 400, "text/plain", Data()) }
            var r = URLRequest(url: url, timeoutInterval: 15)
            r.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", forHTTPHeaderField: "User-Agent")
            r.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
            r.setValue("CONSENT=YES+1", forHTTPHeaderField: "Cookie")
            URLSession.shared.dataTask(with: r) { data, _, _ in
                let list = Self.ytResults(data ?? Data())
                let d = (try? JSONSerialization.data(withJSONObject: list)) ?? Data("[]".utf8)
                self.send(c, 200, "application/json", d)
            }.resume()
            return
        case ("POST", "/api/purge-grlogs"):
            // grading troubleshooting recordings: keep only the newest `keep` takes (0 = none)
            let keep = max(0, Int(req.query["keep"] ?? "0") ?? 0)
            let fm = FileManager.default
            let names = ((try? fm.contentsOfDirectory(atPath: filesDir.path)) ?? []).filter { $0.hasPrefix("grlog") }
            let takes = Set(names.map { String($0.dropLast()) }).sorted(by: >)        // grlog<date> (each has …w and …j)
            for t in takes.dropFirst(keep) { for sfx in ["w", "j"] { try? fm.removeItem(at: filesDir.appendingPathComponent(t + sfx)) } }
            return send(c, 204, "text/plain", Data())
        case ("DELETE", "/api/file"):
            guard let id = safeId(req.query["id"]) else { return send(c, 400, "text/plain", Data()) }
            try? FileManager.default.removeItem(at: filesDir.appendingPathComponent(id))
            return send(c, 204, "text/plain", Data())
        default: break
        }
        if req.method == "GET", p.hasPrefix("/files/") {
            guard let id = safeId(String(p.dropFirst("/files/".count))),
                  let d = try? Data(contentsOf: filesDir.appendingPathComponent(id)) else {
                return send(c, 404, "text/plain", Data())
            }
            let m = req.query["m"].flatMap { $0.isEmpty ? nil : $0 } ?? "application/octet-stream"
            return send(c, 200, m.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: ""), d)
        }
        guard req.method == "GET" else { return send(c, 405, "text/plain", Data()) }
        var rel = p == "/" ? "index.html" : String(p.dropFirst())
        if rel.isEmpty { rel = "index.html" }
        let url = webRoot.appendingPathComponent(rel).standardizedFileURL
        guard url.path.hasPrefix(webRoot.standardizedFileURL.path + "/"),
              let d = try? Data(contentsOf: url) else {
            return send(c, 404, "text/plain", Data("not found".utf8))
        }
        send(c, 200, mime(for: url.pathExtension), d)
    }
}

// MARK: - Script message proxy (avoids retain cycle)

final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(u, didReceive: m)
    }
}

// MARK: - App

@main
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, NSWindowDelegate {
    var server: LocalServer!
    var port: UInt16 = 0
    var windows: [NSWindow] = []
    var webViews: [WKWebView] = []
    var webWindows: [ObjectIdentifier: WebWindows] = [:]
    var appDockers: [ObjectIdentifier: AppDocker] = [:]
    lazy var drive = DriveBrowser()

    static func main() {
        let app = NSApplication.shared
        let d = AppDelegate()
        app.delegate = d
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        relaxThirdPartyCookies()
        watchPresentationOptions()
        let web = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        let up = Updater.shared
        server = LocalServer(webRoot: up.activeWebRoot(bundled: web), dataDir: up.supportDir)
        server.onSave = { [weak self] client in self?.broadcast(client) }
        up.onState = { [weak self] st in self?.sendUpdateState(st) }
        // look for updates a few seconds after opening, then every 4 hours
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { up.check(manual: false) }
        Timer.scheduledTimer(withTimeInterval: 4 * 3600, repeats: true) { _ in up.check(manual: false) }
        server.start(preferredPort: 47821) { [weak self] p in
            guard let self, self.port == 0 else { return }
            self.port = p
            if ProcessInfo.processInfo.environment["REHEARSAL_PRINT_URL"] != nil {
                print("http://localhost:\(p)/index.html?t=\(self.server.token)")
                fflush(stdout)
            }
            self.openWindow(view: "", title: "Rehearsal")
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    func sendUpdateState(_ st: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: st), let json = String(data: d, encoding: .utf8) else { return }
        for w in webViews { w.evaluateJavaScript("window.__updateState && window.__updateState(\(json))") }
    }
    /// switch to the downloaded web files now (reloads every window)
    func applyWebUpdate() {
        let web = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        server.webRoot = Updater.shared.activeWebRoot(bundled: web)
        for w in webViews { w.reload() }
    }
    @objc func checkForUpdates(_ s: Any?) { Updater.shared.check(manual: true) }

    func broadcast(_ client: String) {
        let safe = client.filter { $0.isLetter || $0.isNumber }
        for w in webViews {
            w.evaluateJavaScript("window.__externalUpdate && window.__externalUpdate('\(safe)')")
        }
    }

    @discardableResult
    func openWindow(view: String, title: String) -> NSWindow {
        let cfg = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        ucc.add(WeakHandler(self), name: "native")
        cfg.userContentController = ucc
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.preferences.isElementFullscreenEnabled = true
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        let wv = HoleWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: cfg)
        wv.customUserAgent = safariUA
        wv.makeTransparent()
        wv.autoresizingMask = [.width, .height]
        let container = FlippedView(frame: wv.frame)
        container.addSubview(wv)
        webWindows[ObjectIdentifier(wv)] = WebWindows(owner: wv)
        let docker = AppDocker()
        appDockers[ObjectIdentifier(wv)] = docker
        wv.uiDelegate = self
        wv.navigationDelegate = self
        if #available(macOS 13.3, *) { wv.isInspectable = true }
        let win = RehearsalWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                           backing: .buffered, defer: false)
        win.onFrameChanged = { [weak docker] in docker?.realign(activate: false) }
        win.title = title
        win.titlebarAppearsTransparent = true
        win.titleVisibility = .hidden
        win.contentView = container
        win.backgroundColor = NSColor(red: 0.04, green: 0.22, blue: 0.33, alpha: 1)
        win.minSize = NSSize(width: 720, height: 480)
        win.collectionBehavior = [.fullScreenNone]   // full screen = cover this desktop (see RehearsalWindow)
        win.delegate = self
        win.isReleasedWhenClosed = false
        if windows.isEmpty {
            win.setFrameAutosaveName("RehearsalMain")
            if !win.setFrameUsingName("RehearsalMain") { win.center() }
        } else {
            win.setFrameAutosaveName("RehearsalPresent")
            if !win.setFrameUsingName("RehearsalPresent") { win.cascadeTopLeft(from: windows.last!.frame.origin) }
        }
        windows.append(win)
        webViews.append(wv)
        var s = "http://localhost:\(port)/index.html?t=\(server.token)"
        if !view.isEmpty { s += "&view=\(view)" }
        wv.load(URLRequest(url: URL(string: s)!))
        win.makeKeyAndOrderFront(nil)
        return win
    }

    func windowWillClose(_ n: Notification) {
        guard let w = n.object as? NSWindow, let i = windows.firstIndex(of: w) else { return }
        windows.remove(at: i)
        let wv = webViews.remove(at: i)
        webWindows.removeValue(forKey: ObjectIdentifier(wv))?.removeAll()
        appDockers.removeValue(forKey: ObjectIdentifier(wv))?.undock(bringRehearsalFront: false)
        wv.configuration.userContentController.removeScriptMessageHandler(forName: "native")
    }

    func windowDidMove(_ n: Notification) {
        guard let w = n.object as? NSWindow, let i = windows.firstIndex(of: w), i < webViews.count else { return }
        appDockers[ObjectIdentifier(webViews[i])]?.realign(activate: false)
    }

    func windowDidResize(_ n: Notification) {
        guard let w = n.object as? NSWindow, let i = windows.firstIndex(of: w), i < webViews.count else { return }
        appDockers[ObjectIdentifier(webViews[i])]?.realign(activate: false)
    }

    // MARK: JS bridge
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let body = m.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let wv = m.webView
        switch cmd {
        case "openPresent":
            let w = openWindow(view: "present", title: "Rehearsal — Present")
            if (body["fullscreen"] as? Bool) == true { w.toggleFullScreen(nil) }
        case "print":
            guard let wv, let win = wv.window else { return }
            let info = NSPrintInfo.shared.copy() as! NSPrintInfo
            info.horizontalPagination = .fit
            info.verticalPagination = .automatic
            info.topMargin = 36; info.bottomMargin = 36; info.leftMargin = 36; info.rightMargin = 36
            let op = wv.printOperation(with: info)
            op.view?.frame = wv.bounds
            op.showsPrintPanel = true
            op.runModal(for: win, delegate: nil, didRun: nil, contextInfo: nil)
        case "openExternal":
            if let s = body["url"] as? String, let url = URL(string: s), ["http", "https", "mailto"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
        case "openDrive":
            drive.open(url: body["url"] as? String, requester: wv) 
        case "webSync":
            if let wv { webWindows[ObjectIdentifier(wv)]?.sync(body) }
        case "webCmd":
            if let wv { webWindows[ObjectIdentifier(wv)]?.command(body) }
        case "listAppWindows":
            let list = AppCapture.listRunningApps()
            let payload: [String: Any] = ["screen": AppCapture.hasScreenAccess, "input": AppCapture.hasInputAccess, "windows": list]
            if let d = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: d, encoding: .utf8) {
                wv?.evaluateJavaScript("window.__appWindows && window.__appWindows(\(json))")
            }
        case "dockApp":
            guard let wv, let win = wv.window, let docker = appDockers[ObjectIdentifier(wv)] else { return }
            let appName = (body["app"] as? String) ?? ""
            let bid = (body["bundleId"] as? String) ?? ""
            let pid = (body["pid"] as? NSNumber)?.int32Value ?? 0
            let activate = (body["activate"] as? Bool) ?? true
            if let arr = body["rect"] as? [NSNumber], arr.count == 4 {
                let r = CGRect(x: arr[0].doubleValue, y: arr[1].doubleValue, width: arr[2].doubleValue, height: arr[3].doubleValue)
                docker.dock(appName: appName, bundleId: bid, pid: pid, rect: r, inWindow: win, ownerWeb: wv, activate: activate)
            }
        case "undockApp":
            if let wv {
                let front = (body["bringFront"] as? Bool) ?? false
                appDockers[ObjectIdentifier(wv)]?.undock(bringRehearsalFront: front)
            }
        case "companionStart":
            if let wv { appDockers[ObjectIdentifier(wv)]?.undock(bringRehearsalFront: false) }
            let bid = body["bundleId"] as? String
            let pid = (body["pid"] as? NSNumber)?.int32Value
            (wv?.window as? RehearsalWindow)?.enterCompanion(stripHeight: 118, bundleId: bid, pid: pid)
        case "companionExit":
            (wv?.window as? RehearsalWindow)?.exitCompanion()
        case "requestPermission":
            let which = body["which"] as? String
            if which == "screen" {
                AppCapture.requestScreen()
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
            } else if which == "input" {
                AppCapture.requestInput()
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
            }
        case "launchApp":
            if let b = body["bundleId"] as? String, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: b) {
                let cfg = NSWorkspace.OpenConfiguration(); cfg.activates = false
                NSWorkspace.shared.openApplication(at: url, configuration: cfg)
            }
        case "chromeBookmarks":
            let payload: [String: Any] = ["profiles": ChromeBookmarks.profiles()]
            if let d = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: d, encoding: .utf8) {
                wv?.evaluateJavaScript("window.__chromeBookmarks && window.__chromeBookmarks(\(json))")
            }
        case "updateStatus":
            sendUpdateState(Updater.shared.status())
        case "updateCheck":
            Updater.shared.check(manual: true)
        case "updateApply":
            applyWebUpdate()
        case "updateInstallApp":
            Updater.shared.installApp()
        case "hello":
            (wv?.window as? RehearsalWindow)?.refreshSafeTop()
        case "fullscreen":
            (wv?.window as? RehearsalWindow)?.toggleCover()
        case "windowDrag":
            (wv?.window as? RehearsalWindow)?.startNativeDrag()
        case "windowZoom":
            (wv?.window as? RehearsalWindow)?.toggleZoomWindow()
        case "saveText":
            let name = (body["name"] as? String) ?? "export.json"
            let text = (body["text"] as? String) ?? ""
            let panel = NSSavePanel()
            panel.nameFieldStringValue = name
            panel.canCreateDirectories = true
            let done: (NSApplication.ModalResponse) -> Void = { r in
                if r == .OK, let url = panel.url { try? text.write(to: url, atomically: true, encoding: .utf8) }
            }
            if let win = wv?.window { panel.beginSheetModal(for: win, completionHandler: done) } else { done(panel.runModal()) }
        case "saveFile":
            // save a copy of a stored file (a recording) wherever the teacher picks
            guard let raw = body["id"] as? String, !raw.isEmpty, !raw.contains("/"), !raw.contains("..") else { break }
            let src = server.filesDir.appendingPathComponent(raw)
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (body["name"] as? String) ?? "Recording"
            panel.canCreateDirectories = true
            let done: (NSApplication.ModalResponse) -> Void = { r in
                guard r == .OK, let url = panel.url else { return }
                try? FileManager.default.removeItem(at: url)
                try? FileManager.default.copyItem(at: src, to: url)
            }
            if let win = wv?.window { panel.beginSheetModal(for: win, completionHandler: done) } else { done(panel.runModal()) }
        default: break
        }
    }

    // MARK: WKUIDelegate
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let url = navigationAction.request.url
        // Google sign-in popups must stay in-app so they can talk back to the opener page.
        let host = url?.host ?? ""
        if url == nil || url?.absoluteString == "about:blank" || host.hasSuffix("accounts.google.com") || host.hasSuffix("google.com") && url!.path.contains("signin") {
            let popup = WKWebView(frame: NSRect(x: 0, y: 0, width: 520, height: 680), configuration: configuration)
            popup.customUserAgent = safariUA
            popup.uiDelegate = self
            let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 680),
                               styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            win.title = "Sign in with Google"
            win.contentView = popup
            win.isReleasedWhenClosed = false
            win.center()
            win.makeKeyAndOrderFront(nil)
            popups.append(win)
            return popup
        }
        if let url, ["http", "https"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    var popups: [NSWindow] = []
    func webViewDidClose(_ webView: WKWebView) {
        if let i = popups.firstIndex(where: { $0.contentView === webView }) {
            popups[i].close()
            popups.remove(at: i)
        }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        if let win = webView.window {
            panel.beginSheetModal(for: win) { r in completionHandler(r == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
        a.runModal(); completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24)); f.stringValue = defaultText ?? ""
        a.accessoryView = f
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = f
        completionHandler(a.runModal() == .alertFirstButtonReturn ? f.stringValue : nil)
    }

    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler((origin.host == "localhost" || origin.host == "127.0.0.1") ? .grant : .prompt)
    }

    // MARK: WKNavigationDelegate — keep the app in-app, send top-level external links to the browser
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let isMain = navigationAction.targetFrame?.isMainFrame ?? true
        let isPopup = popups.contains(where: { $0.contentView === webView })
        if isMain, !isPopup, let url, url.host != "localhost", url.host != "127.0.0.1", ["http", "https"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    // MARK: Menu
    @objc func toggleCover(_ s: Any?) { (NSApp.keyWindow as? RehearsalWindow ?? windows.first as? RehearsalWindow)?.toggleCover() }
    @objc func newPresentWindow(_ s: Any?) { openWindow(view: "present", title: "Rehearsal — Present") }
    @objc func newEditorWindow(_ s: Any?) { openWindow(view: "edit", title: "Rehearsal") }
    @objc func reloadPage(_ s: Any?) { (NSApp.keyWindow?.contentView?.subviews.first(where: { $0 is HoleWebView }) as? WKWebView)?.reload() }

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ build: (NSMenu) -> Void) {
            let item = NSMenuItem(); let m = NSMenu(title: title); build(m); item.submenu = m; main.addItem(item)
        }
        add("Rehearsal") { m in
            m.addItem(withTitle: "About Rehearsal", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
            m.addItem(withTitle: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
            m.addItem(.separator())
            m.addItem(withTitle: "Hide Rehearsal", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
            m.addItem(withTitle: "Quit Rehearsal", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        }
        add("File") { m in
            let a = m.addItem(withTitle: "New Present Window", action: #selector(newPresentWindow(_:)), keyEquivalent: "n")
            a.keyEquivalentModifierMask = [.command, .shift]
            m.addItem(withTitle: "New Editor Window", action: #selector(newEditorWindow(_:)), keyEquivalent: "n")
            m.addItem(.separator())
            m.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        }
        add("Edit") { m in
            m.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
            let r = m.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
            r.keyEquivalentModifierMask = [.command, .shift]
            m.addItem(.separator())
            m.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
            m.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
            m.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
            m.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        }
        add("View") { m in
            m.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r")
            let f = m.addItem(withTitle: "Full Screen (cover this desktop)", action: #selector(toggleCover(_:)), keyEquivalent: "f")
            f.keyEquivalentModifierMask = [.command, .control]
        }
        add("Window") { m in
            m.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
            m.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
            NSApp.windowsMenu = m
        }
        NSApp.mainMenu = main
    }
}
