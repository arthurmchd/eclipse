const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagerApi } = require('../../../src/integration/manager/manager-preload');

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function fixture(dispatch, extra = {}) {
  let tick, unload, clock = 0, stopped = false;
  const calls = [];
  const api = createManagerApi({
    ipcRenderer: { invoke: async (channel, method, args) => { calls.push([channel, method, args]); return dispatch(method, args); } },
    setInterval: (callback) => { tick = callback; return { unref() {} }; },
    clearInterval: () => { stopped = true; }, now: () => clock, signInTimeoutMs: 100,
    onUnload: (callback) => { unload = callback; },
    ...extra,
  });
  return { api, calls, async tick() { await tick?.(); await flush(); }, unload: () => unload(), advance(ms) { clock += ms; }, stopped: () => stopped };
}

test('the preload exposes fixed account methods and preserves their argument shapes', async () => {
  const f = fixture(async (method, args) => ({ method, args }));
  assert.equal(f.api.invoke, undefined);
  assert.equal(f.api.getPassword, undefined);
  assert.deepEqual(await f.api.saveAccount({ password: 'synthetic-only' }), { method: 'saveAccount', args: [{ password: 'synthetic-only' }] });
  await f.api.addAccounts([{ gameName: 'Synthetic' }]);
  await f.api.pinAccount('synthetic-id', true, 'extra');
  await f.api.reorderAccounts(['b', 'a']);
  await f.api.minimizeRiot('close');
  await f.api.closeRiot();
  await f.api.dragRiot(10, 20);
  assert.equal(f.api.revealRiot, undefined);
  assert.equal(f.api.setModal, undefined);
  for (const name of ['copy', 'closeManager', 'patchAccount', 'forgetSession', 'showRiotClient', 'pickClientPath', 'openDataFolder']) assert.equal(f.api[name], undefined);
  assert.deepEqual(f.calls.map((call) => call.slice(1)), [
    ['saveAccount', [{ password: 'synthetic-only' }]],
    ['addAccounts', [[{ gameName: 'Synthetic' }]]],
    ['pinAccount', ['synthetic-id', true]],
    ['reorderAccounts', [['b', 'a']]],
    ['windowAction', ['minimize']], ['windowAction', ['close']], ['windowAction', ['drag']],
  ]);
  f.unload();
});

test('events start after the initialization cursor and only deliver allowed channels', async () => {
  let cursor;
  const f = fixture(async (method, args) => {
    if (method === 'init') return { eventCursor: 7 };
    if (method === 'events') { cursor = args[0]; return { cursor: 9, events: [
      { id: 6, channel: 'account-updated', payload: { id: 'old' } },
      { id: 8, channel: 'account-updated', payload: { id: 'new' } },
      { id: 9, channel: 'arbitrary-ipc', payload: { private: true } },
    ] }; }
  });
  await f.api.init();
  const updates = [];
  const off = f.api.onAccountUpdated((value) => updates.push(value));
  await f.tick();
  assert.equal(cursor, 7);
  assert.deepEqual(updates, [{ id: 'new' }]);
  off();
  f.unload();
  assert.equal(f.stopped(), true);
});

test('a short launch acknowledgement waits for the background operation result', async () => {
  let operation = { id: 'attempt', status: 'running' };
  const f = fixture(async (method) => {
    if (method === 'signIn') return { ok: true, operationId: 'attempt' };
    if (method === 'events') return { cursor: 0, events: [] };
    if (method === 'operation') return operation;
  });
  let resolved = false;
  const result = f.api.signIn('account', 'lol').then((value) => { resolved = true; return value; });
  await flush();
  assert.equal(resolved, false);
  operation = { id: 'attempt', status: 'succeeded' };
  await f.tick();
  assert.deepEqual(await result, { ok: true, gameStarted: true });
  f.unload();
});

test('finished operation events preserve failure and cancellation without retrying credentials', async () => {
  for (const status of ['failed', 'cancelled']) {
    let events = [];
    const f = fixture(async (method) => {
      if (method === 'signIn') return { ok: true, operationId: 'attempt' };
      if (method === 'events') return { cursor: events.length, events };
      if (method === 'operation') return { id: 'attempt', status: 'running' };
    });
    const pending = f.api.signIn('account', 'val');
    await flush();
    events = [{ id: 1, channel: 'sign-in-operation', payload: { id: 'attempt', status, text: 'Synthetic outcome' } }];
    await f.tick();
    assert.deepEqual(await pending, { ok: false, error: 'Synthetic outcome', cancelled: status === 'cancelled' });
    assert.equal(f.calls.filter((call) => call[1] === 'signIn').length, 1);
    f.unload();
  }
});

test('timeouts and closing the view release waits without cancelling the backend', async () => {
  const f = fixture(async (method) => {
    if (method === 'signIn') return { ok: true, operationId: 'attempt' };
    if (method === 'events') return { cursor: 0, events: [] };
    if (method === 'operation') return { id: 'attempt', status: 'running' };
  });
  const pending = f.api.signIn('account', 'lol');
  await flush();
  f.advance(101);
  await f.tick();
  assert.match((await pending).error, /taking longer/);
  f.unload();
  assert.equal(f.calls.some((call) => call[1] === 'cancelSignIn'), false);
  await assert.rejects(f.api.init(), /view is closed/);
});

test('a hidden view stops asking for events unless a sign-in is waiting and asks right away when it shows again', async () => {
  let hidden = true, visibility, operation = { id: 'attempt', status: 'running' };
  const f = fixture(async (method) => {
    if (method === 'init') return { eventCursor: 3 };
    if (method === 'events') return { cursor: 3, events: [] };
    if (method === 'signIn') return { ok: true, operationId: 'attempt' };
    if (method === 'operation') return operation;
  }, { hidden: () => hidden, onVisibility: (callback) => { visibility = callback; } });
  const asked = () => f.calls.filter((call) => call[1] === 'events').length;
  visibility();
  await flush();
  assert.equal(asked(), 0);
  await f.api.init();
  for (let i = 0; i < 3; i++) await f.tick();
  assert.equal(asked(), 0);
  const result = f.api.signIn('account', 'lol');
  await flush();
  const during = asked();
  assert.ok(during >= 1);
  await f.tick();
  assert.equal(asked(), during + 1);
  operation = { id: 'attempt', status: 'succeeded' };
  await f.tick();
  assert.deepEqual(await result, { ok: true, gameStarted: true });
  const after = asked();
  await f.tick();
  assert.equal(asked(), after);
  hidden = false;
  visibility();
  await flush();
  assert.equal(asked(), after + 1);
  await f.tick();
  assert.equal(asked(), after + 2);
  hidden = true;
  visibility();
  await f.tick();
  assert.equal(asked(), after + 2);
  f.unload();
  hidden = false;
  visibility();
  await flush();
  assert.equal(asked(), after + 2);
});
