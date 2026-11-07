const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createWindowController } = require('../../../src/platform/windows/windowController');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, { timeoutMs = 300, closeOnEnd = true, closeOnKill = true } = {}) {
  const children = [];
  const calls = [];
  const spawn = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.input = [];
    child.kills = 0;
    child.exited = false;
    let partial = '';
    child.stdin.on('data', (data) => {
      partial += data.toString();
      const lines = partial.split('\n');
      partial = lines.pop();
      child.input.push(...lines);
    });
    child.request = () => JSON.parse(child.input[0]);
    child.reply = (line) => child.stdout.write(`${line}\n`);
    child.close = (code = 0) => {
      if (child.exited) return;
      child.exited = true;
      if (code === 0) child.reply('ok');
      setImmediate(() => child.emit('close', code));
    };
    child.kill = () => {
      child.kills++;
      if (closeOnKill) child.close(1);
      return true;
    };
    child.stdin.on('finish', () => {
      if (closeOnEnd) queueMicrotask(() => child.close());
    });
    children.push(child);
    return child;
  };
  const controller = createWindowController({ spawn, timeoutMs, scriptPath: 'C:/Example/windowGuard.ps1' });
  t.after(async () => {
    for (const child of children) child.close();
    await controller.stop();
  });
  return { controller, children, calls };
}

test('the controller only offers one-shot window actions, with no hiding or persistent monitor', (t) => {
  const f = fixture(t);
  assert.deepEqual(Object.keys(f.controller).sort(), ['closeClient', 'gameWindow', 'reveal', 'stop']);
  assert.equal(f.children.length, 0);
});

test('reveal runs a hidden one-shot helper that brings the Riot to the front', async (t) => {
  const f = fixture(t);
  assert.equal(await f.controller.reveal(), undefined);
  assert.equal(f.children.length, 1);
  assert.deepEqual(f.children[0].request(), { action: 'reveal' });
  assert.equal(f.children[0].input.length, 1);
  assert.equal(f.children[0].stdin.writableEnded, true);
  assert.equal(f.calls[0][0], 'powershell.exe');
  assert.deepEqual(f.calls[0][1], ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:/Example/windowGuard.ps1']);
  assert.equal(f.calls[0][2].windowsHide, true);
});

test('closeClient uses the dedicated window-close helper without killing game processes', async (t) => {
  const f = fixture(t);
  await f.controller.closeClient();
  assert.deepEqual(f.children[0].request(), { action: 'close-client' });
  assert.equal(f.children[0].kills, 0);
});

for (const [answer, ready] of [['game-ready', true], [null, false]]) {
  test(`game-window answers ${ready} from a one-shot helper`, async (t) => {
    const f = fixture(t, { closeOnEnd: false });
    const result = f.controller.gameWindow('tft');
    await flush();
    const child = f.children[0];
    assert.deepEqual(child.request(), { action: 'game-window', game: 'tft' });
    assert.equal(child.stdin.writableEnded, true);
    if (answer) child.stdout.write(`${answer}\r\n`);
    child.close();
    assert.equal(await result, ready);
  });
}

test('game names cannot inject additional helper actions', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.controller.gameWindow('lol\nreveal'), /Invalid game/);
  await assert.rejects(f.controller.gameWindow('reveal'), /Invalid game/);
  assert.equal(f.children.length, 0);
});

test('helpers run one at a time', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const revealing = f.controller.reveal();
  const checking = f.controller.gameWindow('val');
  await flush();
  assert.equal(f.children.length, 1);
  f.children[0].close();
  await revealing;
  await flush();
  assert.equal(f.children.length, 2);
  assert.deepEqual(f.children[1].request(), { action: 'game-window', game: 'val' });
  f.children[1].reply('game-ready');
  f.children[1].close();
  assert.equal(await checking, true);
});

test('a helper error is reported only with a fixed vocabulary', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const denied = assert.rejects(f.controller.reveal(), (error) => error.message === 'Background window guard: invalid-game');
  await flush();
  f.children[0].reply('error:invalid-game');
  f.children[0].close(1);
  await denied;
  const leaked = assert.rejects(f.controller.closeClient(), (error) => error.message === 'Background window guard: unknown');
  await flush();
  f.children[1].reply('error:Access to C:\\Users\\private\\file was denied');
  f.children[1].close(1);
  await leaked;
});

test('a helper that exits without confirming fails with its exit code', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const failing = assert.rejects(f.controller.reveal(), /guard stopped \(3\): helper error/);
  await flush();
  f.children[0].stderr.write('boom');
  await flush();
  f.children[0].close(3);
  await failing;
  const silent = assert.rejects(f.controller.reveal(), /guard stopped \(0\)$/);
  await flush();
  f.children[1].exited = true;
  f.children[1].emit('close', 0);
  await silent;
});

test('one-shot timeout rejects even if killing the helper emits no close event', async (t) => {
  const f = fixture(t, { timeoutMs: 20, closeOnEnd: false, closeOnKill: false });
  await assert.rejects(f.controller.reveal(), /helper timed out/);
  assert.equal(f.children[0].kills, 1);
  f.children[0].close();
  await f.controller.reveal().catch(() => {});
  assert.equal(f.children.length, 2);
});

test('spawn errors reject without leaving an unhandled rejection', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const rejection = assert.rejects(f.controller.reveal(), /spawn denied/);
  await flush();
  f.children[0].emit('error', new Error('spawn denied'));
  await rejection;
  f.children[0].close();
  await flush();
});

test('stop waits for the running helper and then refuses new actions', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const revealing = f.controller.reveal();
  await flush();
  let stopped = false;
  const stopping = f.controller.stop().then(() => { stopped = true; });
  await flush();
  assert.equal(stopped, false);
  f.children[0].close();
  await revealing;
  await stopping;
  await assert.rejects(f.controller.reveal(), /shutting down/);
  await assert.rejects(f.controller.closeClient(), /shutting down/);
  await assert.rejects(f.controller.gameWindow('lol'), /shutting down/);
  await f.controller.stop();
  assert.equal(f.children.length, 1);
});
