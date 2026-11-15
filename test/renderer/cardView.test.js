const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

const load = (file) => import(pathToFileURL(path.join(RENDERER_DIR, file)).href);

const lolAccount = {
  id: '1', gameName: 'Hextech Fox', tagLine: 'EUW',
  stats: { lol: { level: 412, iconId: 4895, solo: { tier: 'DIAMOND', division: 'II', lp: 57, wins: 98, losses: 87 }, flex: null } },
};

test('the card layout is plates unless list was saved', async () => {
  const { layoutOf, LAYOUTS } = await load('cardView.js');
  assert.deepEqual(LAYOUTS, ['plates', 'list']);
  assert.equal(layoutOf({ cardLayout: 'list' }), 'list');
  for (const settings of [{}, { cardLayout: 'plates' }, { cardLayout: 'grid' }, null, undefined]) assert.equal(layoutOf(settings), 'plates');
});

test('a LoL account becomes the same plain fields for any layout', async () => {
  const { accountView } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const view = accountView(lolAccount, 'lol', TEXT.pt);
  assert.deepEqual([view.id, view.name, view.tag, view.level], ['1', 'Hextech Fox', 'EUW', 412]);
  assert.match(view.avatar, /profile-icons\/4895\.jpg$/);
  assert.equal(view.accent, '#7b8ff7');
  assert.deepEqual(
    [view.main.name, view.main.tier, view.main.points, view.main.winrate, view.main.games, view.main.wins, view.main.record, view.main.played],
    ['Solo/Duo', 'Diamante II', '57 PdL', 53, 185, 98, '98V 87D', '53% · 185 partidas'],
  );
  assert.match(view.main.crest, /^assets\/rank-diamond\.png$/);
  assert.equal(view.others.length, 1);
  assert.deepEqual([view.others[0].name, view.others[0].ranked, view.others[0].tier, view.others[0].points, view.others[0].played, view.others[0].winrate], ['Flex', false, 'Sem classificação', 'Sem partidas', '', null]);
  assert.equal(accountView({ ...lolAccount, stats: { lol: { ...lolAccount.stats.lol, iconId: -1 } } }, 'lol', TEXT.en).avatar, '');
  assert.equal(accountView(lolAccount, 'lol', TEXT.en).main.played, '53% · 185 games');
});

test('a VALORANT account has one queue with RR progress and the last change', async () => {
  const { accountView } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const account = { id: '2', gameName: 'Tidal Wave', tagLine: 'BR1', stats: { val: { tier: 18, tierName: 'Diamond 1', rr: 45, level: 120, lastChange: 21, card: 'e9c8d760-4d06-4037-4882-6bab3610d9aa' } } };
  const view = accountView(account, 'val', TEXT.pt);
  assert.equal(view.others.length, 0);
  assert.equal(view.level, 120);
  assert.match(view.avatar, /playercards\/e9c8d760-4d06-4037-4882-6bab3610d9aa\/smallart\.png$/);
  assert.deepEqual([view.main.name, view.main.tier, view.main.points, view.main.progress, view.main.change, view.main.changeTitle], ['Competitivo', 'Diamante 1', '45 RR', 45, 21, 'Última partida: +21 RR']);
  const unrated = accountView({ id: '3', gameName: 'X', tagLine: 'Y', stats: { val: { tier: 0, level: 3 } } }, 'val', TEXT.pt);
  assert.deepEqual([unrated.main.ranked, unrated.main.tier, unrated.main.progress, unrated.main.change], [false, 'Sem classificação', null, null]);
});

test('the climb to Grandmaster or Challenger comes with the queue', async () => {
  const { accountView } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const account = { id: '4', gameName: 'A', tagLine: 'B', stats: { lol: { solo: { tier: 'MASTER', division: '', lp: 215, wins: 10, losses: 5, cutoffs: { grandmaster: 300, challenger: 900 } } } } };
  const { climb } = accountView(account, 'lol', TEXT.pt).main;
  assert.deepEqual([climb.tier, climb.label], ['Grão-Mestre', 'faltam 85 PdL']);
  assert.match(climb.crest, /^assets\/rank-grandmaster\.png$/);
});
