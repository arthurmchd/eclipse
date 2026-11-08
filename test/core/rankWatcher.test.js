const test = require('node:test');
const assert = require('node:assert/strict');
const { createRankWatcher, mergeReading } = require('../../src/core/rankWatcher');

const AT = '2026-11-08T12:00:00.000Z';
const sameRiotId = (a, b) => Boolean(a?.gameName && b?.gameName) && a.gameName.toLowerCase() === b.gameName.toLowerCase() && (a.tagLine || '').toLowerCase() === (b.tagLine || '').toLowerCase();
const entry = (tier, lp, extra = {}) => ({ tier, division: ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? '' : 'II', lp, wins: 10, losses: 9, hotStreak: false, ...extra });
const leagueReading = (riotId = { gameName: 'synthetic', tagLine: 'br1' }) => ({
  riotId,
  lol: { level: 300, iconId: 7, solo: entry('GOLD', 50), flex: null },
  tft: { ranked: entry('SILVER', 20), doubleUp: null },
});
const valReading = (tier = 16) => ({ riotId: { gameName: 'Synthetic', tagLine: 'BR1' }, val: { tier, tierName: tier === 16 ? 'Platinum 2' : 'Platinum 3', level: 90, card: null } });

function fixture({ accounts, processes = { client: true, lol: true }, league = () => leagueReading(), valorant = null, busy = false, time = Date.parse(AT) } = {}) {
  const saved = [], updates = [], lines = [], calls = [];
  let timer = null, clock = time, isBusy = busy;
  const store = {
    data: { accounts: accounts || [{ id: 'a', gameName: 'Synthetic', tagLine: 'BR1', stats: {} }, { id: 'b', gameName: 'Other', tagLine: 'BR1' }] },
    updateAccountFields(id, fields) { const account = this.data.accounts.find((item) => item.id === id); Object.assign(account, fields); saved.push({ id, fields }); return { id, public: true }; },
  };
  const riot = {
    sameRiotId,
    look: () => ({ processes: async () => { calls.push('processes'); if (processes instanceof Error) throw processes; return processes; } }),
    gameRanks: {
      league: async () => { calls.push('league'); return typeof league === 'function' ? league() : league; },
      valorant: async () => { calls.push('valorant'); return valorant; },
    },
  };
  const watcher = createRankWatcher({
    riot, store, busy: () => isBusy, log: (line) => lines.push(line), onUpdated: (account) => updates.push(account),
    setTimeout: (fn, ms) => { timer = { fn, ms }; return timer; }, clearTimeout: () => { timer = null; }, now: () => clock,
  });
  return { watcher, store, saved, updates, lines, calls, timer: () => timer, setBusy: (value) => { isBusy = value; }, advance: (ms) => { clock += ms; } };
}

test('an open League client updates the saved account with the same Riot ID, LoL and TFT, and tells the cards', async () => {
  const f = fixture();
  f.watcher.start();
  await new Promise(setImmediate);
  assert.deepEqual(f.calls, ['processes', 'league']);
  assert.equal(f.saved.length, 1);
  const { stats } = f.store.data.accounts[0];
  assert.deepEqual(stats.lol, { level: 300, iconId: 7, solo: entry('GOLD', 50), flex: null, updatedAt: AT });
  assert.deepEqual(stats.tft, { ranked: entry('SILVER', 20), doubleUp: null, updatedAt: AT });
  assert.deepEqual(stats.errors, {});
  assert.deepEqual(f.updates, [{ id: 'a', public: true }]);
  assert.deepEqual(f.lines, ['game ranks: updated a saved account from the League client']);
  assert.equal(f.timer().ms, 60000);
});

test('the same ranks are written again only after ten minutes, and a change is written at once', async () => {
  const f = fixture();
  f.watcher.start();
  await new Promise(setImmediate);
  f.advance(60000);
  assert.equal(await f.watcher.check(), false);
  f.advance(9 * 60000);
  assert.equal(await f.watcher.check(), true);
  assert.equal(f.saved.length, 2);
  f.store.data.accounts[0].stats.lol.solo.lp = 10;
  f.advance(60000);
  assert.equal(await f.watcher.check(), true);
  assert.equal(f.store.data.accounts[0].stats.lol.solo.lp, 50);
});

test('an account that is not saved, or saved twice, is never touched', async () => {
  const twice = [{ id: 'a', gameName: 'Synthetic', tagLine: 'BR1' }, { id: 'b', gameName: 'SYNTHETIC', tagLine: 'br1' }];
  for (const accounts of [[{ id: 'b', gameName: 'Other', tagLine: 'BR1' }], twice]) {
    const f = fixture({ accounts });
    f.watcher.start();
    await new Promise(setImmediate);
    assert.deepEqual(f.saved, []);
    assert.deepEqual(f.lines, ['game ranks: the League client is signed in to an account that is not saved in Eclipse']);
  }
});

test('nothing is read without a game open or during a sign-in, and an unreadable game keeps the ranks', async () => {
  const closed = fixture({ processes: { client: true } });
  closed.watcher.start();
  await new Promise(setImmediate);
  assert.deepEqual(closed.calls, ['processes']);

  const signingIn = fixture({ busy: true });
  signingIn.watcher.start();
  await new Promise(setImmediate);
  assert.deepEqual(signingIn.calls, []);

  const unreadable = fixture({ league: null });
  unreadable.watcher.start();
  await new Promise(setImmediate);
  assert.deepEqual(unreadable.saved, []);
  assert.deepEqual(unreadable.lines, ['game ranks: could not read the ranks from the League client']);
  await unreadable.watcher.check();
  assert.equal(unreadable.lines.length, 1);

  const broken = fixture({ processes: new Error('tasklist failed') });
  broken.watcher.start();
  await new Promise(setImmediate);
  assert.deepEqual(broken.lines, ['game ranks: could not check the running games']);
});

test('VALORANT is read from the Riot Client only with VALORANT open', async () => {
  const f = fixture({ processes: { client: true, val: true }, valorant: valReading() });
  f.watcher.start();
  await new Promise(setImmediate);
  assert.deepEqual(f.calls, ['processes', 'valorant']);
  assert.equal(f.store.data.accounts[0].stats.val.tierName, 'Platinum 2');
  assert.deepEqual(f.lines, ['game ranks: updated a saved account from the Riot Client']);
});

test('stopping ends the polling and a reading that arrives after it is not written', async () => {
  let release;
  const f = fixture({ league: () => new Promise((resolve) => { release = resolve; }) });
  f.watcher.start();
  await new Promise(setImmediate);
  f.watcher.stop();
  release(leagueReading());
  await new Promise(setImmediate);
  assert.deepEqual(f.saved, []);
  assert.equal(f.timer(), null);
  assert.equal(await f.watcher.check(), false);
});

test('a reading keeps what only a key gives while the rank is the same: apex cutoffs, VALORANT RR, peak and last season', () => {
  const cutoffs = { challenger: 900, grandmaster: 400 };
  const before = {
    lol: { level: 1, iconId: 2, banner: 'kept', solo: entry('MASTER', 100, { cutoffs }), flex: entry('MASTER', 50, { cutoffs }), updatedAt: 'old' },
    val: { tier: 16, tierName: 'Platinum 2', rr: 45, lastChange: 12, peak: { tier: 20 }, lastSeason: { tier: 15 }, region: 'br', level: 80, card: 'old-card', updatedAt: 'old' },
    errors: { lol: 'No Riot API key (Settings)', val: 'No HenrikDev API key (Settings)', tft: 'kept' },
  };
  const read = { lol: { level: null, iconId: 9, solo: entry('MASTER', 130), flex: entry('DIAMOND', 10) }, val: { tier: 16, tierName: 'Platinum 2', level: 81, card: null } };
  const next = mergeReading(before, read, AT);
  assert.deepEqual(next.lol, { level: 1, iconId: 9, banner: 'kept', solo: entry('MASTER', 130, { cutoffs }), flex: entry('DIAMOND', 10), updatedAt: AT });
  assert.deepEqual(next.val, { tier: 16, tierName: 'Platinum 2', rr: 45, lastChange: 12, peak: { tier: 20 }, lastSeason: { tier: 15 }, region: 'br', level: 81, card: 'old-card', updatedAt: AT });
  assert.deepEqual(next.errors, { tft: 'kept' });
  const moved = mergeReading(before, { val: { tier: 17, tierName: 'Platinum 3', level: null, card: 'new-card' } }, AT).val;
  assert.deepEqual([moved.rr, moved.lastChange, moved.level, moved.card, moved.peak], [null, null, 80, 'new-card', { tier: 20 }]);
  assert.deepEqual(mergeReading(undefined, { tft: { ranked: null, doubleUp: null } }, AT), { tft: { ranked: null, doubleUp: null, updatedAt: AT }, errors: {} });
});

test('the League client never sends a hot streak, so the one from a key stays until the queue has a new game', () => {
  const before = { lol: { solo: entry('GOLD', 40, { hotStreak: true }), flex: entry('GOLD', 40, { hotStreak: true }) }, tft: { ranked: entry('SILVER', 20, { hotStreak: true }), doubleUp: null } };
  const read = { lol: { level: 1, iconId: 2, solo: entry('GOLD', 40), flex: entry('GOLD', 60, { wins: 11 }) }, tft: { ranked: entry('SILVER', 20), doubleUp: entry('IRON', 0) } };
  const next = mergeReading(before, read, AT);
  assert.deepEqual([next.lol.solo.hotStreak, next.lol.flex.hotStreak, next.tft.ranked.hotStreak, next.tft.doubleUp.hotStreak], [true, false, true, false]);
  assert.equal(mergeReading(next, read, AT).lol.solo.hotStreak, true);
});
