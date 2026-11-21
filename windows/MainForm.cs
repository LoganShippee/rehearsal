using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
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
    private bool _inCompanionSetup;
    private bool _compSavedCover;
    private FormBorderStyle _compSavedBorder;
    private FormWindowState _compSavedState;
    private Rectangle _compSavedBounds;
    private bool _compSavedTopMost;
    private Size _compSavedMinSize;
    private Size _compSavedMaxSize;

    private readonly System.Windows.Forms.Timer _dragTimer = new() { Interval = 12 };
    private Point _dragCursorStart;
    private Rectangle _dragBoundsStart;
    private int _dragHitMode = HTCAPTION;
    private bool _dragMoving;

    private const int CompMinLogicalW = 220;
    private const int CompMinLogicalH = 64;
    private const int CompMaxLogicalW = 720;
    private const int CompMaxLogicalH = 360;
    private const int CompDefaultLogicalW = 360;
    private const int CompDefaultLogicalH = 118;
    private IntPtr _dockedHwnd = IntPtr.Zero;
    private Rectangle _dockedLogicalRect = Rectangle.Empty;
    private string _dockedAppName = "";
    private string _dockedBundleId = "";
    private const int CompResizeGripLogical = 8;

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

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

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
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeoutW(
        IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam,
        uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")]
    private static extern IntPtr GetClassLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetClassLongW")]
    private static extern uint GetClassLong32(IntPtr hWnd, int nIndex);

    private static IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex)
        => IntPtr.Size == 8 ? GetClassLongPtr64(hWnd, nIndex) : new IntPtr(GetClassLong32(hWnd, nIndex));

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

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
    private const uint PW_RENDERFULLCONTENT = 0x00000002;
    private const uint WM_GETICON = 0x007F;
    private const uint SMTO_ABORTIFHUNG = 0x0002;
    private const int ICON_SMALL = 0;
    private const int ICON_BIG = 1;
    private const int ICON_SMALL2 = 2;
    private const int GCLP_HICON = -14;
    private const int GCLP_HICONSM = -34;
    private const int DWMWA_CLOAKED = 14;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_DEFAULT = 0;
    private const int DWMWCP_ROUND = 2;
    private const int WM_NCHITTEST = 0x0084;
    private const int HTCLIENT = 1;
    private const int HTCAPTION = 2;
    private const int HTLEFT = 10;
    private const int HTRIGHT = 11;
    private const int HTTOP = 12;
    private const int HTTOPLEFT = 13;
    private const int HTTOPRIGHT = 14;
    private const int HTBOTTOM = 15;
    private const int HTBOTTOMLEFT = 16;
    private const int HTBOTTOMRIGHT = 17;

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
        Resize += (_, _) =>
        {
            _webWindows.ReapplyRegion();
            if (_isCompanion && !_inCompanionSetup)
            {
                SaveCompanionLogicalSize();
            }
            else if (!_isCompanion)
            {
                RealignDockedApp(false);
            }
        };
        Move += (_, _) =>
        {
            if (!_isCompanion) RealignDockedApp(false);
        };
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
                "(function(){" +
                "var G=" + CompResizeGripLogical + ";" +
                "function edgeOf(e){" +
                "var x=e.clientX,y=e.clientY,w=window.innerWidth,h=window.innerHeight;" +
                "var l=x<G,r=x>=w-G,t=y<G,b=y>=h-G;" +
                "if(t&&l)return 'nwse-resize';if(b&&r)return 'nwse-resize';" +
                "if(t&&r)return 'nesw-resize';if(b&&l)return 'nesw-resize';" +
                "if(l||r)return 'ew-resize';if(t||b)return 'ns-resize';return '';" +
                "}" +
                "document.addEventListener('pointermove',function(e){" +
                "if(!document.querySelector('.present.companion')){if(document.documentElement.dataset.compCur){document.documentElement.style.cursor='';delete document.documentElement.dataset.compCur;}return;}" +
                "var cur=edgeOf(e);" +
                "if(cur){document.documentElement.style.cursor=cur;document.documentElement.dataset.compCur='1';}" +
                "else if(document.documentElement.dataset.compCur){document.documentElement.style.cursor='';delete document.documentElement.dataset.compCur;}" +
                "},true);" +
                "document.addEventListener('pointerdown',function(e){" +
                "if(e.button!==0)return;" +
                "if(!document.querySelector('.present.companion'))return;" +
                "if(edgeOf(e)){e.preventDefault();window.chrome.webview.postMessage({cmd:'companionResize'});return;}" +
                "if(e.target&&e.target.closest&&e.target.closest('button,a,input,select,textarea,[data-action]'))return;" +
                "window.chrome.webview.postMessage({cmd:'companionDrag'});" +
                "},true);" +
                "})();");

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

    private int HitTestCompanionGrip(Point clientPt)
    {
        int grip = Math.Max(6, (int)Math.Round(CompResizeGripLogical * (DeviceDpi / 96f)));
        bool left = clientPt.X < grip;
        bool right = clientPt.X >= ClientSize.Width - grip;
        bool top = clientPt.Y < grip;
        bool bottom = clientPt.Y >= ClientSize.Height - grip;

        if (top && left) return HTTOPLEFT;
        if (top && right) return HTTOPRIGHT;
        if (bottom && left) return HTBOTTOMLEFT;
        if (bottom && right) return HTBOTTOMRIGHT;
        if (left) return HTLEFT;
        if (right) return HTRIGHT;
        if (top) return HTTOP;
        if (bottom) return HTBOTTOM;
        return HTCAPTION;
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (_isCompanion && m.Msg == WM_NCHITTEST && (int)m.Result == HTCLIENT)
        {
            long lparam = m.LParam.ToInt64();
            int screenX = (short)(lparam & 0xFFFF);
            int screenY = (short)((lparam >> 16) & 0xFFFF);
            var clientPt = PointToClient(new Point(screenX, screenY));
            m.Result = (IntPtr)HitTestCompanionGrip(clientPt);
        }
    }

    public void EvalScript(string js)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(() => EvalScript(js)); } catch { }
            return;
        }
        if (_webView.IsDisposed || _webView.CoreWebView2 == null) return;
        _ = _webView.CoreWebView2.ExecuteScriptAsync(js);
    }

    public void ReloadWebView()
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(ReloadWebView); } catch { }
            return;
        }
        if (_webView.IsDisposed || _webView.CoreWebView2 == null) return;
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

    private static string CompanionConfigPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Rehearsal", "companion-hud.json");

    private static (int Width, int Height) LoadCompanionLogicalSize()
    {
        try
        {
            var path = CompanionConfigPath;
            if (!File.Exists(path)) return (CompDefaultLogicalW, CompDefaultLogicalH);
            using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
            var root = doc.RootElement;
            int w = root.TryGetProperty("width", out var wEl) && wEl.ValueKind == JsonValueKind.Number
                ? wEl.GetInt32() : CompDefaultLogicalW;
            int h = root.TryGetProperty("height", out var hEl) && hEl.ValueKind == JsonValueKind.Number
                ? hEl.GetInt32() : CompDefaultLogicalH;
            return (Math.Clamp(w, CompMinLogicalW, CompMaxLogicalW), Math.Clamp(h, CompMinLogicalH, CompMaxLogicalH));
        }
        catch
        {
            return (CompDefaultLogicalW, CompDefaultLogicalH);
        }
    }

    private void SaveCompanionLogicalSize()
    {
        if (!_isCompanion || _inCompanionSetup) return;
        try
        {
            float scale = DeviceDpi / 96f;
            if (scale <= 0) scale = 1f;
            int w = Math.Clamp((int)Math.Round(Width / scale), CompMinLogicalW, CompMaxLogicalW);
            int h = Math.Clamp((int)Math.Round(Height / scale), CompMinLogicalH, CompMaxLogicalH);
            var path = CompanionConfigPath;
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(new Dictionary<string, int> { ["width"] = w, ["height"] = h });
            File.WriteAllText(path, json);
        }
        catch { }
    }

    private void EnterCompanion(JsonElement root)
    {
        var screen = Screen.FromControl(this);
        bool wasCompanion = _isCompanion;
        _inCompanionSetup = true;
        try
        {
            if (!_isCompanion)
            {
                _compSavedCover = _isCovering;
                _compSavedTopMost = TopMost;
                _compSavedMinSize = MinimumSize;
                _compSavedMaxSize = MaximumSize;
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
            var (logicalW, logicalH) = LoadCompanionLogicalSize();
            int minW = (int)Math.Round(CompMinLogicalW * scale);
            int minH = (int)Math.Round(CompMinLogicalH * scale);
            int maxW = (int)Math.Round(CompMaxLogicalW * scale);
            int maxH = (int)Math.Round(CompMaxLogicalH * scale);
            int hudW = Math.Clamp((int)Math.Round(logicalW * scale), minW, maxW);
            int hudH = Math.Clamp((int)Math.Round(logicalH * scale), minH, maxH);
            int margin = (int)Math.Round(16 * scale);

            var workArea = screen.WorkingArea;
            int x = wasCompanion ? Left : workArea.Right - hudW - margin;
            int y = wasCompanion ? Top : workArea.Bottom - hudH - margin;

            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            MinimumSize = new Size(minW, minH);
            MaximumSize = new Size(maxW, maxH);
            if (!wasCompanion)
            {
                Bounds = new Rectangle(x, y, hudW, hudH);
            }
            TopMost = true;
            SetCornerPreference(DWMWCP_ROUND);
        }
        finally
        {
            _inCompanionSetup = false;
        }

        EvalScript("document.documentElement.style.setProperty('--safe-top', '0px')");
        EvalScript("window.__companionState && window.__companionState(true)");
        UndockExternalApp(false);

        long hwndVal = Int64(root, "hwnd");
        int pid = (int)Int64(root, "pid");
        var bundleId = Str(root, "bundleId");
        var appName = Str(root, "app");
        var targetHwnd = ResolveTargetWindow(hwndVal, pid, bundleId, appName);
        if (targetHwnd != IntPtr.Zero)
        {
            ActivateExternalWindow(targetHwnd);
        }
    }

    private void ExitCompanion()
    {
        _dragTimer.Stop();
        _dragMoving = false;
        _dragHitMode = HTCAPTION;

        if (!_isCompanion)
        {
            EvalScript("window.__companionState && window.__companionState(false)");
            Activate();
            return;
        }

        _inCompanionSetup = true;
        try
        {
            _isCompanion = false;
            SetCornerPreference(DWMWCP_DEFAULT);
            MaximumSize = _compSavedMaxSize;
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
        }
        finally
        {
            _inCompanionSetup = false;
        }

        EvalScript("document.documentElement.style.setProperty('--safe-top', '0px')");
        EvalScript("window.__companionState && window.__companionState(false)");
        Activate();
        if (Handle != IntPtr.Zero)
        {
            try { SetForegroundWindow(Handle); } catch { }
        }
    }

    private void DockExternalApp(JsonElement root)
    {
        long hwndVal = Int64(root, "hwnd");
        int pid = (int)Int64(root, "pid");
        var bundleId = Str(root, "bundleId") ?? "";
        var appName = Str(root, "app") ?? "";
        bool activate = !root.TryGetProperty("activate", out var actEl) || actEl.ValueKind != JsonValueKind.False;

        if (!root.TryGetProperty("rect", out var rectEl) || rectEl.ValueKind != JsonValueKind.Array || rectEl.GetArrayLength() != 4)
            return;

        int lx = (int)Math.Round(rectEl[0].GetDouble());
        int ly = (int)Math.Round(rectEl[1].GetDouble());
        int lw = (int)Math.Round(rectEl[2].GetDouble());
        int lh = (int)Math.Round(rectEl[3].GetDouble());
        if (lw < 80 || lh < 60) return;

        var targetHwnd = ResolveTargetWindow(hwndVal, pid, bundleId, appName);
        if (targetHwnd == IntPtr.Zero || !IsWindow(targetHwnd))
        {
            _dockedHwnd = IntPtr.Zero;
            var notRunning = JsonSerializer.Serialize(new Dictionary<string, object>
            {
                ["status"] = "not-running",
                ["app"] = appName,
                ["bundleId"] = bundleId,
            });
            EvalScript("window.__dockAppState && window.__dockAppState(" + notRunning + ")");
            return;
        }

        _dockedHwnd = targetHwnd;
        _dockedLogicalRect = new Rectangle(lx, ly, lw, lh);
        _dockedAppName = appName;
        _dockedBundleId = bundleId;

        RealignDockedApp(activate);

        var dockedPayload = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["status"] = "docked",
            ["app"] = appName,
            ["bundleId"] = bundleId,
            ["hwnd"] = targetHwnd.ToInt64(),
        });
        EvalScript("window.__dockAppState && window.__dockAppState(" + dockedPayload + ")");
    }

    private void RealignDockedApp(bool activate)
    {
        if (_dockedHwnd == IntPtr.Zero || !IsWindow(_dockedHwnd) || _dockedLogicalRect.Width < 80 || _dockedLogicalRect.Height < 60)
            return;
        try
        {
            float scale = DeviceDpi / 96f;
            var clientPt = new Point((int)Math.Round(_dockedLogicalRect.X * scale), (int)Math.Round(_dockedLogicalRect.Y * scale));
            var screenPt = _webView.PointToScreen(clientPt);
            int w = Math.Max(120, (int)Math.Round(_dockedLogicalRect.Width * scale));
            int h = Math.Max(100, (int)Math.Round(_dockedLogicalRect.Height * scale));

            ShowWindow(_dockedHwnd, SW_RESTORE);
            uint flags = SWP_SHOWWINDOW | (activate ? 0u : SWP_NOACTIVATE);
            SetWindowPos(_dockedHwnd, HWND_TOP, screenPt.X, screenPt.Y, w, h, flags);
            if (activate)
            {
                ActivateExternalWindow(_dockedHwnd);
            }
        }
        catch { }
    }

    private void UndockExternalApp(bool bringFront)
    {
        bool wasDocked = _dockedHwnd != IntPtr.Zero;
        _dockedHwnd = IntPtr.Zero;
        _dockedLogicalRect = Rectangle.Empty;
        if (wasDocked && bringFront)
        {
            Activate();
            if (Handle != IntPtr.Zero)
            {
                try { SetForegroundWindow(Handle); } catch { }
            }
        }
    }

    private async Task CaptureBugReportAsync()
    {
        string dataUrl = "";
        try
        {
            if (!_webView.IsDisposed && _webView.CoreWebView2 != null)
            {
                using var ms = new MemoryStream();
                await _webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Jpeg, ms);
                dataUrl = "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
            }
        }
        catch { }
        var payload = new Dictionary<string, object>
        {
            ["screenshot"] = dataUrl,
            ["os"] = Environment.OSVersion.VersionString,
            ["version"] = Application.ProductVersion ?? "",
            ["logTail"] = "",
        };
        EvalScript("window.__bugReportOpen && window.__bugReportOpen(" + JsonSerializer.Serialize(payload) + ")");
    }

    private void StartCompanionDrag()
    {
        if (!_isCompanion) return;
        var cursor = Cursor.Position;
        if (HitTestCompanionGrip(PointToClient(cursor)) != HTCAPTION) return;
        _dragHitMode = HTCAPTION;
        _dragCursorStart = cursor;
        _dragBoundsStart = Bounds;
        _dragMoving = false;
        _dragTimer.Start();
    }

    private void StartCompanionResize()
    {
        if (!_isCompanion) return;
        var cursor = Cursor.Position;
        int hit = HitTestCompanionGrip(PointToClient(cursor));
        if (hit == HTCAPTION) return;
        _dragHitMode = hit;
        _dragCursorStart = cursor;
        _dragBoundsStart = Bounds;
        _dragMoving = true;
        _dragTimer.Start();
    }

    private void OnDragTimerTick(object? sender, EventArgs e)
    {
        if (!_isCompanion || (MouseButtons & MouseButtons.Left) == 0)
        {
            bool wasResizing = _dragHitMode != HTCAPTION;
            _dragTimer.Stop();
            _dragMoving = false;
            _dragHitMode = HTCAPTION;
            if (wasResizing) SaveCompanionLogicalSize();
            return;
        }

        var cur = Cursor.Position;
        int dx = cur.X - _dragCursorStart.X;
        int dy = cur.Y - _dragCursorStart.Y;

        if (_dragHitMode == HTCAPTION)
        {
            if (!_dragMoving && (dx * dx + dy * dy) > 9)
            {
                _dragMoving = true;
            }
            if (_dragMoving)
            {
                Location = new Point(_dragBoundsStart.X + dx, _dragBoundsStart.Y + dy);
            }
            return;
        }

        int minW = MinimumSize.Width > 0 ? MinimumSize.Width : 220;
        int maxW = MaximumSize.Width > 0 ? MaximumSize.Width : 720;
        int minH = MinimumSize.Height > 0 ? MinimumSize.Height : 64;
        int maxH = MaximumSize.Height > 0 ? MaximumSize.Height : 220;

        var b = _dragBoundsStart;
        int newLeft = b.Left;
        int newTop = b.Top;
        int newW = b.Width;
        int newH = b.Height;

        if (_dragHitMode is HTRIGHT or HTTOPRIGHT or HTBOTTOMRIGHT)
        {
            newW = Math.Clamp(b.Width + dx, minW, maxW);
        }
        else if (_dragHitMode is HTLEFT or HTTOPLEFT or HTBOTTOMLEFT)
        {
            newW = Math.Clamp(b.Width - dx, minW, maxW);
            newLeft = b.Right - newW;
        }

        if (_dragHitMode is HTBOTTOM or HTBOTTOMLEFT or HTBOTTOMRIGHT)
        {
            newH = Math.Clamp(b.Height + dy, minH, maxH);
        }
        else if (_dragHitMode is HTTOP or HTTOPLEFT or HTTOPRIGHT)
        {
            newH = Math.Clamp(b.Height - dy, minH, maxH);
            newTop = b.Bottom - newH;
        }

        var next = new Rectangle(newLeft, newTop, newW, newH);
        if (Bounds != next)
        {
            Bounds = next;
        }
    }

    private void SetCornerPreference(int pref)
    {
        if (Handle == IntPtr.Zero) return;
        try { _ = DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int)); }
        catch { }
    }

    private static string? IconToPngDataUrl(Icon ico)
    {
        try
        {
            using var bmp = new Bitmap(48, 48, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.DrawIcon(ico, new Rectangle(0, 0, 48, 48));
            }
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        }
        catch
        {
            return null;
        }
    }

    private static string? ExtractWindowIconDataUrl(IntPtr hWnd, string? exePath)
    {
        if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
        {
            try
            {
                using var ico = Icon.ExtractAssociatedIcon(exePath);
                if (ico != null)
                {
                    var url = IconToPngDataUrl(ico);
                    if (url != null) return url;
                }
            }
            catch { }
        }

        if (hWnd == IntPtr.Zero) return null;

        try
        {
            IntPtr hIcon = IntPtr.Zero;
            if (SendMessageTimeoutW(hWnd, WM_GETICON, (IntPtr)ICON_BIG, IntPtr.Zero, SMTO_ABORTIFHUNG, 80, out var res) != IntPtr.Zero && res != IntPtr.Zero)
                hIcon = res;
            else if (SendMessageTimeoutW(hWnd, WM_GETICON, (IntPtr)ICON_SMALL2, IntPtr.Zero, SMTO_ABORTIFHUNG, 80, out res) != IntPtr.Zero && res != IntPtr.Zero)
                hIcon = res;
            else if (SendMessageTimeoutW(hWnd, WM_GETICON, (IntPtr)ICON_SMALL, IntPtr.Zero, SMTO_ABORTIFHUNG, 80, out res) != IntPtr.Zero && res != IntPtr.Zero)
                hIcon = res;
            else
            {
                hIcon = GetClassLongPtr(hWnd, GCLP_HICON);
                if (hIcon == IntPtr.Zero) hIcon = GetClassLongPtr(hWnd, GCLP_HICONSM);
            }

            if (hIcon != IntPtr.Zero)
            {
                using var ico = Icon.FromHandle(hIcon);
                return IconToPngDataUrl(ico);
            }
        }
        catch { }

        return null;
    }

    private static string? CaptureWindowPreviewDataUrl(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero || IsIconic(hWnd)) return null;
        try
        {
            if (!GetWindowRect(hWnd, out var rc)) return null;
            int srcW = rc.Right - rc.Left;
            int srcH = rc.Bottom - rc.Top;
            if (srcW < 80 || srcH < 60 || srcW > 16384 || srcH > 16384) return null;

            using var fullBmp = new Bitmap(srcW, srcH, PixelFormat.Format32bppRgb);
            bool ok = false;
            using (var gFull = Graphics.FromImage(fullBmp))
            {
                IntPtr hdc = gFull.GetHdc();
                try
                {
                    ok = PrintWindow(hWnd, hdc, PW_RENDERFULLCONTENT);
                    if (!ok) ok = PrintWindow(hWnd, hdc, 0);
                }
                finally
                {
                    gFull.ReleaseHdc(hdc);
                }
            }
            if (!ok) return null;

            const int maxThumbW = 240;
            const int maxThumbH = 150;
            double ratio = Math.Min((double)maxThumbW / srcW, (double)maxThumbH / srcH);
            if (ratio > 1.0) ratio = 1.0;
            int dstW = Math.Max(1, (int)Math.Round(srcW * ratio));
            int dstH = Math.Max(1, (int)Math.Round(srcH * ratio));

            using var thumbBmp = new Bitmap(dstW, dstH, PixelFormat.Format24bppRgb);
            using (var gThumb = Graphics.FromImage(thumbBmp))
            {
                gThumb.InterpolationMode = InterpolationMode.HighQualityBilinear;
                gThumb.SmoothingMode = SmoothingMode.HighQuality;
                gThumb.PixelOffsetMode = PixelOffsetMode.HighQuality;
                gThumb.DrawImage(fullBmp, new Rectangle(0, 0, dstW, dstH), new Rectangle(0, 0, srcW, srcH), GraphicsUnit.Pixel);
            }

            using var ms = new MemoryStream();
            thumbBmp.Save(ms, ImageFormat.Jpeg);
            return "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
        }
        catch
        {
            return null;
        }
    }

    private static List<Dictionary<string, object?>> ListAppWindows()
    {
        var results = new List<Dictionary<string, object?>>();
        uint myPid = (uint)Environment.ProcessId;
        var procCache = new Dictionary<uint, (string AppName, string ProcessName, string? ExePath, string? CachedIcon, bool Skip)>();

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
                    string? exePath = null;
                    string? cachedIcon = null;
                    bool skip = false;
                    try
                    {
                        using var proc = Process.GetProcessById((int)pid);
                        procName = proc.ProcessName ?? "";
                        if (string.IsNullOrEmpty(procName) || SkipProcessNames.Contains(procName))
                        {
                            skip = true;
                        }
                        else
                        {
                            try
                            {
                                var mod = proc.MainModule;
                                exePath = mod?.FileName;
                                var desc = mod?.FileVersionInfo?.FileDescription?.Trim();
                                if (!string.IsNullOrEmpty(desc)) appName = desc;
                            }
                            catch { }

                            if (string.Equals(procName, "explorer", StringComparison.OrdinalIgnoreCase))
                            {
                                appName = "File Explorer";
                            }
                            else if (string.IsNullOrEmpty(appName))
                            {
                                appName = procName;
                            }

                            if (!string.IsNullOrEmpty(exePath)
                                && !string.Equals(procName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase))
                            {
                                cachedIcon = ExtractWindowIconDataUrl(IntPtr.Zero, exePath);
                            }
                        }
                    }
                    catch
                    {
                        skip = true;
                    }
                    pInfo = (appName, procName, exePath, cachedIcon, skip);
                    procCache[pid] = pInfo;
                }

                if (pInfo.Skip) return true;

                string displayApp = pInfo.AppName;
                if (string.Equals(pInfo.ProcessName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)
                    || string.IsNullOrEmpty(displayApp))
                {
                    displayApp = title;
                }

                string? appIcon = pInfo.CachedIcon ?? ExtractWindowIconDataUrl(hWnd, pInfo.ExePath);
                string? preview = CaptureWindowPreviewDataUrl(hWnd);
                bool onScreen = !IsIconic(hWnd);

                results.Add(new Dictionary<string, object?>
                {
                    ["windowID"] = hWnd.ToInt64(),
                    ["hwnd"] = hWnd.ToInt64(),
                    ["pid"] = (int)pid,
                    ["app"] = displayApp,
                    ["bundleId"] = pInfo.ProcessName,
                    ["title"] = title,
                    ["onScreen"] = onScreen,
                    ["appIcon"] = appIcon,
                    ["preview"] = preview,
                });

                return true;
            }, IntPtr.Zero);
        }
        catch { }

        return results
            .OrderByDescending(w => (bool)(w["onScreen"] ?? false))
            .ThenBy(w => (string)(w["app"] ?? ""), StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(w => (string)(w["title"] ?? ""), StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    private static IntPtr ResolveTargetWindow(long hwndVal, int pid, string? bundleId, string? appName)
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

        if (!string.IsNullOrEmpty(bundleId) || !string.IsNullOrEmpty(appName))
        {
            uint myPid = (uint)Environment.ProcessId;
            IntPtr found = IntPtr.Zero;
            try
            {
                EnumWindows((hWnd, _) =>
                {
                    if (!IsWindowVisible(hWnd)) return true;
                    int len = GetWindowTextLengthW(hWnd);
                    if (len <= 0) return true;
                    GetWindowThreadProcessId(hWnd, out uint wPid);
                    if (wPid == 0 || wPid == myPid) return true;

                    try
                    {
                        using var proc = Process.GetProcessById((int)wPid);
                        if (!string.IsNullOrEmpty(bundleId)
                            && string.Equals(proc.ProcessName, bundleId, StringComparison.OrdinalIgnoreCase))
                        {
                            found = hWnd;
                            return false;
                        }
                    }
                    catch { }

                    if (!string.IsNullOrEmpty(appName))
                    {
                        var sb = new StringBuilder(len + 1);
                        if (GetWindowTextW(hWnd, sb, sb.Capacity) > 0
                            && sb.ToString().Contains(appName, StringComparison.OrdinalIgnoreCase))
                        {
                            found = hWnd;
                            return false;
                        }
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
                    _ = Task.Run(() =>
                    {
                        var payload = new Dictionary<string, object>
                        {
                            ["screen"] = true,
                            ["input"] = true,
                            ["windows"] = ListAppWindows(),
                        };
                        var json = JsonSerializer.Serialize(payload);
                        EvalScript("window.__appWindows && window.__appWindows(" + json + ")");
                    });
                    break;
                }
                case "companionStart":
                    EnterCompanion(root);
                    break;
                case "companionExit":
                    ExitCompanion();
                    break;
                case "dockApp":
                    DockExternalApp(root);
                    break;
                case "undockApp":
                    UndockExternalApp(Bool(root, "bringFront"));
                    break;
                case "companionDrag":
                    StartCompanionDrag();
                    break;
                case "companionResize":
                    StartCompanionResize();
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
                case "captureBugReport":
                {
                    _ = CaptureBugReportAsync();
                    break;
                }
                case "copyImage":
                {
                    var dataUrl = Str(root, "dataUrl") ?? "";
                    int comma = dataUrl.IndexOf(',');
                    if (comma > 0)
                    {
                        try
                        {
                            var bytes = Convert.FromBase64String(dataUrl[(comma + 1)..]);
                            using var ms = new MemoryStream(bytes);
                            using var img = Image.FromStream(ms);
                            Clipboard.SetImage((Image)img.Clone());
                        }
                        catch { }
                    }
                    break;
                }
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
