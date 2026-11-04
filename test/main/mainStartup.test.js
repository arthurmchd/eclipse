const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { SOURCE_DIR } = require('../../src/paths');

const source = fs.readFileSync(path.join(SOURCE_DIR, 'main', 'index.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

test('default overlay startup waits for the official client without starting a private interface or bridge', async () => {
  const f = fixture({ overlayMode: true, prepared: false });
  await flush();
  assert.equal(f.events.includes('overlay-start'), true);
  for (const event of ['private-open', 'bridge-start', 'official-open']) assert.equal(f.events.includes(event), false);
  assert.equal(f.managerOptions().initContext().nativeIntegration.mode, 'overlay');
  assert.equal(f.launchOptions().releaseAfterLaunch, true);
  assert.equal(f.launchOptions().visibleLogin, true);
  f.launchOptions().operationUpdated({ status: 'running', needsAttention: true });
  assert.equal(f.events.at(-1), 'overlay-blocked');
  f.launchOptions().operationUpdated({ status: 'succeeded' });
  assert.equal(f.events.at(-1), 'overlay-unblocked');
  f.app.emit('before-quit', { preventDefault() {} });
  await flush();
  assert.equal(f.events.includes('overlay-stop'), true);
});

test('tray opens the official Riot client and requests its overlay; ordinary launch stays blocked during login', async () => {
  const f = fixture({ overlayMode: true });
  await flush();
  await f.trayMenu().find(item => item.label === 'Contas no Riot').click();
  assert.equal(f.events.includes('official-open'), true);
  assert.equal(f.events.includes('overlay-open'), true);
  f.setOperation({ status: 'running', needsAttention: false });
  await f.managerOptions().showRiotClient();
  assert.equal(f.events.filter(e => e === 'official-open').length, 1);
});

function fixture({ overlayMode = false, prepared = true, openFailure = false, bridgeFailure = false, waitForReady = false, openGate, nativeOpenGate, operation = null, singleInstance = true } = {}) {
  const events = [], publicEvents = [], dialogs = [], openedClientPaths = [], managerCalls = [];
  const app = new EventEmitter();
  let releaseReady, privateOptions, bridgeOptions, managerOptions, launchOptions, trayMenu;
  let windows = 0;
  const ready = waitForReady ? new Promise((resolve) => { releaseReady = resolve; }) : Promise.resolve();
  Object.assign(app, { requestSingleInstanceLock: () => singleInstance, whenReady: () => ready, quit: () => events.push('quit'),
    getVersion: () => 'test', getFileIcon: async () => 'test-icon' });
  class FakeTray extends EventEmitter {
    constructor() { super(); events.push('tray'); }
    setToolTip() {}
    setContextMenu(menu) { trayMenu = menu; }
    destroy() { events.push('destroy-tray'); }
    displayBalloon() { events.push('balloon'); }
  }
  const electron = {
    app, BrowserWindow: function () { windows++; throw new Error('The headless controller must not create a manager window'); },
    ipcMain: { handle() { throw new Error('Manager IPC belongs to the embedded host'); } },
    clipboard: {}, shell: {}, Tray: FakeTray, Menu: { buildFromTemplate: (value) => value }, nativeImage: {},
    dialog: { showMessageBox: async (options) => { dialogs.push(options); return {}; }, showErrorBox: () => events.push('fatal-error') },
  };
  const riotClient = {
    detectClientPath: () => 'C:/test/RiotClientServices.exe',
    openClient: async (clientPath) => { events.push('official-open'); openedClientPaths.push(clientPath); if (nativeOpenGate) await nativeOpenGate; },
    ensureBackgroundClient: async () => {}, dispose: async () => events.push('riot-dispose'),
    runningGames: async () => ({}), hasPersistedLogin: () => false,
    readAuthenticationState: async () => ({ type: 'multifactor' }),
  };
  const store = {
    dir: 'C:/synthetic-data',
    data: { accounts: [], settings: { refreshMinutes: 0, riotClientPath: 'C:/configured/RiotClientServices.exe' } },
    listAccounts: () => [], publicSettings: () => ({}), log: () => {},
  };
  const deps = {
    electron, fs: { existsSync: () => false, appendFileSync: () => {} }, path,
    '../paths': { APP_ICON: 'C:/app/src/renderer/assets/icon.png' },
    '../integration/overlay/riotOverlay': { createRiotOverlay: () => ({
      start: async () => events.push('overlay-start'), open: async () => events.push('overlay-open'),
      setBlocked: (blocked) => events.push(blocked ? 'overlay-blocked' : 'overlay-unblocked'),
      setOperation() {},
      stop: () => events.push('overlay-stop'),
    }) },
    '../core/store': { Store: function () { return store; } },
    '../core/rankApi': { REGIONS: {}, VAL_REGIONS: [], refreshAccount: async () => ({}) },
    '../riot/riotClient': riotClient,
    '../core/signInService': { createSignInService: (options) => {
      launchOptions = options;
      return { getState: () => operation, cancel: () => events.push('cancel'), start: () => ({ ok: true, operationId: 'synthetic' }) };
    } },
    '../core/managerService': {
      createManagerEvents: () => ({ publish: (channel, payload) => publicEvents.push({ channel, payload }) }),
      createManagerService: (options) => {
        managerOptions = options;
        return { dispatch: async (method, args) => { managerCalls.push({ method, args }); return { handled: true }; } };
      },
    },
    '../integration/privateClient': {
      inspectPrivateClient: () => ({ active: prepared, mode: 'private', version: '142.0.0', reason: prepared ? null : 'Private copy is outdated' }),
      createPrivateClient: (options) => {
        privateOptions = options;
        const open = async (event) => { events.push(event); if (openGate) await openGate; if (openFailure) throw new Error('Private interface failed validation'); return { ready: true, managerConnected: true }; };
        return { open: () => open('private-open'), openManager: () => open('embedded-open'),
          hide: () => events.push('private-hide'), stop: async () => events.push('private-stop') };
      },
    },
    '../platform/windows/windowsDpapi': { protectString: async () => 'synthetic' },
    '../integration/bridgeServer': { createClientBridge: (options) => {
      bridgeOptions = options;
      return { start: async () => { events.push('bridge-start'); if (bridgeFailure) throw new Error('Synthetic local connection failure'); },
        stop: async () => events.push('bridge-stop') };
    } },
  };
  vm.runInNewContext(source, { require(name) {
    if (!(name in deps)) throw new Error('Unexpected dependency: ' + name);
    return deps[name];
  }, process: { argv: ['electron', '.', ...(overlayMode ? [] : ['--private-client'])], execPath: 'C:/test/electron.exe' }, setTimeout, clearTimeout, console }, { filename: 'index.js' });
  return { app, events, publicEvents, dialogs, openedClientPaths, managerCalls, riotClient, windowCount: () => windows,
    setOperation: (value) => { operation = value; }, releaseReady: () => releaseReady(),
    privateOptions: () => privateOptions, bridgeOptions: () => bridgeOptions, managerOptions: () => managerOptions,
    launchOptions: () => launchOptions, trayMenu: () => trayMenu };
}

test('explicit private mode opens the legacy integrated UI', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.windowCount(), 0);
  assert.equal(f.events.filter((event) => event === 'bridge-start').length, 1);
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.events.includes('official-open'), false);
  assert.equal(f.privateOptions().revealOfficial, undefined);
  assert.equal(f.managerOptions().initContext().nativeIntegration.active, true);
});

test('a second launch opens the accounts view inside the existing Riot window', async () => {
  const f = fixture();
  await flush();
  f.app.emit('second-instance', {}, ['electron', '.']);
  await flush();
  assert.equal(f.events.filter((event) => event === 'embedded-open').length, 1);
  assert.equal(f.events.filter((event) => event === 'bridge-start').length, 1);
  assert.equal(f.windowCount(), 0);
});

test('requests received before app readiness still result in one integrated startup', async () => {
  const f = fixture({ waitForReady: true });
  f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  f.releaseReady();
  await flush();
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.windowCount(), 0);
});

test('outdated copies and private host failures show an error without creating a fallback manager window', async () => {
  for (const options of [{ prepared: false }, { openFailure: true }]) {
    const f = fixture(options);
    await flush();
    assert.equal(f.dialogs.length, 1);
    assert.match(f.dialogs[0].message, /interface integrada/);
    assert.equal(f.windowCount(), 0);
    assert.equal(f.events.includes('official-open'), false);
    assert.equal(f.events.includes('tray'), true);
  }
});

test('repeated requests serialize the same private opening instead of racing startup', async () => {
  let release;
  const openGate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ openGate });
  await flush();
  for (let i = 0; i < 3; i++) f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  await flush();
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.events.includes('embedded-open'), false);
  release();
  await flush();
  assert.equal(f.dialogs.length, 0);
});

test('failed local bridge startup is cleaned up and the tray remains available for recovery', async () => {
  const f = fixture({ bridgeFailure: true });
  await flush();
  assert.equal(f.events.filter((event) => event === 'bridge-stop').length, 1);
  assert.equal(f.dialogs.length, 1);
  assert.equal(f.events.includes('private-open'), false);
  assert.equal(f.events.includes('destroy-tray'), false);
});

test('bridge management commands and the accounts button use the headless service and embedded view', async () => {
  const f = fixture();
  await flush();
  assert.deepEqual(await f.bridgeOptions().manage('init', []), { handled: true });
  assert.equal(f.managerCalls[0].method, 'init');
  await f.bridgeOptions().openManager();
  assert.equal(f.events.filter((event) => event === 'embedded-open').length, 1);
  assert.equal(f.windowCount(), 0);
});

test('tray accounts action opens the same embedded view and exposes no old manager entry', async () => {
  const f = fixture();
  await flush();
  const menu = f.trayMenu();
  assert.equal(menu.some((item) => /account manager/i.test(item.label || '')), false);
  await menu.find((item) => item.label === 'Contas no Riot').click();
  assert.equal(f.events.filter((event) => event === 'embedded-open').length, 1);
  assert.equal(f.windowCount(), 0);
});

test('native verification recovery preserves its original renderer even when the private copy is unavailable', async () => {
  const f = fixture({ prepared: false, operation: { status: 'running', needsAttention: true, nativeClient: true } });
  await flush();
  assert.deepEqual(f.openedClientPaths, ['C:/configured/RiotClientServices.exe']);
  assert.equal(f.events.includes('private-open'), false);
  assert.equal(f.events.includes('bridge-start'), false);
  assert.equal(f.dialogs.length, 0);
});

test('manager recovery hands native CAPTCHA and MFA back to the original renderer', async () => {
  const f = fixture();
  await flush();
  f.setOperation({ status: 'running', needsAttention: true, nativeClient: true });
  const response = await f.managerOptions().showRiotClient();
  assert.equal(response.ok, true);
  assert.deepEqual(f.openedClientPaths, ['C:/configured/RiotClientServices.exe']);
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.events.includes('private-hide'), true);
});

test('concurrent native recovery requests are serialized', async () => {
  let release;
  const nativeOpenGate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ prepared: false, nativeOpenGate, operation: { status: 'running', needsAttention: true, nativeClient: true } });
  await flush();
  for (let i = 0; i < 3; i++) f.app.emit('second-instance', {}, ['electron', '.', '--riot-login']);
  await flush();
  assert.equal(f.events.filter((event) => event === 'official-open').length, 1);
  release();
  await flush();
  assert.equal(f.events.includes('private-open'), false);
});

test('expired native verification keeps its original renderer until the challenge is finished', async () => {
  const f = fixture();
  await flush();
  f.setOperation({ status: 'failed', needsAttention: true, nativeClient: true });
  for (const state of [{ type: 'multifactor' }, { type: 'auth', error: 'captcha_not_allowed' }, null]) {
    f.riotClient.readAuthenticationState = async () => state;
    assert.equal((await f.managerOptions().showRiotClient()).ok, true);
  }
  f.riotClient.readAuthenticationState = async () => { throw new Error('Temporary local failure'); };
  assert.equal((await f.managerOptions().showRiotClient()).ok, true);
  assert.equal(f.events.filter((event) => event === 'official-open').length, 4);
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  for (const type of ['authenticated', 'auth']) {
    f.riotClient.readAuthenticationState = async () => ({ type });
    assert.equal((await f.managerOptions().showRiotClient()).ok, true);
  }
  assert.equal(f.events.filter((event) => event === 'private-open').length, 3);
  assert.equal(f.events.filter((event) => event === 'official-open').length, 4);
});

test('ordinary background login cannot be revealed by another launch request', async () => {
  const f = fixture();
  await flush();
  f.setOperation({ status: 'running', needsAttention: false, nativeClient: true });
  await f.managerOptions().showRiotClient();
  assert.equal(f.events.filter((event) => event === 'private-open').length, 1);
  assert.equal(f.events.includes('official-open'), false);
});

test('operation progress is retained as service events while the private window stays hidden', async () => {
  const f = fixture();
  await flush();
  f.launchOptions().operationUpdated({ status: 'running', accountId: 'example', text: 'Signing in' });
  f.launchOptions().status({ needsAttention: true, text: 'Needs verification' });
  assert.equal(f.events.includes('private-hide'), true);
  assert.equal(f.publicEvents.some((event) => event.channel === 'sign-in-operation'), true);
  assert.equal(f.events.includes('balloon'), true);
});

test('quitting cancels the operation and closes only project services', async () => {
  const f = fixture();
  await flush();
  let prevented = false;
  f.app.emit('before-quit', { preventDefault() { prevented = true; } });
  await flush();
  assert.equal(prevented, true);
  for (const event of ['cancel', 'private-stop', 'riot-dispose', 'bridge-stop', 'destroy-tray', 'quit']) assert.equal(f.events.includes(event), true);
  assert.equal(f.events.includes('official-open'), false);
});

test('a second controller process exits without opening a window or another bridge', async () => {
  const f = fixture({ singleInstance: false });
  await flush();
  assert.deepEqual(f.events, ['quit']);
  assert.equal(f.windowCount(), 0);
});
