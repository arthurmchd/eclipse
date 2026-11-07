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
