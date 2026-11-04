const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRiotWindowObserver, validTarget } = require('../../../src/platform/windows/riotWindowObserver');

test('observer validates metadata, handles fragmented messages, hides on timeout and terminates its own helper', () => {
  const child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { this.killed = true; } });
  const states = [], errors = [];
  let tick, time = 0;
  const observer = createRiotWindowObserver({ spawn: (_exe, _args, options) => { assert.equal(options.windowsHide, true); return child; }, onState: state => states.push(state), onError: error => errors.push(error.message), now: () => time, setInterval: fn => { tick = fn; return 1; }, clearInterval() {} });
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
  assert.equal(child.killed, true);
  child.emit('close');
  assert.equal(errors.length, 1);
});

test('a minimized window keeps its last area and needs an explicit flag', () => {
  const target = { id: '123', x: 10, y: 20, width: 1000, height: 800 };
  assert.ok(validTarget(target));
  assert.ok(validTarget({ ...target, minimized: true }));
  for (const minimized of [false, 'true', 1, null]) assert.ok(!validTarget({ ...target, minimized }));
  assert.ok(!validTarget({ id: '123', minimized: true }));
});

test('observer sends only a numeric overlay handle to the helper', () => {
  const requests = [];
  for (const handle of ['4660', '12; rm', 4660, undefined]) {
    const child = new EventEmitter();
    let written = '';
    Object.assign(child, { stdin: { on() {}, end(text) { written = text; } }, stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
    const observer = createRiotWindowObserver({ spawn: () => child, ownerPid: 77, onState() {}, setInterval: () => 1, clearInterval() {} });
    observer.start('C:/Riot/RiotClientServices.exe', handle);
    requests.push(JSON.parse(written));
    observer.stop();
  }
  assert.deepEqual(requests.map((request) => request.overlayWindow), ['4660', null, null, null]);
  assert.deepEqual(requests[0], { ownerPid: 77, clientPath: 'C:/Riot/RiotClientServices.exe', overlayWindow: '4660' });
});
