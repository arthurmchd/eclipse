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
  assert.deepEqual([unrated.main.ranked, unrated.main.tier, unrated.main.progress, unrated.main.change], [false, 'Sem classificação', 0, null]);
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

test('League and TFT plates show the default level border until the equipped border is read from the game', async () => {
  const { TEXT } = await load('cardsText.js');
  const { accountView } = await load('cardView.js');
  const plain = { id: 'a', gameName: 'A', tagLine: 'BR1', stats: { lol: { level: 10, iconId: 1 }, val: { tier: 9, tierName: 'Silver 1', level: 45 } } };
  assert.match(accountView(plain, 'lol', TEXT.pt).border.src, /theme-1-border\.png$/);
  assert.match(accountView(plain, 'tft', TEXT.pt).border.src, /theme-1-border\.png$/);
  assert.equal(accountView(plain, 'val', TEXT.pt).border, null);
  const read = { ...plain, stats: { lol: { level: 143, iconId: 1, border: { kind: 'ranked', tier: 'GOLD' } }, val: { ...plain.stats.val, border: 'level' } } };
  assert.equal(accountView(read, 'lol', TEXT.pt).border.kind, 'ranked');
  assert.match(accountView(read, 'tft', TEXT.pt).border.src, /gold\.png$/);
  const chosen = { ...plain, stats: { lol: { level: 143, iconId: 1, border: { kind: 'level', theme: 2 } } } };
  assert.match(accountView(chosen, 'lol', TEXT.pt).border.src, /theme-2-border\.png$/);
  const odd = { ...plain, stats: { lol: { level: 143, iconId: 1, border: { kind: 'ranked', tier: '../x' } } } };
  assert.match(accountView(odd, 'lol', TEXT.pt).border.src, /theme-6-border\.png$/);
  assert.match(accountView(read, 'val', TEXT.pt).border.src, /levelborders\/9c4afb15-40d7-3557-062a-4bb198cb9958\//);
  assert.equal(accountView({ ...plain, stats: { lol: { iconId: 1 } } }, 'lol', TEXT.pt).border, null);
});

test('League and TFT plates hang the banner read from the League, or the default banner, and VALORANT plates use the tall card art', async () => {
  const { TEXT } = await load('cardsText.js');
  const { accountView } = await load('cardView.js');
  const account = { id: 'a', gameName: 'A', tagLine: 'BR1', stats: { lol: { level: 10, iconId: 1, banner: 'gold', solo: { tier: 'DIAMOND', division: 'I', lp: 1, wins: 1, losses: 1 } }, tft: { ranked: { tier: 'SILVER', division: 'I', lp: 1, wins: 1, losses: 1 } }, val: { tier: 9, tierName: 'Silver 1', level: 45, card: '70cecca0-4b4b-9ad4-1652-bebe785ef8e8' } } };
  assert.match(accountView(account, 'lol', TEXT.pt).banner, /bannerskins\/gold\.png$/);
  assert.match(accountView(account, 'tft', TEXT.pt).banner, /bannerskins\/gold\.png$/);
  const unread = { ...account, stats: { ...account.stats, lol: { ...account.stats.lol, banner: undefined } } };
  assert.match(accountView(unread, 'lol', TEXT.pt).banner, /bannerskins\/default\.png$/);
  assert.match(accountView(unread, 'tft', TEXT.pt).banner, /bannerskins\/default\.png$/);
  assert.equal(accountView(account, 'lol', TEXT.pt).art, null);
  const val = accountView(account, 'val', TEXT.pt);
  assert.equal(val.banner, null);
  assert.match(val.art, /playercards\/70cecca0-4b4b-9ad4-1652-bebe785ef8e8\/largeart\.png$/);
});

test('start with Windows is sent only when it exists and the box changed', async () => {
  const { startupChange } = await load('cardView.js');
  assert.equal(startupChange(false, true), true);
  assert.equal(startupChange(true, false), false);
  assert.equal(startupChange(true, true), undefined);
  assert.equal(startupChange(false, false), undefined);
  assert.equal(startupChange(null, true), undefined);
  assert.equal(startupChange(undefined, false), undefined);
});

test('an account without rank still gets the unranked icon of its game', async () => {
  const { accountView } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const val = accountView({ id: '3', gameName: 'Sage Main', tagLine: 'BR1', stats: { val: { tier: 0, level: 20 } } }, 'val', TEXT.pt).main;
  assert.equal(val.ranked, false);
  assert.match(val.crest, /^https:\/\/media\.valorant-api\.com\/competitivetiers\/[0-9a-f-]+\/0\/largeicon\.png$/);
  const fresh = accountView({ id: '4', gameName: 'New', tagLine: 'BR1', stats: {} }, 'val', TEXT.pt).main;
  assert.equal(fresh.crest, val.crest);
  const lol = accountView({ id: '5', gameName: 'Fox', tagLine: 'EUW', stats: { lol: { level: 30, solo: null, flex: null } } }, 'lol', TEXT.pt).main;
  assert.equal(lol.ranked, false);
  assert.match(lol.crest, /ranked-mini-crests\/unranked\.svg$/);
});

test('the page theme is light unless dark was saved, and the button switches it', async () => {
  const { PAGE_THEMES, pageThemeOf, otherPageTheme } = await load('cardView.js');
  assert.deepEqual(PAGE_THEMES, ['light', 'dark']);
  assert.equal(pageThemeOf({ pageTheme: 'dark' }), 'dark');
  for (const settings of [{}, { pageTheme: 'light' }, { pageTheme: 'black' }, null, undefined]) assert.equal(pageThemeOf(settings), 'light');
  assert.equal(otherPageTheme('light'), 'dark');
  assert.equal(otherPageTheme('dark'), 'light');
});

test('the Riot tab shows the account and the main rank of every game it is marked for', async () => {
  const { riotView, RIOT_GAMES, RIOT_ACCENT } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const account = { ...lolAccount, stats: { ...lolAccount.stats, val: { tier: 18, tierName: 'Diamond 1', rr: 45, card: 'e9c8d760-4d06-4037-4882-6bab3610d9ea' } } };
  const view = riotView(account, ['lol', 'val', '2xko'], 'EUW', TEXT.pt);
  assert.deepEqual(RIOT_GAMES, ['lol', 'val', 'tft']);
  assert.deepEqual([view.id, view.name, view.tag, view.region, view.accent], ['1', 'Hextech Fox', 'EUW', 'EUW', RIOT_ACCENT]);
  assert.match(view.avatar, /profile-icons\/4895\.jpg$/);
  assert.deepEqual(view.ranks.map(rank => [rank.game, rank.shown, rank.ranked, rank.tier, rank.points]), [
    ['lol', true, true, 'Diamante II', '57 PdL'],
    ['val', true, true, 'Diamante 1', '45 RR'],
    ['tft', false, false, 'Sem classificação', ''],
  ]);
  assert.match(view.ranks[0].icon, /^assets\/game-lol\.svg$/);
  const valOnly = riotView({ id: '2', gameName: 'Sage', tagLine: 'BR1', stats: { val: { tier: 0, card: 'e9c8d760-4d06-4037-4882-6bab3610d9ea' } } }, ['val'], '', TEXT.pt);
  assert.match(valOnly.avatar, /playercards\/e9c8d760-4d06-4037-4882-6bab3610d9ea\/smallart\.png$/);
  assert.equal(riotView({ id: '3', gameName: 'New', tagLine: 'NA1', stats: {} }, ['lol'], 'NA', TEXT.pt).avatar, '');
});

test('the LoL plate has the profile splash behind it and the TFT plate puts the companion, or else the icon, on the board', async () => {
  const { accountView } = await load('cardView.js');
  const { TEXT } = await load('cardsText.js');
  const look = { ...lolAccount, stats: { ...lolAccount.stats, lol: { ...lolAccount.stats.lol, splash: 'characters/ahri/skins/base/images/ahri_splash_centered_0.jpg', companion: 'tooltip_choncc_classic_tier1' } } };
  const lol = accountView(look, 'lol', TEXT.pt);
  assert.match(lol.splash, /\/assets\/characters\/ahri\/skins\/base\/images\/ahri_splash_tile_0\.jpg$/);
  assert.equal(lol.board, null);
  assert.match(accountView(look, 'tft', TEXT.pt).board, /\/loadouts\/companions\/tooltip_choncc_classic_tier1\.png$/);
  assert.equal(accountView(look, 'tft', TEXT.pt).splash, null);
  assert.match(accountView(lolAccount, 'tft', TEXT.pt).board, /profile-icons\/4895\.jpg$/);
  assert.equal(accountView(lolAccount, 'lol', TEXT.pt).splash, null);
  assert.equal(accountView({ ...lolAccount, stats: { lol: { ...lolAccount.stats.lol, iconId: -1 } } }, 'tft', TEXT.pt).board, null);
});

test('only a running sign-in greys the cards and marks the account being signed in', async () => {
  const { signingState } = await load('cardView.js');
  assert.deepEqual(signingState({ status: 'running', accountId: 'a' }, 'a'), { running: true, playing: true });
  assert.deepEqual(signingState({ status: 'running', accountId: 'a' }, 'b'), { running: true, playing: false });
  assert.deepEqual(signingState({ status: 'running', accountId: 'a' }), { running: true, playing: false });
  for (const status of ['succeeded', 'failed', 'cancelled']) assert.deepEqual(signingState({ status, accountId: 'a' }, 'a'), { running: false, playing: false });
  assert.deepEqual(signingState(null, 'a'), { running: false, playing: false });
});
