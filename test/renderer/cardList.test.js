const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

const load = (file) => import(pathToFileURL(path.join(RENDERER_DIR, file)).href);
const entry = (tier, division, lp) => ({ tier, division, lp, wins: 10, losses: 10 });
const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const accounts = [
  { id: 'a', gameName: 'Ágil', tagLine: 'BR1', region: 'br1', username: 'login-a', note: 'duo com Leo', tags: ['Main'], lastPlayed: ago(3600e3), stats: { lol: { solo: entry('GOLD', 'II', 40) }, val: { tier: 12, tierName: 'Gold 1' } } },
  { id: 'b', gameName: 'beta', tagLine: 'NA1', region: 'na1', username: 'login-b', note: '', tags: ['Smurf', 'Duo'], lastPlayed: null, games: ['val'], stats: { val: { tier: 21, tierName: 'Ascendant 1' } } },
  { id: 'c', gameName: 'Céu', tagLine: 'BR1', region: 'br1', username: 'login-c', note: '', tags: [], lastPlayed: ago(86400e3 * 3), pinned: true, stats: { lol: { solo: entry('DIAMOND', 'IV', 10) } } },
  { id: 'd', gameName: 'delta', tagLine: 'EUW', region: 'euw1', username: 'login-d', note: '', lastPlayed: ago(60e3), games: ['lol'], stats: { lol: { solo: entry('GOLD', 'I', 5) } } },
];
const ids = (list) => list.map((account) => account.id);

test('pinned accounts come first and each sort keeps the manual order for ties', async () => {
  const { visibleAccounts } = await load('cardList.js');
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot' })), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot', sort: 'rank' })), ['c', 'd', 'a', 'b']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot', sort: 'name' })), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot', sort: 'recent' })), ['c', 'd', 'a', 'b']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'val', stats: 'val', sort: 'rank' })), ['c', 'b', 'a']);
});

test('the game tab hides accounts saved for the other game only', async () => {
  const { visibleAccounts, gamesOf } = await load('cardList.js');
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'lol' })), ['c', 'a', 'd']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'val', stats: 'val' })), ['c', 'a', 'b']);
  const all = ['lol', 'val', 'tft', '2xko', 'lor'];
  assert.deepEqual(gamesOf({}), all);
  assert.deepEqual(gamesOf({ games: ['lor', 'val', 'tft', 'other'] }), ['val', 'tft', 'lor']);
  assert.deepEqual(gamesOf({ games: ['other'] }), all);
  assert.deepEqual(gamesOf({ games: [] }), all);
});

test('picking games starts from one game, adds and removes games and never ends empty', async () => {
  const { toggleGame } = await load('cardList.js');
  const all = ['lol', 'val', 'tft', '2xko', 'lor'];
  assert.deepEqual(toggleGame(all, 'val'), ['val']);
  assert.deepEqual(toggleGame(['val'], 'lol'), ['lol', 'val']);
  assert.deepEqual(toggleGame(['lol', 'val'], 'val'), ['lol']);
  assert.deepEqual(toggleGame(['lol'], 'lol'), ['lol']);
  assert.deepEqual(toggleGame(['lol', 'val', 'tft', '2xko'], 'lor'), all);
  assert.deepEqual(toggleGame(['val'], 'all'), all);
  assert.deepEqual(toggleGame(all, 'all'), all);
  assert.deepEqual(toggleGame([], 'tft'), ['tft']);
});

test('search ignores case and accents and also looks at the login but not at old notes or old tags', async () => {
  const { visibleAccounts } = await load('cardList.js');
  const search = (query) => ids(visibleAccounts(accounts, { game: 'riot', query }));
  assert.deepEqual(search('agil'), ['a']);
  assert.deepEqual(search('CEU'), ['c']);
  assert.deepEqual(search('duo'), []);
  assert.deepEqual(search('main'), []);
  assert.deepEqual(search('#br1'), ['c', 'a']);
  assert.deepEqual(search('login-d'), ['d']);
  assert.deepEqual(search('leo'), []);
  assert.deepEqual(search('nothing'), []);
});

test('filters combine server and rank group, and an old tag filter is ignored', async () => {
  const { visibleAccounts, tierOf } = await load('cardList.js');
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot', region: 'br1' })), ['c', 'a']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot', tier: 'GOLD' })), ['a', 'd']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot', tag: 'smurf' })), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(visibleAccounts(accounts, { game: 'riot', region: 'br1', tier: 'GOLD' })), ['a']);
  assert.equal(tierOf(accounts[1], 'lol'), 'UNRANKED');
  assert.equal(tierOf(accounts[1], 'val'), 'ASCENDANT');
});

test('reordering is offered only in the manual order without filters and moves one id', async () => {
  const { canReorder, moveId } = await load('cardList.js');
  assert.equal(canReorder({}), true);
  assert.equal(canReorder({ sort: 'rank' }), false);
  assert.equal(canReorder({ query: ' x ' }), false);
  assert.equal(canReorder({ query: '   ' }), true);
  assert.equal(canReorder({ tier: 'GOLD' }), false);
  assert.equal(canReorder({ region: 'br1' }), false);
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveId(list, 'a', 3), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveId(list, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveId(list, 'b', 4), ['a', 'c', 'd', 'b']);
  assert.deepEqual(moveId(list, 'b', 1), list);
  assert.deepEqual(moveId(list, 'x', 0), list);
});

test('the tag helpers are gone with the feature', async () => {
  const list = await load('cardList.js');
  for (const name of ['tagsOf', 'allTags', 'parseTags', 'SUGGESTED_TAGS', 'MAX_TAGS']) assert.equal(list[name], undefined, name);
});

test('the usage line says when the account was played and how many sign-ins it had', async () => {
  const { usage } = await load('cardList.js');
  const { TEXT } = await load('cardsText.js');
  assert.equal(usage({ lastPlayed: ago(2 * 86400e3), signInCount: 17 }, TEXT.pt, NOW), 'Jogada há 2 dias · 17 entradas');
  assert.equal(usage({ lastPlayed: ago(3 * 3600e3), signInCount: 1 }, TEXT.pt, NOW), 'Jogada há 3 h · 1 entrada');
  assert.equal(usage({ lastPlayed: ago(10e3) }, TEXT.pt, NOW), 'Jogada há 1 min');
  assert.equal(usage({ lastPlayed: null, signInCount: 0 }, TEXT.pt, NOW), 'Nunca jogada');
  assert.equal(usage({ lastPlayed: ago(86400e3), signInCount: 2 }, TEXT.en, NOW), 'Played 1 day ago · 2 sign-ins');
});

test('several accounts are read one per line as Riot ID, login and password', async () => {
  const { parseBatch } = await load('cardList.js');
  const result = parseBatch('Nome Um#BR1;login1;senha;com;ponto\n\n  Dois#NA1 ; login2 ;p2  \nsem-tag;login;senha\nTres#BR1;;senha\nQuatro#;login;senha', { region: 'br1', games: ['lol'] });
  assert.deepEqual(result.accounts, [
    { gameName: 'Nome Um', tagLine: 'BR1', username: 'login1', password: 'senha;com;ponto', region: 'br1', games: ['lol'] },
    { gameName: 'Dois', tagLine: 'NA1', username: 'login2', password: 'p2', region: 'br1', games: ['lol'] },
  ]);
  assert.deepEqual(result.errors, [4, 5, 6]);
  assert.equal(result.tooMany, false);
  assert.equal(parseBatch(Array.from({ length: 51 }, (_, index) => `N${index}#BR1;l${index};p`).join('\n')).tooMany, true);
});

test('the card sort falls back to the manual order', async () => {
  const { sortOf } = await load('cardList.js');
  assert.equal(sortOf({ cardSort: 'rank' }), 'rank');
  for (const settings of [{}, { cardSort: 'random' }, null]) assert.equal(sortOf(settings), 'manual');
});

test('each of the five game tabs shows only the accounts saved for that game', async () => {
  const { visibleAccounts } = await load('cardList.js');
  const list = [...accounts, { id: 'e', gameName: 'eco', tagLine: 'BR1', region: 'br1', username: 'login-e', lastPlayed: null, games: ['tft', 'lor'], stats: {} }];
  assert.deepEqual(ids(visibleAccounts(list, { game: 'lol' })), ['c', 'a', 'd']);
  assert.deepEqual(ids(visibleAccounts(list, { game: 'tft', stats: 'tft' })), ['c', 'a', 'e']);
  assert.deepEqual(ids(visibleAccounts(list, { game: '2xko', stats: 'lol' })), ['c', 'a']);
  assert.deepEqual(ids(visibleAccounts(list, { game: 'lor', stats: 'val' })), ['c', 'a', 'e']);
  assert.deepEqual(ids(visibleAccounts(list, { game: 'riot' })), ['c', 'a', 'b', 'd', 'e']);
});

test('the plate usage line can leave out the sign-in count', async () => {
  const { usage } = await load('cardList.js');
  const { TEXT } = await load('cardsText.js');
  assert.equal(usage({ lastPlayed: ago(2 * 86400e3), signInCount: 17 }, TEXT.pt, NOW, false), 'Jogada há 2 dias');
  assert.equal(usage({ lastPlayed: null, signInCount: 4 }, TEXT.en, NOW, false), 'Never played');
});

test('the counter says how many accounts belong only to other games', async () => {
  const { countLabel } = await load('cardList.js');
  const { TEXT } = await load('cardsText.js');
  assert.equal(countLabel({ shown: 10, total: 10, inGame: 10 }, TEXT.pt), '10 contas');
  assert.equal(countLabel({ shown: 9, total: 10, inGame: 9 }, TEXT.pt), '9 de 10 contas · 1 em outros jogos');
  assert.equal(countLabel({ shown: 2, total: 10, inGame: 10 }, TEXT.pt), '2 de 10 contas');
  assert.equal(countLabel({ shown: 1, total: 4, inGame: 2 }, TEXT.en), '1 of 4 accounts · 2 in other games');
});

test('typing a letter outside a text field starts the search', async () => {
  const { startsSearch } = await load('cardList.js');
  assert.equal(startsSearch({ key: 'a' }, false), true);
  assert.equal(startsSearch({ key: '#' }, false), true);
  for (const event of [{ key: 'a', ctrlKey: true }, { key: 'a', altKey: true }, { key: 'a', metaKey: true }, { key: ' ' }, { key: 'Enter' }, { key: 'ArrowDown' }]) assert.equal(startsSearch(event, false), false, JSON.stringify(event));
  assert.equal(startsSearch({ key: 'a' }, true), false);
});

test('no account starts selected, a second click on the selected one clears it, and a hidden one is dropped', async () => {
  const { toggleSelection, keptSelection } = await load('cardList.js');
  const shown = [{ id: 'a' }, { id: 'b' }];
  assert.equal(keptSelection(null, shown), null);
  assert.equal(toggleSelection(null, 'a'), 'a');
  assert.equal(toggleSelection('a', 'b'), 'b');
  assert.equal(toggleSelection('a', 'a'), null);
  assert.equal(keptSelection('a', shown), 'a');
  assert.equal(keptSelection('z', shown), null);
  assert.equal(keptSelection('a', []), null);
});
