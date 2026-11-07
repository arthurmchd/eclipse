const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRankApi, ladderCutoffs } = require('../../src/core/rankApi');

const hash = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body });

function fixture(routes) {
  const calls = [];
  let clock = Date.parse('2026-11-05T12:00:00Z');
  const fetch = async (url, init) => {
    calls.push({ url, token: init?.headers?.['X-Riot-Token'] ?? init?.headers?.Authorization });
    for (const [pattern, reply] of routes) {
      if (url.includes(pattern)) return typeof reply === 'function' ? reply(url) : response(200, reply);
    }
    return response(404, {});
  };
  const api = createRankApi({ fetch, wait: async () => {}, now: () => clock });
  return { api, calls, advance: (ms) => { clock += ms; }, count: (pattern) => calls.filter((call) => call.url.includes(pattern)).length };
}

const profile = (puuid) => [
  [`/summoners/by-puuid/${puuid}`, { summonerLevel: 300, profileIconId: 7 }],
  [`/tft/league/v1/by-puuid/${puuid}`, []],
];

const account = (overrides = {}) => ({
  id: 'a1', gameName: 'Old Name', tagLine: 'BR1', region: 'br1',
  puuidCache: { [hash('riot-key')]: { riotId: 'Old Name#BR1', puuid: 'p-1' } },
  ...overrides,
});

test('a Riot ID renamed on the Riot site follows the saved PUUID and updates the account', async () => {
  const { api, calls, count } = fixture([
    ['/accounts/by-puuid/p-1', { puuid: 'p-1', gameName: 'New Name', tagLine: 'NEW' }],
    ['/entries/by-puuid/p-1', []],
    ['/v3/mmr/br/pc/New%20Name/NEW', { data: { current: { tier: { id: 10, name: 'Silver 2' }, rr: 40 } } }],
    ['/v1/account/New%20Name/NEW', { data: { account_level: 50 } }],
    ...profile('p-1'),
  ]);
  const { fields, errors } = await api.refreshAccount(account(), { riot: 'riot-key', henrik: 'henrik-key' });
  assert.equal(fields.gameName, 'New Name');
  assert.equal(fields.tagLine, 'NEW');
  assert.deepEqual(fields.puuidCache[hash('riot-key')], { riotId: 'New Name#NEW', puuid: 'p-1' });
  assert.equal(fields.stats.lol.level, 300);
  assert.equal(fields.stats.val.tierName, 'Silver 2');
  assert.deepEqual(errors, {});
  assert.equal(count('/riot/account/v1/'), 1);
  assert.equal(count('/by-riot-id/'), 0);
  assert.ok(calls.some((call) => call.url.includes('/v3/mmr/br/pc/New%20Name/NEW')));
});

test('an unchanged Riot ID costs one account lookup and leaves the name alone', async () => {
  const { api, count } = fixture([
    ['/accounts/by-puuid/p-1', { puuid: 'p-1', gameName: 'Old Name', tagLine: 'BR1' }],
    ['/entries/by-puuid/p-1', []],
    ...profile('p-1'),
  ]);
  const { fields, errors } = await api.refreshAccount(account(), { riot: 'riot-key' });
  assert.equal(Object.hasOwn(fields, 'gameName'), false);
  assert.equal(Object.hasOwn(fields, 'tagLine'), false);
  assert.equal(count('/riot/account/v1/'), 1);
  assert.equal(errors.lol, undefined);
  assert.equal(errors.tft, undefined);
});

test('a failed rename check keeps the saved PUUID and still refreshes the ranks', async () => {
  const { api, count } = fixture([
    ['/accounts/by-puuid/p-1', () => response(500, { status: { message: 'Internal error' } })],
    ['/entries/by-puuid/p-1', []],
    ...profile('p-1'),
  ]);
  const { fields, errors } = await api.refreshAccount(account(), { riot: 'riot-key' });
  assert.equal(errors.lol, undefined);
  assert.equal(fields.stats.lol.level, 300);
  assert.equal(Object.hasOwn(fields, 'gameName'), false);
  assert.deepEqual(fields.puuidCache[hash('riot-key')], { riotId: 'Old Name#BR1', puuid: 'p-1' });
  assert.equal(count('/by-riot-id/'), 0);
});

test('a Riot ID edited in Eclipse looks up the typed name instead of the saved PUUID', async () => {
  const { api, count } = fixture([
    ['/by-riot-id/Other/BR1', { puuid: 'p-2', gameName: 'Other', tagLine: 'BR1' }],
    ['/entries/by-puuid/p-2', []],
    ...profile('p-2'),
  ]);
  const { fields } = await api.refreshAccount(account({ gameName: 'Other' }), { riot: 'riot-key' });
  assert.equal(count('/accounts/by-puuid/'), 0);
  assert.deepEqual(fields.puuidCache[hash('riot-key')], { riotId: 'Other#BR1', puuid: 'p-2' });
  assert.equal(fields.stats.lol.level, 300);
});

test('a separate TFT key looks up the new name found by the League key in the same refresh', async () => {
  const { api, calls } = fixture([
    ['/accounts/by-puuid/p-1', { puuid: 'p-1', gameName: 'New Name', tagLine: 'NEW' }],
    ['/by-riot-id/New%20Name/NEW', { puuid: 't-1', gameName: 'New Name', tagLine: 'NEW' }],
    ['/entries/by-puuid/p-1', []],
    ...profile('p-1'),
    ['/tft/league/v1/by-puuid/t-1', [{ queueType: 'RANKED_TFT', tier: 'GOLD', rank: 'II', leaguePoints: 30, wins: 5, losses: 4 }]],
  ]);
  const { fields, errors } = await api.refreshAccount(account(), { riot: 'riot-key', tft: 'tft-key' });
  assert.deepEqual(errors, { val: 'No HenrikDev API key (Settings)' });
  assert.equal(fields.stats.tft.ranked.tier, 'GOLD');
  assert.deepEqual(fields.puuidCache[hash('tft-key')], { riotId: 'New Name#NEW', puuid: 't-1' });
  assert.ok(calls.some((call) => call.url.includes('/by-riot-id/New%20Name/NEW') && call.token === 'tft-key'));
  assert.equal(calls.some((call) => call.url.includes('/by-riot-id/Old')), false);
});

test('the cutoffs come from the whole Master+ ladder, counting Masters above the lowest Grandmasters', () => {
  const entries = (...points) => points.map((leaguePoints) => ({ leaguePoints }));
  assert.deepEqual(ladderCutoffs([entries(1000, 900, 800), entries(700, 600, 500, 450), entries(650, 300)]), { challenger: 800, grandmaster: 500 });
  assert.deepEqual(ladderCutoffs([entries(1000, 900), [], entries(650)]), { challenger: 900, grandmaster: null });
  assert.deepEqual(ladderCutoffs([[], [], []]), { challenger: null, grandmaster: null });
});

const apexRoutes = (failing = false) => [
  ['/challengerleagues/by-queue/RANKED_SOLO_5x5', failing ? () => response(503, {}) : { entries: [{ leaguePoints: 1100 }, { leaguePoints: 950 }] }],
  ['/grandmasterleagues/by-queue/RANKED_SOLO_5x5', { entries: [{ leaguePoints: 640 }, { leaguePoints: 500 }, { leaguePoints: 410 }] }],
  ['/masterleagues/by-queue/RANKED_SOLO_5x5', { entries: [{ leaguePoints: 520 }, { leaguePoints: 215 }, { leaguePoints: 40 }] }],
];
const league = (puuid, tier, lp) => [`/entries/by-puuid/${puuid}`, [
  { queueType: 'RANKED_SOLO_5x5', tier, rank: 'I', leaguePoints: lp, wins: 80, losses: 60 },
  { queueType: 'RANKED_FLEX_SR', tier: 'DIAMOND', rank: 'II', leaguePoints: 10, wins: 4, losses: 3 },
]];
const named = (puuid, gameName) => [`/accounts/by-puuid/${puuid}`, { puuid, gameName, tagLine: 'BR1' }];

test('Master and above get the Grandmaster and Challenger cutoffs, fetched once per region and queue', async () => {
  const { api, count, advance } = fixture([
    ...apexRoutes(), named('p-1', 'Old Name'), named('p-2', 'Second'), league('p-1', 'MASTER', 215), league('p-2', 'GRANDMASTER', 480), ...profile('p-1'), ...profile('p-2'),
  ]);
  const second = account({ id: 'a2', gameName: 'Second', puuidCache: { [hash('riot-key')]: { riotId: 'Second#BR1', puuid: 'p-2' } } });
  const first = await api.refreshAccount(account(), { riot: 'riot-key' });
  const other = await api.refreshAccount(second, { riot: 'riot-key' });
  assert.deepEqual(first.fields.stats.lol.solo.cutoffs, { challenger: 950, grandmaster: 500 });
  assert.deepEqual(other.fields.stats.lol.solo.cutoffs, { challenger: 950, grandmaster: 500 });
  assert.equal(first.fields.stats.lol.solo.division, '');
  assert.equal(Object.hasOwn(first.fields.stats.lol.flex, 'cutoffs'), false);
  assert.equal(count('/challengerleagues/'), 1);
  assert.equal(count('/grandmasterleagues/'), 1);
  assert.equal(count('/masterleagues/'), 1);
  assert.equal(count('RANKED_FLEX_SR'), 0);
  advance(11 * 60000);
  await api.refreshAccount(account(), { riot: 'riot-key' });
  assert.equal(count('/challengerleagues/'), 2);
});

test('accounts below Master never download the apex ladders', async () => {
  const { api, count } = fixture([named('p-1', 'Old Name'), league('p-1', 'DIAMOND', 90), ...profile('p-1')]);
  const { fields } = await api.refreshAccount(account(), { riot: 'riot-key' });
  assert.equal(fields.stats.lol.solo.tier, 'DIAMOND');
  assert.equal(Object.hasOwn(fields.stats.lol.solo, 'cutoffs'), false);
  assert.equal(count('leagues/by-queue/'), 0);
});

test('a ladder that fails to load leaves the ranks intact and is tried again on the next refresh', async () => {
  const { api, count } = fixture([...apexRoutes(true), named('p-1', 'Old Name'), league('p-1', 'MASTER', 215), ...profile('p-1')]);
  const { fields, errors } = await api.refreshAccount(account(), { riot: 'riot-key' });
  assert.equal(errors.lol, undefined);
  assert.equal(fields.stats.lol.solo.lp, 215);
  assert.equal(Object.hasOwn(fields.stats.lol.solo, 'cutoffs'), false);
  await api.refreshAccount(account(), { riot: 'riot-key' });
  assert.equal(count('/challengerleagues/'), 2);
});

test('a rank answer that never comes fails after the time limit, aborts the request and frees the queue', async () => {
  let aborted = false;
  const fetch = (url, init) => {
    if (url.includes('/by-riot-id/')) return new Promise(() => { init.signal.addEventListener('abort', () => { aborted = true; }); });
    return Promise.resolve(response(404, {}));
  };
  const api = createRankApi({ fetch, wait: async () => {}, timeoutMs: 20 });
  const { errors } = await api.refreshAccount(account({ puuidCache: {} }), { riot: 'riot-key', henrik: 'henrik-key' });
  assert.equal(errors.lol, 'The rank service took too long to answer');
  assert.equal(errors.tft, 'The rank service took too long to answer');
  assert.equal(aborted, true);
  assert.match(errors.val, /No VALORANT profile/);
});

test('a rank answer whose body never arrives also fails after the time limit', async () => {
  const fetch = async (url) => (url.includes('/by-riot-id/') ? { status: 200, ok: true, headers: { get: () => null }, json: () => new Promise(() => {}) } : response(404, {}));
  const api = createRankApi({ fetch, wait: async () => {}, timeoutMs: 20 });
  const { errors } = await api.refreshAccount(account({ puuidCache: {} }), { riot: 'riot-key' });
  assert.equal(errors.lol, 'The rank service took too long to answer');
});

test('a rate limit waits what Riot asks, in seconds or as a date, and gives up on long waits', async () => {
  const clock = Date.parse('2026-11-05T12:00:00Z');
  const run = async (retryAfter) => {
    const waits = [];
    let limited = false;
    const fetch = async (url) => {
      if (url.includes('/by-riot-id/') && !limited) {
        limited = true;
        return { status: 429, ok: false, headers: { get: (name) => (name === 'retry-after' ? retryAfter : null) }, json: async () => ({ status: { message: 'Rate limit exceeded' } }) };
      }
      if (url.includes('/by-riot-id/')) return response(200, { puuid: 'p-1', gameName: 'Old Name', tagLine: 'BR1' });
      for (const [pattern, reply] of profile('p-1')) if (url.includes(pattern)) return response(200, reply);
      return response(404, {});
    };
    const api = createRankApi({ fetch, wait: async (ms) => { if (ms !== 80) waits.push(ms); }, now: () => clock });
    const { errors } = await api.refreshAccount(account({ puuidCache: {} }), { riot: 'riot-key' });
    return { waits, errors };
  };
  assert.deepEqual((await run('3')).waits, [3000]);
  assert.deepEqual((await run('Thu, 05 Nov 2026 12:00:07 GMT')).waits, [7000]);
  assert.deepEqual((await run('Thu, 05 Nov 2026 11:59:00 GMT')).waits, [0]);
  assert.deepEqual((await run('soon')).waits, [5000]);
  assert.deepEqual((await run(null)).waits, [5000]);
  const long = await run('3600');
  assert.deepEqual(long.waits, []);
  assert.equal(long.errors.lol, 'Rate limit exceeded');
  assert.equal(Object.hasOwn(long.errors, 'tft'), false);
});
