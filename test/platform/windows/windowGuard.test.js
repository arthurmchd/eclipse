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

const windows = { skip: process.platform !== 'win32', timeout: 15000 };

test('the window helper self-tests its window, process and game filters without touching desktop windows', windows, async () => {
  assert.deepEqual(await request({ action: 'self-test' }), { code: 0, output: 'ok' });
});

test('the window helper refuses the old persistent monitor and its hiding actions', windows, async () => {
  for (const input of [{ ownerPid: 1, initialMode: 'hide' }, { action: 'watch', ownerPid: 1 }, { action: 'park' }, { action: 'restore' }, { action: 'hide-auxiliary' }, { action: 'inspect' }]) {
    assert.deepEqual(await request(input), { code: 1, output: 'error:invalid-action' });
  }
});

test('the window helper refuses an unknown game before looking at desktop windows', windows, async () => {
  assert.deepEqual(await request({ action: 'game-window', game: 'lol\nreveal' }), { code: 1, output: 'error:invalid-game' });
  assert.deepEqual(await request({ action: ['self-test', 'close-client'] }), { code: 1, output: 'error:invalid-action' });
});
