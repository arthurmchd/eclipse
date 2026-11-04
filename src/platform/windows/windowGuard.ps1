$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  $req = [Console]::In.ReadLine() | ConvertFrom-Json
  if (-not $req) { throw 'invalid-request' }

  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class RiotWindowGuard {
  const int GWL_EXSTYLE = -20, WS_EX_LAYERED = 0x80000, WS_EX_APPWINDOW = 0x40000;
  const int HIDDEN_STYLES = WS_EX_LAYERED | 0x20 | 0x08000000 | 0x80;
  const int CONTROLLED_STYLES = HIDDEN_STYLES | WS_EX_APPWINDOW;
  const string PREFIX = "RiotAccountManager.Guard.";
  const uint EVENT_FOREGROUND = 3, EVENT_CREATE = 0x8000, EVENT_SHOW = 0x8002;
  const uint SWP_FRAMECHANGED = 0x20, SWP_NOACTIVATE = 0x10, SWP_NOMOVE = 2, SWP_NOSIZE = 1, SWP_NOZORDER = 4;
  const uint SWP_ASYNCWINDOWPOS = 0x4000;

  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG {
    public IntPtr hwnd; public uint message; public UIntPtr wParam;
    public IntPtr lParam; public uint time; public POINT point; public uint privateData;
  }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  delegate void EventProc(IntPtr hook, uint ev, IntPtr h, int obj, int child, uint thread, uint time);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll", EntryPoint = "GetClassLongW")] static extern uint GetClassLong(IntPtr h, int index);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] static extern int SetWindowLong(IntPtr h, int index, int value);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetLayeredWindowAttributes(IntPtr h, uint color, byte alpha, uint flags);
  [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr h, out uint color, out byte alpha, out uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetProp(IntPtr h, string name, IntPtr value);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h, string name);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr h, string name);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, EventProc callback, uint pid, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr h, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern void SetLastError(uint error);

  static EventProc callback;
  static string mode = "hide";
  static IntPtr lastUserWindow;
  static bool handlingEvent;
  static string eventFailure;
  static volatile bool abandonedStyleWorker;
  static readonly ConcurrentQueue<string> commands = new ConcurrentQueue<string>();
  sealed class WindowEvent { public uint Kind; public IntPtr Window; }
  static readonly ConcurrentQueue<WindowEvent> windowEvents = new ConcurrentQueue<WindowEvent>();
  static volatile bool inputEnded;
  public static bool Diagnostics;

  static void Output(string line) { Console.Out.WriteLine(line); Console.Out.Flush(); }

  static string ClassName(IntPtr h) {
    var name = new StringBuilder(256); GetClassName(h, name, name.Capacity);
    return System.Text.RegularExpressions.Regex.Replace(name.ToString(), "[^a-zA-Z0-9_.-]", "_");
  }

  static void StyleDiagnostic(IntPtr h, string phase, int before, int expected, int mask, long elapsed, int error) {
    if (!Diagnostics) return;
    uint pid; GetWindowThreadProcessId(h, out pid);
    Output("diagnostic:phase=" + phase + ";pid=" + pid + ";handle=" + h.ToInt64().ToString("x")
      + ";class=" + ClassName(h) + ";classStyle=" + GetClassLong(h, -26).ToString("x")
      + ";before=" + before.ToString("x") + ";expected=" + expected.ToString("x")
      + ";actual=" + GetWindowLong(h, GWL_EXSTYLE).ToString("x") + ";mask=" + mask.ToString("x")
      + ";elapsed=" + elapsed + ";win32=" + error);
  }

  static void PumpMessages() {
    MSG msg;
    for (int i = 0; i < 128 && PeekMessage(out msg, IntPtr.Zero, 0, 0, 1); i++) {
      TranslateMessage(ref msg); DispatchMessage(ref msg);
    }
  }

  static string ProcessName(IntPtr window) {
    uint pid; GetWindowThreadProcessId(window, out pid);
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return "";
    try {
      var name = new StringBuilder(32768);
      int length = name.Capacity;
      return QueryFullProcessImageName(process, 0, name, ref length)
        ? Path.GetFileNameWithoutExtension(name.ToString()) : "";
    } finally { CloseHandle(process); }
  }

  static bool RiotName(string name) {
    return String.Equals(name, "Riot Client", StringComparison.OrdinalIgnoreCase)
      || String.Equals(name, "RiotClientUx", StringComparison.OrdinalIgnoreCase)
      || String.Equals(name, "RiotClientUxRender", StringComparison.OrdinalIgnoreCase)
      || String.Equals(name, "RiotClientServices", StringComparison.OrdinalIgnoreCase);
  }
  static bool RiotWindow(IntPtr h) { return h != IntPtr.Zero && RiotName(ProcessName(h)); }
  static bool RootWindow(IntPtr h) { return h != IntPtr.Zero && GetAncestor(h, 2) == h; }

  static bool AuxiliaryClass(string name) {
    return String.Equals(name, "TrayIconClass", StringComparison.OrdinalIgnoreCase);
  }

  static bool ActivationCandidate(string process, string className, int width, int height, bool root) {
    return root && !AuxiliaryClass(className) && width >= 320 && height >= 240
      && (String.Equals(process, "Riot Client", StringComparison.OrdinalIgnoreCase)
        || String.Equals(process, "RiotClientUx", StringComparison.OrdinalIgnoreCase));
  }

  public static void HideAuxiliaryWindows() {
    EnumWindows((h, l) => {
      if (RiotWindow(h) && AuxiliaryClass(ClassName(h))) {
        if (Property(h, "Saved") != 0) Property(h, "Visible", 0);
        ShowWindowAsync(h, 0);
      }
      return true;
    }, IntPtr.Zero);
  }

  static void Property(IntPtr h, string name, long value) {
    if (!SetProp(h, PREFIX + name, new IntPtr(value)) && IsWindow(h))
      throw new InvalidOperationException("window-access-denied");
  }
  static long Property(IntPtr h, string name) { return GetProp(h, PREFIX + name).ToInt64(); }

  static void Remember(IntPtr h, bool shown) {
    if (Property(h, "Saved") == 0) {
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      Property(h, "ExStyle", ex);
      Property(h, "Visible", IsWindowVisible(h) || shown ? 1 : 0);
      Property(h, "Iconic", IsIconic(h) ? 1 : 0);
      uint color, flags; byte alpha;
      if ((ex & WS_EX_LAYERED) != 0 && GetLayeredWindowAttributes(h, out color, out alpha, out flags)) {
        Property(h, "Color", color);
        Property(h, "Alpha", alpha);
        Property(h, "AlphaFlags", flags);
      }
      Property(h, "Saved", 1);
    } else if (shown) {
      Property(h, "Visible", 1);
    }
  }

  static void BoundedStyleAction(Action action, int timeoutMs, Action pump = null) {
    Exception failure = null;
    var done = new ManualResetEvent(false);
    var worker = new Thread(() => {
      try { action(); } catch (Exception error) { failure = error; }
      finally { done.Set(); }
    });
    worker.IsBackground = true;
    worker.Start();
    var timer = Stopwatch.StartNew();
    bool completed = false;
    do {
      completed = done.WaitOne(Math.Min(10, Math.Max(0, timeoutMs - (int)timer.ElapsedMilliseconds)));
      if (completed) break;
      if (pump != null) pump();
    } while (timer.ElapsedMilliseconds < timeoutMs);
    if (!completed) {
      abandonedStyleWorker = true;
      throw new InvalidOperationException("window-style-timeout");
    }
    done.Dispose();
    if (failure != null) throw failure;
  }

  static bool StyleMatches(int actual, int expected, int mask) {
    return ((actual ^ expected) & mask) == 0;
  }

  static int MergeStyle(int actual, int expected, int mask) {
    return (actual & ~mask) | (expected & mask);
  }

  static void Style(IntPtr h, int value, int mask) {
    if (!IsWindow(h) || StyleMatches(GetWindowLong(h, GWL_EXSTYLE), value, mask)) return;
    int before = GetWindowLong(h, GWL_EXSTYLE), writeError = 0;
    var timer = Stopwatch.StartNew();
    StyleDiagnostic(h, "style-begin", before, value, mask, 0, 0);
    try {
      BoundedStyleAction(() => {
        for (int attempt = 0; attempt < 3; attempt++) {
          if (!IsWindow(h)) return;
          int requested = MergeStyle(GetWindowLong(h, GWL_EXSTYLE), value, mask);
          SetLastError(0);
          int previous = SetWindowLong(h, GWL_EXSTYLE, requested);
          writeError = previous == 0 ? Marshal.GetLastWin32Error() : 0;
          if (!IsWindow(h)) return;
          if (StyleMatches(GetWindowLong(h, GWL_EXSTYLE), requested, mask)) {
            SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0,
              SWP_ASYNCWINDOWPOS | SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
            return;
          }
        }
        throw new InvalidOperationException("window-style-denied");
      }, 750, PumpMessages);
    } catch (Exception error) {
      StyleDiagnostic(h, error.Message == "window-style-timeout" ? "style-timeout" : "style-failed",
        before, value, mask, timer.ElapsedMilliseconds, writeError);
      throw;
    }
    StyleDiagnostic(h, "style-end", before, value, mask, timer.ElapsedMilliseconds, writeError);
  }

  static void RestoreStyle(int original, Action<int, int> apply) {
    if ((original & WS_EX_LAYERED) != 0) apply(original & ~WS_EX_LAYERED, WS_EX_LAYERED);
    apply(original, CONTROLLED_STYLES);
  }

  static void Hide(IntPtr h, bool shown) {
    if (!IsWindow(h)) return;
    Remember(h, shown);
    if (mode == "conceal" && IsWindowVisible(h)) ShowWindowAsync(h, 0);
    bool hidden = false;
    for (int attempt = 0; attempt < 3; attempt++) {
      Style(h, HIDDEN_STYLES, CONTROLLED_STYLES);
      if (!IsWindow(h)) return;
      if (SetLayeredWindowAttributes(h, 0, 1, 2)) {
        if (!IsWindow(h)) return;
        uint color, flags; byte alpha;
        if (GetLayeredWindowAttributes(h, out color, out alpha, out flags) && alpha == 1 && (flags & 2) != 0
            && StyleMatches(GetWindowLong(h, GWL_EXSTYLE), HIDDEN_STYLES, CONTROLLED_STYLES)) {
          hidden = true;
          break;
        }
      } else if (!IsWindow(h)) return;
    }
    if (!hidden) throw new InvalidOperationException("window-opacity-denied");
    if (mode == "conceal") {
      if (IsWindowVisible(h)) ShowWindowAsync(h, 0);
    } else if (Property(h, "Concealed") != 0 && Property(h, "Visible") != 0) {
      ShowWindowAsync(h, 8);
    }
    Property(h, "Concealed", mode == "conceal" ? 1 : 0);
  }

  static void Restore(IntPtr h) {
    if (Property(h, "Saved") == 0) return;
    int ex = unchecked((int)Property(h, "ExStyle"));
    RestoreStyle(ex, (value, mask) => Style(h, value, mask));
    uint flags = unchecked((uint)Property(h, "AlphaFlags"));
    if ((ex & WS_EX_LAYERED) != 0 && flags != 0)
      SetLayeredWindowAttributes(h, unchecked((uint)Property(h, "Color")),
        unchecked((byte)Property(h, "Alpha")), flags);
    bool visible = Property(h, "Visible") != 0 && !AuxiliaryClass(ClassName(h));
    bool iconic = Property(h, "Iconic") != 0;
    ShowWindowAsync(h, visible ? (iconic ? 7 : 8) : 0);
    foreach (string key in new [] { "Saved", "ExStyle", "Visible", "Iconic", "Color", "Alpha", "AlphaFlags", "Concealed" })
      RemoveProp(h, PREFIX + key);
  }

  static void ReturnFocus() {
    if (lastUserWindow != IntPtr.Zero && IsWindow(lastUserWindow)
        && IsWindowVisible(lastUserWindow) && !RiotWindow(lastUserWindow))
      SetForegroundWindow(lastUserWindow);
  }

  static void Sweep() {
    EnumWindows((h, l) => {
      if (RiotWindow(h)) Hide(h, IsWindowVisible(h));
      return true;
    }, IntPtr.Zero);
    if (RiotWindow(GetForegroundWindow())) ReturnFocus();
  }

  static void OnEvent(IntPtr hook, uint ev, IntPtr h, int obj, int child, uint thread, uint time) {
    if (h == IntPtr.Zero) return;
    if (ev != EVENT_FOREGROUND && (obj != 0 || child != 0 || (ev != EVENT_CREATE && ev != EVENT_SHOW))) return;
    if (windowEvents.Count < 512) windowEvents.Enqueue(new WindowEvent { Kind = ev, Window = h });
  }

  static void HandleEvent(WindowEvent entry) {
    if (handlingEvent || mode == "reveal") return;
    IntPtr h = entry.Window;
    uint ev = entry.Kind;
    if (!RootWindow(h)) return;
    handlingEvent = true;
    try {
      if (RiotWindow(h)) {
        Hide(h, ev == EVENT_SHOW);
        if (ev == EVENT_FOREGROUND) ReturnFocus();
      } else if (ev == EVENT_FOREGROUND) {
        lastUserWindow = h;
      }
    } catch (Exception error) { eventFailure = error.Message; }
    finally { handlingEvent = false; }
  }

  public static void RestoreAll(bool activate, bool park = false) {
    IntPtr main = IntPtr.Zero;
    long best = 0;
    string firstFailure = null;
    EnumWindows((h, l) => {
      if (abandonedStyleWorker) { firstFailure = "window-style-timeout"; return false; }
      if (!RiotWindow(h)) return true;
      if (AuxiliaryClass(ClassName(h))) {
        if (Property(h, "Saved") != 0) Property(h, "Visible", 0);
        ShowWindowAsync(h, 0);
      }
      try {
        if (park) {
          ShowWindowAsync(h, 0);
          if (Property(h, "Saved") != 0) Property(h, "Visible", 0);
        }
        Restore(h);
      } catch (Exception error) { firstFailure = error.Message; }
      RECT rect; GetWindowRect(h, out rect);
      var text = new StringBuilder(256); GetWindowText(h, text, text.Capacity);
      long area = (long)Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top);
      if (ActivationCandidate(ProcessName(h), ClassName(h), rect.Right - rect.Left, rect.Bottom - rect.Top, RootWindow(h)) && text.Length > 0) {
        long score = area + (text.ToString().Equals("Riot Client", StringComparison.OrdinalIgnoreCase) ? 100000000 : 0);
        if (score > best) { best = score; main = h; }
      }
      return !abandonedStyleWorker;
    }, IntPtr.Zero);
    if (activate && !abandonedStyleWorker && main != IntPtr.Zero) {
      ShowWindowAsync(main, IsIconic(main) ? 9 : 5);
      SetForegroundWindow(main);
    }
    if (firstFailure != null) throw new InvalidOperationException(firstFailure);
  }

  public static void CloseClientWindows() {
    RestoreAll(false);
    EnumWindows((h, l) => {
      string name = ProcessName(h);
      if (RootWindow(h) && (name.Equals("Riot Client", StringComparison.OrdinalIgnoreCase)
          || name.Equals("RiotClientUx", StringComparison.OrdinalIgnoreCase)))
        PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
  }

  public static bool GameWindow(string game) {
    if (game != "lol" && game != "tft" && game != "val")
      throw new ArgumentException("invalid-game");
    bool found = false;
    EnumWindows((h, l) => {
      if (!RootWindow(h) || !IsWindowVisible(h) || IsIconic(h)) return true;
      RECT rect; GetWindowRect(h, out rect);
      if (rect.Right - rect.Left < 160 || rect.Bottom - rect.Top < 120) return true;
      if ((GetWindowLong(h, GWL_EXSTYLE) & 0x80) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      string name = ProcessName(h);
      found = game == "val"
        ? (name.Equals("VALORANT-Win64-Shipping", StringComparison.OrdinalIgnoreCase) || name.Equals("VALORANT", StringComparison.OrdinalIgnoreCase))
        : (name.Equals("LeagueClientUx", StringComparison.OrdinalIgnoreCase) || name.Equals("League of Legends", StringComparison.OrdinalIgnoreCase));
      return !found;
    }, IntPtr.Zero);
    return found;
  }

  static void ReadCommands() {
    try {
      string line;
      while ((line = Console.In.ReadLine()) != null) commands.Enqueue(line.Trim());
    } finally { inputEnded = true; }
  }

  static bool OwnerAlive(Process owner) {
    try { return !owner.HasExited; } catch { return false; }
  }

  static bool ShouldRestore(bool keepHidden, bool ownerAlive, bool workerAbandoned) {
    return !workerAbandoned && (!keepHidden || !ownerAlive);
  }

  public static void Inspect() {
    EnumWindows((h, l) => {
      if (!RiotWindow(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT rect; GetWindowRect(h, out rect);
      uint color, flags; byte alpha;
      bool layered = GetLayeredWindowAttributes(h, out color, out alpha, out flags);
      Output("window:pid=" + pid + ";handle=" + h.ToInt64().ToString("x") + ";class=" + ClassName(h)
        + ";classStyle=" + GetClassLong(h, -26).ToString("x")
        + ";exStyle=" + GetWindowLong(h, GWL_EXSTYLE).ToString("x")
        + ";saved=" + Property(h, "Saved") + ";savedExStyle=" + Property(h, "ExStyle").ToString("x")
        + ";visible=" + (IsWindowVisible(h) ? 1 : 0) + ";width=" + (rect.Right - rect.Left)
        + ";height=" + (rect.Bottom - rect.Top) + ";layered=" + (layered ? 1 : 0)
        + ";alpha=" + (layered ? alpha.ToString() : "unknown"));
      return true;
    }, IntPtr.Zero);
  }

  public static void Watch(int ownerPid, string initialMode) {
    if (ownerPid <= 0) throw new ArgumentException("invalid-owner");
    if (String.IsNullOrEmpty(initialMode)) initialMode = "hide";
    if (initialMode != "hide" && initialMode != "conceal") throw new ArgumentException("invalid-mode");
    mode = initialMode;
    using (Process owner = Process.GetProcessById(ownerPid)) {
      if (owner.HasExited) throw new InvalidOperationException("owner-exited");
      callback = OnEvent;
      IntPtr foreground = IntPtr.Zero, windows = IntPtr.Zero;
      bool keepHidden = false;
      try {
        foreground = SetWinEventHook(EVENT_FOREGROUND, EVENT_FOREGROUND, IntPtr.Zero, callback, 0, 0, 2);
        windows = SetWinEventHook(EVENT_CREATE, EVENT_SHOW, IntPtr.Zero, callback, 0, 0, 2);
        if (foreground == IntPtr.Zero || windows == IntPtr.Zero)
          throw new InvalidOperationException("window-hook-failed");
        lastUserWindow = GetForegroundWindow();
        if (RiotWindow(lastUserWindow)) lastUserWindow = IntPtr.Zero;
        Sweep();
        var reader = new Thread(ReadCommands); reader.IsBackground = true; reader.Start();
        Output("ready");
        var watch = Stopwatch.StartNew();
        long nextSweep = 0, nextOwnerCheck = 0;
        bool stopping = false;
        while (!stopping) {
          PumpMessages();
          if (eventFailure != null) throw new InvalidOperationException(eventFailure);
          string command;
          while (commands.TryDequeue(out command)) {
            if (command.StartsWith("game-window:", StringComparison.Ordinal)) {
              string game = command.Substring("game-window:".Length);
              Output("game-window:" + game + (GameWindow(game) ? ":ready" : ":waiting"));
              continue;
            } else if (command == "park") {
              mode = "reveal";
              RestoreAll(false, true);
            } else if (command == "reveal") {
              mode = "reveal";
              RestoreAll(true);
            } else if (command == "hide" || command == "conceal") {
              mode = command;
              Sweep();
            } else if (command == "stop") {
              mode = "reveal";
              RestoreAll(false);
              stopping = true;
            } else if (command == "handoff") {
              keepHidden = mode != "reveal";
              stopping = true;
            } else throw new ArgumentException("invalid-command");
            Output("command:" + command);
            if (stopping) break;
          }
          WindowEvent entry;
          for (int i = 0; !stopping && eventFailure == null && i < 128 && windowEvents.TryDequeue(out entry); i++) HandleEvent(entry);
          if (eventFailure != null) throw new InvalidOperationException(eventFailure);
          if (inputEnded && commands.IsEmpty) break;
          if (watch.ElapsedMilliseconds >= nextOwnerCheck) {
            if (owner.HasExited) break;
            nextOwnerCheck = watch.ElapsedMilliseconds + 500;
          }
          if (mode != "reveal" && watch.ElapsedMilliseconds >= nextSweep) {
            Sweep();
            nextSweep = watch.ElapsedMilliseconds + 100;
          }
          Thread.Sleep(5);
        }
      } catch {
        keepHidden = mode != "reveal";
        throw;
      } finally {
        bool restore = ShouldRestore(keepHidden, OwnerAlive(owner), abandonedStyleWorker);
        mode = "reveal";
        if (foreground != IntPtr.Zero) UnhookWinEvent(foreground);
        if (windows != IntPtr.Zero) UnhookWinEvent(windows);
        if (restore) RestoreAll(false);
        GC.KeepAlive(callback);
      }
    }
  }

  public static void SelfTest() {
    if (!ActivationCandidate("Riot Client", "Chrome_WidgetWin_1", 1536, 864, true)
        || ActivationCandidate("RiotClientServices", "TrayIconClass", 400, 430, true)
        || ActivationCandidate("Riot Client", "TrayIconClass", 1536, 864, true)
        || ActivationCandidate("Riot Client", "IME", 0, 0, true)
        || ActivationCandidate("LeagueClientUx", "Chrome_WidgetWin_1", 1536, 864, true)
        || ActivationCandidate("Riot Client", "Chrome_WidgetWin_1", 1536, 864, false))
      throw new InvalidOperationException("activation-filter-test-failed");
    if (!RiotName("RiotClientUx") || !RiotName("Riot Client") || !RiotName("RiotClientServices")
        || RiotName("LeagueClientUx") || RiotName("VALORANT") || RiotName("vgtray"))
      throw new InvalidOperationException("process-filter-test-failed");
    int unrelatedStyle = 0x100;
    int merged = MergeStyle(WS_EX_APPWINDOW | unrelatedStyle, HIDDEN_STYLES, CONTROLLED_STYLES);
    if ((merged & unrelatedStyle) == 0 || !StyleMatches(merged, HIDDEN_STYLES, CONTROLLED_STYLES)
        || !StyleMatches(merged ^ unrelatedStyle, HIDDEN_STYLES, CONTROLLED_STYLES)
        || StyleMatches(merged & ~WS_EX_LAYERED, HIDDEN_STYLES, CONTROLLED_STYLES)
        || StyleMatches(merged | WS_EX_APPWINDOW, HIDDEN_STYLES, CONTROLLED_STYLES)
        || StyleMatches(merged ^ unrelatedStyle, merged, -1))
      throw new InvalidOperationException("controlled-style-test-failed");
    int updatedClientStyle = 0x200000;
    int currentStyle = HIDDEN_STYLES | updatedClientStyle;
    RestoreStyle(WS_EX_APPWINDOW | unrelatedStyle, (value, mask) => {
      if ((mask & ~CONTROLLED_STYLES) != 0) throw new InvalidOperationException("restore-mask-test-failed");
      currentStyle = MergeStyle(currentStyle, value, mask);
    });
    if (currentStyle != (WS_EX_APPWINDOW | updatedClientStyle))
      throw new InvalidOperationException("restore-concurrent-style-test-failed");
    var layeredWrites = new List<int>();
    currentStyle = HIDDEN_STYLES | updatedClientStyle;
    RestoreStyle(WS_EX_LAYERED | WS_EX_APPWINDOW, (value, mask) => {
      currentStyle = MergeStyle(currentStyle, value, mask);
      layeredWrites.Add(currentStyle);
    });
    if (layeredWrites.Count != 2 || (layeredWrites[0] & WS_EX_LAYERED) != 0
        || (layeredWrites[0] & updatedClientStyle) == 0
        || layeredWrites[1] != (WS_EX_LAYERED | WS_EX_APPWINDOW | updatedClientStyle))
      throw new InvalidOperationException("restore-layered-cycle-test-failed");
    if (ShouldRestore(true, true, false) || !ShouldRestore(false, true, false)
        || !ShouldRestore(true, false, false) || ShouldRestore(false, false, true))
      throw new InvalidOperationException("restore-policy-test-failed");
    int ran = 0;
    BoundedStyleAction(() => { ran++; }, 1000);
    if (ran != 1) throw new InvalidOperationException("style-worker-test-failed");
    using (var releasedByPump = new ManualResetEvent(false)) {
      bool pumped = false;
      BoundedStyleAction(() => releasedByPump.WaitOne(), 1000, () => { pumped = true; releasedByPump.Set(); });
      if (!pumped) throw new InvalidOperationException("style-pump-test-failed");
    }
    bool propagated = false;
    try { BoundedStyleAction(() => { throw new InvalidOperationException("synthetic-style-error"); }, 1000); }
    catch (InvalidOperationException error) { propagated = error.Message == "synthetic-style-error"; }
    if (!propagated) throw new InvalidOperationException("style-error-test-failed");
    bool bounded = false;
    using (var release = new ManualResetEvent(false)) {
      try { BoundedStyleAction(() => { release.WaitOne(); }, 30); }
      catch (InvalidOperationException error) { bounded = error.Message == "window-style-timeout"; }
      finally { release.Set(); }
      Thread.Sleep(20);
    }
    if (!bounded) throw new InvalidOperationException("style-timeout-test-failed");
    OnEvent(IntPtr.Zero, EVENT_SHOW, new IntPtr(1), 0, 0, 0, 0);
    WindowEvent queued;
    if (!windowEvents.TryDequeue(out queued) || queued.Kind != EVENT_SHOW || queued.Window != new IntPtr(1))
      throw new InvalidOperationException("event-queue-test-failed");
    for (int i = 0; i < 600; i++) OnEvent(IntPtr.Zero, EVENT_SHOW, new IntPtr(1), 0, 0, 0, 0);
    if (windowEvents.Count != 512) throw new InvalidOperationException("event-limit-test-failed");
    while (windowEvents.TryDequeue(out queued)) {}
  }
}
'@

  if ($req.PSObject.Properties.Name -contains 'diagnostics') {
    if ($req.diagnostics -isnot [bool]) { throw 'invalid-diagnostics' }
    [RiotWindowGuard]::Diagnostics = $req.diagnostics
  }

  switch ($req.action) {
    'hide-auxiliary' { [RiotWindowGuard]::HideAuxiliaryWindows() }
    'close-client' { [RiotWindowGuard]::CloseClientWindows() }
    'park' { [RiotWindowGuard]::RestoreAll($false, $true) }
    'self-test' { [RiotWindowGuard]::SelfTest() }
    'inspect' { [RiotWindowGuard]::Inspect() }
    'restore' {
      $activate = $true
      if ($req.PSObject.Properties.Name -contains 'activate') {
        if ($req.activate -isnot [bool]) { throw 'invalid-activation' }
        $activate = $req.activate
      }
      [RiotWindowGuard]::RestoreAll($activate)
    }
    'game-window' {
      if ([RiotWindowGuard]::GameWindow([string]$req.game)) { [Console]::Out.WriteLine('game-ready') }
    }
    default {
      if ($req.action -and $req.action -ne 'watch') { throw 'invalid-action' }
      [RiotWindowGuard]::Watch([int]$req.ownerPid, [string]$req.initialMode)
    }
  }
  [Console]::Out.WriteLine('ok')
  [Console]::Out.Flush()
  exit 0
} catch {
  $reason = $_.Exception.GetBaseException().Message -replace '[\r\n]', ' '
  [Console]::Out.WriteLine("error:$reason")
  [Console]::Out.Flush()
  exit 1
}
