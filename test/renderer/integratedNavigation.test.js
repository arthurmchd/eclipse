const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RENDERER_DIR, ADDON_DIR } = require('../../src/paths');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function navigationFixture({ embedded = true, available = true, fail = false } = {}) {
  const documentListeners = new Map(), nodes = new Map();
  const secretInputs = [{ value: 'newly-typed-password' }, { value: 'newly-typed-api-key' }];
  const dialogs = [{ listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); } }];
  for (const name of ['#return-to-riot', '#window-behaviour', '#integrated-behaviour']) {
    nodes.set(name, { hidden: false, listeners: new Map(), addEventListener(event, callback) { this.listeners.set(event, callback); } });
  }
  let openDialog = false, closes = 0;
  const toasts = [];
  const api = available ? { closeManager: async () => { if (fail) throw new Error('Could not return to Riot'); closes++; } } : {};
  const context = vm.createContext({
    window: { api },
    document: {
      querySelector: (selector) => selector === 'dialog[open]' ? openDialog ? dialogs[0] : null : nodes.get(selector),
      querySelectorAll: (selector) => selector === 'dialog' ? dialogs : secretInputs,
      addEventListener: (event, callback) => documentListeners.set(event, callback),
    },
  });
  const source = fs.readFileSync(path.join(RENDERER_DIR, 'app.js'), 'utf8')
    .replace(/^import .*;\r?\n/, '')
    .replace(/main\(\);\s*$/, 'globalThis.navigation = { state, bindIntegratedNavigation, closeIntegratedManager };');
  vm.runInContext(source, context);
  context.toast = (...args) => toasts.push(args);
  context.navigation.state.embedded = embedded;
  context.navigation.bindIntegratedNavigation();
  return { nodes, documentListeners, dialogs, secretInputs, toasts, closeCount: () => closes, setDialog: (value) => { openDialog = value; } };
}

test('integrated accounts can return to the native Riot view with the button and Escape', async () => {
  const f = navigationFixture();
  assert.equal(f.nodes.get('#return-to-riot').hidden, false);
  await f.nodes.get('#return-to-riot').listeners.get('click')();
  assert.equal(f.closeCount(), 1);
  assert.ok(f.secretInputs.every((input) => input.value === ''));
  let prevented = false;
  f.documentListeners.get('keydown')({ key: 'Escape', preventDefault() { prevented = true; } });
  await flush();
  assert.equal(prevented, true);
  assert.equal(f.closeCount(), 2);
});

test('Escape inside a modal keeps the accounts view open and modal closure clears transient secrets', async () => {
  const f = navigationFixture();
  f.setDialog(true);
  let prevented = false;
  f.documentListeners.get('keydown')({ key: 'Escape', preventDefault() { prevented = true; } });
  await flush();
  assert.equal(prevented, false);
  assert.equal(f.closeCount(), 0);
  f.dialogs[0].listeners.get('close')();
  assert.ok(f.secretInputs.every((input) => input.value === ''));
});

test('integrated preferences show the fixed background policy without changing saved preferences', () => {
  const f = navigationFixture();
  assert.equal(f.nodes.get('#window-behaviour').hidden, true);
  assert.equal(f.nodes.get('#integrated-behaviour').hidden, false);
});

test('browser preview and missing embedded capability do not claim to close the Riot view', async () => {
  for (const options of [{ embedded: false }, { available: false }]) {
    const f = navigationFixture(options);
    assert.equal(f.nodes.get('#return-to-riot').hidden, true);
    f.documentListeners.get('keydown')({ key: 'Escape', preventDefault() { throw new Error('Preview shortcuts should remain native'); } });
    await flush();
    assert.equal(f.closeCount(), 0);
  }
});

test('a failed return request shows an error instead of silently clearing an unsaved form', async () => {
  const f = navigationFixture({ fail: true });
  await f.nodes.get('#return-to-riot').listeners.get('click')();
  assert.equal(f.closeCount(), 0);
  assert.equal(f.toasts[0][0], 'Could not return to Riot');
  assert.notEqual(f.secretInputs[0].value, '');
});

function launcherFixture({ login = true } = {}) {
  const created = [], listeners = new Map(), timeouts = new Map(), intervals = new Map();
  let id = 0, observer, opens = 0, hasLogin = login;
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.hidden = false; this.style = {}; this.dataset = {}; this.listeners = {};
      this.attributes = {}; this.parentElement = null; this._text = ''; this.classList = { toggle() {} };
      created.push(this);
    }
    append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    set textContent(text) { this._text = String(text); this.children = []; }
    get textContent() { return this._text + this.children.map((item) => item.textContent).join(''); }
    set innerHTML(_value) { throw new Error('The launcher must not interpolate HTML'); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    attachShadow() { return this.shadow = new Element('shadow'); }
    querySelectorAll() { return created.filter((item) => item.tagName === 'button' && item.dataset.accountId); }
    getBoundingClientRect() { return { width: 200, height: 40 }; }
  }
  const body = new Element('body'), password = new Element('input');
  password.parentElement = body;
  Object.defineProperty(password, 'value', { get() { throw new Error('A Riot credential must not be read'); } });
  const window = {
    innerWidth: 1280,
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
    getComputedStyle: (item) => ({ display: item.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
    setTimeout: (callback) => { const key = ++id; timeouts.set(key, callback); return key; },
    clearTimeout: (key) => timeouts.delete(key),
    setInterval: (callback) => { const key = ++id; intervals.set(key, callback); return key; },
    clearInterval: (key) => intervals.delete(key),
    riotAccountManager: { state: async () => ({ ok: true, accounts: [], operation: null }), openManager: async () => { opens++; return { ok: true }; } },
  };
  const document = { body, documentElement: body, readyState: 'complete', createElement: (tag) => new Element(tag), querySelectorAll: () => hasLogin ? [password] : [] };
  vm.runInNewContext(fs.readFileSync(path.join(ADDON_DIR, 'addon-renderer.js'), 'utf8'), {
    window, document, MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() { observer = null; } },
  });
  function scan(loginVisible) {
    hasLogin = loginVisible;
    observer?.();
    for (const [key, callback] of [...timeouts]) { timeouts.delete(key); callback(); }
  }
  return { created, intervals, listeners, scan, openCount: () => opens };
}

test('the Contas entry remains available when the native client is already signed in', async () => {
  const f = launcherFixture({ login: false });
  await flush();
  const launcher = f.created.find((node) => node.id === 'ram-account-workspace-launcher-v1');
  const quickPanel = f.created.find((node) => node.id === 'ram-login-account-panel-v1');
  assert.ok(launcher);
  assert.equal(launcher.hidden, false);
  assert.equal(quickPanel.hidden, true);
  assert.equal(f.intervals.size, 0);
  const open = launcher.shadow.children.find((node) => node.tagName === 'button');
  assert.equal(open.textContent, 'Contas');
  await open.listeners.click();
  assert.equal(f.openCount(), 1);
});

test('the persistent Contas entry survives transitions between login and connected pages without duplicate buttons', async () => {
  const f = launcherFixture();
  await flush();
  f.scan(false);
  f.scan(true);
  await flush();
  assert.equal(f.created.filter((node) => node.id === 'ram-account-workspace-launcher-v1').length, 1);
  assert.equal(f.intervals.size, 1);
  f.listeners.get('beforeunload')();
  assert.equal(f.intervals.size, 0);
});
