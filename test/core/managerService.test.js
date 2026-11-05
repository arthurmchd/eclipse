const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagerService, createManagerEvents } = require('../../src/core/managerService');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(options = {}) {
  const calls = [], timers = [];
  const accounts = new Map([['account-1', { id: 'account-1', username: 'fixture-user', gameName: 'Example', tagLine: 'BR1', region: 'br1', password: 'fixture-encrypted', hasPassword: true, hasSession: true, stats: { lol: { rank: 'GOLD', token: 'fixture-token' } } }]]);
  let clipboardText = '', active = null;
  const settings = { refreshMinutes: 30, streamerMode: false, riotApiKeyMasked: 'RGAPI-fi…1234' };
  const store = {
    dir: 'C:/Fixture/Accounts', data: { settings },
    getAccount: (id) => accounts.get(id),
    listAccounts: () => [...accounts.values()],
    publicAccount: (account) => account,
    publicSettings: () => ({ ...settings }),
    upsertAccount(input) {
      calls.push(['save', input]);
      const account = { ...accounts.get(input.id), ...input, id: input.id || 'account-2', hasPassword: true };
      accounts.set(account.id, account);
      return account;
    },
    updateAccountFields(id, fields) { Object.assign(accounts.get(id), fields); return accounts.get(id); },
    deleteAccount: (id) => accounts.delete(id),
    forgetSession(id) { accounts.get(id).hasSession = false; },
    getPassword: () => 'fixture-plaintext',
    updateSettings(input) {
      calls.push(['settings', input]);
      for (const [key, value] of Object.entries(input)) if (!key.endsWith('ApiKey')) settings[key] = value;
      return { ...settings };
    },
  };
  const events = createManagerEvents();
  const launchService = {
    activeAccountId: () => active,
    getState: () => ({ id: 'operation-1', status: 'running', password: 'fixture-plaintext' }),
    startFromManager(id, game) { calls.push(['sign-in', id, game]); return { ok: true, operationId: 'operation-1' }; },
    cancel() { calls.push(['cancel']); return { ok: true }; },
  };
  const clipboard = { writeText: (value) => { clipboardText = value; }, readText: () => clipboardText, clear: () => { clipboardText = ''; } };
  const service = createManagerService({
    store, launchService, clipboard, events,
    riotClient: { runningGames: async () => ({ lol: false, val: true }), detectClientPath: () => 'C:/Fixture/RiotClientServices.exe' },
    shell: { openPath: async (value) => calls.push(['folder', value]), openExternal: async (value) => calls.push(['url', value]) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:/Fixture/RiotClientServices.exe'] }) },
    refreshAll: async (ids) => calls.push(['refresh', ids]),
    scheduleRefresh: () => calls.push(['schedule']),
    showRiotClient: async () => ({ ok: true }),
    initContext: () => ({ regions: { br1: {} }, valRegions: ['br'], nextRefresh: '2026-10-27T12:00:00.000Z' }),
    setTimer(callback, delay) { timers.push({ callback, delay }); return { unref() {} }; },
    ...options,
  });
  return { service, events, calls, accounts, settings, timers, clipboard, clipboardText: () => clipboardText, active: (id) => { active = id; } };
}

test('embedded initialization and operations retain account metadata without saved credentials', async () => {
  const f = fixture();
  const data = await f.service.dispatch('init');
  assert.equal(data.embedded, true);
  assert.equal(data.accounts[0].username, 'fixture-user');
  assert.equal(data.accounts[0].hasPassword, true);
  assert.equal(data.accounts[0].hasSession, true);
  assert.equal(data.accounts[0].stats.lol.rank, 'GOLD');
  assert.equal(data.settings.riotApiKeyMasked, 'RGAPI-fi…1234');
  const exposed = JSON.stringify([data, await f.service.dispatch('operation')]);
  for (const value of ['fixture-encrypted', 'fixture-token', 'fixture-plaintext']) assert.equal(exposed.includes(value), false);
});

test('full editor creates, edits, patches, forgets sessions and deletes accounts', async () => {
  const f = fixture();
  const input = { gameName: 'New', tagLine: 'BR1', region: 'br1', valRegion: 'br', username: 'new-fixture-user', password: 'new-fixture-password', note: 'demo', lastSeason: { lol: 'Gold', tft: '', val: '' }, ban: null };
  const saved = await f.service.dispatch('saveAccount', [input]);
  assert.equal(saved.id, 'account-2');
  assert.equal(saved.password, undefined);
  assert.equal(f.calls[0][1].password, 'new-fixture-password');
  await flush();
  assert.deepEqual(f.calls.at(-1), ['refresh', ['account-2']]);
  const edited = await f.service.dispatch('saveAccount', [{ ...input, id: saved.id, password: undefined, gameName: 'Edited' }]);
  assert.equal(edited.gameName, 'Edited');
  assert.equal(Object.hasOwn(f.calls.findLast(([name]) => name === 'save')[1], 'password'), false);
  const patched = await f.service.dispatch('patchAccount', [saved.id, { pinned: true, note: 'updated', ban: { game: 'lol', permanent: true, until: null } }]);
  assert.equal(patched.pinned, true);
  assert.equal(patched.ban.permanent, true);
  assert.equal((await f.service.dispatch('forgetSession', ['account-1'])).hasSession, false);
  assert.equal(await f.service.dispatch('deleteAccount', [saved.id]), true);
  assert.equal(f.accounts.has(saved.id), false);
});

test('management commands reject unknown fields, invalid values and active credential edits', async () => {
  const f = fixture();
  const input = { gameName: 'New', tagLine: 'BR1', username: 'demo', region: 'br1', password: 'demo' };
  const requests = [
    ['saveAccount', [{ ...input, region: 'unknown' }]],
    ['saveAccount', [{ ...input, password: undefined }]],
    ['saveAccount', [{ ...input, session: 'disallowed' }]],
    ['patchAccount', ['account-1', { password: 'disallowed' }]],
    ['patchAccount', ['account-1', { pinned: 'yes' }]],
    ['patchAccount', ['account-1', { ban: { game: 'val', permanent: false, until: 'invalid' } }]],
    ['deleteAccount', ['../account-1']],
    ['saveSettings', [{ refreshMinutes: -1 }]],
    ['saveSettings', [{ unexpected: true }]],
    ['saveSettings', [{ staySignedIn: 'no' }]],
    ['constructor', []], ['init', ['extra']], [['init'], []],
  ];
  for (const [method, args] of requests) await assert.rejects(f.service.dispatch(method, args), { status: 400 });
  f.active('account-1');
  for (const [method, args] of [['deleteAccount', ['account-1']], ['forgetSession', ['account-1']], ['saveAccount', [{ ...input, id: 'account-1' }]]]) {
    await assert.rejects(f.service.dispatch(method, args), { status: 409 });
  }
  assert.equal((await f.service.dispatch('patchAccount', ['account-1', { pinned: true }])).pinned, true);
  assert.equal(f.calls.length, 0);
});

test('copy password stays in the native clipboard and clears only the same content', async () => {
  const f = fixture();
  assert.equal(await f.service.dispatch('copy', ['account-1', 'password']), true);
  assert.equal(f.clipboardText(), 'fixture-plaintext');
  assert.equal(f.timers[0].delay, 20000);
  f.clipboard.writeText('something else');
  f.timers[0].callback();
  assert.equal(f.clipboardText(), 'something else');
  await f.service.dispatch('copy', ['account-1', 'password']);
  f.timers[1].callback();
  assert.equal(f.clipboardText(), '');
  await f.service.dispatch('copy', ['account-1', 'riotId']);
  assert.equal(f.clipboardText(), 'Example#BR1');
});

test('settings return masked keys and restart the refresh schedule', async () => {
  const f = fixture();
  const settings = await f.service.dispatch('saveSettings', [{ refreshMinutes: 15, streamerMode: true, staySignedIn: false, riotApiKey: 'fixture-key' }]);
  assert.equal(settings.streamerMode, true);
  assert.equal(settings.staySignedIn, false);
  assert.equal(settings.clientFound, true);
  assert.equal(settings.nextRefresh, '2026-10-27T12:00:00.000Z');
  assert.equal(settings.riotApiKey, undefined);
  assert.deepEqual(f.calls.map(([name]) => name), ['settings', 'schedule']);
  assert.equal(await f.service.dispatch('pickClientPath'), 'C:/Fixture/RiotClientServices.exe');
  assert.equal(await f.service.dispatch('openDataFolder'), true);
});

test('embedded launch acknowledges immediately and exposes cancel, recovery and game status', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.dispatch('signIn', ['account-1', 'tft']), { ok: true, operationId: 'operation-1' });
  assert.deepEqual(f.calls[0], ['sign-in', 'account-1', 'tft']);
  assert.deepEqual(await f.service.dispatch('runningGames'), { lol: false, val: true });
  assert.deepEqual(await f.service.dispatch('cancelSignIn'), { ok: true });
  assert.deepEqual(await f.service.dispatch('showRiotClient'), { ok: true });
  assert.deepEqual(await f.service.dispatch('signIn', ['account-1', 'riot']), { ok: true, operationId: 'operation-1' });
  assert.deepEqual(f.calls.at(-1), ['sign-in', 'account-1', 'riot']);
  await assert.rejects(f.service.dispatch('signIn', ['account-1', 'other']), { status: 400 });
});

test('rank refresh returns before work and validates the selected IDs', async () => {
  const f = fixture();
  assert.equal((await f.service.dispatch('refresh', [['account-1']])).started, true);
  await flush();
  assert.deepEqual(f.calls, [['refresh', ['account-1']]]);
  await assert.rejects(f.service.dispatch('refresh', [['unknown']]), { status: 404 });
  await assert.rejects(f.service.dispatch('refresh', [Array(129).fill('account-1')]), { status: 400 });
});

test('external navigation permits HTTPS only without URL credentials', async () => {
  const f = fixture();
  await f.service.dispatch('openExternal', ['https://example.com/help']);
  assert.deepEqual(f.calls, [['url', 'https://example.com/help']]);
  for (const url of ['file:///C:/private', 'javascript:alert(1)', 'http://example.com/', 'https://user:pass@example.com']) await assert.rejects(f.service.dispatch('openExternal', [url]), { status: 400 });
});

test('event history strips secrets, keeps snapshots and signals overflow resynchronization', () => {
  const events = createManagerEvents({ limit: 2 });
  const account = { id: 'account-1', gameName: 'Original', password: 'private', hasPassword: true, hasSession: true, stats: { authorization: 'private', rank: 'SILVER' } };
  events.publish('account-updated', account);
  account.gameName = 'Changed';
  const snapshot = events.read(0);
  assert.equal(snapshot.events[0].payload.gameName, 'Original');
  assert.equal(snapshot.events[0].payload.hasPassword, true);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  snapshot.events[0].payload.gameName = 'Mutated';
  assert.equal(events.read(0).events[0].payload.gameName, 'Original');
  events.publish('refresh-progress', { done: 1, total: 2 });
  events.publish('next-refresh', null);
  events.publish('unknown', {});
  assert.equal(events.cursor(), 3);
  assert.equal(events.read(0).reset, true);
  assert.equal(events.read(1).reset, false);
  assert.equal(events.read(10).reset, true);
  assert.throws(() => events.read(-1), { status: 400 });
  const bounded = createManagerEvents({ maxBytes: 100 });
  bounded.publish('sign-in-status', { text: 'x'.repeat(200) });
  assert.deepEqual(bounded.read(0), { cursor: 1, reset: true, events: [] });
});

test('language is saved only as pt or en and announces the settings change', async () => {
  const changed = [];
  const f = fixture({ settingsChanged: (settings) => changed.push(settings.language) });
  for (const language of ['fr', 'EN', '', 1, null, true]) await assert.rejects(f.service.dispatch('saveSettings', [{ language }]), /Invalid setting/);
  assert.deepEqual(changed, []);
  assert.equal((await f.service.dispatch('saveSettings', [{ language: 'en' }])).language, 'en');
  assert.equal((await f.service.dispatch('saveSettings', [{ language: 'pt', refreshMinutes: 5 }])).language, 'pt');
  assert.deepEqual(changed, ['en', 'pt']);
  const failing = fixture({ settingsChanged: () => { throw new Error('tray unavailable'); } });
  assert.equal((await failing.service.dispatch('saveSettings', [{ language: 'en' }])).language, 'en');
});
