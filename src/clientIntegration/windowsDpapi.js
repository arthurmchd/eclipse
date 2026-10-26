const { execFile } = require('child_process');

// Inter-process tokens must use Windows DPAPI directly. Electron safeStorage
// can use a profile key, and our UI intentionally has a separate profile.
const POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.value -isnot [string] -or $request.value.Length -gt 32768) { throw 'invalid' }
  $entropy = [Text.Encoding]::UTF8.GetBytes('RiotAccountManager.LocalBridge.v1')
  if ($request.action -eq 'protect') {
    $bytes = [Text.Encoding]::UTF8.GetBytes($request.value)
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $value = [Convert]::ToBase64String($encrypted)
  } elseif ($request.action -eq 'unprotect') {
    $bytes = [Convert]::FromBase64String($request.value)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $value = [Text.Encoding]::UTF8.GetString($plain)
  } else { throw 'invalid' }
  [Console]::Out.WriteLine((@{ok=$true;value=$value} | ConvertTo-Json -Compress))
  exit 0
} catch {
  [Console]::Out.WriteLine('{"ok":false}')
  exit 1
}
`;
const encodedCommand = Buffer.from(POWERSHELL, 'utf16le').toString('base64');

function transform(action, value) {
  if (typeof value !== 'string' || !value || value.length > 32768) return Promise.reject(new Error('Invalid protected connection token'));
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('Windows could not protect or open the local connection token'));
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
      windowsHide: true, timeout: 6000, maxBuffer: 65536, encoding: 'utf8',
    }, (error, output) => {
      if (error) { fail(); return; }
      try {
        const result = JSON.parse(output.trim());
        if (result.ok !== true || typeof result.value !== 'string' || !result.value || result.value.length > 32768) throw new Error();
        resolve(result.value);
      } catch { fail(); }
    });
    child.stdin.on('error', fail);
    child.stdin.end(JSON.stringify({ action, value }));
  });
}

module.exports = {
  protectString: (value) => transform('protect', value),
  unprotectString: (value) => transform('unprotect', value),
  encodedCommand,
};
