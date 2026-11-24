const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

test('the card texts have the same keys in Portuguese and English', async () => {
  const { TEXT } = await import(pathToFileURL(path.join(RENDERER_DIR, 'cardsText.js')).href);
  assert.deepEqual(Object.keys(TEXT.en).sort(), Object.keys(TEXT.pt).sort());
  assert.equal(TEXT.pt.climbMissing(85), 'faltam 85 PdL');
  assert.equal(TEXT.pt.cutoffAbove(74), '74 PdL acima do corte');
  assert.equal(TEXT.en.cutoffBelow(20), '20 LP below the cutoff');
  assert.equal(TEXT.pt.lastMatch(18), 'Última partida: +18 RR');
  assert.equal(TEXT.en.lastMatch(-15), 'Last match: -15 RR');
});

test('the filter and sort labels stay short so the toolbar fits a 636 px Riot', async () => {
  const { TEXT } = await import(pathToFileURL(path.join(RENDERER_DIR, 'cardsText.js')).href);
  for (const text of [TEXT.pt, TEXT.en]) {
    for (const key of ['allRegions', 'allTiers', 'filters', 'allOption']) assert.ok(text[key].length <= 10, `${key}: ${text[key]}`);
    assert.ok(text.addAccount.length <= 16, text.addAccount);
    for (const label of Object.values(text.sorts)) assert.ok(label.length <= 15, label);
    assert.ok(text.searchPlaceholder.length <= 24, text.searchPlaceholder);
  }
  assert.deepEqual([TEXT.pt.allRegions, TEXT.pt.allTiers], ['Servidor', 'Elo']);
  for (const text of [TEXT.pt, TEXT.en]) for (const key of ['allTags', 'filterTag', 'tagsLabel', 'tagsPlaceholder', 'keysHint']) assert.equal(text[key], undefined, key);
  assert.equal(TEXT.pt.sorts.manual, 'Ordem manual');
  assert.equal(TEXT.en.sorts.manual, 'Manual order');
  assert.match(TEXT.pt.dragHint, /^Em Ordem manual/);
  for (const text of [TEXT.pt, TEXT.en]) assert.equal(text.selected, undefined);
});

test('the sounds option and the footer label are translated', async () => {
  const { TEXT } = await import(pathToFileURL(path.join(RENDERER_DIR, 'cardsText.js')).href);
  assert.equal(TEXT.pt.uiSounds, 'Sons da interface');
  assert.equal(TEXT.en.uiSounds, 'Interface sounds');
  assert.match(TEXT.pt.uiSoundsHelp, /CommunityDragon/);
  assert.match(TEXT.en.uiSoundsHelp, /CommunityDragon/);
  assert.equal(TEXT.pt.selectionLabel, 'Selecionada');
  assert.equal(TEXT.en.selectionLabel, 'Selected');
});
