$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  try { $req = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { throw 'invalid-request' }
  if (-not $req -or $req.action -notin @('type', 'self-test')) { throw 'invalid-action' }

  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class RiotWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT point);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);

  const uint WM_MOUSEMOVE = 0x200, WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202;
  const uint WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_CHAR = 0x102;

  static IntPtr Point(int x, int y) { return (IntPtr)((y << 16) | (x & 0xFFFF)); }
  static void Post(IntPtr h, uint message, IntPtr w, IntPtr l) {
    if (!IsWindow(h) || !PostMessage(h, message, w, l))
      throw new InvalidOperationException("input-failed");
  }

  public static void Click(IntPtr h, double fx, double fy) {
    RECT rect;
    if (!GetClientRect(h, out rect) || rect.Right <= 0 || rect.Bottom <= 0)
      throw new InvalidOperationException("window-not-found");
    IntPtr point = Point((int)(rect.Right * fx), (int)(rect.Bottom * fy));
    Post(h, WM_MOUSEMOVE, IntPtr.Zero, point);
    Post(h, WM_LBUTTONDOWN, (IntPtr)1, point);
    Thread.Sleep(40);
    Post(h, WM_LBUTTONUP, IntPtr.Zero, point);
    Thread.Sleep(300);
  }

  static void Key(IntPtr h, int code, int scan) {
    Post(h, WM_KEYDOWN, (IntPtr)code, (IntPtr)(1 | (scan << 16)));
    if (code == 8) Post(h, WM_CHAR, (IntPtr)8, (IntPtr)(1 | (scan << 16)));
    Post(h, WM_KEYUP, (IntPtr)code, (IntPtr)unchecked((int)(0xC0000001u | ((uint)scan << 16))));
  }

  public static void ClearField(IntPtr h) {
    Key(h, 0x23, 0x4F);
    Thread.Sleep(100);
    for (int i = 0; i < 256; i++) { Key(h, 8, 0x0E); Thread.Sleep(3); }
    Thread.Sleep(200);
  }

  public static void Type(IntPtr h, string text) {
    foreach (char character in text) {
      Post(h, WM_CHAR, (IntPtr)character, (IntPtr)1);
      Thread.Sleep(35);
    }
  }

  public static IntPtr FindHidden(uint[] pids) {
    IntPtr found = IntPtr.Zero;
    long best = 0;
    EnumWindows((h, l) => {
      if (GetAncestor(h, 2) != h) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) < 0) return true;
      RECT rect;
      if (!GetClientRect(h, out rect) || rect.Right < 500 || rect.Bottom < 300) return true;
      var title = new StringBuilder(256); GetWindowText(h, title, title.Capacity);
      long score = (long)rect.Right * rect.Bottom + (title.Length > 0 ? 100000000 : 0);
      if (score > best) { found = h; best = score; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static void SelfTest() {
    if (Point(123, 456).ToInt64() != ((456 << 16) | 123))
      throw new InvalidOperationException("point-test-failed");
  }
}
'@

  $USERNAME = @(0.130, 0.303)
  $PASSWORD = @(0.130, 0.377)
  $REMEMBER = @(0.0417, 0.5023)
  $SUBMIT = @(0.1302, 0.7894)
  $PANEL = @(0.026, 0.5)

  function Find-RiotWindowEvenHidden {
    $riotPids = [uint32[]]@(Get-Process -Name 'Riot Client', 'RiotClientUx' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    if (-not $riotPids.Count) { return $null }
    $window = [RiotWindow]::FindHidden($riotPids)
    if ($window -ne [IntPtr]::Zero) { return $window }
    return $null
  }

  function Read-Shot($bitmap, $frame) {
    $pixels = @{}
    foreach ($point in @($PANEL, $USERNAME, $PASSWORD)) {
      $pixels["$point"] = $bitmap.GetPixel($frame.Left + [int]($frame.Width * $point[0]), $frame.Top + [int]($frame.Height * $point[1]))
    }
    $x = $frame.Left + [int]($frame.Width * $REMEMBER[0]); $y = $frame.Top + [int]($frame.Height * $REMEMBER[1])
    $rememberPixels = @()
    foreach ($dx in @(-4, -2, 0, 2, 4)) {
      foreach ($dy in @(-4, -2, 0, 2, 4)) {
        $rememberPixels += $bitmap.GetPixel($x + $dx, $y + $dy)
      }
    }
    return @{ Width = $frame.Width; Height = $frame.Height; Pixels = $pixels; RememberPixels = $rememberPixels }
  }

  function Get-WindowPixels($hwnd) {
    $rect = New-Object RiotWindow+RECT
    $client = New-Object RiotWindow+RECT
    $origin = New-Object RiotWindow+POINT
    if (-not [RiotWindow]::GetWindowRect($hwnd, [ref]$rect) -or -not [RiotWindow]::GetClientRect($hwnd, [ref]$client) -or -not [RiotWindow]::ClientToScreen($hwnd, [ref]$origin)) { return $null }
    $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0 -or $width -gt 10000 -or $height -gt 10000) { return $null }
    $frame = @{ Left = $origin.X - $rect.Left; Top = $origin.Y - $rect.Top; Width = $client.Right; Height = $client.Bottom }
    if ($frame.Width -le 0 -or $frame.Height -le 0 -or $frame.Left -lt 0 -or $frame.Top -lt 0 -or $frame.Left + $frame.Width -gt $width -or $frame.Top + $frame.Height -gt $height) { return $null }
    $bitmap = $null; $graphics = $null; $dc = [IntPtr]::Zero
    try {
      $bitmap = New-Object System.Drawing.Bitmap $width, $height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $dc = $graphics.GetHdc()
      if (-not [RiotWindow]::PrintWindow($hwnd, $dc, 2)) { return $null }
      $graphics.ReleaseHdc($dc); $dc = [IntPtr]::Zero
      return Read-Shot $bitmap $frame
    } catch {
      return $null
    } finally {
      if ($dc -ne [IntPtr]::Zero -and $graphics) { $graphics.ReleaseHdc($dc) }
      if ($graphics) { $graphics.Dispose() }
      if ($bitmap) { $bitmap.Dispose() }
    }
  }

  function Test-Light($color, $min) {
    return $null -ne $color -and $color.R -ge $min -and $color.G -ge $min -and $color.B -ge $min
  }

  function Get-RememberState($shot) {
    if (-not $shot -or $shot.RememberPixels.Count -lt 25) { return 'unknown' }
    $red = 0; $gray = 0
    foreach ($color in $shot.RememberPixels) {
      $high = [Math]::Max([int]$color.R, [Math]::Max([int]$color.G, [int]$color.B))
      $low = [Math]::Min([int]$color.R, [Math]::Min([int]$color.G, [int]$color.B))
      if ($high -le 140) { return 'unknown' }
      if ($color.R -ge 150 -and $color.G -le 110 -and $color.B -le 110) { $red++ }
      elseif ($low -ge 205 -and $high -le 243 -and $high - $low -le 12) { $gray++ }
    }
    if ($red -ge 10 -and $gray -eq 0) { return 'on' }
    if ($gray -ge 20 -and $red -eq 0) { return 'off' }
    return 'unknown'
  }

  function Test-FormReady($hwnd) {
    $shot = Get-WindowPixels $hwnd
    if (-not $shot) { return $false }
    $ratio = $shot.Width / $shot.Height
    if ($ratio -lt 1.6 -or $ratio -gt 1.95) { return $false }
    return (Test-Light $shot.Pixels["$PANEL"] 240) -and
      (Test-Light $shot.Pixels["$USERNAME"] 220) -and
      (Test-Light $shot.Pixels["$PASSWORD"] 220)
  }

  if ($req.action -eq 'self-test') {
    [RiotWindow]::SelfTest()
    $background = [System.Drawing.Color]::FromArgb(252, 252, 252)
    $gray = [System.Drawing.Color]::FromArgb(233, 233, 233)
    $grayHover = [System.Drawing.Color]::FromArgb(220, 220, 220)
    $red = [System.Drawing.Color]::FromArgb(213, 50, 53)
    $redHover = [System.Drawing.Color]::FromArgb(188, 37, 42)
    $mark = [System.Drawing.Color]::FromArgb(249, 249, 249)
    $dark = [System.Drawing.Color]::FromArgb(40, 40, 40)
    $unclear = [System.Drawing.Color]::FromArgb(150, 150, 150)
    function Assert-Remember($pixels, $expected) {
      if ((Get-RememberState @{ RememberPixels = $pixels }) -ne $expected) { throw 'checkbox-test-failed' }
    }
    Assert-Remember (@($gray) * 25) 'off'
    Assert-Remember (@($grayHover) * 25) 'off'
    Assert-Remember (@($red) * 20 + @($mark) * 5) 'on'
    Assert-Remember (@($redHover) * 20 + @($mark) * 5) 'on'
    Assert-Remember (@($background) * 25) 'unknown'
    Assert-Remember (@($gray) * 19 + @($background) * 6) 'unknown'
    Assert-Remember (@($red) * 9 + @($mark) * 16) 'unknown'
    Assert-Remember (@($red) * 12 + @($gray) * 13) 'unknown'
    Assert-Remember (@($dark) * 20 + @($mark) * 5) 'unknown'
    Assert-Remember (@($gray) * 24 + @($dark)) 'unknown'
    Assert-Remember (@($unclear) * 25) 'unknown'
    $bitmap = New-Object System.Drawing.Bitmap 416, 308
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $brush = New-Object System.Drawing.SolidBrush $red
    try {
      $graphics.Clear($background)
      $frame = @{ Left = 8; Top = 0; Width = 400; Height = 300 }
      $x = $frame.Left + [int]($frame.Width * $REMEMBER[0]); $y = $frame.Top + [int]($frame.Height * $REMEMBER[1])
      $graphics.FillRectangle($brush, $x - 6, $y - 6, 13, 13)
      if ((Get-RememberState (Read-Shot $bitmap $frame)) -ne 'on') { throw 'checkbox-test-failed' }
      if ((Get-RememberState (Read-Shot $bitmap @{ Left = 0; Top = 0; Width = 416; Height = 308 })) -ne 'unknown') { throw 'checkbox-test-failed' }
    } finally {
      $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    }
    [Console]::Out.WriteLine('ok')
    exit 0
  }

  if ($req.username -isnot [string] -or -not $req.username -or
      $req.password -isnot [string] -or -not $req.password -or
      $req.username.Length -gt 256 -or $req.password.Length -gt 256 -or
      $req.username -match '[\r\n\x00]' -or $req.password -match '[\r\n\x00]') { throw 'invalid-credentials' }

  [RiotWindow]::SetProcessDPIAware() | Out-Null
  $hwnd = $null; $lastWindow = [IntPtr]::Zero; $readyCount = 0
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $hwnd = Find-RiotWindowEvenHidden
    if ($hwnd -and $hwnd -eq $lastWindow -and (Test-FormReady $hwnd)) { $readyCount++ } else { $readyCount = 0 }
    if ($hwnd) { $lastWindow = $hwnd } else { $lastWindow = [IntPtr]::Zero }
    if ($readyCount -ge 4) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $hwnd) { throw 'window-not-found' }
  if ($readyCount -lt 4) { throw 'form-not-ready' }

  [RiotWindow]::Click($hwnd, $USERNAME[0], $USERNAME[1])
  [RiotWindow]::ClearField($hwnd)
  [RiotWindow]::Type($hwnd, $req.username)
  [RiotWindow]::Click($hwnd, $PASSWORD[0], $PASSWORD[1])
  [RiotWindow]::ClearField($hwnd)
  [RiotWindow]::Type($hwnd, $req.password)

  $wantedRemember = if ($req.remember -eq $true) { 'on' } else { 'off' }
  $rememberState = Get-RememberState (Get-WindowPixels $hwnd)
  if ($rememberState -ne 'unknown' -and $rememberState -ne $wantedRemember) {
    [RiotWindow]::Click($hwnd, $REMEMBER[0], $REMEMBER[1])
    $rememberState = Get-RememberState (Get-WindowPixels $hwnd)
  }
  [Console]::Out.WriteLine("remember:$rememberState")

  if ($req.submit) { [RiotWindow]::Click($hwnd, $SUBMIT[0], $SUBMIT[1]) }
  [Console]::Out.WriteLine('ok')
  [Console]::Out.Flush()
  exit 0
} catch {
  $reason = $_.Exception.GetBaseException().Message
  if ($reason -notin @('invalid-request', 'invalid-action', 'invalid-credentials', 'window-not-found', 'form-not-ready', 'input-failed', 'point-test-failed', 'checkbox-test-failed')) {
    $reason = 'window-script-failed'
  }
  [Console]::Out.WriteLine("error:$reason")
  [Console]::Out.Flush()
  exit 1
}
