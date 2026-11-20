$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  $req = [Console]::In.ReadLine() | ConvertFrom-Json
  if (-not $req) { throw 'invalid-request' }

  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class RiotWindowHelper {
  const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80;

  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static string ClassName(IntPtr h) {
    var name = new StringBuilder(256); GetClassName(h, name, name.Capacity);
    return name.ToString();
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

  static bool RootWindow(IntPtr h) { return h != IntPtr.Zero && GetAncestor(h, 2) == h; }

  static bool ClientInterface(string name) {
    return String.Equals(name, "Riot Client", StringComparison.OrdinalIgnoreCase)
      || String.Equals(name, "RiotClientUx", StringComparison.OrdinalIgnoreCase);
  }

  static bool ActivationCandidate(string process, string className, int width, int height, bool root) {
    return root && !String.Equals(className, "TrayIconClass", StringComparison.OrdinalIgnoreCase)
      && width >= 320 && height >= 240 && ClientInterface(process);
  }

  static bool GameProcess(string game, string name) {
    string[] names;
    switch (game) {
      case "val": names = new[] { "VALORANT-Win64-Shipping", "VALORANT" }; break;
      case "tft": names = new[] { "TFTClient-Win64-Shipping", "TFTClient" }; break;
      case "2xko": names = new[] { "Lion-Win64-Shipping", "Lion" }; break;
      case "lor": names = new[] { "LoR" }; break;
      default: names = new[] { "LeagueClientUx", "League of Legends" }; break;
    }
    foreach (string candidate in names)
      if (name.Equals(candidate, StringComparison.OrdinalIgnoreCase)) return true;
    return false;
  }

  public static void Reveal() {
    IntPtr main = IntPtr.Zero;
    long best = 0;
    EnumWindows((h, l) => {
      RECT rect; GetWindowRect(h, out rect);
      int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
      if (!ActivationCandidate(ProcessName(h), ClassName(h), width, height, RootWindow(h))) return true;
      var text = new StringBuilder(256); GetWindowText(h, text, text.Capacity);
      if (text.Length == 0) return true;
      long score = (long)width * height + (text.ToString().Equals("Riot Client", StringComparison.OrdinalIgnoreCase) ? 100000000 : 0);
      if (score > best) { best = score; main = h; }
      return true;
    }, IntPtr.Zero);
    if (main == IntPtr.Zero) return;
    ShowWindowAsync(main, IsIconic(main) ? 9 : 5);
    SetForegroundWindow(main);
  }

  public static void CloseClientWindows() {
    EnumWindows((h, l) => {
      if (RootWindow(h) && ClientInterface(ProcessName(h))) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
  }

  public static bool GameWindow(string game) {
    if (game != "lol" && game != "tft" && game != "val" && game != "2xko" && game != "lor")
      throw new ArgumentException("invalid-game");
    bool found = false;
    EnumWindows((h, l) => {
      if (!RootWindow(h) || !IsWindowVisible(h) || IsIconic(h)) return true;
      RECT rect; GetWindowRect(h, out rect);
      if (rect.Right - rect.Left < 160 || rect.Bottom - rect.Top < 120) return true;
      if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      found = GameProcess(game, ProcessName(h));
      return !found;
    }, IntPtr.Zero);
    return found;
  }

  public static void SelfTest() {
    if (!ActivationCandidate("Riot Client", "Chrome_WidgetWin_1", 1536, 864, true)
        || !ActivationCandidate("RiotClientUx", "Chrome_WidgetWin_1", 1536, 864, true)
        || ActivationCandidate("RiotClientServices", "TrayIconClass", 400, 430, true)
        || ActivationCandidate("Riot Client", "TrayIconClass", 1536, 864, true)
        || ActivationCandidate("Riot Client", "IME", 0, 0, true)
        || ActivationCandidate("RiotClientServices", "Chrome_WidgetWin_1", 1536, 864, true)
        || ActivationCandidate("LeagueClientUx", "Chrome_WidgetWin_1", 1536, 864, true)
        || ActivationCandidate("Riot Client", "Chrome_WidgetWin_1", 1536, 864, false))
      throw new InvalidOperationException("activation-filter-test-failed");
    if (!ClientInterface("riot client") || !ClientInterface("RiotClientUx") || ClientInterface("RiotClientUxRender")
        || ClientInterface("RiotClientServices") || ClientInterface("LeagueClientUx") || ClientInterface("VALORANT"))
      throw new InvalidOperationException("process-filter-test-failed");
    if (!GameProcess("lol", "LeagueClientUx") || !GameProcess("tft", "TFTClient-Win64-Shipping") || !GameProcess("val", "VALORANT-Win64-Shipping")
        || !GameProcess("2xko", "Lion-Win64-Shipping") || !GameProcess("lor", "LoR")
        || GameProcess("lol", "VALORANT") || GameProcess("val", "LeagueClientUx") || GameProcess("lol", "Riot Client")
        || GameProcess("tft", "League of Legends") || GameProcess("lor", "Lion") || GameProcess("2xko", "LoR"))
      throw new InvalidOperationException("game-filter-test-failed");
    bool rejected = false;
    try { GameWindow("lol\nreveal"); } catch (ArgumentException) { rejected = true; }
    if (!rejected) throw new InvalidOperationException("game-name-test-failed");
  }
}
'@

  if ($req.action -isnot [string]) { throw 'invalid-action' }

  switch ($req.action) {
    'reveal' { [RiotWindowHelper]::Reveal() }
    'close-client' { [RiotWindowHelper]::CloseClientWindows() }
    'game-window' {
      if ([RiotWindowHelper]::GameWindow([string]$req.game)) { [Console]::Out.WriteLine('game-ready') }
    }
    'self-test' { [RiotWindowHelper]::SelfTest() }
    default { throw 'invalid-action' }
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
