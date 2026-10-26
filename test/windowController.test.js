const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createWindowController } = require('../src/windowController');

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
  const controller = createWindowController({ spawn, timeoutMs, scriptPath: 'C:/Example/windowGuard.ps1' });
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

test('hide waits for guard readiness and its command acknowledgement', async (t) => {
  const f = fixture(t);
  let settled = false;
  const hiding = f.controller.hide().then(() => { settled = true; });
  await flush();
  assert.equal(f.children.length, 1);
  const child = f.children[0];
  assert.deepEqual(JSON.parse(child.input[0]), { ownerPid: process.pid });
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

test('a timed-out command invalidates its guard before the next command', async (t) => {
  const f = fixture(t, { timeoutMs: 30 });
  const oldChild = await readyGuard(f);
  await assert.rejects(f.controller.conceal(), /did not respond/);
  const hiding = f.controller.hide();
  await flush();
  assert.equal(f.children.length, 2);
  // A late acknowledgement from the previous process cannot release this call.
  oldChild.reply('command:hide');
  const newChild = f.children[1];
  assert.equal(newChild.input.length, 1);
  newChild.reply('ready');
  await flush();
  newChild.reply('command:hide');
  await hiding;
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

test('health checks detect a guard lost during an active sign-in', async (t) => {
  const f = fixture(t);
  assert.throws(() => f.controller.assertHealthy(), /guard stopped/);
  const child = await readyGuard(f);
  f.controller.assertHealthy();
  child.close(1);
  assert.throws(() => f.controller.assertHealthy(), /guard stopped/);
});
