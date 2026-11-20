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

test('the launch bar names the selected account with its main rank and server', async () => {
  const { selectionView } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const regions = { euw1: { label: 'EUW' } };
  const account = { ...lolAccount, region: 'euw1', hasPassword: true };
  assert.deepEqual(selectionView(account, 'lol', regions, TEXT.pt), { name: 'Hextech Fox #EUW', detail: 'Diamante II · EUW' });
  assert.deepEqual(selectionView(account, 'lol', regions, TEXT.en), { name: 'Hextech Fox #EUW', detail: 'Diamond II · EUW' });
  assert.deepEqual(selectionView(account, 'val', regions, TEXT.pt), { name: 'Hextech Fox #EUW', detail: 'Sem classificação · EUW' });
  assert.deepEqual(selectionView(account, 'riot', regions, TEXT.pt), { name: 'Hextech Fox #EUW', detail: 'Só entrar na conta · EUW' });
  assert.deepEqual(selectionView({ ...account, region: 'xx9' }, 'riot', regions, TEXT.en), { name: 'Hextech Fox #EUW', detail: 'Only sign in · xx9' });
});

test('the launch bar asks for a password or an account before playing', async () => {
  const { selectionView } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  assert.deepEqual(selectionView({ ...lolAccount, region: 'euw1', hasPassword: false }, 'lol', {}, TEXT.pt), { name: 'Hextech Fox #EUW', detail: TEXT.pt.addPassword });
  assert.deepEqual(selectionView(null, 'lol', {}, TEXT.pt), { name: TEXT.pt.selectAccount, detail: '' });
  assert.deepEqual(selectionView(undefined, 'val', {}, TEXT.en), { name: TEXT.en.selectAccount, detail: '' });
});

test('TFT shows Ranked and Double Up with League tiers and the League level and icon', async () => {
  const { accountView, GAME_QUEUES } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  assert.deepEqual(GAME_QUEUES.tft, ['ranked', 'doubleUp']);
  const account = { ...lolAccount, stats: { ...lolAccount.stats, tft: { ranked: { tier: 'GOLD', division: 'I', lp: 30, wins: 12, losses: 10 }, doubleUp: null } } };
  const view = accountView(account, 'tft', TEXT.pt);
  assert.deepEqual([view.main.name, view.main.tier, view.main.points, view.main.progress, view.main.climb], ['Ranqueada', 'Ouro I', '30 PdL', null, null]);
  assert.deepEqual([view.others[0].name, view.others[0].tier], ['Dupla', 'Sem classificação']);
  assert.equal(view.level, 412);
  assert.match(view.avatar, /profile-icons\/4895\.jpg$/);
  assert.equal(accountView(account, 'tft', TEXT.en).others[0].name, 'Double Up');
});

test('the launch bar names 2XKO and Runeterra, which have no rank in Eclipse', async () => {
  const { selectionView, GAME_NAMES } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const account = { ...lolAccount, region: 'euw1', hasPassword: true };
  const regions = { euw1: { label: 'EUW' } };
  assert.deepEqual(Object.keys(GAME_NAMES), ['lol', 'val', 'tft', '2xko', 'lor', 'riot']);
  assert.equal(selectionView(account, '2xko', regions, TEXT.pt).detail, '2XKO · EUW');
  assert.equal(selectionView(account, 'lor', regions, TEXT.en).detail, 'Legends of Runeterra · EUW');
  assert.equal(selectionView(account, 'tft', regions, TEXT.pt).detail, 'Sem classificação · EUW');
});

test('a tab without its own rank says which game the rank comes from', async () => {
  const { queueLabel } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  assert.deepEqual(queueLabel('lol', 'lol', 'solo', TEXT.pt), { label: 'Solo/Duo', title: '', column: 'Solo/Duo' });
  assert.deepEqual(queueLabel('riot', 'lol', 'solo', TEXT.pt), { label: 'Elo do League', title: 'Solo/Duo · League of Legends', column: 'Solo/Duo · League' });
  assert.deepEqual(queueLabel('2xko', 'val', 'competitive', TEXT.en), { label: 'VALORANT rank', title: 'Competitive · VALORANT', column: 'Competitive · VALORANT' });
});

test('a plate has no border until one is read from the game, and each tab uses the border of its own game', async () => {
  const { TEXT } = await load('cardsText.js');
  const { accountView } = await load('cardView.js');
  const plain = { id: 'a', gameName: 'A', tagLine: 'BR1', stats: { lol: { level: 10, iconId: 1 }, val: { tier: 9, tierName: 'Silver 1', level: 45 } } };
  for (const game of ['lol', 'tft', 'val']) assert.equal(accountView(plain, game, TEXT.pt).border, null);
  const read = { ...plain, stats: { lol: { ...plain.stats.lol, border: { kind: 'level', theme: 2 } }, val: { ...plain.stats.val, border: 'level' } } };
  assert.equal(accountView(read, 'lol', TEXT.pt).border.kind, 'level');
  assert.equal(accountView(read, 'tft', TEXT.pt).border.kind, 'level');
  assert.match(accountView(read, 'val', TEXT.pt).border.src, /levelborders\/9c4afb15-40d7-3557-062a-4bb198cb9958\//);
});
