using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Rehearsal;

internal sealed class MainForm : Form
{
    private readonly WebView2 _webView = new();
    private readonly WebWindows _webWindows;
    private readonly List<Form> _popups = new();
    private readonly string _initialView;

    private bool _isCovering;
    private FormBorderStyle _savedBorder;
    private FormWindowState _savedState;
    private Rectangle _savedBounds;

    public MainForm(string view, string title, MainForm? cascadeFrom)
    {
        _initialView = view;
        Text = title;
        Width = 1280;
        Height = 800;
        MinimumSize = new Size(720, 480);
        BackColor = Color.FromArgb(10, 56, 84);
        KeyPreview = true;

        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        if (cascadeFrom != null && !cascadeFrom.IsDisposed)
        {
            StartPosition = FormStartPosition.Manual;
            Location = new Point(cascadeFrom.Left + 28, cascadeFrom.Top + 28);
        }
        else
        {
            StartPosition = FormStartPosition.CenterScreen;
        }

        _webView.Dock = DockStyle.Fill;
        _webView.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(_webView);

        _webWindows = new WebWindows(this, _webView);

        Shown += async (_, _) => await InitWebViewAsync();
        Resize += (_, _) => _webWindows.ReapplyRegion();
        KeyDown += OnFormKeyDown;
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            var env = await Program.GetWebEnvAsync();
            await _webView.EnsureCoreWebView2Async(env);

            var core = _webView.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = true;

            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.__REHEARSAL_PLATFORM='windows';" +
                "window.webkit={messageHandlers:{native:{postMessage:function(m){window.chrome.webview.postMessage(m);}}}};");

            core.WebMessageReceived += OnWebMessageReceived;
            core.PermissionRequested += OnPermissionRequested;
            core.NewWindowRequested += OnNewWindowRequested;
            core.NavigationStarting += OnNavigationStarting;

            var url = $"http://127.0.0.1:{Program.Port}/index.html?t={Program.Server.Token}";
            if (!string.IsNullOrEmpty(_initialView))
                url += "&view=" + Uri.EscapeDataString(_initialView);

            _webView.Source = new Uri(url);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"Could not start WebView2: {ex.Message}\n\nMake sure the Microsoft Edge WebView2 Runtime is installed.",
                "Rehearsal",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _webWindows.RemoveAll();
        foreach (var p in _popups.ToList())
        {
            try { p.Close(); } catch { }
        }
        _popups.Clear();
        base.OnFormClosed(e);
    }

    public void EvalScript(string js)
    {
        if (IsDisposed || _webView.IsDisposed || _webView.CoreWebView2 == null) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(() => EvalScript(js)); } catch { }
            return;
        }
        _ = _webView.CoreWebView2.ExecuteScriptAsync(js);
    }

    public void ReloadWebView()
    {
        if (IsDisposed || _webView.IsDisposed || _webView.CoreWebView2 == null) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(ReloadWebView); } catch { }
            return;
        }
        _webView.CoreWebView2.Reload();
    }

    public void ToggleCover()
    {
        if (_isCovering)
        {
            FormBorderStyle = _savedBorder;
            Bounds = _savedBounds;
            WindowState = _savedState;
            _isCovering = false;
        }
        else
        {
            var screen = Screen.FromControl(this);
            _savedBorder = FormBorderStyle;
            _savedState = WindowState;
            _savedBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;

            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = screen.Bounds;
            _isCovering = true;
            Activate();
        }
    }

    private void OnFormKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.F11)
        {
            ToggleCover();
            e.Handled = true;
        }
        else if (e.Control && e.KeyCode == Keys.R)
        {
            ReloadWebView();
            e.Handled = true;
        }
        else if (e.Control && e.Shift && e.KeyCode == Keys.N)
        {
            Program.OpenWindow("present", "Rehearsal — Present");
            e.Handled = true;
        }
        else if (e.Control && e.KeyCode == Keys.N)
        {
            Program.OpenWindow("edit", "Rehearsal");
            e.Handled = true;
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            var cmd = Str(root, "cmd");
            if (string.IsNullOrEmpty(cmd)) return;

            switch (cmd)
            {
                case "openPresent":
                {
                    var w = Program.OpenWindow("present", "Rehearsal — Present");
                    if (Bool(root, "fullscreen")) w.ToggleCover();
                    break;
                }
                case "print":
                    _webView.CoreWebView2?.ShowPrintUI(CoreWebView2PrintDialogKind.Browser);
                    break;
                case "openExternal":
                    OpenExternalUrl(Str(root, "url"));
                    break;
                case "openDrive":
                    Program.Drive.Open(Str(root, "url"), this);
                    break;
                case "webSync":
                    _webWindows.Sync(root);
                    break;
                case "webCmd":
                    _webWindows.Command(root);
                    break;
                case "listAppWindows":
                    // Third-party desktop window mirroring is Mac-only in v1; report permissions OK with empty list.
                    EvalScript("window.__appWindows && window.__appWindows({\"screen\":true,\"input\":true,\"windows\":[]})");
                    break;
                case "requestPermission":
                case "launchApp":
                    break;
                case "chromeBookmarks":
                {
                    var payload = new Dictionary<string, object> { ["profiles"] = Bookmarks.Profiles() };
                    EvalScript("window.__chromeBookmarks && window.__chromeBookmarks(" + JsonSerializer.Serialize(payload) + ")");
                    break;
                }
                case "updateStatus":
                    Program.SendUpdateState(Updater.Shared.Status());
                    break;
                case "updateCheck":
                    Updater.Shared.Check(manual: true);
                    break;
                case "updateApply":
                    Program.ApplyWebUpdate();
                    break;
                case "updateInstallApp":
                    Updater.Shared.InstallApp();
                    break;
                case "hello":
                    EvalScript("document.documentElement.style.setProperty('--safe-top', '0px')");
                    break;
                case "fullscreen":
                    ToggleCover();
                    break;
                case "saveText":
                {
                    var name = Str(root, "name") ?? "export.json";
                    var text = Str(root, "text") ?? "";
                    using var dlg = new SaveFileDialog
                    {
                        FileName = name,
                        Filter = "All files (*.*)|*.*",
                    };
                    if (dlg.ShowDialog(this) == DialogResult.OK)
                    {
                        try { File.WriteAllText(dlg.FileName, text); } catch { }
                    }
                    break;
                }
                case "saveFile":
                {
                    var id = Str(root, "id");
                    if (string.IsNullOrEmpty(id) || id.Contains('/') || id.Contains('\\') || id.Contains("..")) break;
                    var src = Path.Combine(Program.Server.FilesDir, id);
                    if (!File.Exists(src)) break;
                    using var dlg = new SaveFileDialog
                    {
                        FileName = Str(root, "name") ?? "Recording",
                        Filter = "All files (*.*)|*.*",
                    };
                    if (dlg.ShowDialog(this) == DialogResult.OK)
                    {
                        try { File.Copy(src, dlg.FileName, overwrite: true); } catch { }
                    }
                    break;
                }
            }
        }
        catch { }
    }

    private void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        if (e.PermissionKind == CoreWebView2PermissionKind.Microphone
            && Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)
            && (uri.Host == "127.0.0.1" || uri.Host == "localhost"))
        {
            e.State = CoreWebView2PermissionState.Allow;
            e.Handled = true;
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)
            && uri.Host != "127.0.0.1"
            && uri.Host != "localhost"
            && (uri.Scheme == "http" || uri.Scheme == "https"))
        {
            e.Cancel = true;
            OpenExternalUrl(e.Uri);
        }
    }

    private async void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri);
        var host = uri?.Host ?? "";
        var path = uri?.AbsolutePath ?? "";

        bool isGoogleSignIn = string.IsNullOrEmpty(e.Uri)
            || e.Uri == "about:blank"
            || host.EndsWith("accounts.google.com", StringComparison.OrdinalIgnoreCase)
            || (host.EndsWith("google.com", StringComparison.OrdinalIgnoreCase) && path.Contains("signin", StringComparison.OrdinalIgnoreCase));

        if (!isGoogleSignIn)
        {
            e.Handled = true;
            OpenExternalUrl(e.Uri);
            return;
        }

        var deferral = e.GetDeferral();
        try
        {
            var popupForm = new Form
            {
                Text = "Sign in with Google",
                Width = 520,
                Height = 680,
                StartPosition = FormStartPosition.CenterParent,
            };
            var popupWeb = new WebView2 { Dock = DockStyle.Fill };
            popupForm.Controls.Add(popupWeb);
            _popups.Add(popupForm);
            popupForm.FormClosed += (_, _) => _popups.Remove(popupForm);
            popupForm.Show(this);

            var env = await Program.GetWebEnvAsync();
            await popupWeb.EnsureCoreWebView2Async(env);
            popupWeb.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            popupWeb.CoreWebView2.WindowCloseRequested += (_, _) => popupForm.Close();

            e.NewWindow = popupWeb.CoreWebView2;
            e.Handled = true;
        }
        finally
        {
            deferral.Complete();
        }
    }

    internal static void OpenExternalUrl(string? s)
    {
        if (string.IsNullOrEmpty(s) || !Uri.TryCreate(s, UriKind.Absolute, out var u)) return;
        if (u.Scheme is "http" or "https" or "mailto")
        {
            try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { }
        }
    }

    internal static string? Str(JsonElement obj, string prop)
        => obj.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    internal static bool Bool(JsonElement obj, string prop)
        => obj.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.True;
}
