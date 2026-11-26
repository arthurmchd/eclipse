const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { OVERLAY_COVER_FILE, OVERLAY_COVER_SCRIPT_FILE } = require('../../../src/paths');

const load = () => import(pathToFileURL(OVERLAY_COVER_SCRIPT_FILE).href);
const states = (view) => view.rows.map((row) => row.state);

test('the four steps follow the current one and done marks them all', async () => {
  const { coverView } = await load();
  assert.deepEqual(states(coverView({ step: 'prepare', game: 'lol' }, 'pt')), ['current', 'next', 'next', 'next']);
  assert.deepEqual(states(coverView({ step: 'verify', game: 'lol' }, 'pt')), ['done', 'done', 'current', 'next']);
  assert.deepEqual(states(coverView({ step: 'launch', game: 'lol' }, 'pt')), ['done', 'done', 'done', 'current']);
  assert.deepEqual(states(coverView({ step: 'done', game: 'lol' }, 'pt')), ['done', 'done', 'done', 'done']);
  assert.deepEqual(states(coverView({ step: 'warp', game: 'lol' }, 'pt')), ['current', 'next', 'next', 'next']);
});

test('the labels name the game in both languages and the Riot icon opens Riot', async () => {
  const { coverView } = await load();
  const pt = coverView({ step: 'sign_in', game: 'tft' }, 'pt');
  assert.equal(pt.title, 'Entrando na conta');
  assert.deepEqual(pt.rows.map((row) => row.number), ['1', '2', '3', '4']);
  assert.equal(pt.game, 'Teamfight Tactics');
  assert.deepEqual(pt.rows.map((row) => row.label), ['Preparar a Riot', 'Entrar na conta', 'Conferir a conta', 'Abrir o Teamfight Tactics']);
  const en = coverView({ step: 'sign_in', game: 'val' }, 'en');
  assert.deepEqual(en.rows.map((row) => row.label), ['Prepare Riot', 'Sign in to the account', 'Check the account', 'Open VALORANT']);
  assert.equal(coverView({ step: 'verify', game: 'riot' }, 'pt').rows[3].label, 'Abrir a Riot');
  assert.equal(coverView({ step: 'verify', game: 'riot' }, 'en').rows[3].label, 'Open Riot');
  const unknown = coverView({ step: 'verify', game: 'toString' }, 'xx');
  assert.equal(unknown.game, 'League of Legends');
  assert.equal(unknown.rows[3].label, 'Abrir o League of Legends');
});

test('the current step shows the status, finished steps a summary and the next ones nothing', async () => {
  const { coverView } = await load();
  const view = coverView({ step: 'launch', game: 'lol', detail: 'O jogo está demorando para abrir ou está atualizando…' }, 'pt');
  assert.deepEqual(view.rows.map((row) => row.detail), ['Riot pronta', 'Conta conectada', 'Riot ID conferido', 'O jogo está demorando para abrir ou está atualizando…']);
  assert.deepEqual(coverView({ step: 'sign_in', game: 'lol', detail: 42 }, 'pt').rows.map((row) => row.detail), ['Riot pronta', '', '', '']);
  assert.deepEqual(coverView({ step: 'done', game: 'riot', detail: 'Riot Client aberto' }, 'pt').rows.map((row) => row.detail), ['Riot pronta', 'Conta conectada', 'Riot ID conferido', 'Riot aberta']);
  assert.deepEqual(coverView({ step: 'done', game: 'val' }, 'en').rows.map((row) => row.detail), ['Riot ready', 'Signed in', 'Riot ID checked', 'Game opened']);
});

test('the cover page loads only its own module and style under a closed policy', () => {
  const html = fs.readFileSync(OVERLAY_COVER_FILE, 'utf8');
  assert.match(html, /default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; img-src 'self'"/);
  assert.deepEqual([...html.matchAll(/<img[^>]*>/g)].map((match) => match[0]), ['<img id="riot-logo" src="../../../riot/logo.svg" alt="">']);
  assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map((match) => match[0]), ['<script type="module" src="cover.js">']);
  const script = fs.readFileSync(OVERLAY_COVER_SCRIPT_FILE, 'utf8');
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML|eval\(|invoke|__TAURI/);
});
