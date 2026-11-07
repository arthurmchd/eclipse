const test = require('node:test');
const assert = require('node:assert/strict');
const { createRiotWakeup } = require('../../src/core/riotWakeup');

const SETTLE = 1000, RETRY = 1001, GRACE = 2000;

function fixture({ client = true, clientWindow = false, game = false, full = false, attempts = 3 } = {}) {
  const events = [], logs = [], timers = [];
  let busy = false, watcher = null;
  const state = { client, clientWindow, game, full, show: true };
  const riot = {
    runningGames: async () => { events.push('processes?'); return { client: state.client, clientWindow: state.clientWindow, lol: state.game, val: false }; },
    sessionState: async () => { events.push('state?'); return state.full ? { type: 'auth' } : null; },
    showInterface: async () => { events.push('show'); return state.show; },
    watchLockfile: (onChange) => { watcher = { onChange, closed: false, close() { this.closed = true; } }; return watcher; },
  };
  const wakeup = createRiotWakeup({
    riot, busy: () => busy, log: (line) => logs.push(line),
    setTimeout: (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    settleMs: SETTLE, retryMs: RETRY, graceMs: GRACE, attempts,
  });
  async function next(ms) {
    const index = timers.findIndex((timer) => !timer.cancelled);
    assert.ok(index >= 0, 'a check is scheduled');
    const [timer] = timers.splice(index, 1);
    if (ms !== undefined) assert.equal(timer.ms, ms);
    await timer.fn();
  }
  const pending = () => timers.filter((timer) => !timer.cancelled).length;
  return { wakeup, riot, state, events, logs, next, pending, change: () => watcher.onChange(), watcher: () => watcher, setBusy: (value) => { busy = value; } };
}

test('a Riot that leaves background mode without a window is asked to show it after a grace period', async () => {
  const f = fixture();
  f.wakeup.start();
  await f.next(0);
  assert.equal(f.events.includes('show'), false);
  f.state.full = true;
  f.change();
  await f.next(SETTLE);
  assert.equal(f.events.includes('show'), false);
  await f.next(GRACE);
  assert.equal(f.events.filter((event) => event === 'show').length, 1);
  assert.deepEqual(f.logs, ['opened the Riot window after it left background mode without one']);
  assert.equal(f.pending(), 0);
});

test('the wake waits while Riot is still loading its services, and gives up after the limit', async () => {
  const f = fixture({ attempts: 2 });
  f.wakeup.start();
  await f.next(0);
  f.change();
  await f.next(SETTLE);
  await f.next(RETRY);
  f.state.full = true;
  await f.next(RETRY);
  await f.next(GRACE);
  assert.equal(f.events.filter((event) => event === 'show').length, 1);
  const stuck = fixture({ attempts: 2 });
  stuck.wakeup.start();
  await stuck.next(0);
  stuck.change();
  await stuck.next(SETTLE);
  await stuck.next(RETRY);
  await stuck.next(RETRY);
  assert.equal(stuck.pending(), 0);
  assert.equal(stuck.events.includes('show'), false);
});

test('a Riot that opens its own window, a game that starts or a sign-in in progress is never shown again', async () => {
  for (const change of [(f) => { f.state.clientWindow = true; }, (f) => { f.state.game = true; }, (f) => f.setBusy(true), (f) => { f.state.client = false; }]) {
    const f = fixture();
    f.wakeup.start();
    await f.next(0);
    f.state.full = true;
    f.change();
    await f.next(SETTLE);
    change(f);
    await f.next(GRACE);
    assert.equal(f.events.includes('show'), false);
    assert.equal(f.pending(), 0);
    f.setBusy(false);
    Object.assign(f.state, { clientWindow: false, game: false, client: true });
    f.change();
    await f.next(SETTLE);
    assert.equal(f.pending(), 0);
    assert.equal(f.events.includes('show'), false);
  }
});

test('entering background mode or a Riot that opens without passing through it never shows the window', async () => {
  const f = fixture({ full: true });
  f.wakeup.start();
  await f.next(0);
  f.change();
  await f.next(SETTLE);
  assert.equal(f.pending(), 0);
  f.state.full = false;
  f.change();
  await f.next(SETTLE);
  assert.equal(f.pending(), 0);
  assert.equal(f.events.includes('show'), false);
  const closed = fixture({ client: false });
  closed.wakeup.start();
  await closed.next(0);
  assert.deepEqual(closed.events, ['processes?']);
});

test('a sign-in that starts during the check, a failed show and a failed process check are handled quietly', async () => {
  const f = fixture();
  f.wakeup.start();
  await f.next(0);
  f.state.full = true;
  f.riot.sessionState = async () => { f.setBusy(true); return { type: 'auth' }; };
  f.change();
  await f.next(SETTLE);
  assert.equal(f.pending(), 0);
  const failing = fixture();
  failing.wakeup.start();
  await failing.next(0);
  failing.state.full = true;
  failing.state.show = false;
  failing.change();
  await failing.next(SETTLE);
  await failing.next(GRACE);
  assert.deepEqual(failing.logs, ['Riot left background mode without a window and did not show it']);
  const broken = fixture();
  broken.riot.runningGames = async () => { throw new Error('tasklist failed'); };
  broken.wakeup.start();
  await broken.next(0);
  assert.equal(broken.pending(), 0);
});

test('a newer lockfile change replaces the pending check, and stopping closes the watcher and cancels pending work', async () => {
  const f = fixture();
  f.wakeup.start();
  await f.next(0);
  f.state.full = true;
  f.change();
  f.change();
  assert.equal(f.pending(), 1);
  await f.next(SETTLE);
  f.wakeup.stop();
  assert.equal(f.watcher().closed, true);
  assert.equal(f.pending(), 0);
  assert.equal(f.events.includes('show'), false);
});
