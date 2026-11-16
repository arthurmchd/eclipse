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
  $follow = (-not $selfTest) -and ($req.follow -eq $true) -and ($overlay -ne 0)
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
  [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr h, int idObject, int idChild, uint thread, uint time);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string className, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint RegisterWindowMessage(string name);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern IntPtr SetCapture(IntPtr h);
  [DllImport("user32.dll")] static extern bool ReleaseCapture();
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
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);
  [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc, int x, int y);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr item);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B, EVENT_SYSTEM_MOVESIZESTART = 0x000A, WM_TIMER = 0x0113, GW_OWNER = 4, GW_HWNDNEXT = 2, GW_HWNDPREV = 3;
  const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_NOOWNERZORDER = 0x200, SWP_ASYNCWINDOWPOS = 0x4000;
  const uint WM_CLOSE = 0x0010, WM_RIOT_COMMAND = 0x8001;
  const int GWLP_HWNDPARENT = -8, GWL_EXSTYLE = -20, WS_EX_TOPMOST = 0x8, SW_MINIMIZE = 6, SW_SHOWNOACTIVATE = 4, RELEASE = 3;
  const int DWMWA_TRANSITIONS_FORCEDISABLED = 3, DWMWA_WINDOW_CORNER_PREFERENCE = 33;
  const uint GA_ROOT = 2, SRCCOPY = 0x00CC0020, CLR_INVALID = 0xFFFFFFFF;
  const double PANEL_X = 0.026, PANEL_Y = 0.5;
  const double BOX_X = 0.0417, BOX_Y = 0.5023;
  static uint mainThread = 0;
  static bool dimmed = false, boxSeen = false, formHidden = false, follow = false, lost = false, settledSeen = false;
  static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  static RECT settled;
  static IntPtr stilled = IntPtr.Zero, sensed = IntPtr.Zero;
  static int lastCorner = 0;
  static WinEventProc onEvent = OnEvent;
  static IntPtr chosen = IntPtr.Zero, hook = IntPtr.Zero, startHook = IntPtr.Zero, overlay = IntPtr.Zero, measured = IntPtr.Zero;
  static uint dragStart = 0;
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
    return "{\"target\":{\"id\":\"" + h.ToInt64() + "\",\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + (r.Right-r.Left) + ",\"height\":" + (r.Bottom-r.Top) + ",\"corner\":" + corner + (minimized ? ",\"minimized\":true" : "") + (dimmed ? ",\"dimmed\":true" : "") + (formHidden ? ",\"formHidden\":true" : "") + "}}";
  }
  static int Shade(uint[] colors) {
    if (colors == null || colors.Length == 0) return 0;
    int dark = 0, light = 0;
    foreach (uint color in colors) {
      if (color == CLR_INVALID) return 0;
      int red = (int)(color & 0xFF), green = (int)((color >> 8) & 0xFF), blue = (int)((color >> 16) & 0xFF);
      if (Math.Max(red, Math.Max(green, blue)) <= 140) dark++;
      else if (Math.Min(red, Math.Min(green, blue)) >= 230) light++;
    }
    return dark == colors.Length ? 1 : light == colors.Length ? -1 : 0;
  }
  static int Box(uint[] colors) {
    if (colors == null || colors.Length == 0) return 0;
    int box = 0, light = 0;
    foreach (uint color in colors) {
      if (color == CLR_INVALID) return 0;
      int red = (int)(color & 0xFF), green = (int)((color >> 8) & 0xFF), blue = (int)((color >> 16) & 0xFF);
      int high = Math.Max(red, Math.Max(green, blue)), low = Math.Min(red, Math.Min(green, blue));
      if (high <= 140) return 0;
      if (low >= 246) light++;
      else if ((low >= 205 && high <= 243 && high - low <= 12) || (red >= 150 && green <= 110 && blue <= 110)) box++;
    }
    return light == colors.Length ? -1 : box >= 3 ? 1 : 0;
  }
  static uint[] Sample(IntPtr h, RECT r, double x, double y) {
    POINT p = new POINT();
    p.X = r.Left + (int)Math.Round((r.Right - r.Left) * x);
    p.Y = r.Top + (int)Math.Round((r.Bottom - r.Top) * y);
    IntPtr root = GetAncestor(WindowFromPoint(p), GA_ROOT);
    if (root == IntPtr.Zero || root != h && (overlay == IntPtr.Zero || root != overlay)) return null;
    IntPtr screen = GetDC(IntPtr.Zero);
    if (screen == IntPtr.Zero) return null;
    IntPtr memory = IntPtr.Zero, bitmap = IntPtr.Zero, previous = IntPtr.Zero;
    try {
      memory = CreateCompatibleDC(screen);
      bitmap = CreateCompatibleBitmap(screen, 7, 7);
      if (memory == IntPtr.Zero || bitmap == IntPtr.Zero) return null;
      previous = SelectObject(memory, bitmap);
      if (!BitBlt(memory, 0, 0, 7, 7, screen, p.X - 3, p.Y - 3, SRCCOPY)) return null;
      var colors = new uint[9];
      for (int i = 0; i < 9; i++) colors[i] = GetPixel(memory, (i % 3) * 3, (i / 3) * 3);
      return colors;
    } finally {
      if (previous != IntPtr.Zero) SelectObject(memory, previous);
      if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
      if (memory != IntPtr.Zero) DeleteDC(memory);
      ReleaseDC(IntPtr.Zero, screen);
    }
  }
  static void Sense(IntPtr h) {
    if (h != sensed) { sensed = h; dimmed = false; boxSeen = false; formHidden = false; settledSeen = false; }
    RECT r;
    if (h == IntPtr.Zero || !Measure(h, out r) || !Settled(r)) return;
    int shade = Shade(Sample(h, r, PANEL_X, PANEL_Y));
    if (shade != 0) dimmed = shade > 0;
    if (!dimmed) Notice(Box(Sample(h, r, BOX_X, BOX_Y)));
  }
  static bool Settled(RECT r) {
    bool same = settledSeen && r.Left == settled.Left && r.Top == settled.Top && r.Right == settled.Right && r.Bottom == settled.Bottom;
    settled = r;
    settledSeen = true;
    return same;
  }
  static void Notice(int box) {
    if (box > 0) { boxSeen = true; formHidden = false; }
    else if (box < 0 && boxSeen) formHidden = true;
  }
  static bool Held() {
    uint pid, thread = GetWindowThreadProcessId(overlay, out pid);
    if (thread == 0) return false;
    var info = new GUITHREADINFO();
    info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    return GetGUIThreadInfo(thread, ref info) && info.hwndCapture == overlay;
  }
  static void Announce(IntPtr h) {
    if (!follow || overlay == IntPtr.Zero || dragStart == 0 || h == IntPtr.Zero || h != chosen) return;
    PostMessage(overlay, dragStart, h, IntPtr.Zero);
  }
  static void Follow(RECT r) {
    if (!follow || overlay == IntPtr.Zero || Held()) return;
    if (!SetWindowPos(overlay, IntPtr.Zero, r.Left, r.Top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE)) lost = true;
  }
  static string Describe(IntPtr h) {
    RECT r;
    if (h != IntPtr.Zero && Measure(h, out r)) { Follow(r); last = r; measured = h; lastCorner = Corner(h); return Format(h, r, false, lastCorner); }
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
  static bool Topmost(IntPtr h) {
    return (GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64() & WS_EX_TOPMOST) != 0;
  }
  static void Raise(IntPtr h) {
    if (overlay == IntPtr.Zero || h == IntPtr.Zero || !IsWindowVisible(overlay) || IsIconic(h)) return;
    bool pinned = Topmost(overlay) && !Topmost(h);
    if (!pinned && !Beneath(h)) return;
    if (pinned) SetWindowPos(overlay, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    IntPtr above = GetWindow(h, GW_HWNDPREV);
    if (above == overlay) return;
    SetWindowPos(overlay, above, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
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
    if (startHook != IntPtr.Zero) UnhookWinEvent(startHook);
    hook = IntPtr.Zero;
    startHook = IntPtr.Zero;
    hookedPid = pid;
    if (pid == 0) return;
    hook = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, onEvent, pid, 0, 0);
    if (follow) startHook = SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZESTART, IntPtr.Zero, onEvent, pid, 0, 0);
  }
  static void OnEvent(IntPtr eventHook, uint eventType, IntPtr h, int idObject, int idChild, uint thread, uint time) {
    if (h != chosen || idObject != 0 || idChild != 0) return;
    if (eventType == EVENT_SYSTEM_MOVESIZESTART) { Announce(h); return; }
    string line = Describe(h);
    if (line != lastLine) Write(line);
  }
  static void Poll() {
    chosen = Find();
    Attach(chosen);
    Still(chosen);
    Raise(chosen);
    Hook(chosen);
    Sense(chosen);
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
      SetWindowPos(riot, new IntPtr(-1), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      SetWindowPos(riot, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      Below(cards, riot);
      SetWindowLongPtr(cards, GWLP_HWNDPARENT, riot);
      if (!Beneath(riot) || !Topmost(GetWindow(riot, GW_HWNDPREV))) throw new InvalidOperationException("self-test-top-setup");
      Raise(riot);
      if (Topmost(cards) || GetWindow(riot, GW_HWNDPREV) != cards) throw new InvalidOperationException("self-test-top");
      SetWindowPos(cards, new IntPtr(-1), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      if (!Topmost(cards)) throw new InvalidOperationException("self-test-pin-setup");
      Raise(riot);
      if (Topmost(cards) || Topmost(riot) || GetWindow(riot, GW_HWNDPREV) != cards) throw new InvalidOperationException("self-test-unpin");
      SetWindowPos(riot, new IntPtr(-1), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      if (!Topmost(cards)) throw new InvalidOperationException("self-test-owner-pin-setup");
      Raise(riot);
      if (!Topmost(riot) || !Topmost(cards)) throw new InvalidOperationException("self-test-owner-pinned");
      SetWindowPos(riot, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      SetWindowLongPtr(cards, GWLP_HWNDPARENT, IntPtr.Zero);
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
      uint[] sample = new uint[9];
      for (int i = 0; i < 9; i++) sample[i] = 0x535353;
      if (Shade(sample) != 1) throw new InvalidOperationException("self-test-dimmed");
      for (int i = 0; i < 9; i++) sample[i] = 0xFCFCFC;
      if (Shade(sample) != -1) throw new InvalidOperationException("self-test-clear");
      sample[4] = 0x535353;
      if (Shade(sample) != 0 || Shade(null) != 0) throw new InvalidOperationException("self-test-mixed");
      sample[4] = CLR_INVALID;
      if (Shade(sample) != 0) throw new InvalidOperationException("self-test-invalid");
      for (int i = 0; i < 9; i++) sample[i] = 0xE9E9E9;
      if (Box(sample) != 1) throw new InvalidOperationException("self-test-box-off");
      for (int i = 0; i < 9; i++) sample[i] = i % 2 == 0 ? 0x3532D5u : 0xF9F9F9u;
      if (Box(sample) != 1) throw new InvalidOperationException("self-test-box-on");
      for (int i = 0; i < 9; i++) sample[i] = 0xFCFCFC;
      if (Box(sample) != -1) throw new InvalidOperationException("self-test-box-gone");
      sample[0] = 0xDCDCDC; sample[1] = 0xDCDCDC;
      if (Box(sample) != 0) throw new InvalidOperationException("self-test-box-few");
      sample[2] = 0x2A25BC;
      if (Box(sample) != 1) throw new InvalidOperationException("self-test-box-hover");
      sample[3] = 0x292929;
      if (Box(sample) != 0 || Box(null) != 0) throw new InvalidOperationException("self-test-box-dark");
      sample[3] = CLR_INVALID;
      if (Box(sample) != 0) throw new InvalidOperationException("self-test-box-invalid");
      RECT away = new RECT();
      away.Left = -20000; away.Top = -20000; away.Right = -19500; away.Bottom = -19600;
      if (Sample(riot, away, PANEL_X, PANEL_Y) != null || Sample(riot, away, BOX_X, BOX_Y) != null) throw new InvalidOperationException("self-test-unseen");
      RECT moved = away;
      moved.Left += 40; moved.Right += 40;
      settledSeen = false;
      if (Settled(away) || !Settled(away) || Settled(moved) || !Settled(moved) || Settled(away)) throw new InvalidOperationException("self-test-settle");
      Notice(-1);
      if (formHidden) throw new InvalidOperationException("self-test-form-unseen");
      Notice(1);
      Notice(0);
      if (!boxSeen || formHidden) throw new InvalidOperationException("self-test-form-seen");
      Notice(-1);
      Notice(0);
      if (!formHidden || !Format(riot, away, false, 0).EndsWith(",\"formHidden\":true}}")) throw new InvalidOperationException("self-test-form-hidden");
      Notice(1);
      if (formHidden || Format(riot, away, false, 0).Contains("formHidden")) throw new InvalidOperationException("self-test-form-back");
      dimmed = true;
      if (!Format(riot, away, false, 0).Contains(",\"dimmed\":true}")) throw new InvalidOperationException("self-test-format");
      formHidden = true;
      settledSeen = true;
      Sense(riot);
      if (dimmed || boxSeen || formHidden || settledSeen || sensed != riot) throw new InvalidOperationException("self-test-sense");
      dimmed = true; boxSeen = true; formHidden = true;
      Sense(riot);
      if (!dimmed || !boxSeen || !formHidden) throw new InvalidOperationException("self-test-keep");
      dimmed = false; boxSeen = false; formHidden = false;
      if (Format(riot, away, false, 0).Contains("dimmed")) throw new InvalidOperationException("self-test-plain");
      RECT spot = new RECT(), at;
      spot.Left = -20300; spot.Top = -20200; spot.Right = -19800; spot.Bottom = -19900;
      Follow(spot);
      if (lost || !GetWindowRect(cards, out at) || at.Left != -20000 || at.Top != -20000) throw new InvalidOperationException("self-test-follow-off");
      follow = true;
      Follow(spot);
      if (lost || !GetWindowRect(cards, out at) || at.Left != -20300 || at.Top != -20200 || at.Right - at.Left != 16 || at.Bottom - at.Top != 16) throw new InvalidOperationException("self-test-follow");
      if (!GetWindowRect(riot, out at) || at.Left != -20000 || at.Top != -20000) throw new InvalidOperationException("self-test-follow-riot");
      SetCapture(cards);
      if (Held()) {
        spot.Left = -20100; spot.Top = -20100;
        Follow(spot);
        if (lost || !GetWindowRect(cards, out at) || at.Left != -20300 || at.Top != -20200) throw new InvalidOperationException("self-test-follow-held");
      }
      ReleaseCapture();
      if (Held()) throw new InvalidOperationException("self-test-follow-released");
      spot.Left = -20100; spot.Top = -20100;
      Follow(spot);
      if (lost || !GetWindowRect(cards, out at) || at.Left != -20100 || at.Top != -20100) throw new InvalidOperationException("self-test-follow-after");
      dragStart = RegisterWindowMessage("Eclipse.RiotDragStart");
      MSG drag;
      chosen = IntPtr.Zero;
      Announce(riot);
      if (PeekMessage(out drag, cards, dragStart, dragStart, 1)) throw new InvalidOperationException("self-test-drag-other");
      chosen = riot;
      Announce(riot);
      if (!PeekMessage(out drag, cards, dragStart, dragStart, 1) || drag.wParam != riot) throw new InvalidOperationException("self-test-drag");
      follow = false;
      Announce(riot);
      if (PeekMessage(out drag, cards, dragStart, dragStart, 1)) throw new InvalidOperationException("self-test-drag-off");
      follow = true;
      Hook(riot);
      if (hook == IntPtr.Zero || startHook == IntPtr.Zero) throw new InvalidOperationException("self-test-hooks");
      Hook(IntPtr.Zero);
      if (hook != IntPtr.Zero || startHook != IntPtr.Zero || hookedPid != 0) throw new InvalidOperationException("self-test-unhook");
      follow = false;
      Hook(riot);
      if (hook == IntPtr.Zero || startHook != IntPtr.Zero) throw new InvalidOperationException("self-test-hooks-off");
      Hook(IntPtr.Zero);
      chosen = IntPtr.Zero;
      Apply(cards, 2);
      Pump();
      if (IsWindow(cards)) throw new InvalidOperationException("self-test-close");
      follow = true;
      Follow(spot);
      if (!lost) throw new InvalidOperationException("self-test-follow-lost");
      cards = IntPtr.Zero;
    } finally {
      Still(IntPtr.Zero);
      Hook(IntPtr.Zero);
      ReleaseCapture();
      chosen = IntPtr.Zero;
      dragStart = 0;
      follow = false;
      lost = false;
      dimmed = false;
      boxSeen = false;
      formHidden = false;
      settledSeen = false;
      sensed = IntPtr.Zero;
      overlay = IntPtr.Zero;
      if (cards != IntPtr.Zero) DestroyWindow(cards);
      if (riot != IntPtr.Zero) DestroyWindow(riot);
    }
  }
  public static void Run(string clientPath, int ownerPid, long overlayWindow, bool followOverlay) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    string root = Path.GetDirectoryName(Path.GetFullPath(clientPath));
    modern = Path.Combine(root, "RiotClientElectron", "Riot Client.exe");
    legacy = Path.Combine(root, "UX", "RiotClientUx.exe");
    Process owner = Process.GetProcessById(ownerPid);
    if (overlayWindow != 0) {
      overlay = new IntPtr(overlayWindow);
      uint overlayPid; GetWindowThreadProcessId(overlay, out overlayPid);
      if (overlayPid != (uint)ownerPid) throw new InvalidOperationException("invalid-overlay");
      follow = followOverlay;
      if (follow) dragStart = RegisterWindowMessage("Eclipse.RiotDragStart");
    }
    SetTimer(IntPtr.Zero, UIntPtr.Zero, 180, IntPtr.Zero);
    mainThread = GetCurrentThreadId();
    var listener = new System.Threading.Thread(Listen);
    listener.IsBackground = true;
    listener.Start();
    try {
      Poll();
      MSG m;
      while (!lost && GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {
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
      if (lost) throw new InvalidOperationException("follow-unavailable");
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
  [RiotWindowObserver]::Run([string]$req.clientPath, [int]$req.ownerPid, $overlay, [bool]$follow)
} catch {
  [Console]::Out.WriteLine('{"error":"observer-unavailable"}')
  exit 1
}
