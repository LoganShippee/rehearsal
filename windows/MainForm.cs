using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
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

    private bool _isCompanion;
    private bool _compSavedCover;
    private FormBorderStyle _compSavedBorder;
    private FormWindowState _compSavedState;
    private Rectangle _compSavedBounds;
    private bool _compSavedTopMost;
    private Size _compSavedMinSize;

    private readonly System.Windows.Forms.Timer _dragTimer = new() { Interval = 12 };
    private Point _dragCursorStart;
    private Point _dragFormStart;
    private bool _dragMoving;

    private static readonly HashSet<string> SkipWindowTitles = new(StringComparer.OrdinalIgnoreCase)
    {
        "Program Manager",
        "Windows Input Experience",
        "Microsoft Text Input Application",
        "Default IME",
        "MSCTFIME UI",
        "Task Switching",
    };

    private static readonly HashSet<string> SkipProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "TextInputHost",
        "SearchHost",
        "SearchApp",
        "ShellExperienceHost",
        "StartMenuExperienceHost",
        "LockApp",
        "Widgets",
        "GameBar",
        "GameBarFTServer",
        "dwm",
        "csrss",
    };

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW = 0x00040000;
    private const uint GW_OWNER = 4;
    private const int SW_SHOW = 5;
    private const int SW_RESTORE = 9;
    private const int DWMWA_CLOAKED = 14;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_DEFAULT = 0;
    private const int DWMWCP_ROUND = 2;
    private const int WM_NCHITTEST = 0x0084;
    private const int HTCLIENT = 1;
    private const int HTCAPTION = 2;

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

        _dragTimer.Tick += OnDragTimerTick;

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
                "window.webkit={messageHandlers:{native:{postMessage:function(m){window.chrome.webview.postMessage(m);}}}};" +
                "document.addEventListener('pointerdown',function(e){" +
                "if(e.button!==0)return;" +
                "if(!document.querySelector('.present.companion'))return;" +
                "if(e.target&&e.target.closest&&e.target.closest('button,a,input,select,textarea,[data-action]'))return;" +
                "window.chrome.webview.postMessage({cmd:'companionDrag'});" +
                "},true);");

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
        _dragTimer.Stop();
        _dragTimer.Dispose();
        _webWindows.RemoveAll();
        foreach (var p in _popups.ToList())
        {
            try { p.Close(); } catch { }
        }
        _popups.Clear();
        base.OnFormClosed(e);
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (_isCompanion && m.Msg == WM_NCHITTEST && (int)m.Result == HTCLIENT)
        {
            m.Result = (IntPtr)HTCAPTION;
        }
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
        if (_isCompanion)
        {
            ExitCompanion();
        }
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

    private void EnterCompanion(JsonElement root)
    {
        var screen = Screen.FromControl(this);
        if (!_isCompanion)
        {
            _compSavedCover = _isCovering;
            _compSavedTopMost = TopMost;
            _compSavedMinSize = MinimumSize;
            if (_isCovering)
            {
                _compSavedBorder = _savedBorder;
                _compSavedState = _savedState;
                _compSavedBounds = _savedBounds;
                _isCovering = false;
            }
            else
            {
                _compSavedBorder = FormBorderStyle;
                _compSavedState = WindowState;
                _compSavedBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            }
            _isCompanion = true;
        }

        _webWindows.EnterCompanionMode();

        float scale = DeviceDpi / 96f;
        int hudW = (int)Math.Round(300 * scale);
        int hudH = (int)Math.Round(88 * scale);
        int margin = (int)Math.Round(16 * scale);
        int minW = (int)Math.Round(200 * scale);
        int minH = (int)Math.Round(60 * scale);

        var workArea = screen.WorkingArea;
        int x = workArea.Right - hudW - margin;
        int y = workArea.Bottom - hudH - margin;

        WindowState = FormWindowState.Normal;
        FormBorderStyle = FormBorderStyle.None;
        MinimumSize = new Size(minW, minH);
        Bounds = new Rectangle(x, y, hudW, hudH);
        TopMost = true;
        SetCornerPreference(DWMWCP_ROUND);

        EvalScript("document.documentElement.style.setProperty('--safe-top', '0px')");
        EvalScript("window.__companionState && window.__companionState(true)");

        long hwndVal = Int64(root, "hwnd");
        int pid = (int)Int64(root, "pid");
        var targetHwnd = ResolveTargetWindow(hwndVal, pid);
        if (targetHwnd != IntPtr.Zero)
        {
            ActivateExternalWindow(targetHwnd);
        }
    }

    private void ExitCompanion()
    {
        _dragTimer.Stop();
        _dragMoving = false;

        if (!_isCompanion)
        {
            EvalScript("window.__companionState && window.__companionState(false)");
            Activate();
            return;
        }

        _isCompanion = false;
        SetCornerPreference(DWMWCP_DEFAULT);
        MinimumSize = _compSavedMinSize.Width > 0 ? _compSavedMinSize : new Size(720, 480);
        TopMost = _compSavedTopMost;

        if (_compSavedCover)
        {
            _savedBorder = _compSavedBorder;
            _savedState = _compSavedState;
            _savedBounds = _compSavedBounds;
            _isCovering = true;

            var screen = Screen.FromControl(this);
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = screen.Bounds;
        }
        else
        {
            _isCovering = false;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = _compSavedBorder;
            Bounds = _compSavedBounds;
            WindowState = _compSavedState;
        }

        EvalScript("document.documentElement.style.setProperty('--safe-top', '0px')");
        EvalScript("window.__companionState && window.__companionState(false)");
        Activate();
        if (Handle != IntPtr.Zero)
        {
            try { SetForegroundWindow(Handle); } catch { }
        }
    }

    private void StartCompanionDrag()
    {
        if (!_isCompanion) return;
        _dragCursorStart = Cursor.Position;
        _dragFormStart = Location;
        _dragMoving = false;
        _dragTimer.Start();
    }

    private void OnDragTimerTick(object? sender, EventArgs e)
    {
        if (!_isCompanion || (MouseButtons & MouseButtons.Left) == 0)
        {
            _dragTimer.Stop();
            _dragMoving = false;
            return;
        }

        var cur = Cursor.Position;
        int dx = cur.X - _dragCursorStart.X;
        int dy = cur.Y - _dragCursorStart.Y;
        if (!_dragMoving && (dx * dx + dy * dy) > 9)
        {
            _dragMoving = true;
        }
        if (_dragMoving)
        {
            Location = new Point(_dragFormStart.X + dx, _dragFormStart.Y + dy);
        }
    }

    private void SetCornerPreference(int pref)
    {
        if (Handle == IntPtr.Zero) return;
        try { _ = DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int)); }
        catch { }
    }

    private static List<Dictionary<string, object>> ListAppWindows()
    {
        var results = new List<Dictionary<string, object>>();
        uint myPid = (uint)Environment.ProcessId;
        var procCache = new Dictionary<uint, (string AppName, string ProcessName, bool Skip)>();

        try
        {
            EnumWindows((hWnd, _) =>
            {
                if (!IsWindowVisible(hWnd)) return true;

                int len = GetWindowTextLengthW(hWnd);
                if (len <= 0) return true;

                int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                if ((exStyle & WS_EX_TOOLWINDOW) != 0 && (exStyle & WS_EX_APPWINDOW) == 0)
                    return true;
                if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero && (exStyle & WS_EX_APPWINDOW) == 0)
                    return true;

                try
                {
                    if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0)
                        return true;
                }
                catch { }

                var sb = new StringBuilder(len + 1);
                if (GetWindowTextW(hWnd, sb, sb.Capacity) <= 0) return true;
                var title = sb.ToString().Trim();
                if (string.IsNullOrEmpty(title) || SkipWindowTitles.Contains(title))
                    return true;

                GetWindowThreadProcessId(hWnd, out uint pid);
                if (pid == 0 || pid == myPid) return true;

                if (!procCache.TryGetValue(pid, out var pInfo))
                {
                    string procName = "";
                    string appName = "";
                    bool skip = false;
                    try
                    {
                        using var proc = Process.GetProcessById((int)pid);
                        procName = proc.ProcessName ?? "";
                        if (string.IsNullOrEmpty(procName) || SkipProcessNames.Contains(procName))
                        {
                            skip = true;
                        }
                        else if (string.Equals(procName, "explorer", StringComparison.OrdinalIgnoreCase))
                        {
                            appName = "File Explorer";
                        }
                        else
                        {
                            try
                            {
                                var desc = proc.MainModule?.FileVersionInfo?.FileDescription?.Trim();
                                if (!string.IsNullOrEmpty(desc)) appName = desc;
                            }
                            catch { }
                            if (string.IsNullOrEmpty(appName)) appName = procName;
                        }
                    }
                    catch
                    {
                        skip = true;
                    }
                    pInfo = (appName, procName, skip);
                    procCache[pid] = pInfo;
                }

                if (pInfo.Skip) return true;

                string displayApp = pInfo.AppName;
                if (string.Equals(pInfo.ProcessName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)
                    || string.IsNullOrEmpty(displayApp))
                {
                    displayApp = title;
                }

                results.Add(new Dictionary<string, object>
                {
                    ["windowID"] = hWnd.ToInt64(),
                    ["hwnd"] = hWnd.ToInt64(),
                    ["pid"] = (int)pid,
                    ["app"] = displayApp,
                    ["bundleId"] = pInfo.ProcessName,
                    ["title"] = title,
                    ["onScreen"] = true,
                });

                return true;
            }, IntPtr.Zero);
        }
        catch { }

        return results
            .OrderBy(w => (string)w["app"], StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(w => (string)w["title"], StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    private static IntPtr ResolveTargetWindow(long hwndVal, int pid)
    {
        if (hwndVal != 0)
        {
            var h = new IntPtr(hwndVal);
            if (IsWindow(h) && IsWindowVisible(h)) return h;
        }
        if (pid > 0)
        {
            try
            {
                using var proc = Process.GetProcessById(pid);
                if (proc.MainWindowHandle != IntPtr.Zero && IsWindow(proc.MainWindowHandle))
                    return proc.MainWindowHandle;
            }
            catch { }

            IntPtr found = IntPtr.Zero;
            try
            {
                EnumWindows((hWnd, _) =>
                {
                    if (!IsWindowVisible(hWnd)) return true;
                    if (GetWindowTextLengthW(hWnd) <= 0) return true;
                    GetWindowThreadProcessId(hWnd, out uint wPid);
                    if (wPid == (uint)pid)
                    {
                        found = hWnd;
                        return false;
                    }
                    return true;
                }, IntPtr.Zero);
            }
            catch { }
            if (found != IntPtr.Zero) return found;
        }
        return IntPtr.Zero;
    }

    private static void ActivateExternalWindow(IntPtr targetHwnd)
    {
        if (targetHwnd == IntPtr.Zero || !IsWindow(targetHwnd)) return;

        try
        {
            if (IsIconic(targetHwnd))
            {
                ShowWindow(targetHwnd, SW_RESTORE);
            }
            else
            {
                ShowWindow(targetHwnd, SW_SHOW);
            }

            var fgHwnd = GetForegroundWindow();
            uint fgThread = fgHwnd != IntPtr.Zero ? GetWindowThreadProcessId(fgHwnd, out _) : 0;
            uint curThread = GetCurrentThreadId();
            bool attached = false;
            try
            {
                if (fgThread != 0 && fgThread != curThread)
                {
                    attached = AttachThreadInput(curThread, fgThread, true);
                }
                BringWindowToTop(targetHwnd);
                SetForegroundWindow(targetHwnd);
            }
            finally
            {
                if (attached)
                {
                    AttachThreadInput(curThread, fgThread, false);
                }
            }
        }
        catch { }
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
                {
                    var payload = new Dictionary<string, object>
                    {
                        ["screen"] = true,
                        ["input"] = true,
                        ["windows"] = ListAppWindows(),
                    };
                    EvalScript("window.__appWindows && window.__appWindows(" + JsonSerializer.Serialize(payload) + ")");
                    break;
                }
                case "companionStart":
                    EnterCompanion(root);
                    break;
                case "companionExit":
                    ExitCompanion();
                    break;
                case "companionDrag":
                    StartCompanionDrag();
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

    internal static long Int64(JsonElement obj, string prop)
        => obj.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out var v) ? v : 0;
}
