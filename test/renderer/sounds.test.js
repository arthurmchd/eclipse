const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

const load = () => import(pathToFileURL(path.join(RENDERER_DIR, 'sounds.js')).href);

function element(selectors, extra = {}) {
  const own = new Set(selectors);
  const node = { disabled: false, classList: { contains: (name) => own.has(`.${name}`) }, matches: (selector) => selector.split(',').some((part) => own.has(part.trim())), ...extra };
  node.closest = (selector) => (node.matches(selector) ? node : node.parent?.closest(selector) ?? null);
  return node;
}

test('nothing plays and nothing is fetched until the sounds are turned on', async () => {
  const { createSounds } = await load();
  const made = [];
  const sounds = createSounds((src) => { const audio = { src, played: 0, play() { this.played++; return Promise.reject(new Error('blocked')); } }; made.push(audio); return audio; });
  assert.equal(sounds.play('play'), false);
  assert.equal(made.length, 0);
  sounds.setEnabled('yes');
  assert.equal(sounds.play('play'), false);
  sounds.setEnabled(true);
  assert.equal(sounds.play('play'), true);
  assert.equal(sounds.play('play'), true);
  assert.equal(sounds.play('unknown'), false);
  assert.equal(sounds.play('constructor'), false);
  assert.equal(made.length, 1);
  assert.equal(made[0].src, 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-uikit/global/default/sfx-uikit-button-gold-click.ogg');
  assert.equal(made[0].played, 2);
  assert.equal(made[0].volume, 0.4);
  sounds.setEnabled(false);
  assert.equal(sounds.play('play'), false);
});

test('every sound comes from the League interface kit on CommunityDragon', async () => {
  const { SOUNDS, SOUND_BASE } = await load();
  assert.equal(new URL(SOUND_BASE).origin, 'https://raw.communitydragon.org');
  for (const file of Object.values(SOUNDS)) assert.match(file, /^sfx-uikit-[a-z-]+\.ogg$/);
});

test('hovering and clicking pick the sound of the element under the pointer', async () => {
  const { hoverSound, clickSound, changeSound } = await load();
  const play = element(['#play']);
  const cancel = element(['#play', '.is-cancel']);
  const card = element(['.plate-card']);
  const label = element(['.account-content'], { parent: card });
  const name = element(['strong'], { parent: label });
  const button = element(['button']);
  const off = element(['button'], { disabled: true });
  const tab = element(['#games button']);
  assert.equal(hoverSound(play).name, 'hoverPlay');
  assert.equal(hoverSound(name).name, 'hoverCard');
  assert.equal(hoverSound(name).host, card);
  assert.equal(hoverSound(tab).name, 'hoverButton');
  assert.equal(hoverSound(element(['div'])), null);
  assert.equal(hoverSound(element(['#play'], { disabled: true })), null);
  assert.equal(clickSound(play), 'play');
  assert.equal(clickSound(cancel), 'click');
  assert.equal(clickSound(name), 'pickCard');
  assert.equal(clickSound(button), 'click');
  assert.equal(clickSound(off), null);
  assert.equal(clickSound(element(['input[type=checkbox]'])), null);
  assert.equal(changeSound(element(['select'])), 'select');
  assert.equal(changeSound(element(['input[type=checkbox]'])), 'check');
  assert.equal(changeSound(element(['input'])), null);
  assert.equal(hoverSound(null), null);
});
