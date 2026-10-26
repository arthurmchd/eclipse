const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

test('Windows guard compiles and self-tests bounded workers and queued callbacks without touching desktop windows', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const script = path.join(__dirname, '..', 'src', 'windowGuard.ps1');
  const output = await new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, encoding: 'utf8', timeout: 12000, maxBuffer: 65536,
    }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    child.stdin.on('error', reject);
    child.stdin.end('{"action":"self-test"}\n');
  });
  assert.equal(output, 'ok');
});
