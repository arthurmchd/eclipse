const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionKeeper } = require('../../src/core/sessionKeeper');

const remembered = (subject, riotId = '', version = 'v1') => `login:${subject}|${riotId}|${version}`;
const DELAY = 1000, POLL = 4000;

const KEPT = Date.parse('2026-11-06T13:00:00Z');

function fixture({ yaml = remembered('sub-a'), running = [false], staySignedIn, sessions = { a: remembered('sub-a'), b: remembered('sub-b') }, pollMs = 0, processes = {}, authorized = true, savedAt = {} } = {}) {
  const events = [], logs = [], saved = [], timers = [];
  let busy = false, watcher = null;
  const state = { yaml, running: [...running], sessions: { ...sessions }, processes: { client: true, ...processes }, authorized };
  const parts = (text) => (typeof text === 'string' && text.startsWith('login:') ? text.slice(6).split('|') : []);
  const riot = {
    clientRunning: async () => { events.push('running?'); return state.running.length > 1 ? state.running.shift() : state.running[0]; },
    readSettingsYaml: () => { events.push('read'); return state.yaml; },
    writeSettingsYaml: async (text, { expected } = {}) => {
      if (expected !== undefined) {
        events.push('read');
        if (state.yaml !== expected) return false;
      }
      events.push(['write', text]);
      state.yaml = text;
      return true;
    },
    hasPersistedLogin: (text) => typeof text === 'string' && text.startsWith('login:'),
    stripPersistedLogin: () => 'stripped',
    persistedSubject: (text) => parts(text)[0] || null,
    persistedRiotId: (text) => {
      const [gameName, tagLine] = (parts(text)[1] || '').split('#');
      return gameName ? { gameName, tagLine } : null;
    },
    sameRiotId: (a, b) => Boolean(a && b && a.gameName && a.gameName === b.gameName && a.tagLine === b.tagLine),
    watchSettings: (onChange) => { watcher = { onChange, closed: false, close() { this.closed = true; } }; return watcher; },
    runningGames: async () => { events.push('processes?'); return { ...state.processes }; },
    isAuthorized: async () => { events.push('authorized?'); return state.authorized; },
    quitClient: async () => { events.push('quit'); },
    startClient: async (clientPath) => {
      events.push(['start', clientPath]);
      if (state.startError) throw new Error('C:\\private\\path missing');
      return state.started ?? true;
    },
  };
  const store = {
    data: { accounts: [{ id: 'a', gameName: 'Alpha', tagLine: 'BR1' }, { id: 'b', gameName: 'Beta', tagLine: 'BR1' }, { id: 'c', gameName: 'Gamma', tagLine: 'BR1' }, { id: 'd', gameName: 'Twin', tagLine: 'BR1' }, { id: 'e', gameName: 'Twin', tagLine: 'BR1' }], settings: staySignedIn === undefined ? {} : { staySignedIn } },
    hasSession: (id) => id in state.sessions,
    loadSession: (id) => state.sessions[id] ?? null,
    saveSession: (id, text) => { saved.push([id, text]); state.sessions[id] = text; delete savedAt[id]; },
    sessionSavedAt: (id) => (id in state.sessions ? savedAt[id] ?? KEPT + 1 : 0),
    forgetSession: (id) => { events.push(['forget', id]); delete state.sessions[id]; },
  };
  const keeper = createSessionKeeper({
    riot, store, busy: () => busy, log: (line) => logs.push(line), onSaved: (account) => events.push(['saved', account.id]),
    setTimeout: (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    delayMs: DELAY, pollMs,
  });
  async function flush(limit = 20) {
    for (let i = 0; i < limit; i++) {
      const index = timers.findIndex((timer) => timer.ms === DELAY);
      if (index < 0) return;
      const [timer] = timers.splice(index, 1);
      if (!timer.cancelled) await timer.fn();
    }
  }
  async function tick() {
    const index = timers.findIndex((timer) => timer.ms === POLL && !timer.cancelled);
    assert.ok(index >= 0, 'a client poll is scheduled');
    const [timer] = timers.splice(index, 1);
    await timer.fn();
  }
  return { keeper, riot, store, state, events, logs, saved, timers, flush, tick, watcher: () => watcher, setBusy: (value) => { busy = value; } };
}

test('when Riot has quit, its newest login goes to the account with the same subject and is cleared from Riot', async () => {
  const f = fixture({ yaml: remembered('sub-b', '', 'v2') });
  f.keeper.start();
  await f.flush();
  assert.deepEqual(f.saved, [['b', remembered('sub-b', '', 'v2')]]);
  assert.equal(f.state.yaml, 'stripped');
  assert.deepEqual(f.events.filter(Array.isArray), [['saved', 'b'], ['write', 'stripped']]);
  assert.deepEqual(f.events.filter((event) => typeof event === 'string'), ['read', 'running?', 'read']);
  assert.deepEqual(f.logs, ['kept the Riot session for its account and cleared the remembered login']);
});

test('an unchanged session is not written again before Riot is cleared', async () => {
  const f = fixture();
  f.keeper.start();
  await f.flush();
  assert.deepEqual(f.saved, []);
  assert.equal(f.state.yaml, 'stripped');
});

test('a remembered login of an account outside Eclipse is cleared without being kept, but never while Riot holds it', async () => {
  const f = fixture({ yaml: remembered('sub-unknown') });
  f.keeper.start();
  await f.flush();
  assert.deepEqual(f.saved, []);
  assert.equal(f.state.yaml, 'stripped');
  assert.deepEqual(f.logs, ['cleared a remembered Riot login that is not from an account in Eclipse']);
  const held = fixture({ yaml: remembered('sub-unknown'), running: [true] });
  held.keeper.start();
  await held.flush();
  assert.equal(held.state.yaml, remembered('sub-unknown'));
  assert.deepEqual(held.logs, []);
});

test('an account without a saved session owns the remembered login only when its Riot ID is the only match', async () => {
  const f = fixture({ yaml: remembered('sub-new', 'Gamma#BR1') });
  f.keeper.start();
  await f.flush();
  assert.deepEqual(f.saved, [['c', remembered('sub-new', 'Gamma#BR1')]]);
  assert.equal(f.state.yaml, 'stripped');
  const twins = fixture({ yaml: remembered('sub-new', 'Twin#BR1') });
  twins.keeper.start();
  await twins.flush();
  assert.deepEqual(twins.saved, []);
  assert.equal(twins.state.yaml, 'stripped');
  assert.match(twins.logs[0], /not from an account in Eclipse/);
});

test('the saved session subject wins over a Riot ID that points to another account', async () => {
  const f = fixture({ yaml: remembered('sub-a', 'Gamma#BR1', 'v2') });
  f.keeper.start();
  await f.flush();
  assert.deepEqual(f.saved, [['a', remembered('sub-a', 'Gamma#BR1', 'v2')]]);
});

test('a Riot settings file without a remembered login is never rewritten', async () => {
  const f = fixture({ yaml: 'tdid only' });
  f.keeper.start();
  await f.flush();
  assert.deepEqual(f.saved, []);
  assert.equal(f.events.some(Array.isArray), false);
  assert.deepEqual(f.logs, []);
});

test('while Riot holds the account every renewed session is kept and the file stays; once Riot lets go, the client polling clears it', async () => {
  const f = fixture({ yaml: remembered('sub-a', '', 'v2'), running: [true], pollMs: POLL, processes: { clientWindow: false } });
  f.keeper.start();
  await f.flush();
  assert.deepEqual(f.saved, [['a', remembered('sub-a', '', 'v2')]]);
  assert.equal(f.state.yaml, remembered('sub-a', '', 'v2'));
  f.state.yaml = remembered('sub-a', '', 'v3');
  f.watcher().onChange();
  await f.flush();
  assert.deepEqual(f.saved, [['a', remembered('sub-a', '', 'v2')], ['a', remembered('sub-a', '', 'v3')]]);
  assert.equal(f.state.yaml, remembered('sub-a', '', 'v3'));
  f.state.authorized = false;
  await f.tick();
  await f.flush();
  assert.equal(f.state.yaml, 'stripped');
  assert.deepEqual(f.logs, ['kept the Riot session for its account and cleared the remembered login']);
  await f.tick();
  assert.equal(f.timers.some((timer) => timer.ms === DELAY && !timer.cancelled), false);
});

test('a file that Riot rewrites during the check is never overwritten, and the newer login is kept next', async () => {
  const f = fixture({ yaml: remembered('sub-a', '', 'v2'), running: [true] });
  f.riot.isAuthorized = async () => { f.events.push('authorized?'); f.state.yaml = remembered('sub-a', '', 'v3'); return false; };
  f.keeper.start();
  await f.flush();
  assert.equal(f.state.yaml, remembered('sub-a', '', 'v3'));
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'write'), false);
  f.riot.isAuthorized = async () => false;
  f.watcher().onChange();
  await f.flush();
  assert.deepEqual(f.saved, [['a', remembered('sub-a', '', 'v2')], ['a', remembered('sub-a', '', 'v3')]]);
  assert.equal(f.state.yaml, 'stripped');
});

test('a sign-in in progress keeps the keeper away from the Riot settings', async () => {
  const f = fixture({ yaml: remembered('sub-a', '', 'v2') });
  f.setBusy(true);
  f.keeper.start();
  f.watcher().onChange();
  await f.flush();
  assert.deepEqual(f.events, []);
  f.setBusy(false);
  f.keeper.check();
  await f.flush();
  assert.deepEqual(f.saved, [['a', remembered('sub-a', '', 'v2')]]);
  assert.equal(f.state.yaml, 'stripped');
});

test('a sign-in that starts while Riot is being checked is left alone', async () => {
  const f = fixture();
  f.riot.clientRunning = async () => { f.events.push('running?'); f.setBusy(true); return false; };
  f.keeper.start();
  await f.flush();
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'write'), false);
  assert.equal(f.state.yaml, remembered('sub-a'));
  assert.deepEqual(f.saved, []);
});

test('stay signed in off disables the keeper entirely', async () => {
  const f = fixture({ staySignedIn: false, pollMs: POLL, processes: { lol: false } });
  f.keeper.start();
  f.watcher().onChange();
  await f.flush();
  await f.tick();
  await f.tick();
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.saved, []);
  assert.equal(f.keeper.keep(remembered('sub-a', '', 'v9')), null);
});

test('a change during a check runs one more check afterwards', async () => {
  const f = fixture({ yaml: remembered('sub-a', '', 'v2') });
  let release;
  f.riot.clientRunning = () => { f.events.push('running?'); return new Promise((resolve) => { release = resolve; }); };
  f.keeper.start();
  const first = f.timers.shift().fn();
  f.watcher().onChange();
  await f.timers.shift().fn();
  f.state.yaml = remembered('sub-a', '', 'v3');
  release(false);
  await first;
  f.riot.clientRunning = async () => false;
  await f.flush();
  assert.deepEqual(f.saved, [['a', remembered('sub-a', '', 'v2')], ['a', remembered('sub-a', '', 'v3')]]);
  assert.equal(f.state.yaml, 'stripped');
});

test('stopping closes the watcher and cancels pending work', async () => {
  const f = fixture({ pollMs: POLL });
  f.keeper.start();
  f.keeper.stop();
  await f.flush();
  assert.equal(f.watcher().closed, true);
  assert.equal(f.timers.every((timer) => timer.cancelled), true);
  assert.deepEqual(f.events, []);
  f.keeper.check();
  assert.equal(f.timers.filter((timer) => !timer.cancelled).length, 0);
});

test('a storage failure is logged without crashing and without clearing Riot', async () => {
  const f = fixture({ yaml: remembered('sub-a', '', 'v2') });
  f.store.saveSession = () => { throw new Error('C:/secret/path'); };
  f.keeper.start();
  await f.flush();
  assert.equal(f.state.yaml, remembered('sub-a', '', 'v2'));
  assert.deepEqual(f.logs, ['could not keep the Riot session']);
  f.keeper.check();
  await f.flush();
  assert.deepEqual(f.logs, ['could not keep the Riot session']);
});

test('the leaving session of a closing Riot is kept for its owner even during a sign-in', () => {
  const f = fixture();
  f.setBusy(true);
  assert.equal(f.keeper.keep(remembered('sub-b', '', 'v2')).id, 'b');
  assert.deepEqual(f.saved, [['b', remembered('sub-b', '', 'v2')]]);
  assert.equal(f.keeper.keep(remembered('sub-unknown')), null);
  assert.equal(f.keeper.keep('tdid only'), null);
  assert.deepEqual(f.events.filter(Array.isArray), [['saved', 'b']]);
});

test('after a game closes, a signed-in Riot is asked to quit normally, even with its window open, and the session is kept', async () => {
  const f = fixture({ pollMs: POLL, processes: { lol: true, clientWindow: false } });
  f.keeper.start();
  await f.tick();
  f.state.processes = { client: true, clientWindow: true, lol: false };
  await f.tick();
  assert.equal(f.events.includes('quit'), false);
  await f.tick();
  assert.equal(f.events.filter((event) => event === 'quit').length, 1);
  assert.match(f.logs.at(-1), /after the game/);
  assert.ok(f.timers.some((timer) => timer.ms === DELAY && !timer.cancelled));
  f.state.processes = { client: true, clientWindow: true };
  await f.tick();
  await f.tick();
  assert.equal(f.events.filter((event) => event === 'quit').length, 1);
});

test('a signed-in Riot left without a window and without a game is asked to quit; one with its window open stays', async () => {
  const f = fixture({ yaml: 'tdid only', pollMs: POLL, processes: { clientWindow: true } });
  f.keeper.start();
  for (let i = 0; i < 4; i++) await f.tick();
  assert.equal(f.events.includes('quit'), false);
  assert.equal(f.events.includes('authorized?'), false);
  f.state.processes = { client: true, clientWindow: false };
  await f.tick();
  await f.tick();
  assert.equal(f.events.filter((event) => event === 'quit').length, 1);
  assert.match(f.logs.at(-1), /without a window/);
});

const starts = (f) => f.events.filter((event) => Array.isArray(event) && event[0] === 'start');

async function closedAfterGame(options = {}) {
  const f = fixture({ pollMs: POLL, processes: { lol: true, clientWindow: false }, ...options });
  f.keeper.start();
  await f.tick();
  f.state.processes = { client: true, clientWindow: true };
  await f.tick();
  await f.tick();
  assert.equal(f.events.filter((event) => event === 'quit').length, 1);
  return f;
}

test('a Riot closed after the game with its window open is reopened signed out, only after it quit and its login was cleared', async () => {
  const f = await closedAfterGame();
  f.store.data.settings.riotClientPath = 'C:\\Riot\\RiotClientServices.exe';
  await f.tick();
  assert.equal(starts(f).length, 0);
  f.state.processes = { client: false };
  f.state.yaml = remembered('sub-a', '', 'v2');
  await f.tick();
  assert.equal(starts(f).length, 0);
  await f.flush();
  assert.equal(f.state.yaml, 'stripped');
  assert.deepEqual(f.saved.at(-1), ['a', remembered('sub-a', '', 'v2')]);
  await f.tick();
  assert.deepEqual(starts(f), [['start', 'C:\\Riot\\RiotClientServices.exe']]);
  const lastWrite = f.events.findLastIndex((event) => Array.isArray(event) && event[0] === 'write');
  assert.ok(lastWrite < f.events.findIndex((event) => Array.isArray(event) && event[0] === 'start'));
  assert.equal(f.logs.at(-1), 'reopened the Riot at the sign-in screen after closing it');
  for (let i = 0; i < 6; i++) await f.tick();
  assert.equal(starts(f).length, 1);
});

test('a Riot closed without its window, a Riot that never quits or one the user opens again is never reopened', async () => {
  const hidden = fixture({ yaml: 'tdid only', pollMs: POLL, processes: { client: true, clientWindow: false } });
  hidden.keeper.start();
  await hidden.tick();
  await hidden.tick();
  assert.equal(hidden.events.filter((event) => event === 'quit').length, 1);
  hidden.state.processes = { client: false };
  for (let i = 0; i < 6; i++) await hidden.tick();
  assert.equal(starts(hidden).length, 0);
  const stuck = await closedAfterGame({ yaml: 'tdid only' });
  for (let i = 0; i < 5; i++) await stuck.tick();
  assert.equal(stuck.logs.filter((line) => line === 'gave up reopening the Riot after closing it').length, 1);
  stuck.state.processes = { client: false };
  for (let i = 0; i < 3; i++) await stuck.tick();
  assert.equal(starts(stuck).length, 0);
  const reopened = await closedAfterGame({ yaml: 'tdid only' });
  reopened.state.processes = { client: false };
  reopened.state.started = false;
  await reopened.tick();
  assert.equal(starts(reopened).length, 1);
  assert.equal(reopened.logs.some((line) => /reopen/.test(line)), false);
});

test('a sign-in, a game or stay signed in turned off cancels the reopen', async () => {
  const signingIn = await closedAfterGame({ yaml: 'tdid only' });
  signingIn.setBusy(true);
  await signingIn.tick();
  signingIn.setBusy(false);
  signingIn.state.processes = { client: false };
  for (let i = 0; i < 3; i++) await signingIn.tick();
  assert.equal(starts(signingIn).length, 0);
  const playing = await closedAfterGame({ yaml: 'tdid only' });
  playing.state.processes = { client: true, lol: true };
  await playing.tick();
  playing.state.processes = { client: false };
  for (let i = 0; i < 3; i++) await playing.tick();
  assert.equal(starts(playing).length, 0);
  const disabled = await closedAfterGame({ yaml: 'tdid only' });
  disabled.store.data.settings.staySignedIn = false;
  await disabled.tick();
  disabled.store.data.settings.staySignedIn = true;
  disabled.state.processes = { client: false };
  for (let i = 0; i < 3; i++) await disabled.tick();
  assert.equal(starts(disabled).length, 0);
  const busyDuringCheck = await closedAfterGame({ yaml: 'tdid only' });
  busyDuringCheck.state.processes = { client: false };
  busyDuringCheck.riot.runningGames = async () => { busyDuringCheck.setBusy(true); return { client: false }; };
  await busyDuringCheck.tick();
  busyDuringCheck.setBusy(false);
  for (let i = 0; i < 3; i++) await busyDuringCheck.tick();
  assert.equal(starts(busyDuringCheck).length, 0);
});

test('a failed reopen is logged without details and never retried', async () => {
  const f = await closedAfterGame({ yaml: 'tdid only' });
  f.state.processes = { client: false };
  f.state.startError = true;
  await f.tick();
  await f.tick();
  assert.equal(starts(f).length, 1);
  assert.equal(f.logs.at(-1), 'could not reopen the Riot after closing it');
  assert.equal(f.logs.some((line) => line.includes('private')), false);
});

test('Riot on the sign-in screen, a sign-in in progress or a game starting again never makes the keeper quit Riot', async () => {
  const signedOut = fixture({ pollMs: POLL, authorized: false, processes: { clientWindow: false } });
  signedOut.keeper.start();
  for (let i = 0; i < 3; i++) await signedOut.tick();
  assert.equal(signedOut.events.includes('quit'), false);
  const signingIn = fixture({ pollMs: POLL, processes: { clientWindow: false } });
  signingIn.keeper.start();
  await signingIn.tick();
  signingIn.setBusy(true);
  await signingIn.tick();
  await signingIn.tick();
  signingIn.setBusy(false);
  await signingIn.tick();
  assert.equal(signingIn.events.includes('quit'), false);
  const playing = fixture({ pollMs: POLL, processes: { clientWindow: false } });
  playing.keeper.start();
  await playing.tick();
  playing.state.processes = { client: true, val: true };
  await playing.tick();
  assert.equal(playing.events.includes('quit'), false);
  const gone = fixture({ pollMs: POLL, processes: { client: false } });
  gone.keeper.start();
  for (let i = 0; i < 3; i++) await gone.tick();
  assert.equal(gone.events.includes('authorized?'), false);
});

test('a failed process check never stops the client polling', async () => {
  const f = fixture({ pollMs: POLL });
  f.riot.runningGames = async () => { throw new Error('tasklist failed'); };
  f.keeper.start();
  await f.tick();
  await f.tick();
  assert.equal(f.events.includes('quit'), false);
});

test('sessions saved before cards mode kept sessions are forgotten at start, once, and their cards are refreshed', async () => {
  const f = fixture({ yaml: 'tdid only', sessions: { a: remembered('sub-a'), b: remembered('sub-b'), c: remembered('sub-c') }, savedAt: { a: KEPT - 86400000, c: KEPT } });
  f.keeper.start();
  assert.deepEqual(f.events.filter(Array.isArray), [['forget', 'a'], ['saved', 'a']]);
  assert.equal(f.store.hasSession('a'), false);
  assert.equal(f.store.hasSession('b'), true);
  assert.equal(f.store.hasSession('c'), true);
  assert.deepEqual(f.logs, ['forgot 1 saved session(s) from before cards mode kept sessions']);
  f.keeper.start();
  assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'forget').length, 1);
  const failing = fixture({ yaml: 'tdid only', savedAt: { a: 1, b: 1 } });
  failing.store.forgetSession = (id) => { if (id === 'a') throw new Error('C:/secret/path'); delete failing.state.sessions[id]; };
  failing.keeper.start();
  assert.equal(failing.store.hasSession('a'), true);
  assert.equal(failing.store.hasSession('b'), false);
  assert.deepEqual(failing.logs, ['forgot 1 saved session(s) from before cards mode kept sessions']);
});
