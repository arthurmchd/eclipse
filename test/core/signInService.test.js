const assert = require('node:assert/strict');
const test = require('node:test');
const { createSignInService } = require('../../src/core/signInService');

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const accounts = new Map([['test-account', { id: 'test-account', username: 'private-login', password: 'encrypted-secret', gameName: 'Example', tagLine: 'BR1' }]]);
  const calls = [];
  const statuses = [];
  const updates = [];
  const logs = [];
  let received;
  const result = { gameStarted: true, riotId: { gameName: 'Example', tagLine: 'BR1' }, session: 'private-session', sessionRejected: false };
  const store = {
    data: { settings: { riotClientPath: 'C:/Example/RiotClientServices.exe', hideRiotClient: true, closeRiotClient: true } },
    getAccount: (id) => accounts.get(id),
    getPassword: (id) => { calls.push(['get-password', id]); return 'decrypted-secret'; },
    loadSession: (id) => { calls.push(['load-session', id]); return 'remembered-session'; },
    hasSession: () => true,
    forgetSession: (id) => { calls.push(['forget-session', id]); },
    saveSession: (id, session) => { calls.push(['save-session', id, session]); },
    setCurrentAccount: (id) => { calls.push(['set-current', id]); },
    updateAccountFields: (id, fields) => { calls.push(['update', id, fields]); return { id, gameName: 'Example', tagLine: 'BR1', ...fields }; },
    publicAccount: (account) => ({ id: account.id, gameName: account.gameName, tagLine: account.tagLine }),
  };
  const riotClient = {
    runningGames: async () => { calls.push(['running-games']); return { lol: false, val: false }; },
    signIn: async (options) => { calls.push(['sign-in']); received = options; return result; },
  };
  const options = {
    store, riotClient,
    status: (event) => statuses.push(event),
    accountUpdated: (account) => updates.push(account),
    log: (text) => logs.push(text),
    onClosed: (event) => { calls.push(['on-closed', event]); },
    onLaunched: () => { calls.push(['launched']); },
    ...overrides,
  };
  const service = createSignInService(options);
  return { service, store, riotClient, accounts, result, calls, statuses, updates, logs, received: () => received };
}

async function settle(service) {
  for (let count = 0; count < 20 && service.isBusy(); count++) await flush();
  assert.equal(service.isBusy(), false);
  return service.getState();
}

test('GUI sign-in waits for completion and passes decrypted credentials only to Riot', async () => {
  const f = fixture();
  const pending = f.service.signIn('test-account', 'lol');
  assert.equal(f.service.isBusy(), true);
  assert.equal(f.service.activeAccountId(), 'test-account');
  assert.equal(f.received(), undefined);
  const response = await pending;
  assert.deepEqual(response, { ok: true, gameStarted: true });
  assert.equal(f.received().account.password, 'decrypted-secret');
  assert.equal(f.received().account.username, 'private-login');
  assert.equal(typeof f.received().session, 'function');
  assert.equal(f.received().session(), 'remembered-session');
  assert.equal(f.received().hasSavedSession, true);
  assert.equal(f.service.getState().status, 'succeeded');
  assert.equal(f.service.activeAccountId(), null);
  const exposed = JSON.stringify([response, f.service.getState(), f.updates, f.logs, f.statuses]);
  for (const secret of ['private-login', 'encrypted-secret', 'decrypted-secret', 'private-session']) assert.equal(exposed.includes(secret), false);
});

test('bridge start returns immediately and its operation survives disappearance of a UI', async () => {
  const f = fixture();
  const hold = deferred();
  let called = false;
  f.riotClient.signIn = async () => { called = true; return hold.promise; };
  const accepted = f.service.start('test-account', 'tft');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.operationId, f.service.getState().id);
  assert.equal(f.service.getState().operationId, accepted.operationId);
  assert.equal(called, false);
  await flush();
  assert.equal(called, true);
  assert.equal(f.service.getState().status, 'running');
  hold.resolve(f.result);
  assert.equal((await settle(f.service)).status, 'succeeded');
});

test('GUI and bridge requests share a mutex', async () => {
  const f = fixture();
  const hold = deferred();
  f.riotClient.signIn = async () => hold.promise;
  const pending = f.service.signIn('test-account', 'lol');
  assert.throws(() => f.service.start('test-account', 'val'), /already in progress/);
  assert.equal((await f.service.signIn('test-account', 'tft')).ok, false);
  await flush();
  hold.resolve(f.result);
  await pending;
  assert.equal(f.service.isBusy(), false);
});

for (const runningGame of ['lol', 'val']) {
  test(`Riot-login integration refuses a switch while ${runningGame} is running`, async () => {
    const f = fixture();
    f.riotClient.runningGames = async () => ({ [runningGame]: true });
    f.service.start('test-account', 'lol');
    const state = await settle(f.service);
    assert.equal(state.status, 'failed');
    assert.match(state.error, /Close League of Legends or VALORANT/);
    assert.equal(f.calls.some(([name]) => name === 'get-password' || name === 'sign-in'), false);
  });
}

test('GUI launch keeps its existing confirmation responsibility', async () => {
  const f = fixture();
  f.riotClient.runningGames = async () => { throw new Error('GUI should have already confirmed switching'); };
  assert.equal((await f.service.signIn('test-account', 'val')).ok, true);
});

test('integrated launch always keeps the client hidden despite old visible-client preferences', async () => {
  const f = fixture();
  f.store.data.settings.hideRiotClient = false;
  f.store.data.settings.closeRiotClient = false;
  f.store.hasSession = () => false;
  f.service.start('test-account', 'lol');
  await settle(f.service);
  assert.equal(f.received().hide, true);
  assert.equal(f.received().closeClient, true);
  assert.equal(f.received().hasSavedSession, false);
  assert.equal(f.store.data.settings.hideRiotClient, false);
  assert.equal(f.store.data.settings.closeRiotClient, false);
});

test('normal manager preserves explicit visible-client preferences', async () => {
  const f = fixture();
  f.store.data.settings.hideRiotClient = false;
  f.store.data.settings.closeRiotClient = false;
  await f.service.signIn('test-account', 'lol');
  assert.equal(f.received().hide, false);
  assert.equal(f.received().closeClient, false);
});

test('cancellation before scheduled execution performs no client or credential work', async () => {
  const f = fixture();
  f.service.start('test-account', 'lol');
  assert.deepEqual(f.service.cancel(), { ok: true });
  const state = await settle(f.service);
  assert.equal(state.status, 'cancelled');
  assert.equal(state.text, 'Sign-in cancelled');
  assert.equal(state.needsAttention, false);
  assert.equal(f.calls.length, 0);
});

test('cancellation propagates to an active Riot operation and frees the mutex', async () => {
  const f = fixture();
  f.riotClient.signIn = async ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  const pending = f.service.signIn('test-account', 'lol');
  await flush();
  f.service.cancel();
  assert.deepEqual(await pending, { ok: false, error: 'Sign-in cancelled', cancelled: true });
  assert.equal(f.service.getState().status, 'cancelled');
  assert.equal(f.service.isBusy(), false);
});

test('a rejected old session is forgotten before persisting the replacement', async () => {
  const f = fixture();
  f.result.sessionRejected = true;
  await f.service.signIn('test-account', 'lol');
  const forgotten = f.calls.findIndex(([name]) => name === 'forget-session');
  const saved = f.calls.findIndex(([name]) => name === 'save-session');
  assert.ok(forgotten >= 0 && saved > forgotten);
  assert.equal(f.calls.find(([name]) => name === 'update')[2].lastGame, 'lol');
  assert.equal(f.updates.length, 1);
});

test('authentication errors clear rejected sessions and cleanup failures remain handled', async () => {
  const f = fixture();
  f.riotClient.signIn = async () => { throw Object.assign(new Error('Wrong username or password'), { sessionRejected: true }); };
  f.store.forgetSession = () => { throw new Error('storage unavailable'); };
  const response = await f.service.signIn('test-account', 'lol');
  assert.equal(response.ok, false);
  assert.equal(response.error, 'Wrong username or password');
  assert.equal(f.service.getState().status, 'failed');
  assert.equal(f.service.isBusy(), false);
  assert.ok(f.logs.some((line) => /could not forget/.test(line)));
});

test('progress is public metadata and getState returns an independent snapshot', async () => {
  const f = fixture();
  f.riotClient.signIn = async (options) => {
    options.status('Enter the 2FA code', { needsAttention: true });
    const state = f.service.getState();
    assert.equal(state.needsAttention, true);
    state.text = 'external mutation';
    assert.equal(f.service.getState().text, 'Enter the 2FA code');
    return f.result;
  };
  await f.service.signIn('test-account', 'lol');
  assert.deepEqual(f.statuses, [{ id: 'test-account', text: 'Enter the 2FA code', needsAttention: true, nativeClient: false }]);
  assert.equal(f.service.getState().needsAttention, false);
});

test('native verification context is published for manual handoff and cleared by later progress', async () => {
  const operations = [];
  const f = fixture({ operationUpdated: (operation) => operations.push(operation) });
  const hold = deferred();
  let report;
  f.riotClient.signIn = async (options) => { report = options.status; return hold.promise; };
  const pending = f.service.signIn('test-account', 'lol');
  assert.equal(f.service.getState().nativeClient, false);
  await flush();
  report('Complete the security check in Riot', { needsAttention: true, nativeClient: true });
  assert.equal(f.service.getState().nativeClient, true);
  assert.equal(f.service.getState().needsAttention, true);
  assert.deepEqual(f.statuses.at(-1), { id: 'test-account', text: 'Complete the security check in Riot', needsAttention: true, nativeClient: true });
  assert.equal(operations.at(-1).nativeClient, true);
  report('Preparing the game', { needsAttention: false });
  assert.equal(f.service.getState().nativeClient, false);
  assert.equal(f.statuses.at(-1).nativeClient, false);
  hold.resolve(f.result);
  await pending;
});

test('observer and logging failures do not change a successful launch or hang completion', async () => {
  const fail = () => { throw new Error('observer unavailable'); };
  const f = fixture({ log: fail, status: fail, accountUpdated: fail, onLaunched: fail });
  f.riotClient.signIn = async (options) => { options.status('Starting'); return f.result; };
  assert.equal((await f.service.signIn('test-account', 'lol')).ok, true);
  assert.equal(f.service.getState().status, 'succeeded');
  assert.equal(f.service.isBusy(), false);
});

test('credentials edited before execution are never mixed with the original username', async () => {
  const f = fixture();
  const pending = f.service.signIn('test-account', 'lol');
  f.accounts.get('test-account').password = 'different-encrypted-value';
  const response = await pending;
  assert.equal(response.ok, false);
  assert.match(response.error, /credentials changed/);
  assert.equal(f.calls.some(([name]) => name === 'get-password' || name === 'sign-in'), false);
  assert.equal(JSON.stringify(f.service.getState()).includes('different-encrypted-value'), false);
});

test('client errors and progress cannot expose the decrypted password or username', async () => {
  const f = fixture();
  f.riotClient.signIn = async (options) => {
    options.status(`Unexpected input: ${options.account.username} ${options.account.password}`);
    options.log(`Input failed: ${options.account.password}`);
    throw new Error(`Input failed: ${options.account.username} ${options.account.password}`);
  };
  const response = await f.service.signIn('test-account', 'lol');
  const exposed = JSON.stringify([response, f.service.getState(), f.logs, f.statuses]);
  assert.equal(exposed.includes('private-login'), false);
  assert.equal(exposed.includes('decrypted-secret'), false);
  assert.match(response.error, /\[redacted\]/);
});

test('unsupported games and incomplete accounts never start an operation', async () => {
  const f = fixture();
  assert.throws(() => f.service.start('test-account', 'unknown'), /supported game/);
  assert.throws(() => f.service.start('missing-account', 'lol'), /not found/);
  f.accounts.get('test-account').password = '';
  assert.equal((await f.service.signIn('test-account', 'lol')).ok, false);
  assert.equal(f.service.getState(), null);
  assert.equal(f.service.isBusy(), false);
});

test('a launch that did not open the game is not reported as success', async () => {
  const f = fixture();
  f.result.gameStarted = false;
  const response = await f.service.signIn('test-account', 'lol');
  assert.equal(response.ok, false);
  assert.equal(f.service.getState().status, 'failed');
  assert.equal(f.calls.some(([name]) => name === 'launched'), false);
  const fields = f.calls.find(([name]) => name === 'update')[2];
  assert.equal(fields.lastPlayed, undefined);
  assert.equal(fields.lastGame, undefined);
});

test('non-Error failures and asynchronous observers do not leave an operation pending', async () => {
  const fail = async () => { throw new Error('async observer unavailable'); };
  const f = fixture({ log: fail, status: fail });
  f.riotClient.signIn = async (options) => { options.status('Starting'); throw null; };
  const response = await f.service.signIn('test-account', 'lol');
  assert.equal(response.ok, false);
  assert.equal(response.error, 'Sign-in failed');
  assert.equal(f.service.isBusy(), false);
  await flush();
});
