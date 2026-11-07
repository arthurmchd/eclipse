const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { windowsHelper } = require('../../../src/paths');

test('the login helper recognizes the Riot v142 Stay signed in box by its colors, reads it where it clicks and never touches a window in its self-test', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsHelper('login.ps1')], {
      windowsHide: true, encoding: 'utf8', timeout: 45000, maxBuffer: 65536,
    }, (error, stdout) => error && typeof error.code !== 'number' ? reject(error) : resolve({ code: error?.code || 0, output: stdout.trim() }));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ action: 'self-test' }));
  });
  assert.deepEqual(result, { code: 0, output: 'ok' });
});

test('the login helper reads every pixel inside the client area, the same frame its clicks use', () => {
  const source = fs.readFileSync(windowsHelper('login.ps1'), 'utf8');
  assert.match(source, /ClientToScreen\(\$hwnd, \[ref\]\$origin\)/);
  assert.match(source, /\$frame = @\{ Left = \$origin\.X - \$rect\.Left; Top = \$origin\.Y - \$rect\.Top; Width = \$client\.Right; Height = \$client\.Bottom \}/);
  assert.equal((source.match(/\$bitmap\.GetPixel\(/g) || []).length, 2);
  assert.equal((source.match(/\$bitmap\.GetPixel\(\$frame\.Left \+ /g) || []).length, 1);
  assert.match(source, /\$x = \$frame\.Left \+ \[int\]\(\$frame\.Width \* \$REMEMBER\[0\]\); \$y = \$frame\.Top \+ \[int\]\(\$frame\.Height \* \$REMEMBER\[1\]\)/);
  assert.match(source, /IntPtr point = Point\(\(int\)\(rect\.Right \* fx\), \(int\)\(rect\.Bottom \* fy\)\);/);
});
