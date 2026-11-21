using System.Text.Json;

namespace Rehearsal;

/// <summary>
/// Reads Chrome and Edge bookmarks JSON from %LOCALAPPDATA% when the teacher clicks "Import from Chrome".
/// </summary>
internal static class Bookmarks
{
    public static List<Dictionary<string, object>> Profiles()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var browsers = new (string Label, string Path)[]
        {
            ("Chrome", Path.Combine(localAppData, "Google", "Chrome", "User Data")),
            ("Edge", Path.Combine(localAppData, "Microsoft", "Edge", "User Data")),
        };

        var result = new List<Dictionary<string, object>>();
        foreach (var (label, userData) in browsers)
        {
            if (!Directory.Exists(userData)) continue;
            var names = ReadProfileNames(Path.Combine(userData, "Local State"));

            IEnumerable<string> dirs;
            try
            {
                dirs = Directory.GetDirectories(userData)
                    .Select(Path.GetFileName)
                    .Where(d => d != null && (d == "Default" || d.StartsWith("Profile ", StringComparison.Ordinal)))
                    .OrderBy(d => d, StringComparer.Ordinal)!;
            }
            catch { continue; }

            foreach (var dir in dirs)
            {
                var bmPath = Path.Combine(userData, dir, "Bookmarks");
                if (!File.Exists(bmPath)) continue;
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllBytes(bmPath));
                    if (!doc.RootElement.TryGetProperty("roots", out var roots) || roots.ValueKind != JsonValueKind.Object)
                        continue;

                    var profileName = names.GetValueOrDefault(dir) ?? dir;
                    if (label == "Edge") profileName = $"Edge — {profileName}";

                    result.Add(new Dictionary<string, object>
                    {
                        ["dir"] = $"{label}:{dir}",
                        ["name"] = profileName,
                        ["roots"] = roots.Clone(),
                    });
                }
                catch { }
            }
        }
        return result;
    }

    private static Dictionary<string, string> ReadProfileNames(string localStatePath)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!File.Exists(localStatePath)) return map;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllBytes(localStatePath));
            if (doc.RootElement.TryGetProperty("profile", out var profile)
                && profile.TryGetProperty("info_cache", out var cache)
                && cache.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in cache.EnumerateObject())
                {
                    if (prop.Value.TryGetProperty("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String)
                    {
                        var val = nameEl.GetString();
                        if (!string.IsNullOrEmpty(val)) map[prop.Name] = val;
                    }
                }
            }
        }
        catch { }
        return map;
    }
}
