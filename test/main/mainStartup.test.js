const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { SOURCE_DIR } = require('../../src/paths');

const source = fs.readFileSync(path.join(SOURCE_DIR, 'main', 'index.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const count = (f, name) => f.events.filter((event) => event === name).length;
const click = (f, label) => f.trayMenu().find((item) => item.label === label).click();

test('startup waits for the official client and starts the cards over it', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.events.includes('overlay-start'), true);
  assert.equal(f.events.includes('official-open'), false);
  for (const name of ['releaseAfterLaunch', 'visibleLogin']) assert.equal(Object.hasOwn(f.launchOptions(), name), false);
  for (const name of ['clipboard', 'dialog', 'showRiotClient', 'setTimer']) assert.equal(Object.hasOwn(f.managerOptions(), name), false);
  f.launchOptions().operationUpdated({ status: 'running', needsAttention: true });
  assert.equal(f.events.at(-1), 'overlay-blocked');
  f.launchOptions().operationUpdated({ status: 'succeeded' });
  assert.deepEqual(f.events.slice(-2), ['overlay-unblocked', 'keeper-check']);
  f.app.emit('before-quit', { preventDefault() {} });
  await flush();
  assert.equal(f.events.includes('overlay-stop'), true);
});

test('the session keeper keeps each account session when Riot quits, checks again after a sign-in and stops on quit', async () => {
  const f = fixture();
  await flush();
  assert.ok(f.events.indexOf('keeper-start') >= 0 && f.events.indexOf('keeper-start') < f.events.indexOf('overlay-start'));
  const options = f.keeperOptions();
  assert.equal(options.riot, f.riotClient);
  assert.equal(options.store, f.store);
  assert.equal(options.busy(), false);
  f.setBusy(true);
  assert.equal(options.busy(), true);
  options.onSaved({ id: 'synthetic-account' });
  assert.deepEqual(f.publicEvents.at(-1), { channel: 'account-updated', payload: { id: 'synthetic-account', public: true } });
  f.launchOptions().operationUpdated({ status: 'running' });
  assert.equal(f.events.includes('keeper-check'), false);
  f.launchOptions().operationUpdated({ status: 'failed', text: 'synthetic failure' });
  assert.equal(f.events.includes('keeper-check'), true);
  f.launchOptions().onClosed({ riotId: null, yaml: 'owned' });
  assert.equal(f.events.at(-1), 'keeper-keep');
  f.launchOptions().onClosed({ riotId: null, yaml: 'unknown' });
  assert.equal(count(f, 'keeper-keep'), 2);
  f.app.emit('before-quit', { preventDefault() {} });
  await flush();
  assert.ok(f.events.indexOf('keeper-stop') > f.events.indexOf('cancel'));
});

test('the wakeup opens the window of a Riot that leaves background mode without one, and stops watching on quit', async () => {
  const f = fixture();
  await flush();
  assert.ok(f.events.indexOf('wakeup-start') > f.events.indexOf('keeper-start') && f.events.indexOf('wakeup-start') < f.events.indexOf('overlay-start'));
  const options = f.wakeupOptions();
  assert.equal(options.riot, f.riotClient);
  assert.equal(options.busy(), false);
  f.setBusy(true);
  assert.equal(options.busy(), true);
  f.app.emit('before-quit', { preventDefault() {} });
  await flush();
  assert.ok(f.events.indexOf('wakeup-stop') > f.events.indexOf('cancel'));
});

test('Chromium keeps drawing the cards when they start covered by Riot and shows them without fading in', async () => {
  const f = fixture();
  assert.deepEqual(f.app.switches, [['disable-features', 'CalculateNativeWinOcclusion'], ['wm-window-animations-disabled', undefined]]);
  await flush();
});

test('tray opens the official Riot client and requests the cards; launching stays blocked during a sign-in', async () => {
  const f = fixture();
  await flush();
  assert.deepEqual({ ...await click(f, 'Contas no Riot') }, { ok: true });
  assert.deepEqual(f.openedClientPaths, ['C:/configured/RiotClientServices.exe']);
  assert.equal(count(f, 'overlay-open'), 1);
  await click(f, 'Abrir Riot Client');
  assert.equal(count(f, 'official-open'), 2);
  assert.equal(count(f, 'overlay-open'), 1);
  f.setOperation({ status: 'running', needsAttention: false });
  assert.equal((await click(f, 'Contas no Riot')).ok, false);
  assert.equal(count(f, 'official-open'), 2);
  assert.equal(f.dialogs.length, 1);
});

test('a sign-in waiting for the user shows the Riot without covering it with the cards', async () => {
  const f = fixture({ operation: { status: 'running', needsAttention: true, nativeClient: true } });
  await flush();
  assert.equal((await click(f, 'Contas no Riot')).ok, true);
  assert.equal(count(f, 'official-open'), 1);
  assert.equal(f.events.includes('overlay-open'), false);
  assert.equal(f.dialogs.length, 0);
});

test('the tray is named Eclipse and uses the Eclipse icon, falling back to the executable icon', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.trayState.tooltip, 'Eclipse');
  assert.equal(f.trayState.icon.file, 'C:/app/src/renderer/assets/icon.ico');
  const missing = fixture({ trayIcon: null });
  await flush();
  assert.equal(missing.trayState.icon, 'test-icon');
});

test('the tray exposes no old manager entry', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.trayMenu().some((item) => /manager|gerenciador/i.test(item.label || '')), false);
});

test('tray, notices and overlay start in Portuguese and switch to English when the setting is saved', async () => {
  const f = fixture();
  await flush();
  assert.deepEqual(Array.from(f.trayMenu(), (item) => item.label).filter(Boolean), ['Contas no Riot', 'Abrir Riot Client', 'Cancelar login', 'Sair']);
  assert.deepEqual(f.languages, ['pt']);
  assert.equal(f.launchOptions().translate('Game opened'), 'Jogo aberto');
  f.launchOptions().status({ needsAttention: true, text: 'Synthetic' });
  assert.equal(f.balloons.at(-1).title, 'O login precisa de sua atenção');
  f.store.data.settings.language = 'en';
  f.managerOptions().settingsChanged({ language: 'en' });
  assert.deepEqual(Array.from(f.trayMenu(), (item) => item.label).filter(Boolean), ['Accounts in Riot', 'Open Riot Client', 'Cancel sign-in', 'Quit']);
  assert.deepEqual(f.languages, ['pt', 'en']);
  assert.equal(f.launchOptions().translate('Jogo aberto'), 'Game opened');
  f.launchOptions().operationUpdated({ status: 'failed', text: 'Wrong username or password' });
  assert.equal(f.balloons.at(-1).title, 'Could not open the game');
  f.setOperation({ status: 'running', needsAttention: false });
  assert.deepEqual({ ...await click(f, 'Accounts in Riot') }, { ok: false, error: 'The game is opening. Wait or cancel from the tray.' });
  f.store.data.settings.language = 'pt';
  assert.deepEqual({ ...await click(f, 'Accounts in Riot') }, { ok: false, error: 'O jogo está sendo aberto. Aguarde ou cancele pela bandeja.' });
});

test('failure dialogs follow the saved language', async () => {
  const f = fixture({ operation: { status: 'running', needsAttention: false } });
  await flush();
  await click(f, 'Contas no Riot');
  assert.equal(f.dialogs[0].message, 'Não foi possível abrir as contas no Riot.');
  assert.match(f.dialogs[0].detail, /^O jogo está sendo aberto\. Aguarde ou cancele pela bandeja\.\n\nTente de novo pelo ícone da bandeja/);
  assert.deepEqual([...f.dialogs[0].buttons], ['Entendi']);
  f.store.data.settings.language = 'en';
  f.app.emit('second-instance', {}, ['electron', '.']);
  await flush();
  assert.equal(f.dialogs[1].message, 'Could not open the accounts in Riot.');
  assert.match(f.dialogs[1].detail, /^The game is opening\. Wait or cancel from the tray\.\n\nTry again from the tray icon/);
  assert.deepEqual([...f.dialogs[1].buttons], ['OK']);
});

test('the overlay closes Riot through the Riot client service, without dialogs or balloons', async () => {
  const f = fixture();
  await flush();
  let closes = 0;
  f.riotClient.closeClient = async () => { closes++; return 'background'; };
  assert.equal(await f.overlayOptions().closeClient(), 'background');
  assert.equal(closes, 1);
  f.riotClient.closeClient = async () => { throw new Error('The local Riot service could not complete the request'); };
  await assert.rejects(f.overlayOptions().closeClient(), /could not complete the request/);
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.balloons, []);
});

test('the overlay forwards account commands to the manager service', async () => {
  const f = fixture();
  await flush();
  assert.equal(JSON.stringify(await f.overlayOptions().request('init', [])), JSON.stringify({ ok: true, value: { handled: true } }));
  assert.equal(JSON.stringify(f.managerCalls), JSON.stringify([{ method: 'init', args: [] }]));
});

test('a second launch opens the accounts over the existing Riot window', async () => {
  const f = fixture();
  await flush();
  f.app.emit('second-instance', {}, ['electron', '.']);
  await flush();
  assert.equal(count(f, 'official-open'), 1);
  assert.equal(count(f, 'overlay-open'), 1);
});

test('a second launch before startup finishes is ignored', async () => {
  const f = fixture({ waitForReady: true });
  f.app.emit('second-instance', {}, ['electron', '.']);
  f.releaseReady();
  await flush();
  assert.equal(f.events.includes('overlay-start'), true);
  assert.equal(f.events.includes('official-open'), false);
});

test('repeated requests share the same Riot opening instead of racing', async () => {
  let release;
  const openGate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ openGate });
  await flush();
  for (let i = 0; i < 3; i++) f.app.emit('second-instance', {}, ['electron', '.']);
  await flush();
  assert.equal(count(f, 'official-open'), 1);
  release();
  await flush();
  assert.equal(count(f, 'overlay-open'), 1);
  assert.equal(f.dialogs.length, 0);
});

test('without the Riot Client installed, startup stops with an error before showing the cards', async () => {
  const f = fixture({ clientPath: null });
  await flush();
  assert.equal(f.events.includes('fatal-error'), true);
  assert.equal(f.events.includes('overlay-start'), false);
  assert.equal(f.events.at(-1), 'quit');
});

test('sign-in progress is kept as service events and a sign-in needing attention shows a notice', async () => {
  const f = fixture();
  await flush();
  f.launchOptions().operationUpdated({ status: 'running', accountId: 'example', text: 'Signing in' });
  f.launchOptions().status({ needsAttention: true, text: 'Needs verification' });
  assert.equal(f.publicEvents.some((event) => event.channel === 'sign-in-operation'), true);
  assert.equal(f.publicEvents.some((event) => event.channel === 'sign-in-status'), true);
  assert.equal(f.events.includes('balloon'), true);
});

test('quitting cancels the operation and closes only project services', async () => {
  const f = fixture();
  await flush();
  let prevented = false;
  f.app.emit('before-quit', { preventDefault() { prevented = true; } });
  await flush();
  assert.equal(prevented, true);
  for (const event of ['cancel', 'keeper-stop', 'wakeup-stop', 'overlay-stop', 'riot-dispose', 'destroy-tray', 'quit']) assert.equal(f.events.includes(event), true);
  assert.equal(f.events.includes('official-open'), false);
});

test('accounts asked for during a rank update are refreshed right after it, in one extra pass', async () => {
  const gates = [];
  const refreshed = [];
  const failing = new Set();
  const f = fixture({
    accounts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    refreshAccount: async (account) => {
      refreshed.push(account.id);
      await new Promise((open) => gates.push(open));
      if (failing.has(account.id)) throw new Error('synthetic rank failure');
      return { fields: {} };
    },
  });
  await flush();
  const refreshAll = f.managerOptions().refreshAll;
  const release = async () => { for (let i = 0; i < 12; i++) { gates.splice(0).forEach((open) => open()); await flush(); } };

  const first = refreshAll(['a']);
  await flush();
  const second = refreshAll(['b']);
  const third = refreshAll(['c', 'b']);
  assert.equal(second, third);
  await release();
  await Promise.all([first, second]);
  assert.deepEqual(refreshed, ['a', 'b', 'c']);

  refreshed.length = 0;
  const full = refreshAll();
  assert.equal(refreshAll(), full);
  assert.equal(refreshAll(), full);
  await release();
  await full;
  assert.deepEqual(refreshed, ['a', 'b', 'c']);

  refreshed.length = 0;
  const partial = refreshAll(['a']);
  const queuedPart = refreshAll(['b']);
  assert.equal(refreshAll(), queuedPart);
  await release();
  await Promise.all([partial, queuedPart]);
  assert.deepEqual(refreshed, ['a', 'a', 'b', 'c']);

  refreshed.length = 0;
  failing.add('a');
  const broken = refreshAll(['a']);
  const after = refreshAll(['b']);
  await release();
  await assert.rejects(broken, /Could not update ranks/);
  await after;
  assert.deepEqual(refreshed, ['a', 'b']);
});

test('a second controller process exits without starting anything', async () => {
  const f = fixture({ singleInstance: false });
  await flush();
  assert.deepEqual(f.events, ['quit']);
});

function fixture({ trayIcon = 'C:/app/src/renderer/assets/icon.ico', clientPath = 'C:/test/RiotClientServices.exe', waitForReady = false, openGate, operation = null, singleInstance = true, accounts = [], refreshAccount = async () => ({}) } = {}) {
  const events = [], publicEvents = [], dialogs = [], openedClientPaths = [], managerCalls = [], languages = [], balloons = [];
  const app = new EventEmitter();
  let releaseReady, managerOptions, launchOptions, overlayOptions, keeperOptions, wakeupOptions, trayMenu, busy = false;
  const ready = waitForReady ? new Promise((resolve) => { releaseReady = resolve; }) : Promise.resolve();
  const switches = [];
  Object.assign(app, { requestSingleInstanceLock: () => singleInstance, whenReady: () => ready, quit: () => events.push('quit'),
    getVersion: () => 'test', getFileIcon: async () => 'test-icon', switches,
    commandLine: { appendSwitch: (name, value) => switches.push([name, value]) } });
  const trayState = {};
  class FakeTray extends EventEmitter {
    constructor(icon) { super(); events.push('tray'); trayState.icon = icon; }
    setToolTip(text) { trayState.tooltip = text; }
    setContextMenu(menu) { trayMenu = menu; }
    destroy() { events.push('destroy-tray'); }
    displayBalloon(options) { events.push('balloon'); balloons.push(options); }
  }
  const electron = {
    app, shell: {}, Tray: FakeTray, Menu: { buildFromTemplate: (value) => value }, nativeImage: { createFromPath: (file) => ({ file, isEmpty: () => file !== trayIcon }) },
    dialog: { showMessageBox: async (options) => { dialogs.push(options); return {}; }, showErrorBox: () => events.push('fatal-error') },
  };
  const riotClient = {
    detectClientPath: () => clientPath,
    openClient: async (value) => { events.push('official-open'); openedClientPaths.push(value); if (openGate) await openGate; },
    dispose: async () => events.push('riot-dispose'),
    runningGames: async () => ({}), hasPersistedLogin: () => false,
  };
  const store = {
    dir: 'C:/synthetic-data',
    data: { accounts, settings: { refreshMinutes: 0, riotClientPath: 'C:/configured/RiotClientServices.exe' } },
    listAccounts: () => [], publicSettings: () => ({}), log: () => {}, publicAccount: (account) => ({ id: account.id, public: true }),
    getKeys: () => ({}), updateAccountFields: () => null, save: () => {},
  };
  const deps = {
    electron, fs: { existsSync: () => false, appendFileSync: () => {} }, path,
    '../paths': { APP_ICON: 'C:/app/src/renderer/assets/icon.png', APP_TRAY_ICON: 'C:/app/src/renderer/assets/icon.ico' },
    '../integration/overlay/riotOverlay': { createRiotOverlay: (options) => (overlayOptions = options, {
      start: async () => events.push('overlay-start'), open: async () => events.push('overlay-open'),
      setBlocked: (blocked) => events.push(blocked ? 'overlay-blocked' : 'overlay-unblocked'),
      setOperation() {},
      setLanguage: (value) => languages.push(value),
      stop: () => events.push('overlay-stop'),
    }) },
    '../core/store': { Store: function () { return store; } },
    '../core/rankApi': { REGIONS: {}, VAL_REGIONS: [], refreshAccount },
    '../core/language': require('../../src/core/language'),
    '../riot/riotClient': riotClient,
    '../core/signInService': { createSignInService: (options) => {
      launchOptions = options;
      return { getState: () => operation, cancel: () => events.push('cancel'), isBusy: () => busy };
    } },
    '../core/sessionKeeper': { createSessionKeeper: (options) => (keeperOptions = options, {
      start: () => events.push('keeper-start'), check: () => events.push('keeper-check'), stop: () => events.push('keeper-stop'),
      keep: (yaml) => { events.push('keeper-keep'); return yaml === 'owned' ? { id: 'owner' } : null; },
    }) },
    '../core/riotWakeup': { createRiotWakeup: (options) => (wakeupOptions = options, { start: () => events.push('wakeup-start'), stop: () => events.push('wakeup-stop') }) },
    '../core/managerService': {
      createManagerEvents: () => ({ publish: (channel, payload) => publicEvents.push({ channel, payload }) }),
      createManagerService: (options) => {
        managerOptions = options;
        return { dispatch: async (method, args) => { managerCalls.push({ method, args }); return { handled: true }; } };
      },
    },
  };
  vm.runInNewContext(source, { require(name) {
    if (!(name in deps)) throw new Error('Unexpected dependency: ' + name);
    return deps[name];
  }, process: { argv: ['electron', '.'], execPath: 'C:/test/electron.exe' }, setTimeout, clearTimeout, console }, { filename: 'index.js' });
  return { app, events, publicEvents, dialogs, openedClientPaths, managerCalls, riotClient, store, languages, balloons,
    setOperation: (value) => { operation = value; }, releaseReady: () => releaseReady(),
    managerOptions: () => managerOptions, launchOptions: () => launchOptions, overlayOptions: () => overlayOptions,
    keeperOptions: () => keeperOptions, wakeupOptions: () => wakeupOptions, trayMenu: () => trayMenu, trayState,
    setBusy: (value) => { busy = value; } };
}
