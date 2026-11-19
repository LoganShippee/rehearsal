// Reads Chrome's bookmarks (only when the teacher clicks "Import from Chrome").
// Chrome keeps them as plain JSON in ~/Library/Application Support/Google/Chrome/<profile>/Bookmarks.
// Nothing else (history, passwords, cookies) is touched.

import Foundation

enum ChromeBookmarks {
    static func profiles() -> [[String: Any]] {
        let base = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome", isDirectory: true)
        var names: [String: String] = [:]
        if let d = try? Data(contentsOf: base.appendingPathComponent("Local State")),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let cache = (j["profile"] as? [String: Any])?["info_cache"] as? [String: [String: Any]] {
            for (dir, info) in cache { names[dir] = info["name"] as? String }
        }
        let dirs = ((try? FileManager.default.contentsOfDirectory(atPath: base.path)) ?? [])
            .filter { $0 == "Default" || $0.hasPrefix("Profile ") }.sorted()
        return dirs.compactMap { dir in
            guard let d = try? Data(contentsOf: base.appendingPathComponent(dir).appendingPathComponent("Bookmarks")),
                  let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let roots = j["roots"] as? [String: Any] else { return nil }
            return ["dir": dir, "name": names[dir] ?? dir, "roots": roots]
        }
    }
}
