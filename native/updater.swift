// Rehearsal — updates from GitHub Releases.
//
// Every release publishes latest.json (what's new and where to get it), latest.json.sig (an Ed25519
// signature of it, made with the release key that only the developer has) and two zips: the whole app
// and just the web/ folder. The app only trusts a manifest whose signature matches the public key built
// into it, and each zip must match the SHA-256 the manifest lists.
//
// - Web-only changes (most of them): the new web/ folder is downloaded into
//   ~/Library/Application Support/Rehearsal/updates/ and used from then on. Nothing is reinstalled.
// - Changes to this native shell (the "native" number goes up): the new app is downloaded, swapped in
//   place and reopened, after the user says so.

import Cocoa
import CryptoKit

final class Updater {
    static let shared = Updater()

    private let info = Bundle.main.infoDictionary ?? [:]
    /// version of this app build, e.g. "1.2.0"
    var appVersion: String { (info["CFBundleShortVersionString"] as? String) ?? "0" }
    /// native shell number: goes up only when the Swift side changes
    var nativeBuild: Int { Int((info["CFBundleVersion"] as? String) ?? "0") ?? 0 }
    private var repo: String? { (info["RehearsalUpdateRepo"] as? String).flatMap { $0.contains("/") ? $0 : nil } }
    private var publicKey: Curve25519.Signing.PublicKey? {
        guard let s = info["RehearsalUpdateKey"] as? String, let d = Data(base64Encoded: s) else { return nil }
        return try? Curve25519.Signing.PublicKey(rawRepresentation: d)
    }
    var enabled: Bool { repo != nil && publicKey != nil }
    /// for testing only: REHEARSAL_UPDATE_TEST_BASE=http://localhost:PORT/ (set when launching from Terminal)
    private let testBase: String? = ProcessInfo.processInfo.environment["REHEARSAL_UPDATE_TEST_BASE"].flatMap { $0.hasPrefix("http://localhost:") ? $0 : nil }
    private func downloadPrefix(_ repo: String) -> String { testBase ?? "https://github.com/\(repo)/releases/download/" }

    let supportDir: URL = {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let newDir = appSupport.appendingPathComponent("Rehearsal", isDirectory: true)
        let legacyDir = appSupport.appendingPathComponent("ClassPilot", isDirectory: true)
        let fm = FileManager.default
        if !fm.fileExists(atPath: newDir.path), fm.fileExists(atPath: legacyDir.path) {
            try? fm.moveItem(at: legacyDir, to: newDir)
        }
        return newDir
    }()
    private var updatesDir: URL {
        testBase != nil ? FileManager.default.temporaryDirectory.appendingPathComponent("rehearsal-update-test", isDirectory: true)   // testing never touches real data
            : supportDir.appendingPathComponent("updates", isDirectory: true)
    }
    private var currentFile: URL { updatesDir.appendingPathComponent("current.json") }

    /// what the web pages are told (also re-sent when a page asks)
    private(set) var state: [String: Any] = [:]
    var onState: (([String: Any]) -> Void)?
    private var pendingApp: [String: Any]?
    private var checking = false
    /// the version of the web files being served right now
    private(set) var activeVersion = "0"

    // MARK: which web folder to serve

    /// The newest usable web folder: a downloaded update if it is newer than this app's own and was
    /// made for this native shell (or older), otherwise the one inside the app. Old downloads are removed.
    func activeWebRoot(bundled: URL) -> URL {
        activeVersion = appVersion
        let fm = FileManager.default
        var use: URL? = nil
        if let d = try? Data(contentsOf: currentFile),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let dir = j["dir"] as? String, !dir.contains("/"), !dir.contains("..") {
            let url = updatesDir.appendingPathComponent(dir, isDirectory: true)
            let v = Self.readVersion(url)
            if let v, Self.newer(v.version, than: appVersion), v.native <= nativeBuild,
               fm.fileExists(atPath: url.appendingPathComponent("index.html").path) {
                use = url; activeVersion = v.version
            }
        }
        // tidy: keep only the folder in use
        for name in (try? fm.contentsOfDirectory(atPath: updatesDir.path)) ?? [] where name.hasPrefix("web-") {
            if use?.lastPathComponent != name { try? fm.removeItem(at: updatesDir.appendingPathComponent(name)) }
        }
        if use == nil { try? fm.removeItem(at: currentFile) }
        return use ?? bundled
    }

    static func readVersion(_ webDir: URL) -> (version: String, native: Int)? {
        guard let d = try? Data(contentsOf: webDir.appendingPathComponent("version.json")),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let v = j["version"] as? String else { return nil }
        return (v, (j["native"] as? Int) ?? 0)
    }

    /// "1.10.0" is newer than "1.9.3"
    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    // MARK: checking

    private func publish(_ s: [String: Any]) {
        var s = s
        s["current"] = activeVersion
        s["app"] = appVersion
        s["enabled"] = enabled
        state = s
        DispatchQueue.main.async { self.onState?(s) }
    }

    func status() -> [String: Any] {
        if state.isEmpty { publish(["state": enabled ? "idle" : "off"]) }
        return state
    }

    /// Checks GitHub for a newer release. Web updates download straight away; an app update waits for
    /// the user. `manual`: also report "you're up to date" and errors.
    func check(manual: Bool) {
        guard enabled, let repo, let key = publicKey else {
            if manual { publish(["state": "off"]) }
            return
        }
        if checking { return }
        checking = true
        if manual { publish(["state": "checking"]) }
        let base = testBase ?? "https://github.com/\(repo)/releases/latest/download/"
        Task {
            defer { checking = false }
            do {
                let manifest = try await fetch(URL(string: base + "latest.json")!)
                let sigText = try await fetch(URL(string: base + "latest.json.sig")!)
                guard let sig = Data(base64Encoded: String(decoding: sigText, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)),
                      key.isValidSignature(sig, for: manifest) else { throw Fail("The update's signature doesn't match. It was not installed.") }
                guard let m = try JSONSerialization.jsonObject(with: manifest) as? [String: Any],
                      let version = m["version"] as? String else { throw Fail("The update information could not be read.") }
                let native = (m["native"] as? Int) ?? 0, notes = (m["notes"] as? String) ?? ""
                guard Self.newer(version, than: activeVersion) else {
                    if manual { publish(["state": "none"]) } else if state["state"] as? String == "checking" { publish(["state": "idle"]) }
                    return
                }
                if native > nativeBuild {
                    pendingApp = m
                    publish(["state": "app", "version": version, "notes": notes])
                    if testBase != nil, ProcessInfo.processInfo.environment["REHEARSAL_UPDATE_TEST_INSTALL"] != nil { await MainActor.run { self.installApp() } }
                    return
                }
                guard let web = m["web"] as? [String: Any] else { throw Fail("The update has no web files.") }
                if manual { publish(["state": "downloading", "version": version]) }
                try await installWeb(web, version: version, repo: repo)
                publish(["state": "web-ready", "version": version, "notes": notes])
            } catch {
                if manual { publish(["state": "error", "message": (error as? Fail)?.text ?? "Couldn't reach GitHub. Check the internet connection and try again."]) }
            }
        }
    }

    struct Fail: Error { let text: String; init(_ t: String) { text = t } }

    private func fetch(_ url: URL) async throws -> Data {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        r.setValue("Rehearsal-Updater", forHTTPHeaderField: "User-Agent")
        let (d, resp) = try await URLSession.shared.data(for: r)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw Fail("Couldn't download the update (\((resp as? HTTPURLResponse)?.statusCode ?? 0)).") }
        return d
    }

    /// downloads one file named in the manifest and checks its SHA-256
    private func download(_ entry: [String: Any], repo: String) async throws -> Data {
        guard let s = entry["url"] as? String, s.hasPrefix(downloadPrefix(repo)),
              let url = URL(string: s), let want = (entry["sha256"] as? String)?.lowercased() else { throw Fail("The update information is incomplete.") }
        let d = try await fetch(url)
        let got = SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined()
        guard got == want else { throw Fail("The download was damaged (checksum mismatch). Try again.") }
        return d
    }

    private func unzip(_ data: Data) throws -> URL {
        let fm = FileManager.default
        let tmp = fm.temporaryDirectory.appendingPathComponent("rehearsal-update-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        let zip = tmp.appendingPathComponent("u.zip"), out = tmp.appendingPathComponent("out", isDirectory: true)
        try data.write(to: zip)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        p.arguments = ["-x", "-k", zip.path, out.path]
        try p.run(); p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw Fail("The update couldn't be unpacked.") }
        return out
    }

    private func installWeb(_ web: [String: Any], version: String, repo: String) async throws {
        let data = try await download(web, repo: repo)
        let out = try unzip(data)
        let src = out.appendingPathComponent("web", isDirectory: true)
        guard let v = Self.readVersion(src), v.version == version,
              FileManager.default.fileExists(atPath: src.appendingPathComponent("index.html").path) else { throw Fail("The update's files are incomplete.") }
        let fm = FileManager.default
        try fm.createDirectory(at: updatesDir, withIntermediateDirectories: true)
        let name = "web-" + version.filter { $0.isNumber || $0 == "." }
        let dst = updatesDir.appendingPathComponent(name, isDirectory: true)
        try? fm.removeItem(at: dst)
        try fm.moveItem(at: src, to: dst)
        try? fm.removeItem(at: out.deletingLastPathComponent())
        let cur = try JSONSerialization.data(withJSONObject: ["dir": name, "version": version])
        try cur.write(to: currentFile, options: .atomic)
    }

    // MARK: whole-app update (native changes)

    /// Downloads the new app, then quits, swaps it in place of this one and reopens it.
    func installApp() {
        guard let repo, let m = pendingApp, let app = m["app"] as? [String: Any] else { return }
        let target = Bundle.main.bundleURL
        if target.path.contains("/AppTranslocation/") || !FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path) {
            // can't replace it where it is: open the release page instead
            if let v = m["version"] as? String, let u = URL(string: "https://github.com/\(repo)/releases/tag/v\(v)") { NSWorkspace.shared.open(u) }
            publish(["state": "app", "version": m["version"] ?? "", "notes": m["notes"] ?? "", "manual": true])
            return
        }
        publish(["state": "installing", "version": m["version"] ?? ""])
        Task {
            do {
                let data = try await download(app, repo: repo)
                let out = try unzip(data)
                guard let name = try FileManager.default.contentsOfDirectory(atPath: out.path).first(where: { $0.hasSuffix(".app") }) else { throw Fail("The download has no app in it.") }
                let newApp = out.appendingPathComponent(name)
                guard Bundle(url: newApp)?.bundleIdentifier == Bundle.main.bundleIdentifier else { throw Fail("The download isn't Rehearsal.") }
                let script = """
                while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done
                T=\(Self.sh(target.path)); N=\(Self.sh(newApp.path))
                rm -rf "$T.old" && mv "$T" "$T.old" && mv "$N" "$T" && rm -rf "$T.old" || { [ -d "$T" ] || mv "$T.old" "$T"; }
                xattr -dr com.apple.quarantine "$T" 2>/dev/null
                open "$T"
                """
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/sh")
                p.arguments = ["-c", script]
                try p.run()
                await MainActor.run { NSApp.terminate(nil) }
            } catch {
                publish(["state": "error", "message": (error as? Fail)?.text ?? "The update couldn't be downloaded. Try again."])
            }
        }
    }

    private static func sh(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
}
