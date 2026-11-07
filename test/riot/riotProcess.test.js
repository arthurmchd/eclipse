const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { launchClient } = require('../../src/riot/riotProcess');

test('background launch uses Riot headless mode and never requests a product before account verification', async () => {
  const child = new EventEmitter();
  let released = false, call;
  child.unref = () => { released = true; };
  const pending = launchClient('synthetic.exe', { spawn: (...args) => { call = args; return child; } });
  assert.deepEqual(call[1], ['--headless']);
  assert.equal(call[2].windowsHide, true);
  assert.equal(call[2].stdio, 'ignore');
  assert.equal(released, false);
  child.emit('spawn');
  await pending;
  assert.equal(released, true);
});

test('a visible launch opens the official interface, never a hidden one', async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  let call;
  const pending = launchClient('synthetic.exe', { visible: true, spawn: (...args) => { call = args; return child; } });
  assert.deepEqual(call[1], []);
  assert.equal(call[2].windowsHide, false);
  child.emit('spawn');
  await pending;
});

test('an interface is never created without a visible window', async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  let call;
  const pending = launchClient('synthetic.exe', { interfaceRequired: true, spawn: (...args) => { call = args; return child; } });
  assert.deepEqual(call[1], ['--headless']);
  assert.equal(call[2].windowsHide, true);
  child.emit('spawn');
  await pending;
});

test('spawn failures are reported without exposing OS command details', async () => {
  const child = new EventEmitter();
  const pending = launchClient('synthetic.exe', { spawn: () => child });
  const rejected = assert.rejects(pending, /^Error: Could not start the Riot Client. Check its path and Windows permissions$/);
  child.emit('error', new Error('synthetic-private-argument'));
  await rejected;
});
