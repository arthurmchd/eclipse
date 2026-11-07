const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterfaceOpener, SHOW_INTERFACE } = require('../../src/riot/riotInterface');

function fixture({ client = false, clientWindow = false, showStatus = 204, windowAfterShow = false, stops = true } = {}) {
  const events = [];
  const state = { client, clientWindow };
  const open = createInterfaceOpener({
    runningGames: async () => ({ ...state }),
    localApi: async (method, endpoint) => {
      events.push(['api', method, endpoint]);
      if (showStatus instanceof Error) throw showStatus;
      if (windowAfterShow) state.clientWindow = true;
      return { status: showStatus, json: null };
    },
    stopClient: async () => {
      events.push(['stop']);
      if (stops) state.client = false;
    },
    launchClient: async (exe, options) => {
      events.push(['launch', exe, options]);
      state.client = true;
      state.clientWindow = true;
    },
    waitFor: async (fn) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const value = await fn();
        if (value) return value;
      }
      return null;
    },
  });
  const logs = [];
  return { open: (options = {}) => open({ exe: 'C:/Riot/RiotClientServices.exe', log: (line) => logs.push(line), ...options }), events, logs };
}

test('an existing Riot interface window is reused without restarting anything', async () => {
  const f = fixture({ client: true, clientWindow: true });
  assert.equal(await f.open(), 'existing');
  assert.deepEqual(f.events, []);
});

test('headless services are asked to show their interface before any restart', async () => {
  const f = fixture({ client: true, windowAfterShow: true });
  assert.equal(await f.open(), 'shown');
  assert.deepEqual(f.events, [['api', 'POST', SHOW_INTERFACE]]);
  assert.match(f.logs.join('\n'), /background service/);
});

test('headless services that do not show an interface are restarted with it, visible', async () => {
  for (const showStatus of [204, 404, new Error('connection refused')]) {
    const f = fixture({ client: true, showStatus });
    assert.equal(await f.open(), 'launched');
    assert.deepEqual(f.events.map((event) => event[0]), ['api', 'stop', 'launch']);
    assert.deepEqual(f.events[2], ['launch', 'C:/Riot/RiotClientServices.exe', { visible: true }]);
    assert.match(f.logs.join('\n'), /restarting it with the interface/);
  }
});

test('stopped services start directly with the visible interface, even if asked for a hidden one', async () => {
  const f = fixture({ client: false });
  assert.equal(await f.open({ visible: false }), 'launched');
  assert.deepEqual(f.events, [['launch', 'C:/Riot/RiotClientServices.exe', { visible: true }]]);
});

test('services that refuse to stop are reported instead of starting a second client', async () => {
  const f = fixture({ client: true, stops: false });
  await assert.rejects(f.open(), /Could not restart the Riot Client with its interface/);
  assert.equal(f.events.some((event) => event[0] === 'launch'), false);
});

test('cancellation stops before showing, restarting or launching the interface', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture({ client: true });
  await assert.rejects(f.open({ signal: controller.signal }), /cancelled/);
  assert.deepEqual(f.events, []);
});
