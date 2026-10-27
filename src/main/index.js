const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const { RENDERER_DIR, APP_ICON } = require('../paths');
const { Store } = require('../core/store');
const { REGIONS, VAL_REGIONS, refreshAccount } = require('../core/rankApi');
const riotClient = require('../riot/riotClient');
const { createSignInService } = require('../core/signInService');
const { createClientBridge } = require('../integration/bridgeServer');
const { inspectClientIntegration } = require('../integration/status');
const { createPrivateClient, inspectPrivateClient } = require('../integration/privateClient');
const { protectString } = require('../platform/windows/windowsDpapi');

let win;
let store;
let refreshTimer = null;
let refreshing = null;
let launchService;
let clientBridge;
let tray;
let nativeIntegration = { active: false };
let privateClient;
let riotLoginMode = process.argv.includes('--riot-login');
let integrationStarting = null;
let riotLoginOpening = null;
let startupComplete = false;
let quitting = false;

function saveLeavingSession({ signedIn, riotId, yaml }) {
  const prevId = store.data.currentAccountId;
  const prev = prevId && store.getAccount(prevId);
  if (!prev || !riotClient.hasPersistedLogin(yaml)) return;
  if (!riotId || !riotClient.sameRiotId(riotId, prev)) {
    signInLog('previous session identity could not be confirmed; not saving it');
    return;
  }
  store.saveSession(prevId, yaml);
  send('account-updated', store.publicAccount(prev));
  signInLog(`updated the saved session of ${prev.gameName}#${prev.tagLine}${signedIn ? '' : ' (client was closed)'}`);
}

function signInLog(line) {
  try {
    const file = path.join(store.dir, 'sign-in.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow(hidden = false) {
  win = new BrowserWindow({
    show: !hidden,
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#05080d',
    title: 'Riot Account Manager',
    icon: APP_ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#a09b8c', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on('close', (event) => {
    if (!quitting && clientBridge && tray) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  win.removeMenu();
  win.loadFile(path.join(RENDERER_DIR, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function refreshAll(ids) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const keys = store.getKeys();
    const targets = store.data.accounts.filter((a) => !ids || ids.includes(a.id));
    send('refresh-progress', { done: 0, total: targets.length });
    let done = 0;
    for (const acc of targets) {
      const { fields } = await refreshAccount(acc, keys);
      const updated = store.updateAccountFields(acc.id, fields);
      done++;
      send('account-updated', updated);
      send('refresh-progress', { done, total: targets.length });
    }
    if (!ids) {
      store.data.lastRefresh = new Date().toISOString();
      store.save();
    }
    scheduleRefresh();
    return { lastRefresh: store.data.lastRefresh, nextRefresh: nextRefreshAt() };
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function nextRefreshAt() {
  const minutes = Number(store.data.settings.refreshMinutes) || 0;
  if (!minutes) return null;
  const last = store.data.lastRefresh ? Date.parse(store.data.lastRefresh) : 0;
  return new Date(Math.max(Date.now(), last + minutes * 60000)).toISOString();
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const next = nextRefreshAt();
  if (!next) return;
  send('next-refresh', next);
  refreshTimer = setTimeout(() => refreshAll(), Math.max(5000, Date.parse(next) - Date.now()));
}

function registerIpc() {
  ipcMain.handle('init', () => {
    try {
      return {
        accounts: store.listAccounts(),
        settings: store.publicSettings(),
        regions: REGIONS,
        valRegions: VAL_REGIONS,
        lastRefresh: store.data.lastRefresh,
        nextRefresh: nextRefreshAt(),
        version: app.getVersion(),
        operation: launchService.getState(),
        nativeIntegration: { ...nativeIntegration, requested: riotLoginMode },
        clientFound: Boolean(riotClient.detectClientPath(store.data.settings.riotClientPath)),
      };
    } catch (err) {
      store.log(`loading the window failed: ${err.stack}`);
      throw err;
    }
  });

  ipcMain.handle('account:save', async (_e, input) => {
    if (input.id && launchService.activeAccountId() === input.id) throw new Error('Wait for sign-in to finish before editing this account');
    const acc = store.upsertAccount(input);
    refreshAll([acc.id]).catch(() => {});
    return acc;
  });
  ipcMain.handle('account:delete', (_e, id) => {
    if (launchService.activeAccountId() === id) throw new Error('Wait for sign-in to finish before deleting this account');
    return store.deleteAccount(id);
  });
  ipcMain.handle('account:patch', (_e, id, fields) => {
    const allowed = {};
    for (const k of ['note', 'ban', 'lastSeason', 'pinned']) if (k in fields) allowed[k] = fields[k];
    return store.updateAccountFields(id, allowed);
  });
  ipcMain.handle('account:forget-session', (_e, id) => {
    if (launchService.activeAccountId() === id) throw new Error('Wait for sign-in to finish before changing this account');
    store.forgetSession(id);
    return store.publicAccount(store.getAccount(id));
  });

  ipcMain.handle('copy', (_e, id, what) => {
    const acc = store.getAccount(id);
    if (!acc) return false;
    const text = what === 'password' ? store.getPassword(id) : what === 'riotId' ? `${acc.gameName}#${acc.tagLine}` : acc.username;
    clipboard.writeText(text);
    if (what === 'password') {
      setTimeout(() => {
        if (clipboard.readText() === text) clipboard.clear();
      }, 20000);
    }
    return true;
  });

  ipcMain.handle('refresh', (_e, ids) => refreshAll(ids));
  ipcMain.handle('running-games', () => riotClient.runningGames());
  ipcMain.handle('show-riot-client', async () => {
    if (riotLoginMode) return openRiotLogin({ reportFailure: false });
    try {
      if (nativeChallengePending()) await riotClient.openClient(store.data.settings.riotClientPath);
      else if (nativeIntegration.mode === 'private') await privateClient.open(store.data.settings.riotClientPath || riotClient.detectClientPath());
      else await riotClient.showClient();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('cancel-sign-in', () => {
    launchService?.cancel();
    return { ok: true };
  });

  ipcMain.handle('sign-in', (_e, id, game) => launchService.signIn(id, game));

  ipcMain.handle('settings:save', (_e, input) => {
    const s = store.updateSettings(input);
    scheduleRefresh();
    return { ...s, nextRefresh: nextRefreshAt(), clientFound: Boolean(riotClient.detectClientPath(store.data.settings.riotClientPath)) };
  });

  ipcMain.handle('pick-client-path', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Select RiotClientServices.exe',
      filters: [{ name: 'Riot Client', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('open-data-folder', () => shell.openPath(store.dir));
}

function showManager() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function ensureClientIntegration() {
  if (clientBridge && nativeIntegration.active) return nativeIntegration;
  if (integrationStarting) return integrationStarting;
  integrationStarting = (async () => {
    const riotPath = riotClient.detectClientPath(store.data.settings.riotClientPath);
    nativeIntegration = inspectClientIntegration(riotPath);
    if (riotLoginMode && !nativeIntegration.active) {
      const prepared = inspectPrivateClient(riotPath);
      nativeIntegration = { active: prepared.active, mode: prepared.mode, version: prepared.version, reason: prepared.reason };
    }
    if (!nativeIntegration.active) return nativeIntegration;
    let startingBridge;
    try {
      if (!tray) await createTray();
      startingBridge = createClientBridge({
        directory: store.dir,
        encodeToken: protectString,
        listAccounts: () => store.listAccounts(),
        getState: () => launchService.getState(),
        signIn: ({ accountId, game }) => launchService.start(accountId, game),
        cancel: () => launchService.cancel(),
        openManager: () => { showManager(); return { ok: true }; },
        onError: (err) => signInLog(err.message),
      });
      await startingBridge.start();
      clientBridge = startingBridge;
    } catch (err) {
      await startingBridge?.stop().catch(() => {});
      signInLog(`Riot Client integration unavailable: ${err.message}`);
      nativeIntegration = { ...nativeIntegration, active: false, reason: 'Não foi possível iniciar a conexão local do painel de contas. Tente abrir o atalho novamente.' };
      tray?.destroy();
      tray = null;
    }
    return nativeIntegration;
  })();
  try { return await integrationStarting; }
  finally { integrationStarting = null; }
}

function reportIntegrationError(error) {
  const reason = typeof error?.message === 'string' ? error.message : 'Não foi possível carregar a interface integrada.';
  signInLog(reason);
  showManager();
  dialog.showMessageBox(win, {
    type: 'error', title: 'Riot Account Manager',
    message: 'Não foi possível abrir o Riot com Minhas Contas.',
    detail: `${reason}\n\nO gerenciador continua disponível. A interface original do Riot não foi aberta como substituta.`,
    buttons: ['Entendi'], noLink: true,
  }).catch(() => {});
}

function nativeChallengePending() {
  const operation = launchService?.getState();
  return operation?.status === 'running' && operation.needsAttention === true && operation.nativeClient === true;
}

async function openRiotLogin({ reportFailure = true } = {}) {
  riotLoginMode = true;
  if (riotLoginOpening) return riotLoginOpening;
  riotLoginOpening = (async () => {
    try {
      if (nativeChallengePending()) {
        privateClient?.hide();
        await riotClient.openClient(store.data.settings.riotClientPath);
        return { ok: true };
      }
      await ensureClientIntegration();
      if (!nativeIntegration.active) throw new Error(nativeIntegration.reason || 'A integração de contas ainda não está disponível para esta instalação do Riot.');
      if (nativeIntegration.mode === 'private') await privateClient.open(riotClient.detectClientPath(store.data.settings.riotClientPath));
      else await riotClient.openClient(store.data.settings.riotClientPath);
      return { ok: true };
    }
    catch (err) {
      if (reportFailure) reportIntegrationError(err);
      return { ok: false, error: err.message };
    }
  })();
  try { return await riotLoginOpening; }
  finally { riotLoginOpening = null; }
}

async function createTray() {
  let icon;
  try { icon = await app.getFileIcon(process.execPath, { size: 'small' }); }
  catch { icon = nativeImage.createFromPath(APP_ICON); }
  tray = new Tray(icon);
  tray.setToolTip('Riot Account Manager — running in the background');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open account manager', click: showManager },
    { label: 'Open Riot Client', click: openRiotLogin },
    { label: 'Cancel sign-in', click: () => launchService.cancel() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('double-click', showManager);
  tray.on('balloon-click', showManager);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--riot-login')) riotLoginMode = true;
    if (!startupComplete) return;
    if (commandLine.includes('--riot-login')) openRiotLogin();
    else showManager();
  });

  app.whenReady().then(async () => {
    store = new Store();
    privateClient = createPrivateClient({
      encodeToken: protectString,
      ensureBackend: (clientPath) => riotClient.ensureBackgroundClient(clientPath),
    });
    launchService = createSignInService({
      store, riotClient, log: signInLog, onClosed: saveLeavingSession,
      operationUpdated: (operation) => {
        send('sign-in-operation', operation);
        if (operation.status === 'running' && nativeIntegration.mode === 'private') privateClient.hide();
        if (operation.status === 'failed') tray?.displayBalloon({
          title: 'Não foi possível abrir o jogo', content: operation.text.slice(0, 240), noSound: true,
        });
      },
      status: (payload) => {
        send('sign-in-status', payload);
        if (payload.needsAttention) tray?.displayBalloon({ title: 'Riot sign-in needs your attention', content: payload.text, noSound: true });
      },
      accountUpdated: (account) => { if (account) send('account-updated', account); },
      onLaunched: () => {
        if (store.data.settings.minimizeOnLaunch && win && !win.isDestroyed()) win.minimize();
      },
    });
    registerIpc();
    await ensureClientIntegration();
    createWindow(riotLoginMode && nativeIntegration.active);
    win.webContents.once('did-finish-load', () => {
      const next = nextRefreshAt();
      if (next && Date.parse(next) <= Date.now() + 1000 && store.data.accounts.length) refreshAll().catch((err) => store.log(err.message));
      else scheduleRefresh();
    });
    startupComplete = true;
    if (riotLoginMode) await openRiotLogin();
  }).catch((err) => {
    dialog.showErrorBox('Riot Account Manager', err.message);
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    launchService?.cancel();
    Promise.allSettled([privateClient?.stop(), riotClient.dispose(), clientBridge?.stop()]).finally(() => {
      tray?.destroy();
      app.quit();
    });
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
