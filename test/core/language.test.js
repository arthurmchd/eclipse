const test = require('node:test');
const assert = require('node:assert/strict');
const { LANGUAGES, DEFAULT_LANGUAGE, MESSAGES, normalizeLanguage, localize, mainText } = require('../../src/core/language');

test('Portuguese is the default and only Portuguese or English are accepted', () => {
  assert.deepEqual(LANGUAGES, ['pt', 'en']);
  assert.equal(DEFAULT_LANGUAGE, 'pt');
  for (const value of [undefined, null, '', 'fr', 'EN', 1, {}]) assert.equal(normalizeLanguage(value), 'pt');
  assert.equal(normalizeLanguage('en'), 'en');
});

test('every message translates both ways without ambiguity', () => {
  const english = new Set(), portuguese = new Set();
  for (const [en, pt] of MESSAGES) {
    assert.equal(english.has(en) || portuguese.has(en), false, en);
    assert.equal(portuguese.has(pt) || english.has(pt), false, pt);
    english.add(en); portuguese.add(pt);
    assert.equal(localize(en, 'pt'), pt);
    assert.equal(localize(pt, 'en'), en);
    assert.equal(localize(en, 'en'), en);
    assert.equal(localize(pt, 'pt'), pt);
  }
});

test('messages with a variable part keep it in both languages', () => {
  assert.equal(localize('Riot sign-in error: invalid_session', 'pt'), 'Erro de login da Riot: invalid_session');
  assert.equal(localize('Erro de login da Riot: invalid_session', 'en'), 'Riot sign-in error: invalid_session');
  assert.equal(localize('The background window guard stopped (exit 3). Try Play again', 'pt'), 'O monitor de janelas em segundo plano parou (exit 3). Tente Jogar de novo');
  assert.equal(localize('The background window guard stopped. Try Play again', 'pt'), 'O monitor de janelas em segundo plano parou. Tente Jogar de novo');
  assert.equal(localize('Riot Client window script failed: 5', 'pt'), 'O script da janela do Riot Client falhou: 5');
});

test('unknown texts and non-texts pass through unchanged', () => {
  assert.equal(localize('Something new from Riot', 'pt'), 'Something new from Riot');
  assert.equal(localize(undefined, 'pt'), undefined);
  assert.equal(localize('Game opened', 'xx'), 'Jogo aberto');
});

test('tray and dialog texts exist in both languages with the same keys', () => {
  assert.deepEqual(Object.keys(mainText('en')).sort(), Object.keys(mainText('pt')).sort());
  assert.equal(mainText().trayQuit, 'Sair');
  assert.equal(mainText('en').trayQuit, 'Quit');
  for (const value of Object.values(mainText('en'))) assert.ok(value.length);
});
