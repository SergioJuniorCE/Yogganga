using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal enum StackState
{
    Unknown,
    EngineDown,
    Missing,
    Stopped,
    Pending,
    Running
}

internal sealed class ProbeResult
{
    public StackState State;
    public string Detail;

    public ProbeResult(StackState state, string detail)
    {
        State = state;
        Detail = detail;
    }
}

internal sealed class CommandResult
{
    public int ExitCode;
    public bool TimedOut;
    public string StdOut = "";
    public string StdErr = "";
}

internal sealed class Config
{
    public string Engine = "";
    public string EngineExe = "";
    public string EngineStart = "";
    public string Url = "http://localhost:8787";
    public string DataDir = "";
    public string RepoRoot = "";

    public static Config Load()
    {
        Config config = new Config();
        string directory = Path.GetDirectoryName(Application.ExecutablePath);
        if (directory == null) return config;

        string path = Path.Combine(directory, "tray.ini");
        if (!File.Exists(path)) return config;

        foreach (string line in File.ReadAllLines(path))
        {
            string trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith("#") || trimmed.StartsWith(";")) continue;

            int separator = trimmed.IndexOf('=');
            if (separator <= 0) continue;

            string key = trimmed.Substring(0, separator).Trim();
            string value = trimmed.Substring(separator + 1).Trim();
            if (key.Equals("engine", StringComparison.OrdinalIgnoreCase)) config.Engine = value;
            else if (key.Equals("engineExe", StringComparison.OrdinalIgnoreCase)) config.EngineExe = value;
            else if (key.Equals("engineStart", StringComparison.OrdinalIgnoreCase)) config.EngineStart = value;
            else if (key.Equals("url", StringComparison.OrdinalIgnoreCase)) config.Url = value;
            else if (key.Equals("data", StringComparison.OrdinalIgnoreCase)) config.DataDir = value;
            else if (key.Equals("repo", StringComparison.OrdinalIgnoreCase)) config.RepoRoot = value;
        }

        return config;
    }
}

internal static class Engine
{
    public const string ContainerName = "yogganga";

    public static string Name = "docker";
    public static string Label = "Docker";
    public static string ExePath = "";
    public static string StartPath = "";
    public static bool Found;

    public static void Configure(Config config)
    {
        string requested = (config.Engine ?? "").Trim().ToLowerInvariant();
        if (requested != "docker" && requested != "podman") requested = "";

        string selected = requested;
        string path = null;

        if (selected.Length > 0)
        {
            path = ValidPath(config.EngineExe);
            if (path == null) path = FindOnPath(selected);
        }
        if (path == null)
        {
            path = FindOnPath("docker");
            if (path != null) selected = "docker";
        }
        if (path == null)
        {
            path = FindOnPath("podman");
            if (path != null) selected = "podman";
        }

        if (selected.Length == 0) selected = "docker";
        Name = selected;
        Label = selected == "podman" ? "Podman" : "Docker";
        Found = path != null;
        ExePath = path ?? "";
        StartPath = config.EngineStart ?? "";
    }

    public static ProbeResult Probe()
    {
        if (!Found) return new ProbeResult(StackState.EngineDown, Label + " is not installed");

        CommandResult info = Exec("info", 5000);
        if (info.TimedOut || info.ExitCode != 0)
            return new ProbeResult(StackState.EngineDown, Label + " is not running");

        CommandResult inspect = Exec("inspect -f {{.State.Status}} " + ContainerName, 5000);
        if (inspect.ExitCode != 0)
        {
            string error = (inspect.StdOut + "\n" + inspect.StdErr).ToLowerInvariant();
            if (error.IndexOf("no such") >= 0 ||
                error.IndexOf("not found") >= 0 ||
                error.IndexOf("no container") >= 0 ||
                error.IndexOf("does not exist") >= 0)
            {
                return new ProbeResult(StackState.Missing, "Container not installed");
            }
            return new ProbeResult(StackState.EngineDown, Label + " returned an error");
        }

        string status = inspect.StdOut.Trim().ToLowerInvariant();
        if (status == "running") return new ProbeResult(StackState.Running, "Running");
        if (status == "restarting" || status == "paused" || status == "removing")
            return new ProbeResult(StackState.Pending, "Restarting");
        if (status == "created" || status == "exited" || status == "dead" || status == "stopped")
            return new ProbeResult(StackState.Stopped, "Stopped");
        return new ProbeResult(StackState.Pending, status.Length == 0 ? "Unknown" : status);
    }

    public static bool StartDaemon()
    {
        if (!Found) return false;

        try
        {
            if (Name == "docker")
            {
                string desktop = FindDockerDesktop();
                if (desktop == null) return false;
                ProcessStartInfo start = new ProcessStartInfo(desktop);
                start.UseShellExecute = true;
                Process.Start(start);
            }
            else
            {
                CommandResult result = Exec("machine start", 180000);
                if (result.TimedOut) return false;
            }
        }
        catch (Exception)
        {
            return false;
        }

        for (int attempt = 0; attempt < 90; attempt++)
        {
            CommandResult info = Exec("info", 5000);
            if (!info.TimedOut && info.ExitCode == 0) return true;
            Thread.Sleep(2000);
        }
        return false;
    }

    public static CommandResult StartContainer()
    {
        return Exec("start " + ContainerName, 120000);
    }

    public static CommandResult StopContainer()
    {
        return Exec("stop --time 20 " + ContainerName, 60000);
    }

    public static CommandResult RestartContainer()
    {
        return Exec("restart --time 20 " + ContainerName, 90000);
    }

    public static CommandResult Logs()
    {
        return Exec("logs --tail 200 " + ContainerName, 20000);
    }

    public static CommandResult Exec(string arguments, int timeoutMs)
    {
        CommandResult result = new CommandResult();
        if (!Found)
        {
            result.ExitCode = -1;
            result.StdErr = Label + " is not installed";
            return result;
        }

        Process process = null;
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(ExePath, arguments);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;

            process = new Process();
            process.StartInfo = start;

            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) stdout.AppendLine(e.Data);
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) stderr.AppendLine(e.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            if (!process.WaitForExit(timeoutMs))
            {
                result.TimedOut = true;
                result.ExitCode = -1;
                try { process.Kill(); } catch (Exception) { }
            }
            else
            {
                process.WaitForExit();
                result.ExitCode = process.ExitCode;
            }

            result.StdOut = stdout.ToString();
            result.StdErr = stderr.ToString();
        }
        catch (Exception ex)
        {
            result.ExitCode = -1;
            result.StdErr = ex.Message;
        }
        finally
        {
            if (process != null) process.Dispose();
        }

        return result;
    }

    private static string ValidPath(string path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        path = path.Trim();
        return File.Exists(path) ? path : null;
    }

    private static string FindOnPath(string name)
    {
        string executable = name + ".exe";
        string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
        string[] directories = pathValue.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
        foreach (string directory in directories)
        {
            try
            {
                string candidate = Path.Combine(directory.Trim(), executable);
                if (File.Exists(candidate)) return candidate;
            }
            catch (Exception) { }
        }

        string[] known = KnownPaths(name);
        foreach (string candidate in known)
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static string[] KnownPaths(string name)
    {
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        if (name == "docker")
        {
            return new string[]
            {
                Path.Combine(programFiles, @"Docker\Docker\resources\bin\docker.exe"),
                Path.Combine(localAppData, @"Docker\Docker\resources\bin\docker.exe"),
                Path.Combine(localAppData, @"Programs\Docker\Docker\resources\bin\docker.exe")
            };
        }

        return new string[]
        {
            Path.Combine(localAppData, @"Programs\Podman\podman.exe"),
            Path.Combine(programFiles, @"RedHat\Podman\podman.exe")
        };
    }

    private static string FindDockerDesktop()
    {
        if (!string.IsNullOrEmpty(StartPath) && File.Exists(StartPath)) return StartPath;

        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates = new string[]
        {
            Path.Combine(programFiles, @"Docker\Docker\Docker Desktop.exe"),
            Path.Combine(localAppData, @"Docker\Docker\Docker Desktop.exe"),
            Path.Combine(localAppData, @"Programs\Docker\Docker\Docker Desktop.exe")
        };

        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}

internal static class Program
{
    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--status")
        {
            AttachConsole(-1);
            Config config = Config.Load();
            Engine.Configure(config);
            ProbeResult result = Engine.Probe();
            string report =
                "engine: " + Engine.Label + Environment.NewLine +
                "state: " + result.State.ToString() + Environment.NewLine +
                "detail: " + result.Detail + Environment.NewLine;

            // A GUI-subsystem executable cannot always write to the parent's
            // console, so scripts can pass a file path as the second argument.
            if (args.Length > 1) File.WriteAllText(args[1], report);
            else Console.Write(report);

            Environment.ExitCode = result.State == StackState.Running ? 0 : 1;
            return;
        }

        bool created;
        using (Mutex mutex = new Mutex(true, @"Local\YoggangaTray", out created))
        {
            if (!created) return;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (TrayContext context = new TrayContext())
            {
                Application.Run(context);
            }
        }
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private const int StatusIntervalMs = 3000;

    private static readonly Dictionary<Color, Icon> IconCache = new Dictionary<Color, Icon>();
    private static readonly List<IntPtr> IconHandles = new List<IntPtr>();

    private readonly Config config;
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu;
    private readonly Form marshal;
    private readonly System.Windows.Forms.Timer timer;
    private readonly ToolStripMenuItem statusItem;
    private readonly ToolStripMenuItem startItem;
    private readonly ToolStripMenuItem stopItem;
    private readonly ToolStripMenuItem restartItem;
    private readonly ToolStripMenuItem startEngineItem;
    private readonly ToolStripMenuItem openItem;
    private readonly ToolStripMenuItem copyItem;
    private readonly ToolStripMenuItem dataItem;
    private readonly ToolStripMenuItem logsItem;

    private bool busy;
    private bool startupChecked;
    private bool disposed;

    public TrayContext()
    {
        config = Config.Load();
        Engine.Configure(config);

        statusItem = new ToolStripMenuItem("Yogganga: checking");
        statusItem.Enabled = false;
        statusItem.Font = new Font(statusItem.Font, FontStyle.Bold);

        startItem = new ToolStripMenuItem("Start");
        startItem.Click += delegate { StartContainer(); };

        stopItem = new ToolStripMenuItem("Stop");
        stopItem.Click += delegate { StopContainer(); };

        restartItem = new ToolStripMenuItem("Restart");
        restartItem.Click += delegate { RestartContainer(); };

        startEngineItem = new ToolStripMenuItem("Start " + Engine.Label);
        startEngineItem.Click += delegate { StartDaemon(); };

        openItem = new ToolStripMenuItem("Open server");
        openItem.Click += delegate { OpenUrl(); };

        copyItem = new ToolStripMenuItem("Copy server URL");
        copyItem.Click += delegate { CopyUrl(); };

        dataItem = new ToolStripMenuItem("Open data folder");
        dataItem.Click += delegate { OpenData(); };

        logsItem = new ToolStripMenuItem("Show recent logs");
        logsItem.Click += delegate { ShowLogs(); };

        ToolStripMenuItem exitItem = new ToolStripMenuItem("Exit");
        exitItem.Click += delegate { ExitTray(); };

        menu = new ContextMenuStrip();
        menu.Items.Add(statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(startItem);
        menu.Items.Add(stopItem);
        menu.Items.Add(restartItem);
        menu.Items.Add(startEngineItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(openItem);
        menu.Items.Add(copyItem);
        menu.Items.Add(dataItem);
        menu.Items.Add(logsItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exitItem);

        tray = new NotifyIcon();
        tray.Icon = GetIcon(Color.Gray);
        tray.Text = "Yogganga: checking";
        tray.ContextMenuStrip = menu;
        tray.Visible = true;
        tray.DoubleClick += delegate { OpenUrl(); };

        marshal = new Form();
        marshal.ShowInTaskbar = false;
        marshal.FormBorderStyle = FormBorderStyle.None;
        marshal.StartPosition = FormStartPosition.Manual;
        marshal.Location = new Point(-32000, -32000);
        marshal.Size = new Size(1, 1);
        IntPtr handle = marshal.Handle;

        timer = new System.Windows.Forms.Timer();
        timer.Interval = StatusIntervalMs;
        timer.Tick += delegate { RefreshStatus(); };
        timer.Start();

        RefreshStatus();
    }

    private void RefreshStatus()
    {
        if (busy || disposed) return;
        busy = true;

        ThreadPool.QueueUserWorkItem(delegate
        {
            ProbeResult result = Engine.Probe();
            Post(delegate
            {
                if (disposed) return;
                busy = false;
                Apply(result);
            });
        });
    }

    private void Apply(ProbeResult result)
    {
        StackState state = result.State;
        tray.Icon = GetIcon(ColorFor(state));
        tray.Text = Clip("Yogganga: " + result.Detail);
        statusItem.Text = "Yogganga: " + result.Detail;

        startItem.Enabled = !busy && state == StackState.Stopped;
        stopItem.Enabled = !busy && (state == StackState.Running || state == StackState.Pending);
        restartItem.Enabled = !busy && (state == StackState.Running || state == StackState.Stopped || state == StackState.Pending);
        startEngineItem.Visible = state == StackState.EngineDown && Engine.Found;
        startEngineItem.Enabled = !busy;
        logsItem.Enabled = !busy && (state == StackState.Running || state == StackState.Stopped || state == StackState.Pending);
        dataItem.Enabled = config.DataDir.Length > 0;
        openItem.Enabled = config.Url.Length > 0;
        copyItem.Enabled = config.Url.Length > 0;

        if (!startupChecked && state != StackState.Unknown)
        {
            startupChecked = true;
            if (state == StackState.EngineDown && Engine.Found)
            {
                StartDaemon();
                return;
            }
            if (state == StackState.Stopped)
            {
                StartContainer();
                return;
            }
        }
    }

    private void StartDaemon()
    {
        if (busy || !Engine.Found) return;
        busy = true;
        UpdateBusy("Starting " + Engine.Label + "...");

        ThreadPool.QueueUserWorkItem(delegate
        {
            bool started = Engine.StartDaemon();
            ProbeResult after = started ? Engine.Probe() : null;
            Post(delegate
            {
                busy = false;
                if (!started)
                {
                    MessageBox.Show(
                        "Could not start " + Engine.Label + ".\r\n\r\nStart it manually, then try again.",
                        "Yogganga",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                    RefreshStatus();
                    return;
                }
                if (after != null && after.State == StackState.Stopped)
                {
                    StartContainer();
                    return;
                }
                RefreshStatus();
            });
        });
    }

    private void StartContainer()
    {
        if (busy) return;
        busy = true;
        startupChecked = true;
        UpdateBusy("Starting Yogganga...");

        ThreadPool.QueueUserWorkItem(delegate
        {
            CommandResult result = Engine.StartContainer();
            Post(delegate
            {
                busy = false;
                if (result.ExitCode != 0) ShowFailure("Could not start the container.", result);
                RefreshStatus();
            });
        });
    }

    private void StopContainer()
    {
        if (busy) return;
        busy = true;
        startupChecked = true;
        UpdateBusy("Stopping Yogganga...");

        ThreadPool.QueueUserWorkItem(delegate
        {
            CommandResult result = Engine.StopContainer();
            Post(delegate
            {
                busy = false;
                if (result.ExitCode != 0) ShowFailure("Could not stop the container.", result);
                RefreshStatus();
            });
        });
    }

    private void RestartContainer()
    {
        if (busy) return;
        busy = true;
        startupChecked = true;
        UpdateBusy("Restarting Yogganga...");

        ThreadPool.QueueUserWorkItem(delegate
        {
            CommandResult result = Engine.RestartContainer();
            Post(delegate
            {
                busy = false;
                if (result.ExitCode != 0) ShowFailure("Could not restart the container.", result);
                RefreshStatus();
            });
        });
    }

    private void ShowLogs()
    {
        if (busy) return;
        busy = true;
        UpdateBusy("Reading logs...");

        ThreadPool.QueueUserWorkItem(delegate
        {
            CommandResult result = Engine.Logs();
            string text = result.StdOut;
            if (result.StdErr.Length > 0)
                text += (text.Length > 0 ? Environment.NewLine : "") + result.StdErr;

            Post(delegate
            {
                busy = false;
                if (result.ExitCode != 0)
                {
                    ShowFailure("Could not read container logs.", result);
                    RefreshStatus();
                    return;
                }

                try
                {
                    string path = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "recent-logs.txt");
                    File.WriteAllText(path, text);
                    ProcessStartInfo start = new ProcessStartInfo("notepad.exe", "\"" + path + "\"");
                    start.UseShellExecute = true;
                    Process.Start(start);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(ex.Message, "Yogganga", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                RefreshStatus();
            });
        });
    }

    private void OpenData()
    {
        if (config.DataDir.Length == 0 || !Directory.Exists(config.DataDir))
        {
            MessageBox.Show(
                "Data folder not found:\r\n" + config.DataDir,
                "Yogganga",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        ProcessStartInfo start = new ProcessStartInfo("explorer.exe", "\"" + config.DataDir + "\"");
        start.UseShellExecute = true;
        Process.Start(start);
    }

    private void OpenUrl()
    {
        if (config.Url.Length == 0) return;
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(config.Url);
            start.UseShellExecute = true;
            Process.Start(start);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Yogganga", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void CopyUrl()
    {
        if (config.Url.Length == 0) return;
        try
        {
            Clipboard.SetText(config.Url);
            tray.ShowBalloonTip(2000, "Yogganga", "Server URL copied.", ToolTipIcon.Info);
        }
        catch (Exception)
        {
            MessageBox.Show("Could not copy the URL.", "Yogganga", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void UpdateBusy(string text)
    {
        tray.Icon = GetIcon(Color.FromArgb(210, 153, 34));
        tray.Text = Clip("Yogganga: " + text);
        statusItem.Text = text;
        startItem.Enabled = false;
        stopItem.Enabled = false;
        restartItem.Enabled = false;
        startEngineItem.Enabled = false;
        logsItem.Enabled = false;
    }

    private void ShowFailure(string message, CommandResult result)
    {
        string detail = (result.StdErr + "\r\n" + result.StdOut).Trim();
        if (detail.Length > 1200) detail = detail.Substring(0, 1200) + "...";
        if (detail.Length > 0) message += "\r\n\r\n" + detail;
        MessageBox.Show(message, "Yogganga", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private void ExitTray()
    {
        if (disposed) return;
        disposed = true;
        timer.Stop();
        tray.Visible = false;
        tray.Dispose();
        menu.Dispose();
        marshal.Dispose();
        DisposeIcons();
        ExitThread();
    }

    private void Post(MethodInvoker action)
    {
        try
        {
            if (!marshal.IsDisposed) marshal.BeginInvoke(action);
        }
        catch (Exception) { }
    }

    private static Color ColorFor(StackState state)
    {
        if (state == StackState.Running) return Color.FromArgb(46, 160, 67);
        if (state == StackState.Stopped) return Color.FromArgb(215, 58, 73);
        if (state == StackState.Pending) return Color.FromArgb(210, 153, 34);
        return Color.FromArgb(139, 148, 158);
    }

    private static string Clip(string text)
    {
        return text.Length <= 63 ? text : text.Substring(0, 60) + "...";
    }

    private static Icon GetIcon(Color color)
    {
        lock (IconCache)
        {
            Icon cached;
            if (IconCache.TryGetValue(color, out cached)) return cached;

            Bitmap bitmap = new Bitmap(16, 16);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (Brush brush = new SolidBrush(color))
            using (Pen pen = new Pen(Color.FromArgb(90, 0, 0, 0)))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.Clear(Color.Transparent);
                graphics.FillEllipse(brush, 1, 1, 14, 14);
                graphics.DrawEllipse(pen, 1, 1, 14, 14);
            }

            IntPtr handle = bitmap.GetHicon();
            bitmap.Dispose();
            Icon icon = Icon.FromHandle(handle);
            IconCache[color] = icon;
            IconHandles.Add(handle);
            return icon;
        }
    }

    private static void DisposeIcons()
    {
        lock (IconCache)
        {
            foreach (Icon icon in IconCache.Values) icon.Dispose();
            IconCache.Clear();
            foreach (IntPtr handle in IconHandles) DestroyIcon(handle);
            IconHandles.Clear();
        }
    }

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr handle);
}
