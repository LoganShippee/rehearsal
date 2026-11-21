using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Rehearsal;

internal static class Program
{
    public static LocalServer Server { get; private set; } = null!;
    public static int Port { get; private set; }
    public static string BundledWebRoot { get; private set; } = "";
    public static List<MainForm> Windows { get; } = new();
    public static DriveForm Drive { get; private set; } = null!;

    private static Task<CoreWebView2Environment>? _webEnvTask;
    private static System.Threading.Timer? _updateTimer;
    private static Control? _uiSync;

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        BundledWebRoot = ResolveBundledWebRoot();
        var updater = Updater.Shared;
        var activeWeb = updater.ActiveWebRoot(BundledWebRoot);

        Server = new LocalServer(activeWeb, updater.SupportDir);
        Port = Server.Start(47821);

        if (Environment.GetEnvironmentVariable("REHEARSAL_PRINT_URL") != null)
        {
            Console.WriteLine($"http://127.0.0.1:{Port}/index.html?t={Server.Token}");
        }

        Drive = new DriveForm();

        var first = OpenWindow("", "Rehearsal");
        _uiSync = first;

        Server.OnSave = client => RunOnUi(() => BroadcastExternalUpdate(client));
        updater.OnState = st => RunOnUi(() => SendUpdateState(st));

        // Check for updates 8 seconds after opening, then every 4 hours.
        _updateTimer = new System.Threading.Timer(
            _ => updater.Check(manual: false),
            null,
            TimeSpan.FromSeconds(8),
            TimeSpan.FromHours(4));

        Application.Run();
        _updateTimer?.Dispose();
        Server.Stop();
    }

    public static Task<CoreWebView2Environment> GetWebEnvAsync()
    {
        if (_webEnvTask != null) return _webEnvTask;
        var webViewDataDir = Path.Combine(Updater.Shared.SupportDir, "WebView2");
        Directory.CreateDirectory(webViewDataDir);
        _webEnvTask = CoreWebView2Environment.CreateAsync(userDataFolder: webViewDataDir);
        return _webEnvTask;
    }

    private static string ResolveBundledWebRoot()
    {
        var besideExe = Path.Combine(AppContext.BaseDirectory, "web");
        if (File.Exists(Path.Combine(besideExe, "index.html"))) return besideExe;

        // Fallback when running from source (windows/bin/Debug/...)
        var repoWeb = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "web"));
        if (File.Exists(Path.Combine(repoWeb, "index.html"))) return repoWeb;

        return besideExe;
    }

    public static void RunOnUi(Action action)
    {
        var sync = _uiSync ?? Windows.FirstOrDefault();
        if (sync == null || sync.IsDisposed) return;
        if (sync.InvokeRequired)
        {
            try { sync.BeginInvoke(action); } catch { }
        }
        else
        {
            action();
        }
    }

    public static MainForm OpenWindow(string view, string title)
    {
        var cascadeFrom = Windows.LastOrDefault();
        var form = new MainForm(view, title, cascadeFrom);
        Windows.Add(form);
        form.FormClosed += (_, _) =>
        {
            Windows.Remove(form);
            if (Windows.Count == 0)
            {
                Application.ExitThread();
            }
        };
        form.Show();
        form.Activate();
        return form;
    }

    public static void SendUpdateState(Dictionary<string, object?> state)
    {
        var json = JsonSerializer.Serialize(state);
        foreach (var w in Windows.ToList())
        {
            w.EvalScript($"window.__updateState && window.__updateState({json})");
        }
    }

    public static void ApplyWebUpdate()
    {
        Server.WebRoot = Updater.Shared.ActiveWebRoot(BundledWebRoot);
        foreach (var w in Windows.ToList())
        {
            w.ReloadWebView();
        }
    }

    private static void BroadcastExternalUpdate(string client)
    {
        var safe = new string((client ?? "").Where(char.IsLetterOrDigit).ToArray());
        foreach (var w in Windows.ToList())
        {
            w.EvalScript($"window.__externalUpdate && window.__externalUpdate('{safe}')");
        }
    }
}
