const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createWindowController } = require('../../../src/platform/windows/windowController');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };

function fixture(t, { timeoutMs = 300, closeOnEnd = true, closeOnKill = true, maxRecoveries = 3 } = {}) {
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
      for (const line of lines) {
        try {
          const request = JSON.parse(line);
          if (request.action === 'restore' && request.activate === false) queueMicrotask(() => child.close());
        } catch {}
      }
    });
    child.reply = (line) => child.stdout.write(`${line}\n`);
    child.close = (code = 0) => {
      if (child.exited) return;
      child.exited = true;
      if (code === 0) child.reply('ok');
      child.emit('close', code);
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
  const controller = createWindowController({ spawn, timeoutMs, maxRecoveries, scriptPath: 'C:/Example/windowGuard.ps1' });
  t.after(async () => {
    for (const child of children) child.close();
    await controller.stop();
  });
  return { controller, children, calls };
}

async function readyGuard(f) {
  const hiding = f.controller.hide();
  await flush();
  const child = f.children[0];
  child.reply('ready');
  await flush();
  child.reply('command:hide');
  await hiding;
  return child;
}

test('closeClient uses the dedicated window-close helper without killing game processes', async (t) => {
  const f = fixture(t);
  await f.controller.closeClient();
  assert.deepEqual(JSON.parse(f.children[0].input[0]), { action: 'close-client' });
  assert.equal(f.calls[0][0], 'powershell.exe');
});

test('park releases monitoring without revealing Riot and a later launch can arm it again', async (t) => {
  const f = fixture(t);
  const child = await readyGuard(f);
  const parked = f.controller.park();
  await flush();
  assert.equal(child.input.at(-1), 'park');
  child.reply('command:park');
  await parked;
  const hiding = f.controller.hide();
  await flush();
  child.reply('command:hide');
  await hiding;
  assert.equal(f.children.length, 1);
});

test('hide waits for guard readiness and its command acknowledgement', async (t) => {
  const f = fixture(t);
  let settled = false;
  const hiding = f.controller.hide().then(() => { settled = true; });
  await flush();
  assert.equal(f.children.length, 1);
  const child = f.children[0];
  assert.deepEqual(JSON.parse(child.input[0]), { ownerPid: process.pid, initialMode: 'hide' });
  assert.equal(child.input.length, 1);
  assert.equal(f.calls[0][0], 'powershell.exe');
  assert.equal(f.calls[0][2].windowsHide, true);
  child.stdout.write('rea');
  await flush();
  assert.equal(child.input.length, 1);
  child.stdout.write('dy\r\n');
  await flush();
  assert.equal(child.input[1], 'hide');
  assert.equal(settled, false);
  child.reply('command:hide');
  await hiding;
  assert.equal(settled, true);
});

test('concurrent commands are serialized and share one persistent guard', async (t) => {
  const f = fixture(t);
  const hiding = f.controller.hide();
  const concealing = f.controller.conceal();
  const revealing = f.controller.reveal();
  await flush();
  const child = f.children[0];
  child.reply('ready');
  await flush();
  assert.deepEqual(child.input.slice(1), ['hide']);
  child.reply('command:hide');
  await hiding;
  await flush();
  assert.deepEqual(child.input.slice(1), ['hide', 'conceal']);
  child.reply('command:conceal');
  await concealing;
  await flush();
  assert.deepEqual(child.input.slice(1), ['hide', 'conceal', 'reveal']);
  child.reply('command:reveal');
  await revealing;
  assert.equal(f.children.length, 1);
});

test('game-window queries use persistent ready and waiting responses', async (t) => {
  const f = fixture(t);
  const child = await readyGuard(f);
  const ready = f.controller.gameWindow('lol');
  await flush();
  assert.equal(child.input.at(-1), 'game-window:lol');
  child.reply('game-window:lol:ready');
  assert.equal(await ready, true);
  const waiting = f.controller.gameWindow('val');
  await flush();
  child.reply('game-window:val:waiting');
  assert.equal(await waiting, false);
  assert.equal(f.children.length, 1);
});

test('game-window can use a one-shot helper when no guard exists', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const result = f.controller.gameWindow('tft');
  await flush();
  const child = f.children[0];
  assert.deepEqual(JSON.parse(child.input[0]), { action: 'game-window', game: 'tft' });
  assert.equal(child.stdin.writableEnded, true);
  child.reply('game-ready');
  child.close();
  assert.equal(await result, true);
});

test('one-shot timeout rejects even if killing the helper emits no close event', async (t) => {
  const f = fixture(t, { timeoutMs: 20, closeOnEnd: false, closeOnKill: false });
  await assert.rejects(f.controller.reveal(), /helper timed out/);
  assert.equal(f.children[0].kills, 1);
});

test('spawn errors reject startup without leaving an unhandled rejection', async (t) => {
  const f = fixture(t);
  const rejection = assert.rejects(f.controller.hide(), /spawn denied/);
  await flush();
  f.children[0].emit('error', new Error('spawn denied'));
  await rejection;
});

test('a timed-out command invalidates its guard and is retried once on a new guard', async (t) => {
  const f = fixture(t, { timeoutMs: 30 });
  const oldChild = await readyGuard(f);
  const concealing = f.controller.conceal();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  assert.equal(f.children.length, 2);
  oldChild.reply('command:conceal');
  const newChild = f.children[1];
  assert.equal(newChild.input.length, 1);
  assert.equal(oldChild.input.at(-1), 'handoff');
  assert.deepEqual(JSON.parse(newChild.input[0]), { ownerPid: process.pid, initialMode: 'conceal' });
  newChild.reply('ready');
  await settle();
  assert.deepEqual(newChild.input.slice(1), ['conceal']);
  newChild.reply('command:conceal');
  await concealing;
  assert.deepEqual(f.controller.drainIncidents(), [{ reason: 'no-response', recovered: true }]);
});

test('a guard lost while armed is restarted in the same mode and the reason is reported', async (t) => {
  const f = fixture(t);
  const oldChild = await readyGuard(f);
  const concealing = f.controller.conceal();
  await flush();
  oldChild.reply('command:conceal');
  await concealing;
  oldChild.reply('error:window-style-timeout');
  await flush();
  f.controller.assertHealthy();
  await settle();
  assert.equal(f.children.length, 2);
  const newChild = f.children[1];
  assert.equal(oldChild.input.at(-1), 'handoff');
  assert.deepEqual(JSON.parse(newChild.input[0]), { ownerPid: process.pid, initialMode: 'conceal' });
  newChild.reply('ready');
  await settle();
  assert.deepEqual(newChild.input.slice(1), ['conceal']);
  newChild.reply('command:conceal');
  await settle();
  f.controller.assertHealthy();
  assert.deepEqual(f.controller.drainIncidents(), [{ reason: 'window-style-timeout', recovered: true }]);
  assert.deepEqual(f.controller.drainIncidents(), []);
});

test('a hide or conceal interrupted by a lost guard is retried once on a new guard', async (t) => {
  const f = fixture(t);
  const oldChild = await readyGuard(f);
  const concealing = f.controller.conceal();
  await flush();
  assert.equal(oldChild.input.at(-1), 'conceal');
  oldChild.reply('error:window-style-denied');
  await settle();
  const newChild = f.children[1];
  newChild.reply('ready');
  await settle();
  assert.deepEqual(newChild.input.slice(1), ['conceal']);
  newChild.reply('command:conceal');
  await concealing;
  assert.equal(f.children.length, 2);
  assert.deepEqual(f.controller.drainIncidents(), [{ reason: 'window-style-denied', recovered: true }]);
});

test('recovery is bounded and a guard that keeps failing stops the sign-in with its reason', async (t) => {
  const f = fixture(t, { maxRecoveries: 1 });
  const first = await readyGuard(f);
  first.reply('error:window-opacity-denied');
  await settle();
  const second = f.children[1];
  second.reply('ready');
  await settle();
  second.reply('command:hide');
  await settle();
  f.controller.assertHealthy();
  second.reply('error:window-opacity-denied');
  await settle();
  assert.equal(f.children.length, 2);
  assert.throws(() => f.controller.assertHealthy(), /guard stopped \(window-opacity-denied\)\. Try Play again/);
  assert.deepEqual(f.controller.drainIncidents(), [
    { reason: 'window-opacity-denied', recovered: true },
    { reason: 'window-opacity-denied', recovered: false },
  ]);
});

test('guard failure reasons outside the fixed vocabulary are not reported verbatim', async (t) => {
  const f = fixture(t);
  const child = await readyGuard(f);
  child.reply('error:Access to C:\\Users\\private\\file was denied');
  await settle();
  f.children[1].reply('ready');
  await settle();
  f.children[1].reply('command:hide');
  await settle();
  assert.deepEqual(f.controller.drainIncidents(), [{ reason: 'unknown', recovered: true }]);
});

test('game-window queries use a one-shot helper after an unarmed guard stopped', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const child = await readyGuard(f);
  const revealing = f.controller.reveal();
  await flush();
  child.reply('command:reveal');
  await revealing;
  child.close(1);
  await settle();
  assert.throws(() => f.controller.assertHealthy(), /guard stopped/);
  const result = f.controller.gameWindow('lol');
  await settle();
  assert.equal(f.children.length, 2);
  const helper = f.children[1];
  assert.deepEqual(JSON.parse(helper.input[0]), { action: 'game-window', game: 'lol' });
  helper.reply('game-ready');
  helper.close();
  assert.equal(await result, true);
});

test('stop closes guard input and permanently prevents restarting', async (t) => {
  const f = fixture(t);
  const child = await readyGuard(f);
  await f.controller.stop();
  assert.equal(child.stdin.writableEnded, true);
  assert.equal(child.exited, true);
  assert.equal(child.kills, 0);
  await assert.rejects(f.controller.hide(), /shutting down/);
  await assert.rejects(f.controller.reveal(), /shutting down/);
  await assert.rejects(f.controller.gameWindow('lol'), /shutting down/);
  assert.equal(f.children.length, 1);
});

test('stop kills a guard that does not close after input ends', async (t) => {
  const f = fixture(t, { closeOnEnd: false });
  const child = await readyGuard(f);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopping = f.controller.stop();
  t.mock.timers.tick(3000);
  await stopping;
  assert.equal(child.kills, 1);
  assert.equal(child.exited, true);
});

test('stop during startup rejects pending commands without opening a replacement', async (t) => {
  const f = fixture(t);
  const rejection = assert.rejects(f.controller.hide(), /stopped|shutting down/);
  await flush();
  await f.controller.stop();
  await rejection;
  await assert.rejects(f.controller.conceal(), /shutting down/);
  assert.equal(f.children.length, 1);
});

test('game names cannot inject additional guard commands', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.controller.gameWindow('lol\nreveal'), /Invalid game/);
  assert.equal(f.children.length, 0);
});

test('health checks fail before a guard exists and after the controller stops', async (t) => {
  const f = fixture(t);
  assert.throws(() => f.controller.assertHealthy(), /guard stopped/);
  await readyGuard(f);
  f.controller.assertHealthy();
  await f.controller.stop();
  assert.throws(() => f.controller.assertHealthy(), /guard stopped/);
  assert.equal(f.children.length, 1);
});

test('a retired guard keeps windows hidden through recovery and stop restores retained snapshots without focus', async (t) => {
  const f = fixture(t);
  const first = await readyGuard(f);
  first.reply('error:window-style-denied');
  await settle();
  assert.equal(first.input.at(-1), 'handoff');
  const second = f.children[1];
  second.reply('ready');
  await settle();
  second.reply('command:hide');
  await settle();
  await f.controller.stop();
  assert.equal(second.input.includes('handoff'), false);
  assert.deepEqual(JSON.parse(f.children[2].input[0]), { action: 'restore', activate: false });
  assert.equal(f.children[2].exited, true);
  await f.controller.stop();
  assert.equal(f.children.length, 3);
});

test('stop restores retained windows even after recovery has exhausted its budget', async (t) => {
  const f = fixture(t, { maxRecoveries: 0 });
  const child = await readyGuard(f);
  child.reply('error:window-style-denied');
  child.close(1);
  await settle();
  assert.equal(f.children.length, 1);
  await f.controller.stop();
  assert.deepEqual(JSON.parse(f.children[1].input[0]), { action: 'restore', activate: false });
});

test('stop during replacement startup restores retained snapshots and never opens another watcher', async (t) => {
  const f = fixture(t);
  const child = await readyGuard(f);
  child.reply('error:window-style-denied');
  await settle();
  assert.equal(f.children.length, 2);
  await f.controller.stop();
  assert.equal(f.children.filter((item) => JSON.parse(item.input[0]).ownerPid).length, 2);
  assert.deepEqual(JSON.parse(f.children.at(-1).input[0]), { action: 'restore', activate: false });
});
