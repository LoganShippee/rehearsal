using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Rehearsal;

/// <summary>
/// Dedicated Google Drive browser window sharing WebView2 login session with the main app.
/// Mirrors native/drive.swift.
/// </summary>
internal sealed class DriveForm : Form
{
    private readonly WebView2 _web = new();
    private readonly Button _back = new() { Text = "◀", Width = 34 };
    private readonly Button _fwd = new() { Text = "▶", Width = 34 };
    private readonly Button _home = new() { Text = "My Drive", AutoSize = true };
    private readonly Button _shared = new() { Text = "Shared with me", AutoSize = true };
    private readonly Button _reload = new() { Text = "↻", Width = 34 };
    private readonly Label _hint = new()
    {
        Text = "Open a file in Drive, then click “Use this file”.",
        AutoEllipsis = true,
        TextAlign = ContentAlignment.MiddleLeft,
        Dock = DockStyle.Fill,
    };
    private readonly Button _useBtn = new()
    {
        Text = "Use this file",
        AutoSize = true,
        Enabled = false,
    };

    private readonly System.Windows.Forms.Timer _spaTimer = new() { Interval = 700 };
    private MainForm? _requester;
    private bool _initialized;
    private string? _pendingUrl;

    public DriveForm()
    {
        Text = "Google Drive";
        Width = 1100;
        Height = 760;
        StartPosition = FormStartPosition.CenterScreen;

        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var bar = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 44,
            ColumnCount = 7,
            RowCount = 1,
            Padding = new Padding(8, 6, 8, 6),
        };
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        bar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        bar.Controls.Add(_back, 0, 0);
        bar.Controls.Add(_fwd, 1, 0);
        bar.Controls.Add(_home, 2, 0);
        bar.Controls.Add(_shared, 3, 0);
        bar.Controls.Add(_reload, 4, 0);
        bar.Controls.Add(_hint, 5, 0);
        bar.Controls.Add(_useBtn, 6, 0);

        _web.Dock = DockStyle.Fill;
        Controls.Add(_web);
        Controls.Add(bar);

        _back.Click += (_, _) => { if (_web.CoreWebView2?.CanGoBack == true) _web.CoreWebView2.GoBack(); };
        _fwd.Click += (_, _) => { if (_web.CoreWebView2?.CanGoForward == true) _web.CoreWebView2.GoForward(); };
        _home.Click += (_, _) => Navigate("https://drive.google.com/drive/my-drive");
        _shared.Click += (_, _) => Navigate("https://drive.google.com/drive/shared-with-me");
        _reload.Click += (_, _) => _web.CoreWebView2?.Reload();
        _useBtn.Click += (_, _) => UseFile();

        AcceptButton = _useBtn;
        _spaTimer.Tick += (_, _) => { if (Visible && _initialized) RefreshUi(); };
        _spaTimer.Start();

        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };
    }

    public async void Open(string? url, MainForm requester)
    {
        _requester = requester;
        if (!Visible) Show();
        Activate();

        if (!_initialized)
        {
            _pendingUrl = url;
            await InitAsync();
            return;
        }

        if (!string.IsNullOrEmpty(url) && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == "https")
        {
            Navigate(u.AbsoluteUri);
        }
        else if (_web.CoreWebView2 != null && string.IsNullOrEmpty(_web.CoreWebView2.Source))
        {
            Navigate("https://drive.google.com/drive/my-drive");
        }
    }

    private async Task InitAsync()
    {
        if (_initialized) return;
        try
        {
            var env = await Program.GetWebEnvAsync();
            await _web.EnsureCoreWebView2Async(env);
            _initialized = true;

            var core = _web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.NavigationCompleted += (_, _) => RefreshUi();
            core.SourceChanged += (_, _) => RefreshUi();
            core.DocumentTitleChanged += (_, _) => RefreshUi();
            core.NewWindowRequested += (_, e) =>
            {
                if (!string.IsNullOrEmpty(e.Uri) && e.Uri != "about:blank")
                {
                    e.Handled = true;
                    core.Navigate(e.Uri);
                }
            };

            if (!string.IsNullOrEmpty(_pendingUrl) && Uri.TryCreate(_pendingUrl, UriKind.Absolute, out var u) && u.Scheme == "https")
                Navigate(u.AbsoluteUri);
            else
                Navigate("https://drive.google.com/drive/my-drive");
        }
        catch { }
    }

    private void Navigate(string url)
    {
        if (_web.CoreWebView2 != null) _web.CoreWebView2.Navigate(url);
    }

    private static (string Kind, string Id)? Parse(string? rawUrl)
    {
        if (string.IsNullOrEmpty(rawUrl) || !Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)) return null;
        var host = url.Host;
        var parts = url.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);

        if (string.Equals(host, "docs.google.com", StringComparison.OrdinalIgnoreCase))
        {
            int idx = Array.IndexOf(parts, "d");
            if (idx >= 1 && idx + 1 < parts.Length) return (parts[idx - 1], parts[idx + 1]);
        }
        if (string.Equals(host, "drive.google.com", StringComparison.OrdinalIgnoreCase))
        {
            int dIdx = Array.IndexOf(parts, "d");
            if (dIdx >= 0 && dIdx + 1 < parts.Length && parts.Contains("file")) return ("file", parts[dIdx + 1]);
            int fIdx = Array.IndexOf(parts, "folders");
            if (fIdx >= 0 && fIdx + 1 < parts.Length) return ("folder", parts[fIdx + 1]);
        }
        return null;
    }

    private void RefreshUi()
    {
        var core = _web.CoreWebView2;
        if (core == null) return;
        _back.Enabled = core.CanGoBack;
        _fwd.Enabled = core.CanGoForward;
        var picked = Parse(core.Source);
        _useBtn.Enabled = picked != null;
        _hint.Text = picked != null
            ? $"Ready to add: {CleanTitle()} ({picked.Value.Kind})"
            : "Open a file in Drive, then click “Use this file”.";
    }

    private string CleanTitle()
    {
        var t = _web.CoreWebView2?.DocumentTitle ?? "Google file";
        foreach (var suffix in new[] { " - Google Slides", " - Google Docs", " - Google Sheets", " - Google Forms", " - Google Drive" })
        {
            if (t.EndsWith(suffix, StringComparison.Ordinal))
                t = t[..^suffix.Length];
        }
        return string.IsNullOrEmpty(t) ? "Google file" : t;
    }

    private void UseFile()
    {
        var url = _web.CoreWebView2?.Source;
        var picked = Parse(url);
        if (url == null || picked == null) return;

        var payload = new Dictionary<string, string>
        {
            ["url"] = url,
            ["title"] = CleanTitle(),
            ["kind"] = picked.Value.Kind,
            ["id"] = picked.Value.Id,
        };
        var json = JsonSerializer.Serialize(payload);
        _requester?.EvalScript($"window.__drivePicked && window.__drivePicked({json})");
        _requester?.Activate();
    }
}
