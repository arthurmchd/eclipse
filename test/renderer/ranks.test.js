const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

const load = (file) => import(pathToFileURL(path.join(RENDERER_DIR, file)).href);

test('the climb points Master to Grandmaster, Grandmaster to Challenger and keeps Challenger against its own cutoff', async () => {
  const { climbOf } = await load('ranks.js');
  const cutoffs = { grandmaster: 300, challenger: 900 };
  assert.deepEqual(climbOf({ tier: 'MASTER', lp: 215, cutoffs }), { tier: 'GRANDMASTER', cutoff: 300, gap: 85, holding: false });
  assert.deepEqual(climbOf({ tier: 'MASTER', lp: 340, cutoffs }), { tier: 'GRANDMASTER', cutoff: 300, gap: -40, holding: false });
  assert.deepEqual(climbOf({ tier: 'GRANDMASTER', lp: 512, cutoffs }), { tier: 'CHALLENGER', cutoff: 900, gap: 388, holding: false });
  assert.deepEqual(climbOf({ tier: 'CHALLENGER', lp: 974, cutoffs }), { tier: 'CHALLENGER', cutoff: 900, gap: -74, holding: true });
});

test('no climb without a usable cutoff or below Master', async () => {
  const { climbOf, rankOf } = await load('ranks.js');
  assert.equal(climbOf(null), null);
  assert.equal(climbOf({ tier: 'MASTER', lp: 215 }), null);
  assert.equal(climbOf({ tier: 'MASTER', lp: 215, cutoffs: { grandmaster: null, challenger: 900 } }), null);
  assert.equal(climbOf({ tier: 'DIAMOND', lp: 90, cutoffs: { grandmaster: 300, challenger: 900 } }), null);
  const account = { stats: { lol: { solo: { tier: 'MASTER', division: '', lp: 215, wins: 1, losses: 1, cutoffs: { grandmaster: 300, challenger: 900 } }, flex: null } } };
  assert.equal(rankOf(account, 'lol', 'solo').climb.gap, 85);
  assert.equal(rankOf(account, 'lol', 'flex').climb, null);
});

test('the VALORANT card art is the small square art of the saved card, or the default card', async () => {
  const { valCardArt } = await load('ranks.js');
  const base = 'https://media.valorant-api.com/playercards';
  assert.equal(valCardArt(`${base}/CEC2424B-483E-DA2E-4369-F0A8822F96B5/smallart.png`), `${base}/cec2424b-483e-da2e-4369-f0a8822f96b5/smallart.png`);
  assert.equal(valCardArt('70cecca0-4b4b-9ad4-1652-bebe785ef8e8'), `${base}/70cecca0-4b4b-9ad4-1652-bebe785ef8e8/smallart.png`);
  for (const card of [null, undefined, '', 'https://example.com/card.png', { small: 'x' }]) assert.equal(valCardArt(card), `${base}/9fb348bc-41a0-91ad-8a3e-818035c4e561/smallart.png`);
});

test('every League account gets the default level border of its level', async () => {
  const { levelTheme, lolLevelBorder } = await load('ranks.js');
  assert.deepEqual([1, 29, 30, 49, 50, 74, 75, 100, 499, 500, 2000].map(levelTheme), [1, 1, 2, 2, 3, 3, 4, 5, 20, 21, 21]);
  assert.match(lolLevelBorder(143).src, /themed-borders\/theme-6-border\.png$/);
  for (const odd of [null, undefined, 0, -3, 1.5, '40']) assert.equal(lolLevelBorder(odd), null);
});

test('the VALORANT large art is the tall art of the same card, or of the default card', async () => {
  const { valLargeArt } = await load('ranks.js');
  const base = 'https://media.valorant-api.com/playercards';
  assert.equal(valLargeArt(`${base}/CEC2424B-483E-DA2E-4369-F0A8822F96B5/smallart.png`), `${base}/cec2424b-483e-da2e-4369-f0a8822f96b5/largeart.png`);
  for (const card of [null, '', 'https://example.com/card.png']) assert.equal(valLargeArt(card), `${base}/9fb348bc-41a0-91ad-8a3e-818035c4e561/largeart.png`);
});

test('the League banner is the one read from the game (rank, event or challenge banner), or else the default League banner', async () => {
  const { lolBanner } = await load('ranks.js');
  const base = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/regalia/bannerskins';
  assert.equal(lolBanner('gold'), `${base}/gold.png`);
  assert.equal(lolBanner('default'), `${base}/default.png`);
  assert.equal(lolBanner('worlds2026_banner'), `${base}/worlds2026_banner.png`);
  assert.equal(lolBanner('LNY2023'), `${base}/lny2023.png`);
  assert.equal(lolBanner(undefined), `${base}/default.png`);
  assert.equal(lolBanner('../x'), `${base}/default.png`);
  assert.equal(lolBanner({ name: 'gold' }), `${base}/default.png`);
});

test('a VALORANT rank read from the game has no RR, and the card shows the tier without one', async () => {
  const { rankOf } = await load('ranks.js');
  const fromGame = rankOf({ stats: { val: { tier: 16, tierName: 'Platinum 2', rr: null, level: 80 } } }, 'val', 'competitive');
  assert.deepEqual([fromGame.label, fromGame.sub, fromGame.progress, fromGame.score, fromGame.level], ['Platinum 2', '', 0, 16000, 80]);
  const fromKey = rankOf({ stats: { val: { tier: 16, tierName: 'Platinum 2', rr: 45 } } }, 'val', 'competitive');
  assert.deepEqual([fromKey.sub, fromKey.progress, fromKey.score], ['45 RR', 0.45, 16045]);
});

test('every League tier uses its icon shipped with the app, and only Unranked keeps the remote crest', async () => {
  const fs = require('node:fs');
  const { LOL_TIERS, lolCrest } = await load('ranks.js');
  for (const tier of LOL_TIERS.filter((t) => t.id !== 'UNRANKED')) {
    const crest = lolCrest(tier.id);
    assert.equal(crest, `assets/rank-${tier.id.toLowerCase()}.png`);
    assert.ok(fs.statSync(path.join(RENDERER_DIR, crest)).size > 0, crest);
  }
  assert.match(lolCrest('UNRANKED'), /ranked-mini-crests\/unranked\.svg$/);
  assert.match(lolCrest('NOT_A_TIER'), /ranked-mini-crests\/unranked\.svg$/);
});

test('the League border is the chosen level border or the ranked armor, and anything odd is no border', async () => {
  const { lolBorder } = await load('ranks.js');
  assert.deepEqual(lolBorder({ kind: 'level', theme: 13 }), { kind: 'level', src: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/uikit/themed-borders/theme-13-border.png' });
  assert.deepEqual(lolBorder({ kind: 'ranked', tier: 'MASTER' }), { kind: 'ranked', src: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/master.png' });
  for (const odd of [undefined, null, {}, { kind: 'level', theme: 0 }, { kind: 'level', theme: 22 }, { kind: 'level', theme: '3' }, { kind: 'ranked', tier: '../x' }, { kind: 'ranked', tier: 'UNRANKED' }]) assert.equal(lolBorder(odd), null);
});

test('the VALORANT border is the chosen one or the one of the account level, with the badge for the level number', async () => {
  const { valBorder } = await load('ranks.js');
  const at = (id) => ({ kind: 'val', src: `https://media.valorant-api.com/levelborders/${id}/smallplayercardappearance.png`, badge: `https://media.valorant-api.com/levelborders/${id}/levelnumberappearance.png` });
  assert.deepEqual(valBorder('3D90BC3A-4626-71D6-A17C-93AE14D05FB0', 5), at('3d90bc3a-4626-71d6-a17c-93ae14d05fb0'));
  assert.deepEqual(valBorder('level', 1), at('ebc736cd-4b6a-137b-e2b0-1486e31312c9'));
  assert.deepEqual(valBorder('level', 39), at('5156a90d-4d65-58d0-f6a8-48a0c003878a'));
  assert.deepEqual(valBorder('level', 40), at('9c4afb15-40d7-3557-062a-4bb198cb9958'));
  for (const [border, level] of [[undefined, 50], [null, 50], ['level', null], ['level', 0], ['../../x', 50], [{}, 50]]) assert.equal(valBorder(border, level), null);
});

test('the profile splash and the TFT companion only become CommunityDragon images from safe saved names', async () => {
  const { lolSplash, tftCompanion } = await load('ranks.js');
  const base = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets';
  assert.equal(lolSplash('characters/ahri/skins/skin01/images/ahri_splash_centered_1.jpg'), `${base}/characters/ahri/skins/skin01/images/ahri_splash_tile_1.jpg`);
  assert.equal(lolSplash('characters/jinx/skins/base/images/jinx_splash_centered_0.jpg'), `${base}/characters/jinx/skins/base/images/jinx_splash_tile_0.jpg`);
  assert.equal(lolSplash('characters/ahri/skins/base/images/ahri_splash_uncentered_0.jpg'), `${base}/characters/ahri/skins/base/images/ahri_splash_uncentered_0.jpg`);
  for (const odd of [undefined, 5, '', 'characters/ahri/../x.jpg', 'https://evil.example/x.jpg', 'characters/Ahri/skins/base/images/a.jpg', 'characters/ahri/skins/base/images/a.png']) assert.equal(lolSplash(odd), null);
  assert.equal(tftCompanion('tooltip_chibiahri_base_classic_tier1'), `${base}/loadouts/companions/tooltip_chibiahri_base_classic_tier1.png`);
  for (const odd of [undefined, null, '', '../x', 'Tooltip_A', 'a/b']) assert.equal(tftCompanion(odd), null);
});
