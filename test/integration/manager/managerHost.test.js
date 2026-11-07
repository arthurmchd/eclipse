const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createManagerHost, CHANNEL } = require('../../../src/integration/manager/managerHost');
const { ACCOUNT_CARDS_FILE, MANAGER_PRELOAD_FILE } = require('../../../src/paths');

function fixture(t, request = async (method, args) => ({ ok: true, value: { method, args } }), options = {}) {
  const handlers = new Map(), views = [], requests = [];
  const parent = new EventEmitter();
  let size = [1280, 800], destroyed = false;
  parent.isDestroyed = () => destroyed;
  parent.getContentSize = () => size;
  parent.contentView = {
    children: [],
    addChildView(view) { this.children.push(view); },
    removeChildView(view) { this.children = this.children.filter((child) => child !== view); },
  };
  class FakeView {
    constructor(options) {
      this.options = options; this.webContents = new EventEmitter();
      const contents = this.webContents;
      contents.isDestroyed = () => Boolean(contents.closed);
      contents.getURL = () => contents.url || '';
      contents.loadFile = async (file) => { contents.file = file; contents.url = pathToFileURL(file).href; contents.mainFrame = { url: contents.url }; };
      contents.close = () => { contents.closed = true; };
      contents.focus = () => { contents.focused = true; };
      contents.setWindowOpenHandler = (callback) => { contents.openHandler = callback; };
      contents.session = { setPermissionRequestHandler: (callback) => { contents.permission = callback; }, setPermissionCheckHandler: (callback) => { contents.permissionCheck = callback; } };
      views.push(this);
    }
    setBackgroundColor(color) { this.background = color; }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(visible) { this.visible = visible; }
  }
  const electron = { WebContentsView: FakeView,
    BrowserWindow: class { constructor() { throw new Error('A separate manager window must never be created'); } },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) },
  };
  const host = createManagerHost({ ...options, electron, request: async (...args) => { requests.push(args); return request(...args); } });
  t.after(() => host.dispose());
  const event = () => ({ sender: views[0].webContents, senderFrame: views[0].webContents.mainFrame });
  return { host, parent, views, handlers, requests, event, resize(width, height) { size = [width, height]; parent.emit('resize'); }, destroy() { destroyed = true; parent.emit('closed'); } };
}

test('the complete account interface is a secured child view inside the existing Riot window', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.host.open(f.parent), { ready: true, embedded: true });
  assert.equal(f.views.length, 1);
  assert.equal(f.parent.contentView.children[0], f.views[0]);
  assert.equal(f.views[0].webContents.file, ACCOUNT_CARDS_FILE);
  assert.deepEqual(f.views[0].options.webPreferences, {
    preload: MANAGER_PRELOAD_FILE, contextIsolation: true, sandbox: true, nodeIntegration: false,
    webSecurity: true, partition: 'persist:ram-manager-panel',
  });
  assert.deepEqual(f.views[0].bounds, { x: 0, y: 0, width: 1280, height: 800 });
  f.resize(940, 710);
  assert.deepEqual(f.views[0].bounds, { x: 0, y: 0, width: 940, height: 710 });
});

test('IPC is restricted to the embedded main frame and exact local file', async (t) => {
  const f = fixture(t);
  await f.host.open(f.parent);
  const handler = f.handlers.get(CHANNEL);
  assert.deepEqual(await handler(f.event(), 'saveAccount', [{ gameName: 'Example', password: 'synthetic-only' }]), { method: 'saveAccount', args: [{ gameName: 'Example', password: 'synthetic-only' }] });
  for (const event of [
    { sender: {}, senderFrame: f.event().senderFrame },
    { sender: f.event().sender, senderFrame: { url: f.event().senderFrame.url } },
  ]) await assert.rejects(handler(event, 'init', []), /only available/);
  f.views[0].webContents.mainFrame.url = 'http://127.0.0.1:1234/index.html';
  await assert.rejects(handler(f.event(), 'init', []), /only available/);
  assert.equal(f.requests.length, 1);
});

test('invalid commands and oversized payloads never reach the credential service', async (t) => {
  const f = fixture(t);
  await f.host.open(f.parent);
  const handler = f.handlers.get(CHANNEL);
  for (const method of ['readPassword', 'closeManager', 'copy', 'patchAccount', 'forgetSession', 'showRiotClient', 'pickClientPath', 'openDataFolder']) await assert.rejects(handler(f.event(), method, []), /Invalid account command/);
  await assert.rejects(handler(f.event(), 'init', {}), /Invalid account command/);
  await assert.rejects(handler(f.event(), 'saveAccount', [{ note: 'x'.repeat(33000) }]), /Não foi possível/);
  assert.equal(f.requests.length, 0);
});

test('closing the embedded interface preserves the same Riot window and view for reopening', async (t) => {
  const f = fixture(t);
  await f.host.open(f.parent);
  f.host.close();
  assert.equal(f.parent.contentView.children.length, 0);
  assert.equal(f.views[0].visible, false);
  assert.equal(f.views[0].webContents.closed, undefined);
  await f.host.open(f.parent);
  assert.equal(f.views.length, 1);
  assert.equal(f.parent.contentView.children.length, 1);
  f.destroy();
  assert.equal(f.views[0].webContents.closed, true);
});

test('a left inset keeps the view right of it and never leaves it without width', async (t) => {
  const f = fixture(t, undefined, { topInset: 0, leftInset: (width) => Math.round(width * 400 / 1536) });
  await f.host.open(f.parent);
  assert.deepEqual(f.views[0].bounds, { x: 333, y: 0, width: 947, height: 800 });
  f.resize(1536, 864);
  assert.deepEqual(f.views[0].bounds, { x: 400, y: 0, width: 1136, height: 864 });
  f.resize(1, 864);
  assert.deepEqual(f.views[0].bounds, { x: 0, y: 0, width: 1, height: 864 });
});

test('the embedded view asks for Riot window actions locally and only from a fixed list', async (t) => {
  const actions = [];
  const f = fixture(t, undefined, { onWindowAction: async (action) => { actions.push(action); if (action === 'close') throw new Error('private failure'); return action === 'minimize'; } });
  await f.host.open(f.parent);
  const handler = f.handlers.get(CHANNEL);
  assert.deepEqual(await handler(f.event(), 'windowAction', ['minimize']), { ok: true });
  assert.deepEqual(await handler(f.event(), 'windowAction', ['close']), { ok: false });
  for (const args of [['quit'], ['reveal'], [], ['minimize', 'close'], [1], [{ action: 'close' }]]) await assert.rejects(handler(f.event(), 'windowAction', args), /Invalid account command/);
  await assert.rejects(handler(f.event(), 'setModal', [true]), /Invalid account command/);
  await assert.rejects(handler({ sender: {}, senderFrame: {} }, 'windowAction', ['minimize']), /only available/);
  assert.deepEqual(actions, ['minimize', 'close']);
  assert.equal(f.requests.length, 0);
});

test('without a window action handler the embedded view reports the action as not done', async (t) => {
  const f = fixture(t);
  await f.host.open(f.parent);
  assert.deepEqual(await f.handlers.get(CHANNEL)(f.event(), 'windowAction', ['close']), { ok: false });
  assert.equal(f.requests.length, 0);
});

test('the embedded view blocks navigation, extra windows and browser permissions', async (t) => {
  const f = fixture(t);
  await f.host.open(f.parent);
  const contents = f.views[0].webContents;
  let prevented = 0;
  contents.emit('will-navigate', { preventDefault() { prevented++; } }, 'https://example.invalid');
  assert.equal(prevented, 1);
  assert.deepEqual(contents.openHandler({ url: 'https://developer.riotgames.com' }), { action: 'deny' });
  assert.deepEqual(contents.openHandler({ url: 'file:///private-data' }), { action: 'deny' });
  assert.deepEqual(f.requests, [['openExternal', ['https://developer.riotgames.com']]]);
  let permission;
  contents.permission(contents, 'camera', (allowed) => { permission = allowed; });
  assert.equal(permission, false);
  assert.equal(contents.permissionCheck(), false);
});

test('bridge failures are generic and cannot echo credentials into renderer errors', async (t) => {
  const f = fixture(t, async () => ({ ok: false, error: 'synthetic-private-token' }));
  await f.host.open(f.parent);
  await assert.rejects(f.handlers.get(CHANNEL)(f.event(), 'init', []), (error) => {
    assert.equal(error.message.includes('synthetic-private-token'), false);
    return true;
  });
  f.host.dispose();
  assert.equal(f.handlers.has(CHANNEL), false);
  assert.equal(f.views[0].webContents.closed, true);
  await assert.rejects(f.host.open(f.parent), /unavailable/);
});
