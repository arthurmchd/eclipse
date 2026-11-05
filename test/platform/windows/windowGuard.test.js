const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

function request(input) {
  const script = path.join(__dirname, '..', '..', '..', 'src', 'platform', 'windows', 'windowGuard.ps1');
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, encoding: 'utf8', timeout: 12000, maxBuffer: 65536,
    }, (error, stdout) => error && error.code !== 1 ? reject(error) : resolve({ code: error?.code || 0, output: stdout.trim() }));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(input) + '\n');
  });
}

test('Windows guard self-tests rejection of tray and auxiliary activation, restoration, bounded workers and callbacks without touching desktop windows', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  assert.deepEqual(await request({ action: 'self-test' }), { code: 0, output: 'ok' });
});

test('Windows guard rejects an invalid initial mode before inspecting processes or desktop windows', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  assert.deepEqual(await request({ ownerPid: 1, initialMode: 'reveal' }), { code: 1, output: 'error:invalid-mode' });
});

test('Windows guard rejects invalid restore activation before touching desktop windows', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  assert.deepEqual(await request({ action: 'restore', activate: 'no' }), { code: 1, output: 'error:invalid-activation' });
});
