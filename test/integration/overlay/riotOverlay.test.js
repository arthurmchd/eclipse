const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRiotOverlay, overlayBounds, overlayShape, coverRect, cardsLeft, cornerInsets, cornerRadius, topEdge } = require('../../../src/integration/overlay/riotOverlay');
const { toggleRect } = require('../../../src/integration/overlay/overlayToggle');
const { PANEL_POINT } = require('../../../src/platform/windows/riotWindowObserver');
const fakeToggle = () => ({ open: async () => {}, setLanguage() {}, setVisible() {}, dispose() {} });
const fakeCover = () => ({ open: async () => {}, setVisible() {}, dispose() {} });
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
  const overlay = createRiotOverlay({ electron: { BrowserWindow: class extends Window { constructor(options) { super(options); window = this; } }, screen: { screenToDipRect: (_window, rect) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / 2])) } }, request: async () => ({}), readAuthenticationState: async () => ({ type: 'auth' }), createObserver: options => { sample = options.onState; return { start(_path, handle) { started = handle; }, stop() {} }; }, createHost: options => { hostOptions = options; return { open: async () => { opens++; }, dispose() { disposed = true; } }; }, createToggle: options => { toggleOptions = options; return { open: async parent => { toggleParent = parent; }, setLanguage: value => toggleLanguages.push(value), setVisible() {}, dispose() { toggleDisposed = true; } }; }, createCover: fakeCover });
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
  assert.deepEqual(window.shape, overlayShape(window.bounds, { top: 1, corner: 7.5 }));
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
    createHost: () => ({ open: async () => {}, dispose() {} }), createToggle: fakeToggle, createCover: fakeCover,
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
    createHost: () => ({ open: async () => {}, dispose() {} }), createToggle: fakeToggle, createCover: fakeCover,
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

test('a Riot dialog over the login screen hides the cards and the toggle until it closes, without losing the session', async () => {
  let sample, tick, window, time = 1000, calls = 0, shows = 0;
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
    hide() { this.visible = false; }
  }
  const overlay = createRiotOverlay({
    electron: { BrowserWindow: Window, screen: { screenToDipRect: (_, rect) => rect } },
    readAuthenticationState: async () => { calls++; return { type: 'auth' }; }, now: () => time,
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    createHost: () => ({ open: async () => {}, dispose() {} }), createToggle: fakeToggle, createCover: fakeCover,
    createObserver: options => { sample = options.onState; return { start() {}, stop() {} }; },
  });
  const flush = () => new Promise(setImmediate);
  const target = { id: '1', x: 0, y: 0, width: 1536, height: 864, corner: 8 };
  await overlay.start('C:/Riot/RiotClientServices.exe');
  sample(target); await flush();
  assert.equal(window.visible, true);
  const shape = window.shape;
  shows = 0;
  sample({ ...target, dimmed: true });
  assert.equal(window.visible, false);
  const checked = calls;
  for (let i = 0; i < 4; i++) { time += 1000; tick(); await flush(); }
  assert.ok(calls > checked);
  assert.equal(window.visible, false);
  assert.equal(shows, 0);
  sample({ ...target, dimmed: true, minimized: true });
  sample({ ...target, dimmed: true });
  assert.equal(window.visible, false);
  sample(target);
  assert.equal(window.visible, true);
  assert.equal(shows, 1);
  assert.equal(window.shape, shape);
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
    assert.deepEqual(overlayShape(bounds, { toggle: false }), [{ x: left, y: 0, width: width - left, height }]);
    assert.deepEqual(overlayShape(bounds, { hidden: true, toggle: false }), []);
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

test('the copies of the Riot controls minimize and close the way the Riot button would, and nothing else', async () => {
  let sample, hostOptions, window, close = async () => 'background', closes = 0;
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
    createToggle: () => ({ open: async () => {}, setLanguage() {}, setHidden: value => toggleHidden.push(value), setVisible() {}, dispose() {} }), createCover: fakeCover,
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
  for (const action of ['reveal', 'quit', 'maximize', '', undefined]) assert.equal(await act(action), false);
  assert.deepEqual(window.shape, overlayShape(window.bounds));
  assert.deepEqual(toggleHidden, []);
  assert.deepEqual(commands, ['minimize', 'close', 'close']);
  assert.equal(closes, 3);
  overlay.stop();
  assert.equal(await act('minimize'), false);
  assert.equal(await act('close'), false);
  assert.deepEqual(commands, ['minimize', 'close', 'close']);
  assert.equal(closes, 3);
});

test('while a sign-in runs the login column is covered and the toggle hidden until Riot needs the user or the sign-in ends', async () => {
  let sample, window, coverOptions, toggleOptions;
  const order = [], events = [];
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.bounds = {}; this.visible = false; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.webContents.loadURL = async () => {}; }
    setMenu() {}
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setShape(shape) { this.shape = shape; events.push('shape'); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
  }
  const overlay = createRiotOverlay({
    electron: { BrowserWindow: Window, screen: { screenToDipRect: (_window, rect) => rect } },
    request: async () => ({}), readAuthenticationState: async () => ({ type: 'auth' }),
    createObserver: options => { sample = options.onState; return { start() {}, stop() {}, command: () => true }; },
    createHost: () => ({ open: async () => { order.push('host'); }, dispose() { order.push('host disposed'); } }),
    createCover: options => { coverOptions = options; return { open: async parent => { order.push(parent === window ? 'cover' : 'cover elsewhere'); }, setVisible: value => events.push(`cover ${value}`), dispose() { order.push('cover disposed'); } }; },
    createToggle: options => { toggleOptions = options; return { open: async () => { order.push('toggle'); }, setLanguage() {}, setVisible: value => events.push(`toggle ${value}`), dispose() { order.push('toggle disposed'); } }; },
    setInterval: () => ({ unref() {} }), clearInterval() {},
  });
  overlay.setOperation({ status: 'running' });
  await overlay.start('C:/Riot/RiotClientServices.exe');
  assert.deepEqual(order, ['host', 'cover', 'toggle']);
  assert.equal(coverOptions.area, coverRect);
  assert.deepEqual(events.filter(event => event !== 'shape'), ['cover true', 'toggle false']);
  sample({ id: '1', x: 0, y: 0, width: 1536, height: 864, corner: 8 });
  await new Promise(setImmediate);
  assert.equal(window.visible, true);
  const plain = overlayShape(window.bounds, { top: 1, corner: 7 }), covered = overlayShape(window.bounds, { top: 1, corner: 7, covered: true });
  assert.deepEqual(window.shape, covered);
  events.length = 0;
  overlay.setOperation({ status: 'running', needsAttention: true });
  assert.deepEqual(window.shape, plain);
  assert.deepEqual(events, ['shape', 'cover false', 'toggle true']);
  assert.equal(window.visible, true);
  events.length = 0;
  overlay.setOperation({ status: 'running', needsAttention: false });
  assert.deepEqual(window.shape, covered);
  assert.deepEqual(events, ['cover true', 'toggle false', 'shape']);
  toggleOptions.onChange(true);
  assert.deepEqual(window.shape, overlayShape(window.bounds, { top: 1, corner: 7, covered: true, hidden: true }));
  toggleOptions.onChange(false);
  assert.deepEqual(window.shape, covered);
  overlay.setOperation({ status: 'running', signedIn: true });
  assert.equal(window.visible, false);
  events.length = 0;
  for (const status of ['succeeded', 'failed', 'cancelled']) {
    overlay.setOperation({ status: 'running' });
    assert.deepEqual(window.shape, covered);
    overlay.setOperation({ status, needsAttention: status === 'failed' });
    assert.deepEqual(window.shape, plain);
  }
  overlay.setOperation(null);
  assert.deepEqual(events.filter(event => event.startsWith('cover')), ['cover false', 'cover true', 'cover false', 'cover true', 'cover false']);
  assert.deepEqual(events.filter(event => event.startsWith('toggle')), ['toggle true', 'toggle false', 'toggle true', 'toggle false', 'toggle true']);
  assert.equal(window.visible, true);
  overlay.stop();
  assert.deepEqual(order.slice(3), ['toggle disposed', 'cover disposed', 'host disposed']);
});

test('the toggle leaves with the Riot sign-in form, manual or through Play, comes back with it, and with the accounts hidden nothing is left to click', async () => {
 let sample, window, toggleOptions;
 const events = [], shapes = [];
 class Window extends EventEmitter {
   constructor() { super(); window = this; this.bounds = {}; this.visible = false; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.webContents.loadURL = async () => {}; }
   setMenu() {}
   getBounds() { return this.bounds; }
   setBounds(bounds) { this.bounds = bounds; }
   setShape(shape) { this.shape = shape; shapes.push(shape); events.push('shape'); }
   isDestroyed() { return this.destroyed; }
   destroy() { this.destroyed = true; }
   isVisible() { return this.visible; }
   showInactive() { this.visible = true; }
   hide() { this.visible = false; }
 }
 const overlay = createRiotOverlay({
   electron: { BrowserWindow: Window, screen: { screenToDipRect: (_window, rect) => rect } },
   request: async () => ({}), readAuthenticationState: async () => ({ type: 'auth' }),
   createObserver: options => { sample = options.onState; return { start() {}, stop() {}, command: () => true }; },
   createHost: () => ({ open: async () => {}, dispose() {} }),
   createCover: () => ({ open: async () => {}, setVisible: value => events.push(`cover ${value}`), dispose() {} }),
   createToggle: options => { toggleOptions = options; return { open: async () => {}, setLanguage() {}, setVisible: value => events.push(`toggle ${value}`), dispose() {} }; },
   setInterval: () => ({ unref() {} }), clearInterval() {},
 });
 await overlay.start('C:/Riot/RiotClientServices.exe');
 const target = { id: '1', x: 0, y: 0, width: 1536, height: 864, corner: 8 };
 sample(target);
 await new Promise(setImmediate);
 assert.equal(window.visible, true);
 const left = cardsLeft(1536), shapeOf = options => overlayShape(window.bounds, { top: 1, corner: 7, ...options });
 assert.deepEqual(window.shape, shapeOf({}));
 events.length = 0;
 sample({ ...target, formHidden: true });
 assert.deepEqual(events, ['toggle false', 'shape']);
 assert.deepEqual(window.shape, shapeOf({ toggle: false }));
 assert.equal(window.shape.some(r => r.x < left), false);
 assert.equal(window.visible, true);
 sample({ ...target, formHidden: true });
 sample({ ...target, formHidden: 'true' });
 assert.deepEqual(events, ['toggle false', 'shape', 'shape', 'toggle true']);
 assert.deepEqual(window.shape, shapeOf({}));
 toggleOptions.onChange(true);
 assert.deepEqual(window.shape, shapeOf({ hidden: true }));
 events.length = 0;
 sample({ ...target, formHidden: true });
 assert.equal(window.visible, false);
 sample({ ...target, formHidden: true });
 assert.equal(window.visible, false);
 assert.deepEqual(events, ['toggle false']);
 sample(target);
 assert.equal(window.visible, true);
 assert.deepEqual(window.shape, shapeOf({ hidden: true }));
 assert.deepEqual(events, ['toggle false', 'shape', 'toggle true']);
 toggleOptions.onChange(false);
 events.length = 0;
 overlay.setOperation({ status: 'running' });
 sample({ ...target, formHidden: true });
 assert.deepEqual(events, ['cover true', 'toggle false', 'shape', 'shape']);
 assert.deepEqual(window.shape, shapeOf({ covered: true, toggle: false }));
 overlay.setOperation({ status: 'failed', needsAttention: true });
 assert.deepEqual(events.slice(4), ['shape', 'cover false']);
 assert.deepEqual(window.shape, shapeOf({ toggle: false }));
 assert.equal(window.visible, true);
 sample(target);
 assert.deepEqual(events.slice(6), ['shape', 'toggle true']);
 assert.deepEqual(window.shape, shapeOf({}));
 toggleOptions.onChange(true);
 overlay.setOperation({ status: 'running' });
 sample({ ...target, formHidden: true });
 assert.equal(window.visible, true);
 assert.deepEqual(window.shape, shapeOf({ hidden: true, covered: true, toggle: false }));
 overlay.setOperation({ status: 'failed' });
 assert.equal(window.visible, false);
 sample(target);
 assert.equal(window.visible, true);
 assert.deepEqual(window.shape, shapeOf({ hidden: true }));
 assert.equal(shapes.some(shape => shape.length === 0), false);
 overlay.stop();
});

test('the cover fills the login column except where the observer reads the Riot panel, and leaves the cards as they were', () => {
  for (const [width, height] of [[640, 360], [1024, 576], [1280, 720], [1536, 864], [1920, 1080], [2560, 1440]]) {
    const bounds = { width, height }, left = cardsLeft(width);
    assert.deepEqual(coverRect(bounds), { x: 0, y: 0, width: left, height });
    const panel = { x: Math.round(width * PANEL_POINT.x), y: Math.round(height * PANEL_POINT.y) };
    for (const hidden of [false, true]) {
      const shape = overlayShape(bounds, { hidden, covered: true });
      const inside = (x, y) => shape.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
      assert.deepEqual(shape[0], toggleRect(bounds));
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) assert.equal(inside(panel.x + dx, panel.y + dy), false, `hole ${width} ${dx},${dy}`);
      for (const [x, y] of [[panel.x - 6, panel.y], [panel.x + 6, panel.y], [panel.x, panel.y - 6], [panel.x, panel.y + 6], [0, 0], [left - 1, 0], [0, height - 1], [left - 1, height - 1], [Math.round(left / 2), Math.round(height * 0.34)]]) assert.equal(inside(x, y), true, `${width} ${x},${y}`);
      const column = shape.slice(1).filter(r => r.x < left);
      for (const r of column) assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= left && r.y + r.height <= height);
      assert.equal(column.reduce((sum, r) => sum + r.width * r.height, 0), left * height - 11 * 11);
      assert.deepEqual(shape.filter(r => r.x >= left), hidden ? [] : overlayShape(bounds).filter(r => r.x >= left));
      assert.deepEqual(overlayShape(bounds, { hidden, covered: true, toggle: false }), shape.slice(1));
    }
  }
  const size = { width: 1536, height: 864 }, left = cardsLeft(1536);
  const shape = overlayShape(size, { corner: 7, covered: true });
  const inside = (x, y) => shape.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  const outer = (x, y, cx, cy) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 8;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (inside(x, y)) assert.ok(outer(x, y, 7, 8), `top ${x},${y}`);
      if (inside(x, 863 - y)) assert.ok(outer(x, 863 - y, 7, 865 - 8), `bottom ${x},${863 - y}`);
    }
  }
  assert.ok(inside(4, 0) && !inside(3, 0) && inside(0, 4) && inside(4, 863) && !inside(3, 863) && inside(0, 859));
  assert.equal(shape.slice(1).filter(r => r.x < left).reduce((sum, r) => sum + r.width * r.height, 0), left * 864 - 11 * 11 - 2 * (4 + 3 + 2 + 1));
  assert.equal(overlayShape({ width: 3, height: 2 }, { corner: 500, covered: true }).every(r => r.width > 0 && r.height > 0), true);
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

test('the top row stays with the Riot border, so nothing paints past it on any side, at the top corners included', () => {
  assert.deepEqual([undefined, 0, 1, 2, 8, 16, '8', 7.5].map((corner) => topEdge({ corner })), [0, 0, 0, 1, 1, 1, 0, 0]);
  const size = { width: 1536, height: 864 }, left = cardsLeft(1536);
  for (const covered of [false, true]) {
    const shape = overlayShape(size, { corner: 7, top: 1, covered });
    const inside = (x, y) => shape.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    const within = (x, y, cx, cy) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 7;
    for (let x = 0; x < 1536; x += 1) assert.equal(inside(x, 0), false, `row 0 at ${x}`);
    for (let y = 1; y < 9; y += 1) {
      for (let x = 1536 - 8; x < 1536; x += 1) if (inside(x, y)) assert.ok(within(x, y, 1536 - 7, 1 + 7), `top right ${x},${y}`);
      if (covered) for (let x = 0; x < 8; x += 1) if (inside(x, y)) assert.ok(within(x, y, 7, 1 + 7), `top left ${x},${y}`);
    }
    for (let y = 863 - 8; y < 864; y += 1) for (let x = 1536 - 8; x < 1536; x += 1) if (inside(x, y)) assert.ok(within(x, y, 1536 - 7, 864 - 7), `bottom right ${x},${y}`);
    assert.ok(inside(1531, 1) && !inside(1532, 1) && inside(1535, 5) && inside(left, 1) && inside(1200, 1) && inside(1531, 863));
    assert.equal(inside(4, 1), covered);
    const cards = shape.filter((r) => r.x >= left);
    assert.equal(cards.reduce((sum, r) => sum + r.width * r.height, 0), (1536 - left) * 863 - 2 * (4 + 3 + 2 + 1));
    assert.deepEqual(shape[0], toggleRect(size));
  }
  assert.deepEqual(overlayShape(size, { top: 1 }), [toggleRect(size), { x: left, y: 1, width: 1536 - left, height: 863 }]);
  for (const top of [-1, 864, 2.5, '1']) assert.deepEqual(overlayShape(size, { top }), overlayShape(size));
});
