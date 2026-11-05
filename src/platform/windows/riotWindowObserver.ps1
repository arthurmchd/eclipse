$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $req = [Console]::In.ReadLine() | ConvertFrom-Json
  $selfTest = $req -and $req.action -eq 'self-test'
  if (-not $selfTest -and (-not $req -or $req.ownerPid -le 0 -or -not [IO.Path]::IsPathRooted($req.clientPath))) { throw 'invalid-request' }
  $overlay = 0L
  if (-not $selfTest -and $null -ne $req.overlayWindow) {
    if ([string]$req.overlayWindow -notmatch '^\d{1,20}$') { throw 'invalid-request' }
    $overlay = [long][string]$req.overlayWindow
  }
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class RiotWindowObserver {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr h, int idObject, int idChild, uint thread, uint time);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int index, IntPtr value);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string className, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc callback, uint pid, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr h, UIntPtr id, uint ms, IntPtr callback);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B, WM_TIMER = 0x0113, GW_OWNER = 4, GW_HWNDNEXT = 2, GW_HWNDPREV = 3;
  const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_ASYNCWINDOWPOS = 0x4000;
  const uint WM_CLOSE = 0x0010, WM_RIOT_COMMAND = 0x8001;
  const int GWLP_HWNDPARENT = -8, SW_MINIMIZE = 6, SW_SHOWNOACTIVATE = 4, RELEASE = 3;
  const int DWMWA_TRANSITIONS_FORCEDISABLED = 3, DWMWA_WINDOW_CORNER_PREFERENCE = 33;
  static uint mainThread = 0;
  static IntPtr stilled = IntPtr.Zero;
  static int lastCorner = 0;
  static WinEventProc onEvent = OnEvent;
  static IntPtr chosen = IntPtr.Zero, hook = IntPtr.Zero, overlay = IntPtr.Zero, measured = IntPtr.Zero;
  static RECT last;
  static uint hookedPid = 0;
  static string modern = "", legacy = "", lastLine = null;
  static string Image(uint pid) {
    IntPtr p = OpenProcess(0x1000, false, pid);
    if (p == IntPtr.Zero) return "";
    try { var b = new StringBuilder(32768); int n = b.Capacity; return QueryFullProcessImageName(p, 0, b, ref n) ? b.ToString() : ""; }
    finally { CloseHandle(p); }
  }
  static bool Measure(IntPtr h, out RECT r) {
    r = new RECT();
    if (!IsWindowVisible(h) || IsIconic(h)) return false;
    if (!GetClientRect(h, out r) || r.Right-r.Left < 320 || r.Bottom-r.Top < 240) return false;
    POINT origin = new POINT(); if (!ClientToScreen(h, ref origin)) return false;
    r.Left += origin.X; r.Right += origin.X; r.Top += origin.Y; r.Bottom += origin.Y;
    int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
    return true;
  }
  static bool Official(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    string image = Image(pid);
    return String.Equals(image, modern, StringComparison.OrdinalIgnoreCase) || String.Equals(image, legacy, StringComparison.OrdinalIgnoreCase);
  }
  static bool Minimized(IntPtr h) {
    return h != IntPtr.Zero && h == measured && IsWindowVisible(h) && IsIconic(h) && Official(h);
  }
  static IntPtr Find() {
    if (Minimized(chosen)) return chosen;
    IntPtr foreground = GetForegroundWindow(), found = IntPtr.Zero;
    long best = 0;
    EnumWindows((h, l) => {
      RECT r; if (!Measure(h, out r) || !Official(h)) return true;
      long score = (long)(r.Right-r.Left)*(r.Bottom-r.Top) + (h == foreground ? 100000000 : 0);
      if (score > best) { best = score; found = h; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  static int Corner(IntPtr h) {
    int preference;
    if (IsZoomed(h) || DwmGetWindowAttribute(h, DWMWA_WINDOW_CORNER_PREFERENCE, out preference, 4) != 0) return 0;
    int size = preference == 0 || preference == 2 ? 8 : preference == 3 ? 4 : 0;
    uint dpi = GetDpiForWindow(h);
    return (int)Math.Round(size * (dpi == 0 ? 96 : dpi) / 96.0);
  }
  static string Format(IntPtr h, RECT r, bool minimized, int corner) {
    return "{\"target\":{\"id\":\"" + h.ToInt64() + "\",\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + (r.Right-r.Left) + ",\"height\":" + (r.Bottom-r.Top) + ",\"corner\":" + corner + (minimized ? ",\"minimized\":true" : "") + "}}";
  }
  static string Describe(IntPtr h) {
    RECT r;
    if (h != IntPtr.Zero && Measure(h, out r)) { last = r; measured = h; lastCorner = Corner(h); return Format(h, r, false, lastCorner); }
    if (Minimized(h)) return Format(h, last, true, lastCorner);
    return "{\"target\":null}";
  }
  static void Write(string line) {
    lastLine = line;
    Console.Out.WriteLine(line);
    Console.Out.Flush();
  }
  static void Attach(IntPtr h) {
    if (overlay == IntPtr.Zero || h == IntPtr.Zero || GetWindow(overlay, GW_OWNER) == h) return;
    SetWindowLongPtr(overlay, GWLP_HWNDPARENT, h);
    if (GetWindow(overlay, GW_OWNER) != h) throw new InvalidOperationException("owner-unavailable");
  }
  static bool Beneath(IntPtr h) {
    for (IntPtr next = GetWindow(h, GW_HWNDNEXT); next != IntPtr.Zero; next = GetWindow(next, GW_HWNDNEXT))
      if (next == overlay) return true;
    return false;
  }
  static void Raise(IntPtr h) {
    if (overlay == IntPtr.Zero || h == IntPtr.Zero || !IsWindowVisible(overlay) || IsIconic(h) || !Beneath(h)) return;
    SetWindowPos(overlay, GetWindow(h, GW_HWNDPREV), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
  }
  static int Transitions(IntPtr h, bool disabled) {
    int value = disabled ? 1 : 0;
    return DwmSetWindowAttribute(h, DWMWA_TRANSITIONS_FORCEDISABLED, ref value, 4);
  }
  static void Still(IntPtr h) {
    if (overlay == IntPtr.Zero || h == stilled) return;
    if (stilled != IntPtr.Zero && IsWindow(stilled)) Transitions(stilled, false);
    stilled = h;
    if (h != IntPtr.Zero) Transitions(h, true);
  }
  static void Hook(IntPtr h) {
    uint pid = 0;
    if (h != IntPtr.Zero) GetWindowThreadProcessId(h, out pid);
    if (pid == hookedPid) return;
    if (hook != IntPtr.Zero) UnhookWinEvent(hook);
    hook = IntPtr.Zero;
    hookedPid = pid;
    if (pid != 0) hook = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, onEvent, pid, 0, 0);
  }
  static void OnEvent(IntPtr eventHook, uint eventType, IntPtr h, int idObject, int idChild, uint thread, uint time) {
    if (h != chosen || idObject != 0 || idChild != 0) return;
    string line = Describe(h);
    if (line != lastLine) Write(line);
  }
  static void Poll() {
    chosen = Find();
    Attach(chosen);
    Still(chosen);
    Raise(chosen);
    Hook(chosen);
    Write(Describe(chosen));
  }
  static int Code(string line) {
    return line == "minimize" ? 1 : line == "close" ? 2 : 0;
  }
  static void Apply(IntPtr h, int code) {
    if (code == 1) ShowWindowAsync(h, SW_MINIMIZE);
    else if (code == 2) PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
  }
  static void Act(int code) {
    IntPtr h = chosen;
    if (h == IntPtr.Zero || !IsWindowVisible(h) || IsIconic(h) || !Official(h)) return;
    Apply(h, code);
  }
  static void Listen() {
    try {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        int code = line.Length <= 16 ? Code(line.Trim()) : 0;
        if (code != 0) PostThreadMessage(mainThread, WM_RIOT_COMMAND, new IntPtr(code), IntPtr.Zero);
      }
    } catch {}
    PostThreadMessage(mainThread, WM_RIOT_COMMAND, new IntPtr(RELEASE), IntPtr.Zero);
  }
  static void Pump() {
    MSG m;
    while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
  }
  static IntPtr TestWindow() {
    IntPtr h = CreateWindowEx(0x08000080, "STATIC", "", 0x90000000, -20000, -20000, 16, 16, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    if (h == IntPtr.Zero) throw new InvalidOperationException("self-test-window");
    return h;
  }
  static void Below(IntPtr cards, IntPtr riot) {
    SetWindowPos(cards, riot, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    if (!Beneath(riot)) throw new InvalidOperationException("self-test-order");
  }
  public static void SelfTest() {
    IntPtr riot = IntPtr.Zero, cards = IntPtr.Zero;
    try {
      riot = TestWindow();
      cards = TestWindow();
      overlay = cards;
      ShowWindow(cards, 0);
      Below(cards, riot);
      Raise(riot);
      if (!Beneath(riot)) throw new InvalidOperationException("self-test-hidden");
      ShowWindow(cards, 4);
      Below(cards, riot);
      Raise(riot);
      if (Beneath(riot) || GetWindow(riot, GW_HWNDPREV) != cards) throw new InvalidOperationException("self-test-raise");
      Raise(riot);
      if (GetWindow(riot, GW_HWNDPREV) != cards) throw new InvalidOperationException("self-test-stable");
      if (Code("minimize") != 1 || Code("close") != 2 || Code("quit") != 0 || Code("") != 0) throw new InvalidOperationException("self-test-commands");
      Apply(riot, 1);
      Pump();
      if (!IsIconic(riot)) throw new InvalidOperationException("self-test-minimize");
      ShowWindow(riot, SW_SHOWNOACTIVATE);
      if (IsIconic(riot)) throw new InvalidOperationException("self-test-restore");
      Still(riot);
      if (stilled != riot || Transitions(riot, true) != 0) throw new InvalidOperationException("self-test-transitions");
      Still(riot);
      if (stilled != riot) throw new InvalidOperationException("self-test-still");
      uint dpi = GetDpiForWindow(riot);
      int expected = (int)Math.Round(4 * (dpi == 0 ? 96 : dpi) / 96.0), small = 3, square = 1;
      if (DwmSetWindowAttribute(riot, DWMWA_WINDOW_CORNER_PREFERENCE, ref small, 4) == 0 && Corner(riot) != expected) throw new InvalidOperationException("self-test-corner");
      if (DwmSetWindowAttribute(riot, DWMWA_WINDOW_CORNER_PREFERENCE, ref square, 4) == 0 && Corner(riot) != 0) throw new InvalidOperationException("self-test-square");
      Still(IntPtr.Zero);
      if (stilled != IntPtr.Zero) throw new InvalidOperationException("self-test-release");
      Apply(cards, 2);
      Pump();
      if (IsWindow(cards)) throw new InvalidOperationException("self-test-close");
      cards = IntPtr.Zero;
    } finally {
      Still(IntPtr.Zero);
      overlay = IntPtr.Zero;
      if (cards != IntPtr.Zero) DestroyWindow(cards);
      if (riot != IntPtr.Zero) DestroyWindow(riot);
    }
  }
  public static void Run(string clientPath, int ownerPid, long overlayWindow) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    string root = Path.GetDirectoryName(Path.GetFullPath(clientPath));
    modern = Path.Combine(root, "RiotClientElectron", "Riot Client.exe");
    legacy = Path.Combine(root, "UX", "RiotClientUx.exe");
    Process owner = Process.GetProcessById(ownerPid);
    if (overlayWindow != 0) {
      overlay = new IntPtr(overlayWindow);
      uint overlayPid; GetWindowThreadProcessId(overlay, out overlayPid);
      if (overlayPid != (uint)ownerPid) throw new InvalidOperationException("invalid-overlay");
    }
    SetTimer(IntPtr.Zero, UIntPtr.Zero, 180, IntPtr.Zero);
    mainThread = GetCurrentThreadId();
    var listener = new System.Threading.Thread(Listen);
    listener.IsBackground = true;
    listener.Start();
    try {
      Poll();
      MSG m;
      while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {
        if (m.message == WM_RIOT_COMMAND && m.hwnd == IntPtr.Zero) {
          if ((int)m.wParam == RELEASE) return;
          Act((int)m.wParam);
          continue;
        }
        if (m.message == WM_TIMER && m.hwnd == IntPtr.Zero) {
          owner.Refresh();
          if (owner.HasExited) return;
          Poll();
          continue;
        }
        TranslateMessage(ref m);
        DispatchMessage(ref m);
      }
    } finally {
      Still(IntPtr.Zero);
    }
  }
}
'@
  if ($selfTest) {
    [RiotWindowObserver]::SelfTest()
    [Console]::Out.WriteLine('ok')
    exit 0
  }
  [RiotWindowObserver]::Run([string]$req.clientPath, [int]$req.ownerPid, $overlay)
} catch {
  [Console]::Out.WriteLine('{"error":"observer-unavailable"}')
  exit 1
}
