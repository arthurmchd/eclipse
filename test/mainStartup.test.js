const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };

function fixture({ args = [], prepared = true, openFailure = false, bridgeFailure = false, waitForReady = false, openGate, nativeOpenGate, operation = null } = {}) {
  const events = [];
  const openedClientPaths = [];
  const app = new EventEmitter();
  let releaseReady;
  const ready = waitForReady ? new Promise((resolve) => { releaseReady = resolve; }) : Promise.resolve();
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => ready, quit: () => events.push('quit'),
    getVersion: () => 'test', getFileIcon: async () => 'test-icon' });
  const handlers = new Map();
  const windows = [];
  const dialogs = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter();
      this.webContents.send = () => {};
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    removeMenu() {}
    loadFile() {}
    show() { events.push('show-manager'); }
    focus() {}
    hide() {}
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); events.push('tray'); }
    setToolTip() {}
    setContextMenu() {}
    destroy() { events.push('destroy-tray'); }
    displayBalloon() { events.push('balloon'); }
  }
  const electron = { app, BrowserWindow: FakeWindow, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    clipboard: {}, shell: {}, Tray: FakeTray, Menu: { buildFromTemplate: (value) => value }, nativeImage: {},
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return {}; }, showErrorBox: () => events.push('fatal-error') } };
  const riotClient = { detectClientPath: () => 'C:/test/RiotClientServices.exe',
    openClient: async (clientPath) => { events.push('official-open'); openedClientPaths.push(clientPath); if (nativeOpenGate) await nativeOpenGate; }, showClient: async () => events.push('official-show'),
    ensureBackgroundClient: async () => {}, dispose: async () => {}, runningGames: async () => ({}) };
  const store = { dir: 'C:/synthetic-data', data: { accounts: [], settings: { refreshMinutes: 0, riotClientPath: 'C:/configured/RiotClientServices.exe' } },
    listAccounts: () => [], publicSettings: () => ({}), log: () => {} };
  let privateOptions;
  const deps = {
    electron,
    fs: { existsSync: () => false, appendFileSync: () => {} }, path,
    './src/store': { Store: function () { return store; } },
    './src/riotApi': { REGIONS: {}, VAL_REGIONS: [], refreshAccount: async () => ({}) },
    './src/riotClient': riotClient,
    './src/signInService': { createSignInService: () => ({ getState: () => operation, cancel: () => {}, start: () => ({}) }) },
    './src/clientIntegration/status': { inspectClientIntegration: () => ({ active: false, reason: 'Original interface' }) },
    './src/clientIntegration/privateClient': {
      inspectPrivateClient: () => ({ active: prepared, mode: 'private', version: '142.0.0', reason: prepared ? null : 'Private copy is outdated' }),
      createPrivateClient: (options) => { privateOptions = options; return {
        open: async () => { events.push('private-open'); if (openGate) await openGate; if (openFailure) throw new Error('Private interface failed validation'); return { ready: true, managerConnected: true }; },
        hide: () => events.push('private-hide'), stop: async () => {},
      }; },
    },
    './src/clientIntegration/windowsDpapi': { protectString: async () => 'synthetic' },
    './src/clientIntegration/bridgeServer': { createClientBridge: () => ({
      start: async () => { events.push('bridge-start'); if (bridgeFailure) throw new Error('Synthetic local connection failure'); },
      stop: async () => events.push('bridge-stop'),
    }) },
  };
  vm.runInNewContext(source, { require: (name) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
    return deps[name];
  }, __dirname: path.join(__dirname, '..'), process: { argv: ['electron', '.', ...args], execPath: 'C:/test/electron.exe' },
  setTimeout, clearTimeout, console }, { filename: 'main.js' });
  return { app, events, windows, handlers, dialogs, openedClientPaths, setOperation: (value) => { operation = value; }, releaseReady: () => releaseReady(), privateOptions: () => privateOptions };
}

test('integrated shortcut promotes an existing normal manager and starts its bridge', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.events.includes('bridge-start'), false);
  f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  await flush();
  assert.equal(f.events.filter((event) => event === 'bridge-start').length, 1);
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.events.includes('official-open'), false);
  assert.equal(f.handlers.get('init')().nativeIntegration.requested, true);
  assert.equal(f.handlers.get('init')().nativeIntegration.active, true);
  assert.equal(f.privateOptions().revealOfficial, undefined);
});

test('an integrated request received before app readiness is preserved', async () => {
  const f = fixture({ waitForReady: true });
  f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  f.releaseReady();
  await flush();
  assert.equal(f.windows[0].options.show, false);
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.events.includes('official-open'), false);
});

test('outdated private copies show a readable error without opening the original client', async () => {
  const f = fixture({ args: ['--riot-login'], prepared: false });
  await flush();
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].detail, /Private copy is outdated/);
  assert.ok(f.events.includes('show-manager'));
  assert.equal(f.events.includes('private-open'), false);
  assert.equal(f.events.includes('official-open'), false);
  assert.equal(f.events.includes('official-show'), false);
});

test('private host failures are visible in the manager and never reveal the original UI', async () => {
  const f = fixture({ args: ['--riot-login'], openFailure: true });
  await flush();
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].detail, /failed validation/);
  assert.ok(f.events.includes('show-manager'));
  assert.equal(f.events.includes('official-open'), false);
  assert.equal(f.events.includes('official-show'), false);
});

test('repeated shortcut requests share one opening instead of racing backend startup', async () => {
  let releaseOpen;
  const openGate = new Promise((resolve) => { releaseOpen = resolve; });
  const f = fixture({ openGate });
  await flush();
  for (let i = 0; i < 3; i++) f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  await flush();
  assert.equal(f.events.filter((event) => event === 'bridge-start').length, 1);
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  releaseOpen();
  await flush();
  assert.equal(f.dialogs.length, 0);
});

test('failed local bridge activation is cleaned up and reported without launching a UI', async () => {
  const f = fixture({ bridgeFailure: true });
  await flush();
  f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  await flush();
  assert.equal(f.events.filter((event) => event === 'bridge-stop').length, 1);
  assert.equal(f.events.filter((event) => event === 'destroy-tray').length, 1);
  assert.equal(f.dialogs.length, 1);
  assert.equal(f.events.includes('private-open'), false);
  assert.equal(f.events.includes('official-open'), false);
});

test('integrated manual recovery reopens the native challenge without replacing its renderer', async () => {
  const f = fixture({ args: ['--riot-login'] });
  await flush();
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  f.setOperation({ status: 'running', needsAttention: true, nativeClient: true });
  const response = await f.handlers.get('show-riot-client')();
  assert.equal(response.ok, true);
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.events.filter((event) => event === 'official-open').length, 1);
  assert.ok(f.events.includes('private-hide'));
  assert.deepEqual(f.openedClientPaths, ['C:/configured/RiotClientServices.exe']);
});

test('normal-manager manual recovery also opens the renderer that owns the native challenge', async () => {
  const f = fixture({ prepared: false, operation: { status: 'running', needsAttention: true, nativeClient: true } });
  await flush();
  const response = await f.handlers.get('show-riot-client')();
  assert.equal(response.ok, true);
  assert.deepEqual(f.openedClientPaths, ['C:/configured/RiotClientServices.exe']);
  assert.equal(f.events.includes('official-show'), false);
  assert.equal(f.events.includes('private-open'), false);
  assert.equal(f.events.includes('bridge-start'), false);
});

test('native verification recovery bypasses integration preparation and serializes repeated requests', async () => {
  let releaseNativeOpen;
  const nativeOpenGate = new Promise((resolve) => { releaseNativeOpen = resolve; });
  const f = fixture({ prepared: false, nativeOpenGate, operation: { status: 'running', needsAttention: true, nativeClient: true } });
  await flush();
  for (let i = 0; i < 3; i++) f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  await flush();
  assert.equal(f.events.filter((event) => event === 'official-open').length, 1);
  assert.equal(f.events.includes('bridge-start'), false);
  assert.equal(f.events.includes('private-open'), false);
  releaseNativeOpen();
  await flush();
  assert.equal(f.dialogs.length, 0);
});

test('only a running native verification can take the explicit native recovery path', async () => {
  for (const operation of [
    { status: 'running', needsAttention: true, nativeClient: false },
    { status: 'running', needsAttention: false, nativeClient: true },
    { status: 'failed', needsAttention: true, nativeClient: true },
  ]) {
    const f = fixture({ operation });
    await flush();
    f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
    await flush();
    assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
    assert.equal(f.events.includes('official-open'), false);
  }
});
