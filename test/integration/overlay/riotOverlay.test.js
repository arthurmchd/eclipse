const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRiotOverlay, overlayBounds, overlayShape, cardsLeft, cornerInsets, cornerRadius } = require('../../../src/integration/overlay/riotOverlay');
const { toggleRect } = require('../../../src/integration/overlay/overlayToggle');
const fakeToggle = () => ({ open: async () => {}, setLanguage() {}, dispose() {} });
const { ACCOUNT_CARDS_FILE } = require('../../../src/paths');

test('cards attach automatically, stay with an unfocused Riot window, follow moves and keep the left login area at every DPI', async () => {
  let sample, hostOptions, toggleOptions, toggleParent, started, opens = 0, disposed = false, toggleDisposed = false;
  const toggleLanguages = [];
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
  const overlay = createRiotOverlay({ electron: { BrowserWindow: class extends Window { constructor(options) { super(options); window = this; } }, screen: { screenToDipRect: (_window, rect) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / 2])) } }, request: async () => ({}), readAuthenticationState: async () => ({ type: 'auth' }), createObserver: options => { sample = options.onState; return { start(_path, handle) { started = handle; }, stop() {} }; }, createHost: options => { hostOptions = options; return { open: async () => { opens++; }, dispose() { disposed = true; } }; }, createToggle: options => { toggleOptions = options; return { open: async parent => { toggleParent = parent; }, setLanguage: value => toggleLanguages.push(value), dispose() { toggleDisposed = true; } }; } });
  overlay.setLanguage('en');
  await overlay.start('C:/Riot/RiotClientServices.exe');
  assert.equal(toggleOptions.language, 'en');
  overlay.setLanguage('pt');
  overlay.setLanguage('xx');
  assert.deepEqual(toggleLanguages, ['pt', 'pt']);
  assert.equal(opens, 1);
  assert.equal(hostOptions.rendererFile, ACCOUNT_CARDS_FILE);
  assert.equal(hostOptions.backgroundColor, '#f2f2f2');
  assert.equal(window.options.transparent, true);
  assert.equal(window.url, 'about:blank');
  assert.equal(window.options.alwaysOnTop, false);
  assert.equal(started, '4660');
  assert.equal(toggleParent, window);
  assert.equal(hostOptions.leftInset, cardsLeft);
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1000 });
  await new Promise(setImmediate);
  assert.deepEqual(window.bounds, overlayBounds({ x: -960, y: 0, width: 800, height: 500 }));
  assert.equal(window.bounds.x, -960);
  assert.equal(window.bounds.width, 800);
  assert.equal(hostOptions.leftInset(window.bounds.width), Math.round(800 * 400 / 1536));
  assert.equal(window.visible, true);
  assert.equal(window.raised, undefined);
  assert.deepEqual(window.shape, overlayShape(window.bounds));
  const shaped = window.shape;
  sample({ id: '1', x: -1700, y: 120, width: 1600, height: 1000 });
  assert.deepEqual(window.bounds, overlayBounds({ x: -850, y: 60, width: 800, height: 500 }));
  assert.equal(window.shape, shaped);
  sample({ id: '1', x: -1700, y: 120, width: 1600, height: 1000, corner: 16 });
  assert.deepEqual(window.shape, overlayShape(window.bounds, { corner: 7.5 }));
  const rounded = window.shape;
  sample({ id: '1', x: -1600, y: 120, width: 1600, height: 1000, corner: 16 });
  assert.equal(window.shape, rounded);
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1000 });
  assert.deepEqual(window.shape, shaped);
  overlay.setBlocked(true); overlay.setOperation({ status: 'running' });
  assert.equal(window.visible, true);
  overlay.setOperation({ status: 'running', signedIn: true });
  assert.equal(window.visible, false);
  overlay.setOperation({ status: 'failed', signedIn: true });
  assert.equal(window.visible, true);
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1400 });
  assert.equal(window.visible, true);
  assert.notEqual(window.shape, shaped);
  assert.deepEqual(window.shape, overlayShape(window.bounds));
  assert.equal(hostOptions.onModal, undefined);
  assert.equal(typeof hostOptions.onWindowAction, 'function');
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1000 });
  toggleOptions.onChange(true);
  assert.deepEqual(window.shape, [toggleRect(window.bounds)]);
  sample({ id: '1', x: -1920, y: 0, width: 1600, height: 1400 });
  assert.deepEqual(window.shape, [toggleRect(window.bounds)]);
  assert.equal(window.visible, true);
  toggleOptions.onChange(false);
  assert.deepEqual(window.shape, overlayShape(window.bounds));
  sample(null);
  assert.equal(window.visible, false);
  sample({ id: '2', x: 0, y: 0, width: 1600, height: 1000 });
  await new Promise(setImmediate);
  assert.equal(window.visible, true);
  assert.equal(opens, 1);
  overlay.stop();
  assert.equal(disposed, true);
  assert.equal(toggleDisposed, true);
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
    createHost: () => ({ open: async () => {}, dispose() {} }), createToggle: fakeToggle,
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
    createHost: () => ({ open: async () => {}, dispose() {} }), createToggle: fakeToggle,
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

test('in the login column only the toggle area paints and takes clicks, at every client size', () => {
  for (const [width, height] of [[640, 360], [1024, 576], [1280, 720], [1536, 864], [1920, 1080], [2560, 1440]]) {
    const bounds = overlayBounds({ x: -100.4, y: 50, width, height });
    assert.deepEqual(bounds, { x: -100, y: 50, width, height });
    const left = cardsLeft(width);
    assert.equal(left, Math.round(width * 400 / 1536));
    const toggle = toggleRect(bounds);
    const scale = width / 1536;
    assert.ok(toggle.x >= 178 * scale, 'toggle starts after the Stay signed in label');
    assert.ok(toggle.x + toggle.width <= Math.ceil(344 * scale) && toggle.x + toggle.width < left, 'toggle stays inside the login form');
    assert.ok(toggle.y <= 426 * height / 864 && toggle.y + toggle.height >= 442 * height / 864, 'toggle spans the Stay signed in row');
    for (const options of [{}, { hidden: true }]) {
      const shape = overlayShape(bounds, options);
      const inLogin = shape.filter(r => r.x < left);
      assert.deepEqual(inLogin, [toggle]);
      for (const r of shape) assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= width && r.y + r.height <= height);
    }
    assert.deepEqual(overlayShape(bounds, { hidden: true }), [toggle]);
    assert.deepEqual(overlayShape(bounds), [toggle, { x: left, y: 0, width: width - left, height }]);
    assert.deepEqual(overlayShape(bounds, { modal: true }), overlayShape(bounds));
  }
});

test('the cards take the whole art area, including where Riot draws its own window controls', () => {
  for (const height of [240, 480, 864, 1200]) {
    const rect = { x: 10, y: -30, width: 1536, height };
    const bounds = overlayBounds(rect);
    assert.deepEqual(bounds, rect);
    const left = cardsLeft(bounds.width);
    const shape = overlayShape(bounds);
    const contains = (x, y) => shape.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    for (const offset of [1, 16, 48, 80]) assert.equal(contains(bounds.width - offset, Math.min(48, height - 1)), true);
    assert.equal(contains(bounds.width - 1, 0), true);
    assert.equal(contains(bounds.width - 1, height - 1), true);
    assert.equal(contains(left, 0), true);
    assert.equal(contains(left - 1, 0), false);
    assert.equal(contains(0, height - 1), false);
    assert.equal(shape[1].width, 1136);
    assert.equal(shape.length, 2);
  }
});

test('the copies of the Riot controls minimize, close the way the Riot button would and reveal Riot', async () => {
  let sample, hostOptions, toggleOptions, window, close = async () => 'background', closes = 0;
  const commands = [], toggleHidden = [];
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
  }
  const overlay = createRiotOverlay({
    electron: { BrowserWindow: Window, screen: { screenToDipRect: (_window, rect) => rect } },
    request: async () => ({}), readAuthenticationState: async () => ({ type: 'auth' }),
    closeClient: async () => { closes++; return close(); },
    createObserver: options => { sample = options.onState; return { start() {}, stop() {}, command: name => { commands.push(name); return true; } }; },
    createHost: options => { hostOptions = options; return { open: async () => {}, dispose() {} }; },
    createToggle: options => { toggleOptions = options; return { open: async () => {}, setLanguage() {}, setHidden: value => toggleHidden.push(value), dispose() {} }; },
    setInterval: () => ({ unref() {} }), clearInterval() {},
  });
  assert.equal(await overlay.start('C:/Riot/RiotClientServices.exe'), undefined);
  sample({ id: '1', x: 0, y: 0, width: 1536, height: 864 });
  await new Promise(setImmediate);
  assert.deepEqual(window.shape, overlayShape(window.bounds));
  const act = hostOptions.onWindowAction;
  assert.equal(await act('minimize'), true);
  assert.deepEqual(commands, ['minimize']);
  assert.equal(await act('close'), true);
  assert.deepEqual(commands, ['minimize']);
  close = async () => 'quit';
  assert.equal(await act('close'), true);
  assert.deepEqual(commands, ['minimize', 'close']);
  close = async () => { throw new Error('The local Riot service could not complete the request'); };
  assert.equal(await act('close'), true);
  assert.deepEqual(commands, ['minimize', 'close', 'close']);
  assert.equal(closes, 3);
  assert.equal(await act('reveal'), true);
  assert.deepEqual(window.shape, [toggleRect(window.bounds)]);
  assert.deepEqual(toggleHidden, [true]);
  toggleOptions.onChange(false);
  assert.deepEqual(window.shape, overlayShape(window.bounds));
  for (const action of ['quit', 'maximize', '', undefined]) assert.equal(await act(action), false);
  assert.deepEqual(commands, ['minimize', 'close', 'close']);
  assert.equal(closes, 3);
  overlay.stop();
  assert.equal(await act('minimize'), false);
  assert.equal(await act('close'), false);
  assert.deepEqual(commands, ['minimize', 'close', 'close']);
  assert.equal(closes, 3);
});

test('the cards follow the rounded corners of the Riot window on the right and never paint past them', () => {
  assert.deepEqual(cornerInsets(7), [4, 3, 2, 1]);
  assert.deepEqual(cornerInsets(0), []);
  assert.equal(cornerRadius({ width: 1536, corner: 8 }, { width: 1536 }), 7);
  assert.equal(cornerRadius({ width: 1920, corner: 10 }, { width: 1536 }), 7.2);
  for (const corner of [undefined, 0, 1, 7.5, '8']) assert.equal(cornerRadius({ width: 1536, corner }, { width: 1536 }), 0);
  const size = { width: 1536, height: 864 }, left = cardsLeft(1536);
  const shape = overlayShape(size, { corner: 7 });
  const inside = (x, y) => shape.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  const outer = (x, y, cx, cy) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 8;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 1536 - 8; x < 1536; x += 1) {
      if (inside(x, y)) assert.ok(outer(x, y, 1537 - 8, 8), `top ${x},${y}`);
      if (inside(x, 863 - y)) assert.ok(outer(x, 863 - y, 1537 - 8, 865 - 8), `bottom ${x},${863 - y}`);
    }
  }
  assert.ok(inside(1535, 4) && inside(1535, 859) && inside(1531, 0) && !inside(1532, 0) && inside(1531, 863) && !inside(1532, 863));
  for (const [x, y] of [[left, 0], [left, 863], [1200, 0], [1200, 863], [1535, 432]]) assert.ok(inside(x, y), `${x},${y}`);
  assert.equal(shape.filter((r) => r !== shape[0]).reduce((sum, r) => sum + r.width * r.height, 0), (1536 - left) * 864 - 2 * (4 + 3 + 2 + 1));
  assert.deepEqual(overlayShape(size, { corner: 7, hidden: true }), [toggleRect(size)]);
  assert.deepEqual(overlayShape(size), [toggleRect(size), { x: left, y: 0, width: 1536 - left, height: 864 }]);
  assert.equal(overlayShape({ width: 400, height: 300 }, { corner: 500 }).every((r) => r.width > 0 && r.height > 0), true);
});
