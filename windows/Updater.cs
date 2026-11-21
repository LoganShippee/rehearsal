using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace Rehearsal;

/// <summary>
/// Signed GitHub Releases updater matching native/updater.swift.
/// Supports both Tier 1 hot web updates (web.zip) and Tier 2 Windows shell updates (Rehearsal-Windows.zip).
/// </summary>
internal sealed class Updater
{
    public static Updater Shared { get; } = new();

    public string AppVersion { get; }
    public int NativeBuild { get; }
    public string ActiveVersion { get; private set; } = "0";
    public string SupportDir { get; }
    public string UpdatesDir { get; }
    public Action<Dictionary<string, object?>>? OnState { get; set; }

    private readonly string? _repo;
    private readonly byte[]? _publicKeyBytes;
    private readonly string? _testBase;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private readonly object _checkLock = new();

    private Dictionary<string, object?> _state = new();
    private JsonElement? _pendingApp;
    private string? _pendingVersion;
    private string? _pendingNotes;
    private bool _checking;

    private string CurrentFile => Path.Combine(UpdatesDir, "current.json");
    public bool Enabled => _repo != null && _publicKeyBytes != null;

    private Updater()
    {
        var meta = typeof(Updater).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .ToDictionary(a => a.Key, a => a.Value ?? "", StringComparer.Ordinal);

        AppVersion = meta.GetValueOrDefault("RehearsalVersion", "0");
        int.TryParse(meta.GetValueOrDefault("RehearsalNativeWin", "1"), out int nat);
        NativeBuild = nat;

        var repo = meta.GetValueOrDefault("RehearsalUpdateRepo", "");
        _repo = repo.Contains('/') ? repo : null;

        var keyStr = meta.GetValueOrDefault("RehearsalUpdateKey", "");
        try
        {
            var raw = Convert.FromBase64String(keyStr.Trim());
            if (raw.Length == 32) _publicKeyBytes = raw;
        }
        catch { }

        var tb = Environment.GetEnvironmentVariable("REHEARSAL_UPDATE_TEST_BASE");
        _testBase = tb != null && tb.StartsWith("http://localhost:", StringComparison.OrdinalIgnoreCase) ? tb : null;

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        SupportDir = Path.Combine(localAppData, "Rehearsal");
        UpdatesDir = _testBase != null
            ? Path.Combine(Path.GetTempPath(), "rehearsal-update-test")
            : Path.Combine(SupportDir, "updates");

        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Rehearsal-Updater");
    }

    private string DownloadPrefix(string repo) => _testBase ?? $"https://github.com/{repo}/releases/download/";

    public string ActiveWebRoot(string bundled)
    {
        ActiveVersion = AppVersion;
        string? useDir = null;

        try
        {
            if (File.Exists(CurrentFile))
            {
                using var doc = JsonDocument.Parse(File.ReadAllBytes(CurrentFile));
                if (doc.RootElement.TryGetProperty("dir", out var dirEl) && dirEl.ValueKind == JsonValueKind.String)
                {
                    var dir = dirEl.GetString() ?? "";
                    if (!dir.Contains('/') && !dir.Contains('\\') && !dir.Contains(".."))
                    {
                        var candidate = Path.Combine(UpdatesDir, dir);
                        var ver = ReadVersion(candidate);
                        // Windows checks nativeWin (0 when omitted in web.zip built by Mac release.sh).
                        if (ver != null
                            && Newer(ver.Value.Version, AppVersion)
                            && ver.Value.NativeWin <= NativeBuild
                            && File.Exists(Path.Combine(candidate, "index.html")))
                        {
                            useDir = candidate;
                            ActiveVersion = ver.Value.Version;
                        }
                    }
                }
            }
        }
        catch { }

        // Tidy unused web-* folders
        try
        {
            if (Directory.Exists(UpdatesDir))
            {
                var keepName = useDir != null ? Path.GetFileName(useDir) : null;
                foreach (var d in Directory.GetDirectories(UpdatesDir, "web-*"))
                {
                    if (!string.Equals(Path.GetFileName(d), keepName, StringComparison.OrdinalIgnoreCase))
                    {
                        try { Directory.Delete(d, recursive: true); } catch { }
                    }
                }
            }
            if (useDir == null && File.Exists(CurrentFile))
            {
                try { File.Delete(CurrentFile); } catch { }
            }
        }
        catch { }

        return useDir ?? bundled;
    }

    private static (string Version, int NativeWin)? ReadVersion(string webDir)
    {
        try
        {
            var path = Path.Combine(webDir, "version.json");
            if (!File.Exists(path)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
            if (!doc.RootElement.TryGetProperty("version", out var vEl) || vEl.ValueKind != JsonValueKind.String)
                return null;
            var v = vEl.GetString();
            if (string.IsNullOrEmpty(v)) return null;
            int nw = 0;
            if (doc.RootElement.TryGetProperty("nativeWin", out var nwEl) && nwEl.ValueKind == JsonValueKind.Number)
                nw = nwEl.GetInt32();
            return (v, nw);
        }
        catch { return null; }
    }

    public static bool Newer(string a, string b)
    {
        var x = a.Split('.').Select(s => int.TryParse(s, out int n) ? n : 0).ToArray();
        var y = b.Split('.').Select(s => int.TryParse(s, out int n) ? n : 0).ToArray();
        int len = Math.Max(x.Length, y.Length);
        for (int i = 0; i < len; i++)
        {
            int p = i < x.Length ? x[i] : 0;
            int q = i < y.Length ? y[i] : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private void Publish(Dictionary<string, object?> s)
    {
        s["current"] = ActiveVersion;
        s["app"] = AppVersion;
        s["enabled"] = Enabled;
        _state = s;
        OnState?.Invoke(new Dictionary<string, object?>(s));
    }

    public Dictionary<string, object?> Status()
    {
        if (_state.Count == 0)
            Publish(new Dictionary<string, object?> { ["state"] = Enabled ? "idle" : "off" });
        return new Dictionary<string, object?>(_state);
    }

    public void Check(bool manual)
    {
        if (!Enabled || _repo == null || _publicKeyBytes == null)
        {
            if (manual) Publish(new Dictionary<string, object?> { ["state"] = "off" });
            return;
        }

        lock (_checkLock)
        {
            if (_checking) return;
            _checking = true;
        }

        if (manual) Publish(new Dictionary<string, object?> { ["state"] = "checking" });
        var baseUrl = _testBase ?? $"https://github.com/{_repo}/releases/latest/download/";
        var repo = _repo;
        var pubKey = _publicKeyBytes;

        _ = Task.Run(async () =>
        {
            try
            {
                var manifestBytes = await FetchAsync(baseUrl + "latest.json");
                var sigBytesRaw = await FetchAsync(baseUrl + "latest.json.sig");
                var sigB64 = Encoding.UTF8.GetString(sigBytesRaw).Trim();

                byte[] sigBytes;
                try { sigBytes = Convert.FromBase64String(sigB64); }
                catch { throw new UpdateFail("The update's signature doesn't match. It was not installed."); }

                if (!VerifySignature(pubKey, manifestBytes, sigBytes))
                    throw new UpdateFail("The update's signature doesn't match. It was not installed.");

                using var doc = JsonDocument.Parse(manifestBytes);
                var root = doc.RootElement;
                if (!root.TryGetProperty("version", out var vEl) || vEl.ValueKind != JsonValueKind.String)
                    throw new UpdateFail("The update information could not be read.");

                var version = vEl.GetString() ?? "";
                int nativeWin = root.TryGetProperty("nativeWin", out var nwEl) && nwEl.ValueKind == JsonValueKind.Number
                    ? nwEl.GetInt32() : 0;
                var notes = root.TryGetProperty("notes", out var nEl) && nEl.ValueKind == JsonValueKind.String
                    ? nEl.GetString() ?? "" : "";

                if (!Newer(version, ActiveVersion))
                {
                    if (manual) Publish(new Dictionary<string, object?> { ["state"] = "none" });
                    else if (Equals(_state.GetValueOrDefault("state"), "checking"))
                        Publish(new Dictionary<string, object?> { ["state"] = "idle" });
                    return;
                }

                if (nativeWin > NativeBuild)
                {
                    if (root.TryGetProperty("appWin", out var appWinEl) && appWinEl.ValueKind == JsonValueKind.Object)
                    {
                        _pendingApp = appWinEl.Clone();
                        _pendingVersion = version;
                        _pendingNotes = notes;
                        Publish(new Dictionary<string, object?>
                        {
                            ["state"] = "app",
                            ["version"] = version,
                            ["notes"] = notes,
                        });
                        if (_testBase != null && Environment.GetEnvironmentVariable("REHEARSAL_UPDATE_TEST_INSTALL") != null)
                        {
                            Program.RunOnUi(InstallApp);
                        }
                    }
                    else
                    {
                        OpenReleasePage(repo, version);
                        Publish(new Dictionary<string, object?>
                        {
                            ["state"] = "app",
                            ["version"] = version,
                            ["notes"] = notes,
                            ["manual"] = true,
                        });
                    }
                    return;
                }

                if (!root.TryGetProperty("web", out var webEl) || webEl.ValueKind != JsonValueKind.Object)
                    throw new UpdateFail("The update has no web files.");

                if (manual)
                {
                    Publish(new Dictionary<string, object?> { ["state"] = "downloading", ["version"] = version });
                }

                await InstallWebAsync(webEl.Clone(), version, repo);
                Publish(new Dictionary<string, object?>
                {
                    ["state"] = "web-ready",
                    ["version"] = version,
                    ["notes"] = notes,
                });
            }
            catch (Exception ex)
            {
                if (manual)
                {
                    var msg = ex is UpdateFail uf
                        ? uf.Message
                        : "Couldn't reach GitHub. Check the internet connection and try again.";
                    Publish(new Dictionary<string, object?> { ["state"] = "error", ["message"] = msg });
                }
            }
            finally
            {
                lock (_checkLock) { _checking = false; }
            }
        });
    }

    public void InstallApp()
    {
        if (_repo == null || _pendingApp == null) return;
        var appEntry = _pendingApp.Value;
        var repo = _repo;
        var version = _pendingVersion ?? "";
        var notes = _pendingNotes ?? "";

        var targetDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var targetExe = Process.GetCurrentProcess().MainModule?.FileName ?? Path.Combine(targetDir, "Rehearsal.exe");

        if (!IsDirectoryWritable(targetDir))
        {
            OpenReleasePage(repo, version);
            Publish(new Dictionary<string, object?>
            {
                ["state"] = "app",
                ["version"] = version,
                ["notes"] = notes,
                ["manual"] = true,
            });
            return;
        }

        Publish(new Dictionary<string, object?> { ["state"] = "installing", ["version"] = version });

        _ = Task.Run(async () =>
        {
            try
            {
                var data = await DownloadEntryAsync(appEntry, repo);
                var extractOut = UnzipToTemp(data);
                var tmpRoot = Directory.GetParent(extractOut)!.FullName;

                var newExe = Directory.GetFiles(extractOut, "Rehearsal.exe", SearchOption.AllDirectories).FirstOrDefault();
                if (newExe == null)
                    throw new UpdateFail("The download has no app in it.");

                var srcDir = Path.GetDirectoryName(newExe)!;
                var pid = Environment.ProcessId;

                var psScript =
                    "$p=[int]$env:REH_PID; " +
                    "while(Get-Process -Id $p -ErrorAction SilentlyContinue){Start-Sleep -Milliseconds 200}; " +
                    "Start-Sleep -Milliseconds 300; " +
                    "$s=$env:REH_SRC; $d=$env:REH_DST; $t=$env:REH_TMP; $e=$env:REH_EXE; " +
                    "$w=Join-Path $d 'web'; $wo=Join-Path $d 'web.old'; " +
                    "if(Test-Path $wo){Remove-Item -Recurse -Force $wo -ErrorAction SilentlyContinue}; " +
                    "if(Test-Path $w){Rename-Item $w $wo -ErrorAction SilentlyContinue}; " +
                    "Copy-Item -Path (Join-Path $s '*') -Destination $d -Recurse -Force; " +
                    "if(Test-Path $wo){Remove-Item -Recurse -Force $wo -ErrorAction SilentlyContinue}; " +
                    "Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue; " +
                    "Start-Process -FilePath $e";

                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetTempPath(),
                };
                psi.ArgumentList.Add("-NoProfile");
                psi.ArgumentList.Add("-NonInteractive");
                psi.ArgumentList.Add("-WindowStyle");
                psi.ArgumentList.Add("Hidden");
                psi.ArgumentList.Add("-Command");
                psi.ArgumentList.Add(psScript);
                psi.Environment["REH_PID"] = pid.ToString();
                psi.Environment["REH_SRC"] = srcDir;
                psi.Environment["REH_DST"] = targetDir;
                psi.Environment["REH_TMP"] = tmpRoot;
                psi.Environment["REH_EXE"] = targetExe;

                Process.Start(psi);
                Program.RunOnUi(Application.Exit);
            }
            catch (Exception ex)
            {
                var msg = ex is UpdateFail uf ? uf.Message : "The update couldn't be downloaded. Try again.";
                Publish(new Dictionary<string, object?> { ["state"] = "error", ["message"] = msg });
            }
        });
    }

    private async Task InstallWebAsync(JsonElement webEntry, string version, string repo)
    {
        var data = await DownloadEntryAsync(webEntry, repo);
        var extractOut = UnzipToTemp(data);
        var tmpRoot = Directory.GetParent(extractOut)!.FullName;

        var src = Path.Combine(extractOut, "web");
        var ver = ReadVersion(src);
        if (ver == null || !string.Equals(ver.Value.Version, version, StringComparison.Ordinal)
            || !File.Exists(Path.Combine(src, "index.html")))
        {
            throw new UpdateFail("The update's files are incomplete.");
        }

        Directory.CreateDirectory(UpdatesDir);
        var safeVer = new string(version.Where(c => char.IsDigit(c) || c == '.').ToArray());
        var folderName = "web-" + safeVer;
        var dst = Path.Combine(UpdatesDir, folderName);
        if (Directory.Exists(dst)) Directory.Delete(dst, recursive: true);

        try { Directory.Move(src, dst); }
        catch { CopyDirectory(src, dst); }

        try { Directory.Delete(tmpRoot, recursive: true); } catch { }

        var curJson = JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, string>
        {
            ["dir"] = folderName,
            ["version"] = version,
        });
        var curTmp = CurrentFile + ".tmp";
        File.WriteAllBytes(curTmp, curJson);
        File.Move(curTmp, CurrentFile, overwrite: true);
    }

    private async Task<byte[]> FetchAsync(string url)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
        using var resp = await _http.SendAsync(req);
        if (!resp.IsSuccessStatusCode)
            throw new UpdateFail($"Couldn't download the update ({(int)resp.StatusCode}).");
        return await resp.Content.ReadAsByteArrayAsync();
    }

    private async Task<byte[]> DownloadEntryAsync(JsonElement entry, string repo)
    {
        if (!entry.TryGetProperty("url", out var urlEl) || urlEl.ValueKind != JsonValueKind.String
            || !entry.TryGetProperty("sha256", out var shaEl) || shaEl.ValueKind != JsonValueKind.String)
        {
            throw new UpdateFail("The update information is incomplete.");
        }

        var url = urlEl.GetString() ?? "";
        var want = (shaEl.GetString() ?? "").ToLowerInvariant();
        if (!url.StartsWith(DownloadPrefix(repo), StringComparison.OrdinalIgnoreCase))
            throw new UpdateFail("The update information is incomplete.");

        var data = await FetchAsync(url);
        var got = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
        if (!string.Equals(got, want, StringComparison.Ordinal))
            throw new UpdateFail("The download was damaged (checksum mismatch). Try again.");
        return data;
    }

    private static string UnzipToTemp(byte[] data)
    {
        var tmp = Path.Combine(Path.GetTempPath(), "rehearsal-update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        var zipPath = Path.Combine(tmp, "u.zip");
        var outDir = Path.Combine(tmp, "out");
        File.WriteAllBytes(zipPath, data);
        try
        {
            ZipFile.ExtractToDirectory(zipPath, outDir, overwriteFiles: true);
            return outDir;
        }
        catch
        {
            throw new UpdateFail("The update couldn't be unpacked.");
        }
    }

    private static bool VerifySignature(byte[] publicKeyBytes, byte[] message, byte[] signature)
    {
        try
        {
            var pubKey = new Ed25519PublicKeyParameters(publicKeyBytes, 0);
            var verifier = new Ed25519Signer();
            verifier.Init(false, pubKey);
            verifier.BlockUpdate(message, 0, message.Length);
            return verifier.VerifySignature(signature);
        }
        catch { return false; }
    }

    private static bool IsDirectoryWritable(string dir)
    {
        try
        {
            var probe = Path.Combine(dir, ".write-test-" + Guid.NewGuid().ToString("N"));
            File.WriteAllBytes(probe, Array.Empty<byte>());
            File.Delete(probe);
            return true;
        }
        catch { return false; }
    }

    private static void OpenReleasePage(string repo, string version)
    {
        var url = string.IsNullOrEmpty(version)
            ? $"https://github.com/{repo}/releases/latest"
            : $"https://github.com/{repo}/releases/tag/v{version}";
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    private static void CopyDirectory(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var f in Directory.GetFiles(src))
            File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), overwrite: true);
        foreach (var d in Directory.GetDirectories(src))
            CopyDirectory(d, Path.Combine(dst, Path.GetFileName(d)));
    }

    private sealed class UpdateFail : Exception
    {
        public UpdateFail(string message) : base(message) { }
    }
}
