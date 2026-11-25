const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RENDERER_DIR } = require('../../src/paths');

const load = (file) => import(pathToFileURL(path.join(RENDERER_DIR, file)).href);
const URL_A = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/regalia/bannerskins/default.png';
const URL_B = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/regalia/bannerskins/gold.png';

function image(banner, src = null) {
  const attributes = { src };
  return { dataset: { banner }, isConnected: true, getAttribute: name => attributes[name], set src(value) { attributes.src = value; }, get src() { return attributes.src; } };
}

test('the banner is shrunk to twice the size it shows on the card, keeping its proportion', async () => {
  const { BANNER_SIZE } = await load('banners.js');
  assert.deepEqual({ ...BANNER_SIZE }, { width: 280, height: 714 });
  assert.ok(Math.abs(BANNER_SIZE.width / BANNER_SIZE.height - 580 / 1480) < 0.001);
});

test('each banner is shrunk once and every card with it gets the same small copy', async () => {
  const { createBanners } = await load('banners.js');
  const calls = [];
  const banners = createBanners(async url => { calls.push(url); return `blob:eclipse://localhost/${calls.length}`; });
  assert.equal(banners.get(URL_A), null);
  const first = image(URL_A);
  const second = image(URL_A);
  const other = image(URL_B);
  await banners.fill({ querySelectorAll: () => [first, second, other] });
  assert.deepEqual(calls, [URL_A, URL_B]);
  assert.equal(first.src, 'blob:eclipse://localhost/1');
  assert.equal(second.src, 'blob:eclipse://localhost/1');
  assert.equal(other.src, 'blob:eclipse://localhost/2');
  assert.equal(banners.get(URL_A), 'blob:eclipse://localhost/1');
  const redrawn = image(URL_A);
  banners.fill({ querySelectorAll: () => [redrawn] });
  assert.equal(redrawn.src, 'blob:eclipse://localhost/1');
  assert.deepEqual(calls, [URL_A, URL_B]);
  assert.equal(redrawn.src, 'blob:eclipse://localhost/1');
});

test('a banner that cannot be shrunk falls back to the original image, and removed cards are left alone', async () => {
  const { createBanners } = await load('banners.js');
  const failing = createBanners(async () => { throw new Error('load'); });
  const card = image(URL_A);
  await failing.fill({ querySelectorAll: () => [card] });
  assert.equal(card.src, URL_A);
  const odd = createBanners(async () => 'https://evil.example/x.png');
  const other = image(URL_B);
  await odd.fill({ querySelectorAll: () => [other] });
  assert.equal(other.src, URL_B);
  const slow = createBanners(async () => 'blob:eclipse://localhost/9');
  const gone = image(URL_A);
  gone.isConnected = false;
  await slow.fill({ querySelectorAll: () => [gone] });
  assert.equal(gone.src, null);
  const kept = image(URL_A, 'blob:eclipse://localhost/1');
  await slow.fill({ querySelectorAll: () => [kept] });
  assert.equal(kept.src, 'blob:eclipse://localhost/1');
});

test('a shrink that never finishes gives up after the timeout and shows the original image', async () => {
  const { createBanners, SHRINK_TIMEOUT } = await load('banners.js');
  assert.equal(SHRINK_TIMEOUT, 15000);
  const timers = [];
  const wait = (callback, ms) => { timers.push(ms); callback(); return 7; };
  const stuck = createBanners(() => new Promise(() => {}), { wait, clear: () => assert.fail('a fired timer is not cleared') });
  const card = image(URL_A);
  await stuck.fill({ querySelectorAll: () => [card] });
  assert.deepEqual(timers, [SHRINK_TIMEOUT]);
  assert.equal(card.src, URL_A);
});

test('a small copy that arrives after the timeout is freed, and a shrink in time clears its own timer', async () => {
  const { createBanners } = await load('banners.js');
  let fire;
  let finish;
  const revoked = [];
  const late = createBanners(() => new Promise(resolve => { finish = resolve; }), { wait: callback => { fire = callback; return 1; }, clear: () => assert.fail('not cleared after firing'), revoke: url => revoked.push(url) });
  const card = image(URL_A);
  const filled = late.fill({ querySelectorAll: () => [card] });
  await new Promise(resolve => setImmediate(resolve));
  fire();
  await filled;
  assert.equal(card.src, URL_A);
  finish('blob:eclipse://localhost/late');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(revoked, ['blob:eclipse://localhost/late']);
  assert.equal(late.get(URL_A), URL_A);
  const cleared = [];
  const quick = createBanners(async () => 'blob:eclipse://localhost/1', { wait: () => 42, clear: id => cleared.push(id), revoke: url => revoked.push(url) });
  const other = image(URL_B);
  await quick.fill({ querySelectorAll: () => [other] });
  assert.equal(other.src, 'blob:eclipse://localhost/1');
  assert.deepEqual(cleared, [42]);
  const failing = createBanners(async () => { throw new Error('load'); }, { wait: () => 43, clear: id => cleared.push(id), revoke: url => revoked.push(url) });
  await failing.fill({ querySelectorAll: () => [image(URL_B)] });
  assert.deepEqual(cleared, [42, 43]);
  assert.deepEqual(revoked, ['blob:eclipse://localhost/late']);
});

function fakePage({ canvasError = null, context = true, blob = true, smallLoads = true } = {}) {
  const revoked = [];
  const loaded = [];
  class FakeImage {
    set src(value) {
      loaded.push({ url: value, cors: this.crossOrigin === 'anonymous' });
      const ok = !value.startsWith('blob:') || smallLoads;
      queueMicrotask(() => (ok ? this.onload?.() : this.onerror?.()));
    }
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (context ? { drawImage() {} } : null),
    toBlob(callback) {
      if (canvasError) throw canvasError;
      queueMicrotask(() => callback(blob ? { size: 1 } : null));
    },
  };
  const globals = {
    Image: FakeImage,
    document: { createElement: () => canvas },
    URL: Object.assign(Object.create(URL), { createObjectURL: () => 'blob:eclipse://localhost/small', revokeObjectURL: url => revoked.push(url) }),
  };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return {
    canvas, revoked, loaded,
    restore() { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}

test('shrinking draws the original with CORS, checks that the small copy loads, and frees the canvas', async () => {
  const { shrinkImage } = await load('banners.js');
  const page = fakePage();
  try {
    assert.equal(await shrinkImage(URL_A), 'blob:eclipse://localhost/small');
    assert.deepEqual(page.loaded, [{ url: URL_A, cors: true }, { url: 'blob:eclipse://localhost/small', cors: false }]);
    assert.deepEqual([page.canvas.width, page.canvas.height], [0, 0]);
    assert.deepEqual(page.revoked, []);
  } finally {
    page.restore();
  }
});

test('shrinking rejects instead of hanging when the canvas fails, and drops a small copy that does not load', async () => {
  const { shrinkImage } = await load('banners.js');
  for (const [options, message] of [[{ canvasError: new Error('tainted') }, 'tainted'], [{ context: false }, 'canvas'], [{ blob: false }, 'blob'], [{ smallLoads: false }, 'load']]) {
    const page = fakePage(options);
    try {
      await assert.rejects(shrinkImage(URL_A), { message });
      assert.deepEqual([page.canvas.width, page.canvas.height], [0, 0]);
      assert.deepEqual(page.revoked, options.smallLoads === false ? ['blob:eclipse://localhost/small'] : []);
    } finally {
      page.restore();
    }
  }
});
