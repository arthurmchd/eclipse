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

test('the LoL banner uses the chosen banner name or falls back to the ranked banner of the best tier', async () => {
  const { lolBanner } = await load('ranks.js');
  const base = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/regalia/bannerskins';
  assert.equal(lolBanner({ banner: 'Hextech_Banner' }), `${base}/hextech_banner.png`);
  assert.equal(lolBanner({ banner: '../x', solo: { tier: 'GOLD' } }), `${base}/gold.png`);
  assert.equal(lolBanner({ solo: { tier: 'EMERALD' }, flex: { tier: 'MASTER' } }), `${base}/master.png`);
  assert.equal(lolBanner({ solo: null, flex: { tier: 'IRON' } }), `${base}/iron.png`);
  assert.equal(lolBanner({ solo: { tier: 'UNRANKED' } }), `${base}/default.png`);
  assert.equal(lolBanner(undefined), `${base}/default.png`);
});

test('the VALORANT card art is the wide art of the saved card, or the default card', async () => {
  const { valCardArt } = await load('ranks.js');
  const base = 'https://media.valorant-api.com/playercards';
  assert.equal(valCardArt(`${base}/CEC2424B-483E-DA2E-4369-F0A8822F96B5/smallart.png`), `${base}/cec2424b-483e-da2e-4369-f0a8822f96b5/wideart.png`);
  assert.equal(valCardArt('70cecca0-4b4b-9ad4-1652-bebe785ef8e8'), `${base}/70cecca0-4b4b-9ad4-1652-bebe785ef8e8/wideart.png`);
  for (const card of [null, undefined, '', 'https://example.com/card.png', { small: 'x' }]) assert.equal(valCardArt(card), `${base}/9fb348bc-41a0-91ad-8a3e-818035c4e561/wideart.png`);
});
