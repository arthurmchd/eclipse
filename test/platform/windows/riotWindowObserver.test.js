const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { windowsHelper } = require('../../../src/paths');
const { createRiotWindowObserver, validTarget, PANEL_POINT } = require('../../../src/platform/windows/riotWindowObserver');

test('observer validates metadata, handles fragmented messages, hides on timeout and terminates its own helper', () => {
  const child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { this.killed = true; } });
  const states = [], errors = [];
  let tick, release, time = 0;
  const observer = createRiotWindowObserver({ spawn: (_exe, _args, options) => { assert.equal(options.windowsHide, true); return child; }, onState: state => states.push(state), onError: error => errors.push(error.message), now: () => time, setInterval: fn => { tick = fn; return 1; }, clearInterval() {}, setTimeout: (fn, ms) => { assert.equal(ms, 1000); release = fn; return 2; } });
  observer.start('C:/Riot/RiotClientServices.exe');
  const target = { id: '123', x: -100, y: 10, width: 1000, height: 800 };
  const message = JSON.stringify({ target });
  child.stdout.write(message.slice(0, 10));
  assert.equal(states.length, 0);
  child.stdout.write(message.slice(10) + '\n');
  assert.deepEqual(states.at(-1), target);
  child.stdout.write('{"target":{"width":-10}}\n');
  assert.equal(states.at(-1), null);
  assert.equal(errors.length, 1);
  time = 4000; tick();
  assert.equal(states.at(-1), null);
  observer.stop();
  assert.equal(child.stdin.writableEnded, true);
  assert.equal(child.killed, undefined);
  release();
  assert.equal(child.killed, true);
  child.emit('close');
  assert.equal(errors.length, 1);
});

test('observer helper puts cards that fell beneath the Riot window back right above it, using only its own test windows', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const selfTest = () => new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsHelper('riotWindowObserver.ps1')], {
      windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
    }, (error, stdout) => error && error.code !== 1 ? reject(error) : resolve({ code: error?.code || 0, output: stdout.trim() }));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ action: 'self-test' }) + '\n');
  });
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await selfTest();
    if (result.code === 0) break;
  }
  assert.deepEqual(result, { code: 0, output: 'ok' });
});

test('a minimized window keeps its last area and needs an explicit flag', () => {
  const target = { id: '123', x: 10, y: 20, width: 1000, height: 800 };
  assert.ok(validTarget(target));
  for (const corner of [0, 8, 12, 64]) assert.ok(validTarget({ ...target, corner }));
  for (const corner of [-1, 65, 7.5, '8', null]) assert.ok(!validTarget({ ...target, corner }));
  assert.ok(validTarget({ ...target, minimized: true }));
  for (const minimized of [false, 'true', 1, null]) assert.ok(!validTarget({ ...target, minimized }));
  assert.ok(!validTarget({ id: '123', minimized: true }));
});

test('a Riot window dimmed by one of its own dialogs needs an explicit flag', () => {
  const target = { id: '123', x: 10, y: 20, width: 1000, height: 800, corner: 8 };
  assert.ok(validTarget({ ...target, dimmed: true }));
  assert.ok(validTarget({ ...target, dimmed: true, minimized: true }));
  for (const dimmed of [false, 'true', 1, null, {}]) assert.ok(!validTarget({ ...target, dimmed }));
  assert.ok(!validTarget({ id: '123', dimmed: true }));
});

test('a Riot sign-in form that left the screen needs an explicit flag', () => {
 const target = { id: '123', x: 10, y: 20, width: 1000, height: 800, corner: 8 };
 assert.ok(validTarget({ ...target, formHidden: true }));
 assert.ok(validTarget({ ...target, formHidden: true, dimmed: true, minimized: true }));
 for (const formHidden of [false, 'true', 1, null, {}]) assert.ok(!validTarget({ ...target, formHidden }));
 assert.ok(!validTarget({ id: '123', formHidden: true }));
});

test('the helper watches the Riot Stay signed in box at the point the login helper clicks', () => {
 const box = fs.readFileSync(windowsHelper('riotWindowObserver.ps1'), 'utf8').match(/const double BOX_X = ([\d.]+), BOX_Y = ([\d.]+);/);
 const remember = fs.readFileSync(windowsHelper('login.ps1'), 'utf8').match(/\$REMEMBER = @\(([\d.]+), ([\d.]+)\)/);
 assert.ok(box && remember);
 assert.deepEqual(box.slice(1), remember.slice(1));
 assert.deepEqual(box.slice(1).map(Number), [0.0417, 0.5023]);
});

test('the panel point the overlay leaves uncovered is the one the helper reads', () => {
  const source = fs.readFileSync(windowsHelper('riotWindowObserver.ps1'), 'utf8');
  assert.ok(source.includes(`const double PANEL_X = ${PANEL_POINT.x}, PANEL_Y = ${PANEL_POINT.y};`));
  assert.deepEqual(PANEL_POINT, { x: 0.026, y: 0.5 });
  assert.equal(Object.isFrozen(PANEL_POINT), true);
});

test('observer sends only a numeric overlay handle to the helper', () => {
  const requests = [];
  for (const handle of ['4660', '12; rm', 4660, undefined]) {
    const child = new EventEmitter();
    let written = '';
    Object.assign(child, { stdin: { on() {}, write(text) { written += text; } }, stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
    const observer = createRiotWindowObserver({ spawn: () => child, ownerPid: 77, onState() {}, setInterval: () => 1, clearInterval() {} });
    observer.start('C:/Riot/RiotClientServices.exe', handle);
    requests.push(JSON.parse(written));
    observer.stop();
  }
  assert.deepEqual(requests.map((request) => request.overlayWindow), ['4660', null, null, null]);
  assert.deepEqual(requests[0], { ownerPid: 77, clientPath: 'C:/Riot/RiotClientServices.exe', overlayWindow: '4660' });
});

test('observer forwards only the minimize and close commands, one line each, and only while running', () => {
  const child = new EventEmitter();
  const stdin = new PassThrough();
  let written = '';
  stdin.on('data', (chunk) => { written += chunk; });
  Object.assign(child, { stdin, stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  const observer = createRiotWindowObserver({ spawn: () => child, ownerPid: 77, onState() {}, setInterval: () => 1, clearInterval() {} });
  assert.equal(observer.command('minimize'), false);
  observer.start('C:/Riot/RiotClientServices.exe');
  const request = written;
  for (const name of ['minimize', 'close']) assert.equal(observer.command(name), true);
  for (const name of ['quit', 'minimize\nclose', '', null, { name: 'close' }]) assert.equal(observer.command(name), false);
  assert.equal(written.slice(request.length), 'minimize\nclose\n');
  assert.equal(JSON.parse(request).ownerPid, 77);
  observer.stop();
  assert.equal(observer.command('close'), false);
  assert.equal(written.slice(request.length), 'minimize\nclose\n');
});

test('the real helper keeps reporting after commands and leaves windows alone when no official Riot window exists', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const states = [], errors = [];
  let observer;
  try {
    await new Promise((resolve, reject) => {
      let commanded = false;
      const deadline = setTimeout(() => reject(new Error('the helper stopped reporting')), 25000);
      observer = createRiotWindowObserver({
        onState(state) {
          states.push(state);
          if (!commanded) {
            commanded = true;
            for (const name of ['minimize', 'close']) assert.equal(observer.command(name), true);
          } else if (states.length >= 4) { clearTimeout(deadline); resolve(); }
        },
        onError(error) { errors.push(error.message); clearTimeout(deadline); reject(error); },
      });
      observer.start(path.join(os.tmpdir(), 'eclipse-no-riot', 'RiotClientServices.exe'));
    });
  } finally { observer?.stop(); }
  assert.deepEqual(errors, []);
  assert.ok(states.every((state) => state === null));
});

test('the real helper ends on its own when the manager closes its input', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsHelper('riotWindowObserver.ps1')], {
      windowsHide: true, encoding: 'utf8', timeout: 25000, maxBuffer: 65536,
    }, (error, stdout) => error && typeof error.code !== 'number' ? reject(error) : resolve({ code: error?.code || 0, lines: stdout.trim().split(/\r?\n/) }));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ ownerPid: process.pid, clientPath: path.join(os.tmpdir(), 'eclipse-no-riot', 'RiotClientServices.exe'), overlayWindow: null }) + '\n');
  });
  assert.equal(result.code, 0);
  assert.ok(result.lines.length >= 1);
  assert.ok(result.lines.every((line) => line === '{"target":null}'));
});
