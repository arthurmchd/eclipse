const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRiotOverlay, overlayBounds, overlayShape } = require('../../../src/integration/overlay/riotOverlay');
const { ACCOUNT_CARDS_FILE } = require('../../../src/paths');

test('cards attach automatically, stay with an unfocused Riot window, follow moves and keep the left login area at every DPI', async () => {
  let sample, hostOptions, started, opens = 0, disposed = false;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.bounds = {}; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.webContents.loadURL = async url => { this.url = url; }; }
    getNativeWindowHandle() { const handle = Buffer.alloc(8); handle.writeBigUInt64LE(4660n); return handle; }
    setMenu() {}
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setShape(shape) { this.shape = shape; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    moveTop() { this.raised = true; }
    hide() { this.visible = false; }
  }
  let window;
  const overlay = createRiotOverlay({ electron: { BrowserWindow: class extends Window { constructor(options) { super(options); window = this; } }, screen: { screenToDipRect: (_window, rect) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / 2])) } }, request: async () => ({}), readAuthenticationState: async () => ({ type: 'auth' }), createObserver: options => { sample = options.onState; return { start(_path, handle) { started = handle; }, stop() {} }; }, createHost: options => { hostOptions = options; return { open: async () => { opens++; }, dispose() { disposed = true; } }; } });
  await overlay.start('C:/Riot/RiotClientServices.exe');
  assert.equal(opens, 1);
  assert.equal(hostOptions.rendererFile, ACCOUNT_CARDS_FILE);
  assert.equal(hostOptions.backgroundColor, '#00000000');
  assert.equal(window.options.transparent, true);
  assert.equal(window.url, 'about:blank');
  assert.equal(window.options.alwaysOnTop, false);
  assert.equal(started, '4660');
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1000 });
  await new Promise(setImmediate);
  assert.deepEqual(window.bounds, overlayBounds({ x: -960, y: 0, width: 800, height: 500 }));
  assert.equal(window.bounds.x, -960 + Math.round(800 * 400 / 1536));
  assert.ok(window.bounds.x + window.bounds.width <= -960 + 800);
  assert.equal(window.visible, true);
  assert.equal(window.raised, undefined);
  assert.deepEqual(window.shape, overlayShape(window.bounds));
  const shaped = window.shape;
  sample({ id: '1', x: -1700, y: 120, width: 1600, height: 1000 });
  assert.deepEqual(window.bounds, overlayBounds({ x: -850, y: 60, width: 800, height: 500 }));
  assert.equal(window.shape, shaped);
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1000 });
  overlay.setBlocked(true); overlay.setOperation({ status: 'running' });
  assert.equal(window.visible, true);
  overlay.setOperation({ status: 'running', signedIn: true });
  assert.equal(window.visible, false);
  overlay.setOperation({ status: 'failed', signedIn: true });
  assert.equal(window.visible, true);
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1400 });
  assert.equal(window.visible, true);
  assert.notEqual(window.shape, shaped);
  sample(null);
  assert.equal(window.visible, false);
  sample({ id: '2', x: 0, y: 0, width: 1600, height: 1000 });
  await new Promise(setImmediate);
  assert.equal(window.visible, true);
  assert.equal(opens, 1);
  overlay.stop();
  assert.equal(disposed, true);
  assert.equal(window.destroyed, true);
});

test('only the login session can show cards, including manual login, logout and stale replies', async () => {
  let sample, tick, window, time = 1000, cleared = false, calls = 0;
  let read = async () => ({ type: 'auth' });
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.bounds = {}; this.visible = false; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.webContents.loadURL = async () => {}; }
    setMenu() {}
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setShape(shape) { this.shape = shape; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    moveTop() {}
  }
  const overlay = createRiotOverlay({
    electron: { BrowserWindow: Window, screen: { screenToDipRect: (_, rect) => rect } },
    readAuthenticationState: signal => { calls++; return read(signal); }, now: () => time,
    setInterval: fn => { tick = fn; return 1; }, clearInterval: () => { cleared = true; },
    createHost: () => ({ open: async () => {}, dispose() {} }),
    createObserver: options => { sample = options.onState; return { start() {}, stop() {} }; },
  });
  const flush = () => new Promise(setImmediate);
  const target = { id: '1', x: 0, y: 0, width: 1536, height: 864 };
  await overlay.start('C:/Riot/RiotClientServices.exe');
  assert.equal(calls, 0);
  sample(target);
  assert.equal(window.visible, false);
  await flush();
  assert.equal(window.visible, true);
  for (const managed of [false, true]) {
    if (managed) overlay.setOperation({ status: 'running' });
    read = async () => ({ type: 'authenticated' });
    tick(); await flush();
    assert.equal(window.visible, false);
    await overlay.open();
    assert.equal(window.visible, false);
    read = async () => ({ type: 'auth' });
    tick(); await flush();
    assert.equal(window.visible, true);
  }
  for (const state of [null, { type: 'unknown' }, { type: 'multifactor' }, { type: 'challenge' }]) {
    read = async () => state;
    tick(); await flush();
    assert.equal(window.visible, false);
  }
  read = async () => { throw new Error('unavailable'); };
  tick(); await flush();
  assert.equal(window.visible, false);
  read = async () => ({ type: 'error', error: 'auth_failure' });
  tick(); await flush();
  assert.equal(window.visible, true);
  let resolve, signal;
  read = current => { signal = current; return new Promise(done => { resolve = done; }); };
  tick();
  const pendingCalls = calls;
  time += 3000;
  tick();
  assert.equal(calls, pendingCalls);
  assert.equal(window.visible, false);
  sample(null);
  assert.equal(signal.aborted, true);
  read = async () => ({ type: 'authenticated' });
  sample({ ...target, id: '2' }); await flush();
  resolve({ type: 'auth' }); await flush();
  assert.equal(window.visible, false);
  read = current => { signal = current; return new Promise(done => { resolve = done; }); };
  tick();
  overlay.stop();
  assert.equal(cleared, true);
  assert.equal(signal.aborted, true);
  resolve({ type: 'auth' }); await flush();
  assert.equal(window.destroyed, true);
  assert.equal(window.visible, false);
});

test('a minimized Riot hides the cards itself, keeps the session and shows them on the first restored sample', async () => {
  let sample, tick, window, time = 1000, calls = 0, hides = 0, shows = 0;
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.bounds = {}; this.visible = false; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.webContents.loadURL = async () => {}; }
    setMenu() {}
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setShape(shape) { this.shape = shape; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    isVisible() { return this.visible; }
    showInactive() { shows++; this.visible = true; }
    hide() { hides++; this.visible = false; }
  }
  const overlay = createRiotOverlay({
    electron: { BrowserWindow: Window, screen: { screenToDipRect: (_, rect) => rect } },
    readAuthenticationState: async () => { calls++; return { type: 'auth' }; }, now: () => time,
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    createHost: () => ({ open: async () => {}, dispose() {} }),
    createObserver: options => { sample = options.onState; return { start() {}, stop() {} }; },
  });
  const flush = () => new Promise(setImmediate);
  const target = { id: '1', x: 0, y: 0, width: 1536, height: 864 };
  await overlay.start('C:/Riot/RiotClientServices.exe');
  sample(target); await flush();
  assert.equal(window.visible, true);
  const placed = window.bounds, checked = calls;
  hides = 0; shows = 0;
  sample({ ...target, x: -32000, y: -32000, minimized: true });
  assert.equal(window.visible, false);
  assert.ok(hides >= 1);
  assert.equal(calls, checked);
  for (let i = 0; i < 5; i++) { time += 1000; tick(); await flush(); }
  assert.ok(calls > checked);
  assert.equal(shows, 0);
  assert.equal(window.visible, false);
  assert.equal(window.bounds, placed);
  const restored = calls;
  sample(target);
  assert.equal(calls, restored);
  assert.equal(shows, 1);
  assert.equal(window.visible, true);
  sample({ ...target, minimized: true });
  overlay.setOperation({ status: 'running', signedIn: true });
  overlay.setOperation(null);
  assert.equal(window.visible, false);
  overlay.setOperation({ status: 'running', signedIn: true });
  sample(target);
  assert.equal(window.visible, false);
  overlay.setOperation(null);
  assert.equal(window.visible, true);
  overlay.stop();
});

test('card bounds never enter the login area across small and large client windows', () => {
  for (const width of [640, 1024, 1536, 1920, 2560]) {
    const bounds = overlayBounds({ x: -100, y: 50, width, height: 900 });
    assert.equal(bounds.x, -100 + Math.round(width * 400 / 1536));
    assert.equal(bounds.x + bounds.width, width - 100);
    assert.equal(bounds.y, 50);
    assert.equal(bounds.height, 900);
  }
});

test('the footer reaches the client edges while the native controls stay outside the input region', () => {
  for (const height of [240, 480, 864, 1200]) {
    const rect = { x: 10, y: -30, width: 1536, height };
    const bounds = overlayBounds(rect);
    const top = bounds.y - rect.y;
    assert.equal(top, 0);
    assert.equal(bounds.y + bounds.height, rect.y + height);
    assert.equal(bounds.x + bounds.width, rect.x + rect.width);
    const shape = overlayShape(bounds);
    const contains = (x, y) => shape.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    for (const offset of [16, 48, 80]) assert.equal(contains(bounds.width - offset, 48), false);
    assert.equal(contains(bounds.width - 1, height - 1), true);
    assert.equal(contains(0, 0), true);
    assert.equal(shape[0].width, 1032);
    for (const r of shape) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0);
      assert.ok(r.x + r.width <= bounds.width && r.y + r.height <= bounds.height);
    }
  }
});
