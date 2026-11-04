$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $req = [Console]::In.ReadLine() | ConvertFrom-Json
  if (-not $req -or $req.ownerPid -le 0 -or -not [IO.Path]::IsPathRooted($req.clientPath)) { throw 'invalid-request' }
  $overlay = 0L
  if ($null -ne $req.overlayWindow) {
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
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc callback, uint pid, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr h, UIntPtr id, uint ms, IntPtr callback);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B, WM_TIMER = 0x0113, GW_OWNER = 4;
  const int GWLP_HWNDPARENT = -8;
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
  static string Format(IntPtr h, RECT r, bool minimized) {
    return "{\"target\":{\"id\":\"" + h.ToInt64() + "\",\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + (r.Right-r.Left) + ",\"height\":" + (r.Bottom-r.Top) + (minimized ? ",\"minimized\":true" : "") + "}}";
  }
  static string Describe(IntPtr h) {
    RECT r;
    if (h != IntPtr.Zero && Measure(h, out r)) { last = r; measured = h; return Format(h, r, false); }
    if (Minimized(h)) return Format(h, last, true);
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
    Hook(chosen);
    Write(Describe(chosen));
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
    Poll();
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {
      if (m.message == WM_TIMER && m.hwnd == IntPtr.Zero) {
        owner.Refresh();
        if (owner.HasExited) return;
        Poll();
        continue;
      }
      TranslateMessage(ref m);
      DispatchMessage(ref m);
    }
  }
}
'@
  [RiotWindowObserver]::Run([string]$req.clientPath, [int]$req.ownerPid, $overlay)
} catch {
  [Console]::Out.WriteLine('{"error":"observer-unavailable"}')
  exit 1
}
