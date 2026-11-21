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
    private List<string> _lastOrder = new();
    private List<(Rectangle Rect, double Z)> _lastHoles = new();
    private List<(Rectangle Rect, double Z)> _lastBlockers = new();

    public WebWindows(MainForm ownerForm, WebView2 ownerWeb)
    {
        _ownerForm = ownerForm;
        _ownerWeb = ownerWeb;
    }

    private float Scale => _ownerForm.DeviceDpi / 96f;

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

                if (!_views.TryGetValue(id, out var wv))
                {
                    wv = CreateChildWebView(id, rect.Value, MainForm.Str(it, "url"));
                    _views[id] = wv;
                }

                bool hide = MainForm.Bool(it, "hidden");
                if (wv.Visible != !hide) wv.Visible = !hide;
                if (!hide && wv.Bounds != rect.Value) wv.Bounds = rect.Value;
            }
        }

        foreach (var id in _views.Keys.Where(k => !seen.Contains(k)).ToList())
        {
            var v = _views[id];
            _views.Remove(id);
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
        var wv = new WebView2
        {
            Bounds = bounds,
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

            var core = wv.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.NavigationStarting += (_, _) => ReportNav(id, wv);
            core.NavigationCompleted += (_, _) => ReportNav(id, wv);
            core.DocumentTitleChanged += (_, _) => ReportNav(id, wv);
            core.NewWindowRequested += (_, e) =>
            {
                if (!string.IsNullOrEmpty(e.Uri) && e.Uri != "about:blank")
                {
                    e.Handled = true;
                    core.Navigate(e.Uri);
                }
            };

            if (!string.IsNullOrEmpty(initialUrl) && Uri.TryCreate(initialUrl, UriKind.Absolute, out var u)
                && (u.Scheme == "http" || u.Scheme == "https"))
            {
                wv.Source = u;
            }
        }
        catch { }
    }

    public void Command(JsonElement body)
    {
        var id = MainForm.Str(body, "id");
        if (string.IsNullOrEmpty(id) || !_views.TryGetValue(id, out var wv)) return;
        var core = wv.CoreWebView2;
        if (core == null) return;

        switch (MainForm.Str(body, "action"))
        {
            case "load":
            {
                var url = MainForm.Str(body, "url");
                if (!string.IsNullOrEmpty(url) && Uri.TryCreate(url, UriKind.Absolute, out var u)
                    && (u.Scheme == "http" || u.Scheme == "https"))
                {
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
                core.Reload();
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
        _lastOrder.Clear();
        _lastHoles.Clear();
        _lastBlockers.Clear();
        var prev = _ownerWeb.Region;
        _ownerWeb.Region = null;
        prev?.Dispose();
    }

    private void ReportNav(string id, WebView2 wv)
    {
        var core = wv.CoreWebView2;
        if (core == null) return;
        var payload = new Dictionary<string, object>
        {
            ["id"] = id,
            ["url"] = core.Source ?? "",
            ["title"] = core.DocumentTitle ?? "",
            ["back"] = core.CanGoBack,
            ["forward"] = core.CanGoForward,
        };
        _ownerForm.EvalScript("window.__webNav && window.__webNav(" + JsonSerializer.Serialize(payload) + ")");
    }
}
