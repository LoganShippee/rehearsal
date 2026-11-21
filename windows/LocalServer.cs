using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Rehearsal;

/// <summary>
/// Loopback-only HTTP server serving the bundled/updated web folder and local storage APIs.
/// Uses TcpListener on 127.0.0.1 so it works without admin privileges or http.sys URL ACLs.
/// </summary>
internal sealed class LocalServer
{
    public string Token { get; }
    public string WebRoot { get; set; }
    public string DataDir { get; }
    public string FilesDir => Path.Combine(DataDir, "files");
    public string DataFile => Path.Combine(DataDir, "data.json");
    public string BackupsDir => Path.Combine(DataDir, "backups");
    public Action<string>? OnSave { get; set; }

    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly object _backupLock = new();

    private static readonly Dictionary<int, string> StatusNames = new()
    {
        [200] = "OK",
        [204] = "No Content",
        [400] = "Bad Request",
        [403] = "Forbidden",
        [404] = "Not Found",
        [405] = "Method Not Allowed",
    };

    private static readonly Dictionary<string, string> MimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".htm"] = "text/html; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8",
        [".mjs"] = "text/javascript; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".json"] = "application/json",
        [".webmanifest"] = "application/manifest+json",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
        [".ico"] = "image/x-icon",
        [".mp3"] = "audio/mpeg",
        [".wav"] = "audio/wav",
        [".m4a"] = "audio/mp4",
        [".ogg"] = "audio/ogg",
        [".woff2"] = "font/woff2",
        [".woff"] = "font/woff",
        [".ttf"] = "font/ttf",
        [".pdf"] = "application/pdf",
        [".xml"] = "application/xml",
    };

    public LocalServer(string webRoot, string dataDir)
    {
        WebRoot = webRoot;
        DataDir = dataDir;
        Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        Directory.CreateDirectory(FilesDir);
    }

    public int Start(int preferredPort)
    {
        TcpListener listener;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, preferredPort);
            listener.Start();
        }
        catch
        {
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
        }

        _listener = listener;
        _cts = new CancellationTokenSource();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _ = AcceptLoopAsync(listener, _cts.Token);
        return port;
    }

    public void Stop()
    {
        try { _cts?.Cancel(); } catch { }
        try { _listener?.Stop(); } catch { }
    }

    private async Task AcceptLoopAsync(TcpListener listener, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var client = await listener.AcceptTcpClientAsync(ct);
                _ = Task.Run(() => HandleClientAsync(client, ct), ct);
            }
            catch (OperationCanceledException) { break; }
            catch { if (ct.IsCancellationRequested) break; }
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            client.NoDelay = true;
            try
            {
                await using var stream = client.GetStream();
                var req = await ReadRequestAsync(stream, ct);
                if (req == null) return;
                await RouteAsync(req, stream);
            }
            catch { }
        }
    }

    private sealed class HttpRequestData
    {
        public required string Method { get; init; }
        public required string Path { get; init; }
        public required Dictionary<string, string> Query { get; init; }
        public required Dictionary<string, string> Headers { get; init; }
        public required byte[] Body { get; init; }
    }

    private static async Task<HttpRequestData?> ReadRequestAsync(NetworkStream stream, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        var buf = new byte[8192];
        int headerEnd = -1;

        while (headerEnd < 0)
        {
            int n = await stream.ReadAsync(buf, ct);
            if (n <= 0) return null;
            ms.Write(buf, 0, n);
            headerEnd = FindHeaderEnd(ms.GetBuffer(), (int)ms.Length);
            if (ms.Length > 64 * 1024 && headerEnd < 0) return null;
        }

        var raw = ms.GetBuffer();
        var totalLen = (int)ms.Length;
        var headStr = Encoding.UTF8.GetString(raw, 0, headerEnd);
        var lines = headStr.Split("\r\n");
        if (lines.Length == 0) return null;

        var first = lines[0].Split(' ', 3);
        if (first.Length < 2) return null;
        var method = first[0].ToUpperInvariant();
        var target = first[1];

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 1; i < lines.Length; i++)
        {
            int idx = lines[i].IndexOf(':');
            if (idx > 0)
            {
                headers[lines[i][..idx].Trim()] = lines[i][(idx + 1)..].Trim();
            }
        }

        int contentLen = 0;
        if (headers.TryGetValue("content-length", out var clStr))
        {
            int.TryParse(clStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out contentLen);
        }
        if (contentLen < 0 || contentLen > 256 * 1024 * 1024) return null;

        int bodyStart = headerEnd + 4;
        var body = new byte[contentLen];
        int already = Math.Min(contentLen, totalLen - bodyStart);
        if (already > 0) Buffer.BlockCopy(raw, bodyStart, body, 0, already);

        int offset = already;
        while (offset < contentLen)
        {
            int n = await stream.ReadAsync(body.AsMemory(offset, contentLen - offset), ct);
            if (n <= 0) return null;
            offset += n;
        }

        var q = new Dictionary<string, string>(StringComparer.Ordinal);
        string path = target;
        int qIdx = target.IndexOf('?');
        if (qIdx >= 0)
        {
            path = target[..qIdx];
            var queryStr = target[(qIdx + 1)..];
            foreach (var part in queryStr.Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                int eq = part.IndexOf('=');
                if (eq >= 0)
                    q[Uri.UnescapeDataString(part[..eq].Replace('+', ' '))] = Uri.UnescapeDataString(part[(eq + 1)..].Replace('+', ' '));
                else
                    q[Uri.UnescapeDataString(part.Replace('+', ' '))] = "";
            }
        }
        path = Uri.UnescapeDataString(path);
        if (string.IsNullOrEmpty(path)) path = "/";

        return new HttpRequestData
        {
            Method = method,
            Path = path,
            Query = q,
            Headers = headers,
            Body = body,
        };
    }

    private static int FindHeaderEnd(byte[] buf, int len)
    {
        for (int i = 0; i <= len - 4; i++)
        {
            if (buf[i] == '\r' && buf[i + 1] == '\n' && buf[i + 2] == '\r' && buf[i + 3] == '\n')
                return i;
        }
        return -1;
    }

    private static async Task SendAsync(NetworkStream stream, int status, string contentType, byte[] body)
    {
        var reason = StatusNames.GetValueOrDefault(status, "OK");
        var head = $"HTTP/1.1 {status} {reason}\r\n" +
                   $"Content-Type: {contentType}\r\n" +
                   $"Content-Length: {body.Length}\r\n" +
                   $"Cache-Control: no-store\r\n" +
                   $"X-Content-Type-Options: nosniff\r\n" +
                   $"Connection: close\r\n\r\n";
        var headBytes = Encoding.UTF8.GetBytes(head);
        await stream.WriteAsync(headBytes);
        if (body.Length > 0) await stream.WriteAsync(body);
        await stream.FlushAsync();
    }

    private static Task SendTextAsync(NetworkStream stream, int status, string contentType, string text)
        => SendAsync(stream, status, contentType, Encoding.UTF8.GetBytes(text));

    private async Task RouteAsync(HttpRequestData req, NetworkStream stream)
    {
        var p = req.Path;
        if (p.StartsWith("/api/", StringComparison.Ordinal) || p.StartsWith("/files/", StringComparison.Ordinal))
        {
            var tok = req.Headers.GetValueOrDefault("x-token")
                      ?? req.Query.GetValueOrDefault("t")
                      ?? "";
            if (!string.Equals(tok, Token, StringComparison.Ordinal))
            {
                await SendTextAsync(stream, 403, "text/plain", "forbidden");
                return;
            }
        }

        switch ((req.Method, p))
        {
            case ("GET", "/api/data"):
            {
                var d = File.Exists(DataFile) ? await File.ReadAllBytesAsync(DataFile) : Array.Empty<byte>();
                await SendAsync(stream, 200, "application/json", d);
                return;
            }
            case ("POST", "/api/data"):
            {
                if (!IsValidJson(req.Body))
                {
                    await SendTextAsync(stream, 400, "text/plain", "bad json");
                    return;
                }
                lock (_backupLock)
                {
                    var bak = Path.Combine(DataDir, "data.backup.json");
                    if (File.Exists(DataFile))
                    {
                        try { File.Copy(DataFile, bak, overwrite: true); } catch { }
                    }
                    DailyBackup(force: false);
                    WriteAtomic(DataFile, req.Body);
                }
                OnSave?.Invoke(req.Headers.GetValueOrDefault("x-client") ?? "");
                await SendAsync(stream, 204, "text/plain", Array.Empty<byte>());
                return;
            }
            case ("GET", "/api/backups"):
            {
                var list = new List<Dictionary<string, object>>();
                if (Directory.Exists(BackupsDir))
                {
                    var files = Directory.GetFiles(BackupsDir, "data-*.json")
                        .Select(f => new FileInfo(f))
                        .OrderByDescending(f => f.Name, StringComparer.Ordinal);
                    foreach (var fi in files)
                    {
                        var mod = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds();
                        list.Add(new Dictionary<string, object>
                        {
                            ["name"] = fi.Name,
                            ["size"] = fi.Length,
                            ["modified"] = mod,
                        });
                    }
                }
                await SendTextAsync(stream, 200, "application/json", JsonSerializer.Serialize(list));
                return;
            }
            case ("POST", "/api/backup-now"):
            {
                string name;
                lock (_backupLock) { name = DailyBackup(force: true) ?? ""; }
                await SendTextAsync(stream, 200, "text/plain", name);
                return;
            }
            case ("POST", "/api/restore"):
            {
                var n = SafeBackupName(req.Query.GetValueOrDefault("name"));
                if (n == null)
                {
                    await SendAsync(stream, 400, "text/plain", Array.Empty<byte>());
                    return;
                }
                var src = Path.Combine(BackupsDir, n);
                if (!File.Exists(src))
                {
                    await SendAsync(stream, 404, "text/plain", Array.Empty<byte>());
                    return;
                }
                var d = await File.ReadAllBytesAsync(src);
                if (!IsValidJson(d))
                {
                    await SendAsync(stream, 404, "text/plain", Array.Empty<byte>());
                    return;
                }
                lock (_backupLock)
                {
                    DailyBackup(force: true);
                    WriteAtomic(DataFile, d);
                }
                OnSave?.Invoke("restore");
                await SendAsync(stream, 204, "text/plain", Array.Empty<byte>());
                return;
            }
            case ("POST", "/api/file"):
            {
                var id = SafeId(req.Query.GetValueOrDefault("id"));
                if (id == null)
                {
                    await SendAsync(stream, 400, "text/plain", Array.Empty<byte>());
                    return;
                }
                Directory.CreateDirectory(FilesDir);
                WriteAtomic(Path.Combine(FilesDir, id), req.Body);
                await SendAsync(stream, 204, "text/plain", Array.Empty<byte>());
                return;
            }
            case ("DELETE", "/api/file"):
            {
                var id = SafeId(req.Query.GetValueOrDefault("id"));
                if (id == null)
                {
                    await SendAsync(stream, 400, "text/plain", Array.Empty<byte>());
                    return;
                }
                try { File.Delete(Path.Combine(FilesDir, id)); } catch { }
                await SendAsync(stream, 204, "text/plain", Array.Empty<byte>());
                return;
            }
            case ("GET", "/api/convert"):
            {
                await HandleConvertAsync(req, stream);
                return;
            }
            case ("GET", "/api/ytsearch"):
            {
                await HandleYtSearchAsync(req, stream);
                return;
            }
            case ("POST", "/api/purge-grlogs"):
            {
                int.TryParse(req.Query.GetValueOrDefault("keep") ?? "0", out int keep);
                keep = Math.Max(0, keep);
                if (Directory.Exists(FilesDir))
                {
                    var takes = Directory.GetFiles(FilesDir, "grlog*")
                        .Select(Path.GetFileName)
                        .Where(n => !string.IsNullOrEmpty(n) && n.Length > 1)
                        .Select(n => n![..^1])
                        .Distinct(StringComparer.Ordinal)
                        .OrderByDescending(x => x, StringComparer.Ordinal)
                        .Skip(keep);
                    foreach (var t in takes)
                    {
                        foreach (var sfx in new[] { "w", "j" })
                        {
                            try { File.Delete(Path.Combine(FilesDir, t + sfx)); } catch { }
                        }
                    }
                }
                await SendAsync(stream, 204, "text/plain", Array.Empty<byte>());
                return;
            }
        }

        if (req.Method == "GET" && p.StartsWith("/files/", StringComparison.Ordinal))
        {
            var id = SafeId(p["/files/".Length..]);
            if (id == null)
            {
                await SendAsync(stream, 404, "text/plain", Array.Empty<byte>());
                return;
            }
            var filePath = Path.Combine(FilesDir, id);
            if (!File.Exists(filePath))
            {
                await SendAsync(stream, 404, "text/plain", Array.Empty<byte>());
                return;
            }
            var m = req.Query.GetValueOrDefault("m");
            var mime = string.IsNullOrEmpty(m) ? "application/octet-stream" : m.Replace("\r", "").Replace("\n", "");
            await SendAsync(stream, 200, mime, await File.ReadAllBytesAsync(filePath));
            return;
        }

        if (req.Method != "GET")
        {
            await SendAsync(stream, 405, "text/plain", Array.Empty<byte>());
            return;
        }

        var rel = p == "/" ? "index.html" : p.TrimStart('/');
        if (string.IsNullOrEmpty(rel)) rel = "index.html";
        var rootFull = Path.GetFullPath(WebRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var full = Path.GetFullPath(Path.Combine(rootFull, rel.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || !File.Exists(full))
        {
            await SendTextAsync(stream, 404, "text/plain", "not found");
            return;
        }

        var ext = Path.GetExtension(full);
        var type = MimeTypes.GetValueOrDefault(ext, "application/octet-stream");
        await SendAsync(stream, 200, type, await File.ReadAllBytesAsync(full));
    }

    private async Task HandleConvertAsync(HttpRequestData req, NetworkStream stream)
    {
        var id = SafeId(req.Query.GetValueOrDefault("id"));
        if (id == null)
        {
            await SendAsync(stream, 400, "text/plain", Array.Empty<byte>());
            return;
        }
        var ext = string.Equals(req.Query.GetValueOrDefault("ext"), "mscx", StringComparison.OrdinalIgnoreCase) ? "mscx" : "mscz";
        var src = Path.Combine(FilesDir, id);
        if (!File.Exists(src))
        {
            await SendAsync(stream, 404, "text/plain", Array.Empty<byte>());
            return;
        }

        var mscore = FindMuseScoreExe();
        if (mscore == null)
        {
            await SendTextAsync(stream, 404, "text/plain", "MuseScore not found");
            return;
        }

        var tmp = Path.Combine(Path.GetTempPath(), "rehearsal-conv-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            var inF = Path.Combine(tmp, "score." + ext);
            var outF = Path.Combine(tmp, "score.musicxml");
            File.Copy(src, inF, overwrite: true);

            var psi = new ProcessStartInfo
            {
                FileName = mscore,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            psi.ArgumentList.Add("-o");
            psi.ArgumentList.Add(outF);
            psi.ArgumentList.Add(inF);

            using var proc = Process.Start(psi);
            if (proc == null)
            {
                await SendTextAsync(stream, 400, "text/plain", "could not run MuseScore");
                return;
            }
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
            try { await proc.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException) { try { proc.Kill(entireProcessTree: true); } catch { } }

            if (!File.Exists(outF))
            {
                await SendTextAsync(stream, 400, "text/plain", "conversion failed");
                return;
            }
            await SendAsync(stream, 200, "application/xml", await File.ReadAllBytesAsync(outF));
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { }
        }
    }

    private static string? FindMuseScoreExe()
    {
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        }.Where(s => !string.IsNullOrEmpty(s)).Distinct(StringComparer.OrdinalIgnoreCase);

        var rels = new[]
        {
            @"MuseScore 4\bin\MuseScore4.exe",
            @"MuseScore Studio 4\bin\MuseScore4.exe",
            @"MuseScore 5\bin\MuseScore5.exe",
            @"MuseScore Studio\bin\MuseScore4.exe",
            @"MuseScore Studio\bin\MuseScore5.exe",
        };

        foreach (var root in roots)
        {
            foreach (var rel in rels)
            {
                var p = Path.Combine(root, rel);
                if (File.Exists(p)) return p;
            }
        }
        return null;
    }

    private async Task HandleYtSearchAsync(HttpRequestData req, NetworkStream stream)
    {
        var q = (req.Query.GetValueOrDefault("q") ?? "").Trim();
        if (string.IsNullOrEmpty(q) || q.Length >= 200)
        {
            await SendAsync(stream, 400, "text/plain", Array.Empty<byte>());
            return;
        }
        try
        {
            var url = "https://www.youtube.com/results?search_query=" + Uri.EscapeDataString(q);
            using var msg = new HttpRequestMessage(HttpMethod.Get, url);
            msg.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
            msg.Headers.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9");
            msg.Headers.TryAddWithoutValidation("Cookie", "CONSENT=YES+1");

            using var resp = await _http.SendAsync(msg);
            var html = await resp.Content.ReadAsStringAsync();
            var list = YtResults(html);
            await SendTextAsync(stream, 200, "application/json", JsonSerializer.Serialize(list));
        }
        catch
        {
            await SendTextAsync(stream, 200, "application/json", "[]");
        }
    }

    private static List<Dictionary<string, string>> YtResults(string html)
    {
        var outList = new List<Dictionary<string, string>>();
        int start = html.IndexOf("var ytInitialData = ", StringComparison.Ordinal);
        if (start >= 0) start += "var ytInitialData = ".Length;
        else
        {
            start = html.IndexOf("ytInitialData = ", StringComparison.Ordinal);
            if (start < 0) return outList;
            start += "ytInitialData = ".Length;
        }
        int end = html.IndexOf(";</script>", start, StringComparison.Ordinal);
        if (end < 0) return outList;

        try
        {
            using var doc = JsonDocument.Parse(html[start..end]);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            Walk(doc.RootElement, seen, outList);
        }
        catch { }
        return outList;

        static string GetText(JsonElement el)
        {
            if (el.ValueKind != JsonValueKind.Object) return "";
            if (el.TryGetProperty("simpleText", out var st) && st.ValueKind == JsonValueKind.String)
                return st.GetString() ?? "";
            if (el.TryGetProperty("runs", out var runs) && runs.ValueKind == JsonValueKind.Array)
            {
                var sb = new StringBuilder();
                foreach (var r in runs.EnumerateArray())
                {
                    if (r.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String)
                        sb.Append(t.GetString());
                }
                return sb.ToString();
            }
            return "";
        }

        static void Walk(JsonElement el, HashSet<string> seen, List<Dictionary<string, string>> acc)
        {
            if (acc.Count >= 24) return;
            if (el.ValueKind == JsonValueKind.Object)
            {
                if (el.TryGetProperty("videoRenderer", out var vr) && vr.ValueKind == JsonValueKind.Object)
                {
                    if (vr.TryGetProperty("videoId", out var idEl) && idEl.ValueKind == JsonValueKind.String)
                    {
                        var id = idEl.GetString() ?? "";
                        if (!string.IsNullOrEmpty(id) && seen.Add(id))
                        {
                            vr.TryGetProperty("title", out var titleEl);
                            vr.TryGetProperty("lengthText", out var lenEl);
                            vr.TryGetProperty("ownerText", out var chEl);
                            acc.Add(new Dictionary<string, string>
                            {
                                ["id"] = id,
                                ["title"] = GetText(titleEl),
                                ["len"] = GetText(lenEl),
                                ["ch"] = GetText(chEl),
                            });
                            return;
                        }
                    }
                }
                foreach (var prop in el.EnumerateObject())
                {
                    Walk(prop.Value, seen, acc);
                    if (acc.Count >= 24) return;
                }
            }
            else if (el.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in el.EnumerateArray())
                {
                    Walk(item, seen, acc);
                    if (acc.Count >= 24) return;
                }
            }
        }
    }

    private string? DailyBackup(bool force)
    {
        if (!File.Exists(DataFile)) return null;
        Directory.CreateDirectory(BackupsDir);
        var stamp = DateTime.Now.ToString(force ? "yyyy-MM-dd-HHmmss" : "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var name = $"data-{stamp}{(force ? "-manual" : "")}.json";
        var dst = Path.Combine(BackupsDir, name);
        if (!force && File.Exists(dst)) return null;
        try { File.Copy(DataFile, dst, overwrite: true); } catch { return null; }

        try
        {
            var all = Directory.GetFiles(BackupsDir, "data-*.json")
                .Select(Path.GetFileName)
                .Where(n => n != null)
                .OrderBy(n => n, StringComparer.Ordinal)
                .ToList();
            if (all.Count > 30)
            {
                foreach (var old in all.Take(all.Count - 30))
                {
                    try { File.Delete(Path.Combine(BackupsDir, old!)); } catch { }
                }
            }
        }
        catch { }
        return name;
    }

    private static string? SafeBackupName(string? s)
    {
        if (string.IsNullOrEmpty(s) || s.Length >= 80) return null;
        if (!s.StartsWith("data-", StringComparison.Ordinal) || !s.EndsWith(".json", StringComparison.Ordinal)) return null;
        return s.All(c => char.IsLetterOrDigit(c) || c == '-' || c == '.') ? s : null;
    }

    private static string? SafeId(string? s)
    {
        if (string.IsNullOrEmpty(s) || s.Length >= 64) return null;
        return s.All(char.IsLetterOrDigit) ? s : null;
    }

    private static bool IsValidJson(byte[] bytes)
    {
        try { using var _ = JsonDocument.Parse(bytes); return true; }
        catch { return false; }
    }

    private static void WriteAtomic(string path, byte[] data)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var tmp = path + ".tmp." + Guid.NewGuid().ToString("N");
        File.WriteAllBytes(tmp, data);
        File.Move(tmp, path, overwrite: true);
    }
}
