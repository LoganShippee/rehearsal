using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Rehearsal;

/// <summary>
/// Full-browser child WebView2 controls positioned behind the main WebView2.
/// MainForm's main WebView2 cuts Win32 Region holes for each active browser hole
/// (excluding higher-z blockers like the dock, timers, and overlapping windows).
/// </summary>
internal sealed class WebWindows
{
    private readonly MainForm _ownerForm;
    private readonly WebView2 _ownerWeb;
    private readonly Dictionary<string, WebView2> _views = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _lastSyncedUrl = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Uri> _lastUrl = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _navUrls = new(StringComparer.Ordinal);
    private readonly Dictionary<string, double> _lastZoom = new(StringComparer.Ordinal);
    private readonly HashSet<string> _failedIds = new(StringComparer.Ordinal);
    private readonly HashSet<string> _isLoading = new(StringComparer.Ordinal);
    private List<string> _lastOrder = new();
    private List<(Rectangle Rect, double Z)> _lastHoles = new();
    private List<(Rectangle Rect, double Z)> _lastBlockers = new();

    public WebWindows(MainForm ownerForm, WebView2 ownerWeb)
    {
        _ownerForm = ownerForm;
        _ownerWeb = ownerWeb;
    }

    private float Scale => _ownerForm.DeviceDpi / 96f;

    private static bool TryParseHttpUri(string? raw, out Uri? uri)
    {
        uri = null;
        var s = raw?.Trim();
        if (string.IsNullOrEmpty(s) || string.Equals(s, "about:blank", StringComparison.OrdinalIgnoreCase))
            return false;
        if (Uri.TryCreate(s, UriKind.Absolute, out var u)
            && (string.Equals(u.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
                || string.Equals(u.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)))
        {
            uri = u;
            return true;
        }
        return false;
    }

    private static string HtmlEsc(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        return s.Replace("&", "&amp;", StringComparison.Ordinal)
                .Replace("<", "&lt;", StringComparison.Ordinal)
                .Replace(">", "&gt;", StringComparison.Ordinal)
                .Replace("\"", "&quot;", StringComparison.Ordinal)
                .Replace("'", "&#39;", StringComparison.Ordinal);
    }

    private Rectangle? ReadRect(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var arr) || arr.ValueKind != JsonValueKind.Array || arr.GetArrayLength() != 4)
            return null;
        float s = Scale;
        int x = (int)Math.Round(arr[0].GetDouble() * s);
        int y = (int)Math.Round(arr[1].GetDouble() * s);
        int w = (int)Math.Round(arr[2].GetDouble() * s);
        int h = (int)Math.Round(arr[3].GetDouble() * s);
        return new Rectangle(x, y, w, h);
    }

    private (Rectangle Rect, double Z)? ReadZRect(JsonElement arr)
    {
        if (arr.ValueKind != JsonValueKind.Array || arr.GetArrayLength() != 5) return null;
        float s = Scale;
        int x = (int)Math.Round(arr[0].GetDouble() * s);
        int y = (int)Math.Round(arr[1].GetDouble() * s);
        int w = (int)Math.Round(arr[2].GetDouble() * s);
        int h = (int)Math.Round(arr[3].GetDouble() * s);
        double z = arr[4].GetDouble();
        return (new Rectangle(x, y, w, h), z);
    }

    public void Sync(JsonElement body)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var order = new List<string>();

        if (body.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var it in itemsEl.EnumerateArray())
            {
                var id = MainForm.Str(it, "id");
                var rect = ReadRect(it, "rect");
                if (string.IsNullOrEmpty(id) || rect == null) continue;
                if (MainForm.Str(it, "kind") == "app") continue;

                seen.Add(id);
                order.Add(id);

                var rawUrl = MainForm.Str(it, "url");
                bool hasHttpUrl = TryParseHttpUri(rawUrl, out var u);

                if (_views.TryGetValue(id, out var wv))
                {
                    if (hasHttpUrl && u != null)
                    {
                        bool force = MainForm.Bool(it, "forceUrl");
                        bool urlChanged = !_lastSyncedUrl.TryGetValue(id, out var prevSynced)
                                          || !string.Equals(prevSynced, u.AbsoluteUri, StringComparison.Ordinal);
                        var core = wv.CoreWebView2;
                        bool neverLoaded = core != null
                                           && (string.IsNullOrEmpty(core.Source)
                                               || string.Equals(core.Source, "about:blank", StringComparison.OrdinalIgnoreCase))
                                           && !_isLoading.Contains(id)
                                           && !_failedIds.Contains(id);
                        if (force || urlChanged || neverLoaded)
                        {
                            _lastSyncedUrl[id] = u.AbsoluteUri;
                            _lastUrl[id] = u;
                            _failedIds.Remove(id);
                            if (core != null)
                            {
                                bool alreadyLoadingSame = _isLoading.Contains(id)
                                                          && string.Equals(core.Source, u.AbsoluteUri, StringComparison.Ordinal);
                                if (!alreadyLoadingSame && (force || !string.Equals(core.Source, u.AbsoluteUri, StringComparison.Ordinal) || neverLoaded))
                                {
                                    core.Navigate(u.AbsoluteUri);
                                }
                            }
                        }
                    }
                }
                else
                {
                    Uri? initUri = hasHttpUrl ? u : (_lastUrl.TryGetValue(id, out var savedU) ? savedU : null);
                    if (initUri != null)
                    {
                        _lastSyncedUrl[id] = initUri.AbsoluteUri;
                        _lastUrl[id] = initUri;
                        _failedIds.Remove(id);
                    }
                    wv = CreateChildWebView(id, rect.Value, initUri?.AbsoluteUri);
                    _views[id] = wv;
                    _lastOrder.Clear();
                }

                bool hide = MainForm.Bool(it, "hidden");
                if (wv.Visible != !hide) wv.Visible = !hide;
                if (!hide && rect.Value.Width > 0 && rect.Value.Height > 0 && wv.Bounds != rect.Value)
                {
                    wv.Bounds = rect.Value;
                }
            }
        }

        foreach (var id in _views.Keys.Where(k => !seen.Contains(k)).ToList())
        {
            var v = _views[id];
            _views.Remove(id);
            _lastSyncedUrl.Remove(id);
            _lastUrl.Remove(id);
            _navUrls.Remove(id);
            _lastZoom.Remove(id);
            _failedIds.Remove(id);
            _isLoading.Remove(id);
            _lastOrder.Clear();
            _ownerForm.Controls.Remove(v);
            v.Dispose();
        }

        if (!order.SequenceEqual(_lastOrder))
        {
            _lastOrder = order;
            // Maintain back-to-front ordering underneath _ownerWeb.
            _ownerWeb.BringToFront();
            foreach (var id in order)
            {
                if (_views.TryGetValue(id, out var v))
                {
                    v.BringToFront();
                }
            }
            _ownerWeb.BringToFront();
        }

        var holes = new List<(Rectangle Rect, double Z)>();
        if (body.TryGetProperty("holes", out var holesEl) && holesEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var h in holesEl.EnumerateArray())
            {
                var zr = ReadZRect(h);
                if (zr != null) holes.Add(zr.Value);
            }
        }

        var blockers = new List<(Rectangle Rect, double Z)>();
        if (body.TryGetProperty("blockers", out var blockersEl) && blockersEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var b in blockersEl.EnumerateArray())
            {
                var zr = ReadZRect(b);
                if (zr != null) blockers.Add(zr.Value);
            }
        }

        _lastHoles = holes;
        _lastBlockers = blockers;
        ReapplyRegion();
    }

    public void EnterCompanionMode()
    {
        foreach (var v in _views.Values)
        {
            if (v.Visible) v.Visible = false;
        }
        _lastHoles.Clear();
        _lastBlockers.Clear();
        ReapplyRegion();
    }

    public void ReapplyRegion()
    {
        if (_ownerWeb.IsDisposed) return;

        if (_lastHoles.Count == 0 || _ownerWeb.Width <= 0 || _ownerWeb.Height <= 0)
        {
            var old = _ownerWeb.Region;
            _ownerWeb.Region = null;
            old?.Dispose();
            return;
        }

        var rgn = new Region(new Rectangle(0, 0, _ownerWeb.Width, _ownerWeb.Height));
        foreach (var hole in _lastHoles)
        {
            if (hole.Rect.Width <= 0 || hole.Rect.Height <= 0) continue;
            using var holeRgn = new Region(hole.Rect);
            foreach (var blocker in _lastBlockers)
            {
                if (blocker.Z > hole.Z && blocker.Rect.Width > 0 && blocker.Rect.Height > 0)
                {
                    holeRgn.Exclude(blocker.Rect);
                }
            }
            rgn.Exclude(holeRgn);
        }

        var prev = _ownerWeb.Region;
        _ownerWeb.Region = rgn;
        prev?.Dispose();
    }

    private WebView2 CreateChildWebView(string id, Rectangle bounds, string? initialUrl)
    {
        var initBounds = new Rectangle(bounds.X, bounds.Y, Math.Max(1, bounds.Width), Math.Max(1, bounds.Height));
        var wv = new WebView2
        {
            Bounds = initBounds,
            Visible = true,
        };
        _ownerForm.Controls.Add(wv);
        _ownerWeb.BringToFront();

        _ = InitChildAsync(id, wv, initialUrl);
        return wv;
    }

    private async Task InitChildAsync(string id, WebView2 wv, string? initialUrl)
    {
        try
        {
            var env = await Program.GetWebEnvAsync();
            if (wv.IsDisposed) return;
            await wv.EnsureCoreWebView2Async(env);
            if (wv.IsDisposed || wv.CoreWebView2 == null) return;

            if (_lastZoom.TryGetValue(id, out var z))
            {
                try { wv.ZoomFactor = z; } catch { }
            }

            var core = wv.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.NavigationStarting += (_, e) =>
            {
                if (!string.IsNullOrEmpty(e.Uri) && Uri.TryCreate(e.Uri, UriKind.Absolute, out var navUri))
                {
                    if (string.Equals(navUri.Scheme, "mailto", StringComparison.OrdinalIgnoreCase))
                    {
                        e.Cancel = true;
                        MainForm.OpenExternalUrl(navUri.AbsoluteUri);
                        return;
                    }
                    if (string.Equals(navUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(navUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
                    {
                        _navUrls[id] = navUri.AbsoluteUri;
                        _lastUrl[id] = navUri;
                    }
                }
                _isLoading.Add(id);
                ReportNav(id, wv);
            };
            core.SourceChanged += (_, _) =>
            {
                RecordCommittedUrl(id, core);
                ReportNav(id, wv);
            };
            core.HistoryChanged += (_, _) => ReportNav(id, wv);
            core.NavigationCompleted += (_, e) =>
            {
                _isLoading.Remove(id);
                if (e.IsSuccess)
                {
                    RecordCommittedUrl(id, core);
                }
                else
                {
                    ShowError(id, wv, e.WebErrorStatus);
                }
                ReportNav(id, wv);
            };
            core.DocumentTitleChanged += (_, _) => ReportNav(id, wv);
            core.ProcessFailed += (_, _) =>
            {
                if (wv.IsDisposed || wv.CoreWebView2 == null) return;
                if (TryParseHttpUri(core.Source, out _))
                {
                    try { core.Reload(); } catch { }
                }
                else if (_lastUrl.TryGetValue(id, out var u))
                {
                    try { core.Navigate(u.AbsoluteUri); } catch { }
                }
            };
            core.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (TryParseHttpUri(e.Uri, out var targetUri) && targetUri != null)
                {
                    _lastUrl[id] = targetUri;
                    _failedIds.Remove(id);
                    core.Navigate(targetUri.AbsoluteUri);
                }
                else if (!string.IsNullOrEmpty(e.Uri)
                         && Uri.TryCreate(e.Uri, UriKind.Absolute, out var extUri)
                         && string.Equals(extUri.Scheme, "mailto", StringComparison.OrdinalIgnoreCase))
                {
                    MainForm.OpenExternalUrl(extUri.AbsoluteUri);
                }
            };

            Uri? target = null;
            if (_lastUrl.TryGetValue(id, out var latestU))
            {
                target = latestU;
            }
            else if (TryParseHttpUri(initialUrl, out var initU))
            {
                target = initU;
            }

            if (target != null)
            {
                _lastUrl[id] = target;
                _lastSyncedUrl[id] = target.AbsoluteUri;
                _failedIds.Remove(id);
                core.Navigate(target.AbsoluteUri);
            }
        }
        catch { }
    }

    public void Command(JsonElement body)
    {
        var id = MainForm.Str(body, "id");
        if (string.IsNullOrEmpty(id)) return;
        var action = MainForm.Str(body, "action");

        if (!_views.TryGetValue(id, out var wv))
        {
            if (action == "load" && TryParseHttpUri(MainForm.Str(body, "url"), out var pendingU) && pendingU != null)
            {
                _lastUrl[id] = pendingU;
                _lastSyncedUrl[id] = pendingU.AbsoluteUri;
            }
            else if (action == "zoom" && body.TryGetProperty("zoom", out var pzEl) && pzEl.ValueKind == JsonValueKind.Number)
            {
                _lastZoom[id] = Math.Clamp(pzEl.GetDouble(), 0.25, 5.0);
            }
            return;
        }

        if (action == "zoom")
        {
            if (body.TryGetProperty("zoom", out var zEl) && zEl.ValueKind == JsonValueKind.Number)
            {
                var z = Math.Clamp(zEl.GetDouble(), 0.25, 5.0);
                _lastZoom[id] = z;
                try { wv.ZoomFactor = z; } catch { }
            }
            return;
        }

        var core = wv.CoreWebView2;
        if (core == null)
        {
            if (action == "load" && TryParseHttpUri(MainForm.Str(body, "url"), out var pendingU) && pendingU != null)
            {
                _lastUrl[id] = pendingU;
                _lastSyncedUrl[id] = pendingU.AbsoluteUri;
                _failedIds.Remove(id);
            }
            return;
        }

        switch (action)
        {
            case "load":
            {
                if (TryParseHttpUri(MainForm.Str(body, "url"), out var u) && u != null)
                {
                    _lastSyncedUrl[id] = u.AbsoluteUri;
                    _lastUrl[id] = u;
                    _failedIds.Remove(id);
                    core.Navigate(u.AbsoluteUri);
                }
                break;
            }
            case "back":
                if (core.CanGoBack) core.GoBack();
                break;
            case "forward":
                if (core.CanGoForward) core.GoForward();
                break;
            case "reload":
                if (!_failedIds.Contains(id) && TryParseHttpUri(core.Source, out _))
                {
                    core.Reload();
                }
                else if (_lastUrl.TryGetValue(id, out var lastU))
                {
                    _failedIds.Remove(id);
                    core.Navigate(lastU.AbsoluteUri);
                }
                else
                {
                    core.Reload();
                }
                break;
            case "focus":
                wv.Focus();
                break;
        }
    }

    public void RemoveAll()
    {
        foreach (var v in _views.Values.ToList())
        {
            _ownerForm.Controls.Remove(v);
            v.Dispose();
        }
        _views.Clear();
        _lastSyncedUrl.Clear();
        _lastUrl.Clear();
        _navUrls.Clear();
        _lastZoom.Clear();
        _failedIds.Clear();
        _isLoading.Clear();
        _lastOrder.Clear();
        _lastHoles.Clear();
        _lastBlockers.Clear();
        var prev = _ownerWeb.Region;
        _ownerWeb.Region = null;
        prev?.Dispose();
    }

    private void RecordCommittedUrl(string id, CoreWebView2 core)
    {
        if (TryParseHttpUri(core.Source, out var u) && u != null)
        {
            _failedIds.Remove(id);
            _lastUrl[id] = u;
        }
    }

    private void ShowError(string id, WebView2 wv, CoreWebView2WebErrorStatus status)
    {
        if (status == CoreWebView2WebErrorStatus.OperationCanceled) return;
        var core = wv.CoreWebView2;
        if (core == null) return;

        _failedIds.Add(id);

        string failing = "";
        if (_navUrls.TryGetValue(id, out var navU) && TryParseHttpUri(navU, out _))
        {
            failing = navU;
        }
        else if (TryParseHttpUri(core.Source, out var srcU) && srcU != null)
        {
            failing = srcU.AbsoluteUri;
        }
        else if (_lastUrl.TryGetValue(id, out var lastU))
        {
            failing = lastU.AbsoluteUri;
        }

        if (TryParseHttpUri(failing, out var failUri) && failUri != null)
        {
            _lastUrl[id] = failUri;
        }

        bool isGoogle = failing.Contains("google.com", StringComparison.OrdinalIgnoreCase);
        string hint = isGoogle
            ? "If this Google file needs your account, open <b>Drive window</b> in the bar above to sign in once, then press <b>Reload</b>."
            : "Check the web address or internet connection, then press <b>Reload</b>.";
        string urlLine = string.IsNullOrEmpty(failing) ? "" : $"<div class=\"url\">{HtmlEsc(failing)}</div>";
        string reloadBtn = string.IsNullOrEmpty(failing)
            ? ""
            : $"<button data-url=\"{HtmlEsc(failing)}\" onclick=\"location.href=this.dataset.url\">↻ Reload</button>";
        string msg = DescribeWebError(status);

        string html =
            "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
            "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;box-sizing:border-box}" +
            ".card{max-width:460px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px 24px;box-shadow:0 6px 20px rgba(15,23,42,.06)}" +
            "h3{margin:0 0 8px;font-size:16px;color:#0f172a}" +
            ".msg{margin:0 0 10px;color:#334155}" +
            ".url{font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f1f5f9;color:#475569;padding:8px 10px;border-radius:8px;word-break:break-all;margin:0 0 12px}" +
            ".hint{margin:0 0 14px;font-size:13px;color:#475569}" +
            "button{background:#0f172a;color:#fff;border:0;border-radius:8px;padding:8px 14px;font:600 13px -apple-system,'Segoe UI',sans-serif;cursor:pointer}" +
            "button:hover{background:#1e293b}" +
            "</style></head><body><div class=\"card\">" +
            "<h3>Couldn’t load this page</h3>" +
            $"<p class=\"msg\">{HtmlEsc(msg)}</p>" +
            urlLine +
            $"<p class=\"hint\">{hint}</p>" +
            reloadBtn +
            "</div></body></html>";

        try { core.NavigateToString(html); } catch { }
    }

    private static string DescribeWebError(CoreWebView2WebErrorStatus status) => status switch
    {
        CoreWebView2WebErrorStatus.HostNameNotResolved => "The server’s address could not be found.",
        CoreWebView2WebErrorStatus.CannotConnect => "Could not connect to the server.",
        CoreWebView2WebErrorStatus.ServerUnreachable => "The server is unreachable.",
        CoreWebView2WebErrorStatus.Timeout => "The connection timed out.",
        CoreWebView2WebErrorStatus.Disconnected => "The internet connection appears to be offline.",
        CoreWebView2WebErrorStatus.ConnectionReset => "The connection was reset by the server.",
        CoreWebView2WebErrorStatus.ConnectionAborted => "The connection was interrupted.",
        CoreWebView2WebErrorStatus.CertificateCommonNameIsIncorrect or
        CoreWebView2WebErrorStatus.CertificateExpired or
        CoreWebView2WebErrorStatus.CertificateIsInvalid or
        CoreWebView2WebErrorStatus.CertificateRevoked or
        CoreWebView2WebErrorStatus.ClientCertificateContainsErrors => "This site’s security certificate is not trusted.",
        CoreWebView2WebErrorStatus.RedirectFailed => "The page redirected too many times.",
        CoreWebView2WebErrorStatus.ErrorHttpInvalidServerResponse => "The server sent an invalid response.",
        _ => $"The page could not be loaded ({status}).",
    };

    private void ReportNav(string id, WebView2 wv)
    {
        var core = wv.CoreWebView2;
        if (core == null) return;
        var cur = core.Source ?? "";
        var cleanUrl = (string.IsNullOrEmpty(cur)
                        || string.Equals(cur, "about:blank", StringComparison.OrdinalIgnoreCase)
                        || cur.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            ? (_lastUrl.TryGetValue(id, out var u) ? u.AbsoluteUri : "")
            : cur;
        var payload = new Dictionary<string, object>
        {
            ["id"] = id,
            ["url"] = cleanUrl,
            ["title"] = core.DocumentTitle ?? "",
            ["back"] = core.CanGoBack,
            ["forward"] = core.CanGoForward,
        };
        _ownerForm.EvalScript("window.__webNav && window.__webNav(" + JsonSerializer.Serialize(payload) + ")");
    }
}
