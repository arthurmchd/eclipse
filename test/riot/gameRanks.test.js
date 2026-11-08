const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameRanks, leagueFolders, readLeagueLockfile, parseLeague, parseValorant, valTierName } = require('../../src/riot/gameRanks');

const SUMMONER = { gameName: 'Synthetic', tagLine: 'BR1', summonerLevel: 321, profileIconId: 29, puuid: 'synthetic-puuid' };
const RANKED = {
  queues: [
    { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'II', leaguePoints: 45, wins: 30, losses: 25 },
    { queueType: 'RANKED_FLEX_SR', tier: 'MASTER', division: 'NA', leaguePoints: 120, wins: 40, losses: 33, hotStreak: true },
    { queueType: 'RANKED_TFT', tier: 'PLATINUM', division: 'IV', leaguePoints: 0, wins: 8, losses: 12 },
    { queueType: 'RANKED_TFT_DOUBLE_UP', tier: 'NONE', division: 'NA', leaguePoints: 0, wins: 0, losses: 0 },
  ],
};
const presence = (data, extra = {}) => ({ puuid: 'own-puuid', product: 'valorant', private: Buffer.from(JSON.stringify(data)).toString('base64'), ...extra });
const SESSION = { puuid: 'own-puuid', game_name: 'Synthetic', game_tag: 'VAL' };

test('the League client gives the Riot ID, level, icon and every ranked queue in the shape the cards use', () => {
  assert.deepEqual(parseLeague(SUMMONER, RANKED), {
    riotId: { gameName: 'Synthetic', tagLine: 'BR1' },
    lol: {
      level: 321, iconId: 29,
      solo: { tier: 'GOLD', division: 'II', lp: 45, wins: 30, losses: 25, hotStreak: false },
      flex: { tier: 'MASTER', division: '', lp: 120, wins: 40, losses: 33, hotStreak: true },
    },
    tft: { ranked: { tier: 'PLATINUM', division: 'IV', lp: 0, wins: 8, losses: 12, hotStreak: false }, doubleUp: null },
  });
  const fromMap = parseLeague(SUMMONER, { queueMap: { RANKED_SOLO_5x5: { tier: 'IRON', division: 'IV', leaguePoints: 3, wins: 1, losses: 9 } } });
  assert.deepEqual(fromMap.lol.solo, { tier: 'IRON', division: 'IV', lp: 3, wins: 1, losses: 9, hotStreak: false });
  assert.equal(fromMap.lol.flex, null);
});

test('League answers in an unknown shape give nothing, so the saved ranks are kept', () => {
  assert.equal(parseLeague({ displayName: 'Old shape' }, RANKED), null);
  assert.equal(parseLeague({ ...SUMMONER, gameName: 'x'.repeat(65) }, RANKED), null);
  assert.equal(parseLeague({ ...SUMMONER, tagLine: 'BR\n1' }, RANKED), null);
  assert.equal(parseLeague(SUMMONER, { something: [] }), null);
  const odd = parseLeague({ ...SUMMONER, summonerLevel: -1, profileIconId: 1.5 }, { queues: [
    { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'V', leaguePoints: 1, wins: 1, losses: 1 },
    { queueType: 'RANKED_FLEX_SR', tier: 'WOOD', division: 'I', leaguePoints: 1, wins: 1, losses: 1 },
    { queueType: 'RANKED_TFT', tier: 'GOLD', division: 'I', leaguePoints: '50', wins: 1, losses: 1 },
  ] });
  assert.deepEqual([odd.lol.level, odd.lol.iconId, odd.lol.solo, odd.lol.flex, odd.tft.ranked], [null, null, null, null, null]);
});

test('VALORANT tiers are named like the HenrikDev ones the cards translate', () => {
  assert.deepEqual([0, 2, 3, 5, 12, 20, 21, 23, 24, 26, 27, 28].map(valTierName),
    ['Unrated', 'Unrated', 'Iron 1', 'Iron 3', 'Gold 1', 'Diamond 3', 'Ascendant 1', 'Ascendant 3', 'Immortal 1', 'Immortal 3', 'Radiant', 'Unrated']);
});

test('the own VALORANT presence gives tier, level and card, in the flat and the nested shape, and other presences are ignored', () => {
  const card = '9FB348BC-41A0-91AD-8A3E-818035C4E561';
  const expected = { riotId: { gameName: 'Synthetic', tagLine: 'VAL' }, val: { tier: 16, tierName: 'Platinum 2', level: 88, card: `https://media.valorant-api.com/playercards/${card.toLowerCase()}/smallart.png` } };
  const friend = presence({ competitiveTier: 27, accountLevel: 500 }, { puuid: 'friend-puuid' });
  const lol = presence({ competitiveTier: 3 }, { product: 'league_of_legends' });
  assert.deepEqual(parseValorant(SESSION, { presences: [friend, lol, presence({ competitiveTier: 16, accountLevel: 88, playerCardId: card })] }), expected);
  assert.deepEqual(parseValorant(SESSION, { presences: [presence({ isValid: true, playerPresenceData: { competitiveTier: 16, accountLevel: 88, playerCardId: card } })] }), expected);
});

test('a missing, odd or oversized VALORANT presence gives nothing', () => {
  assert.equal(parseValorant(SESSION, { presences: [] }), null);
  assert.equal(parseValorant({ puuid: 'own-puuid' }, { presences: [presence({ competitiveTier: 10 })] }), null);
  assert.equal(parseValorant(SESSION, { presences: [presence({ competitiveTier: 30 })] }), null);
  assert.equal(parseValorant(SESSION, { presences: [presence({ competitiveTier: '10' })] }), null);
  assert.equal(parseValorant(SESSION, { presences: [{ ...presence({}), private: 'not base64 json' }] }), null);
  assert.equal(parseValorant(SESSION, { presences: [{ ...presence({}), private: 'A'.repeat(64 * 1024 + 1) }] }), null);
  const noCard = parseValorant(SESSION, { presences: [presence({ competitiveTier: 0, playerCardId: '../../x' })] });
  assert.deepEqual(noCard.val, { tier: 0, tierName: 'Unrated', level: null, card: null });
});

test('the League lockfile comes from the League and TFT folders the Riot lists, and nowhere else', () => {
  const installs = JSON.stringify({ associated_client: {
    'C:/Riot Games/VALORANT/live/': 'C:/Riot Games/Riot Client/RiotClientServices.exe',
    'C:/Riot Games/League of Legends/': 'C:/Riot Games/Riot Client/RiotClientServices.exe',
    'C:/Riot Games/Teamfight Tactics/Live/': 'C:/Riot Games/Riot Client/RiotClientServices.exe',
    'League of Legends/': 'relative',
  } });
  const read = [];
  const files = { 'installs.json': installs, 'C:\\Riot Games\\Teamfight Tactics\\Live\\lockfile': 'LeagueClient:4321:50123:synthetic-password:https' };
  const readFile = (file) => { read.push(file); if (file in files) return files[file]; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  assert.deepEqual(leagueFolders({ readFile, installsFile: 'installs.json' }), ['C:/Riot Games/League of Legends/', 'C:/Riot Games/Teamfight Tactics/Live/']);
  assert.deepEqual(readLeagueLockfile({ readFile, installsFile: 'installs.json' }), { pid: 4321, port: 50123, token: 'synthetic-password' });
  assert.equal(read.some((file) => /VALORANT/.test(file)), false);
  assert.throws(() => readLeagueLockfile({ readFile: () => { throw new Error('missing'); }, installsFile: 'installs.json' }), /League client is not running/);
  assert.deepEqual(leagueFolders({ readFile: () => '{bad json', installsFile: 'installs.json' }), []);
});

test('the reader only sends GET requests, stops at the first failing answer and reads each game from its own service', async () => {
  const calls = [];
  const answer = (routes) => async (method, route) => { calls.push([method, route]); const value = routes[route]; if (value instanceof Error) throw value; return value; };
  const ranks = createGameRanks({
    leagueApi: answer({ '/lol-summoner/v1/current-summoner': { status: 200, json: SUMMONER }, '/lol-ranked/v1/current-ranked-stats': { status: 200, json: RANKED } }),
    riotApi: answer({ '/chat/v1/session': { status: 200, json: SESSION }, '/chat/v4/presences': { status: 200, json: { presences: [presence({ competitiveTier: 9 })] } } }),
  });
  assert.equal((await ranks.league()).lol.solo.tier, 'GOLD');
  assert.equal((await ranks.valorant()).val.tierName, 'Silver 1');
  assert.deepEqual(calls.map(([method]) => method), ['GET', 'GET', 'GET', 'GET']);

  calls.length = 0;
  const failing = createGameRanks({
    leagueApi: answer({ '/lol-summoner/v1/current-summoner': { status: 404, json: { message: 'nope' } } }),
    riotApi: answer({ '/chat/v1/session': new Error('not ready') }),
  });
  assert.equal(await failing.league(), null);
  assert.equal(await failing.valorant(), null);
  assert.deepEqual(calls.map(([, route]) => route), ['/lol-summoner/v1/current-summoner', '/chat/v1/session']);
});
