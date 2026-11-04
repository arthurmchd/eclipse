const fs = require('fs');
const path = require('path');
const { app, clipboard, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const { APP_ICON } = require('../paths');
const { Store } = require('../core/store');
const { REGIONS, VAL_REGIONS, refreshAccount } = require('../core/rankApi');
const riotClient = require('../riot/riotClient');
const { createSignInService } = require('../core/signInService');
const { createManagerService, createManagerEvents } = require('../core/managerService');
const { createClientBridge } = require('../integration/bridgeServer');
const { createPrivateClient, inspectPrivateClient } = require('../integration/privateClient');
const { protectString } = require('../platform/windows/windowsDpapi');
const { createRiotOverlay } = require('../integration/overlay/riotOverlay');

const overlayMode = !process.argv.includes('--private-client');
let store, launchService, managerService, clientBridge, privateClient, tray, overlay;
let nativeIntegration = { active: false, mode: 'private' };
let refreshing = null, refreshTimer = null, integrationStarting = null, riotOpening = null;
let startupComplete = false, quitting = false;
const events = createManagerEvents();
const send = (channel, payload) => events.publish(channel, payload);

function signInLog(line) {
  try {
    const file = path.join(store.dir, 'sign-in.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n');
  } catch {}
}
function saveLeavingSession({ riotId, yaml }) {
  const previous = store.data.currentAccountId && store.getAccount(store.data.currentAccountId);
  if (!previous || !riotClient.hasPersistedLogin(yaml)) return;
  if (!riotId || !riotClient.sameRiotId(riotId, previous)) {
    signInLog('previous session identity could not be confirmed; not saving it');
    return;
  }
  store.saveSession(previous.id, yaml);
  send('account-updated', store.publicAccount(previous));
  signInLog('updated the previous account session');
}
function nextRefreshAt() {
  const minutes = Number(store.data.settings.refreshMinutes) || 0;
  if (!minutes) return null;
  const last = store.data.lastRefresh ? Date.parse(store.data.lastRefresh) : 0;
  return new Date(Math.max(Date.now(), last + minutes * 60000)).toISOString();
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (quitting) return;
  const next = nextRefreshAt();
  send('next-refresh', next);
  if (next) refreshTimer = setTimeout(() => refreshAll().catch(() => {}), Math.max(5000, Date.parse(next) - Date.now()));
}
async function refreshAll(ids) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const targets = store.data.accounts.filter((account) => !ids || ids.includes(account.id));
    let done = 0;
    send('refresh-progress', { done, total: targets.length });
    try {
      const keys = store.getKeys();
      for (const account of targets) {
        if (quitting) break;
        const { fields } = await refreshAccount(account, keys);
        const updated = store.updateAccountFields(account.id, fields);
        if (updated) send('account-updated', updated);
        send('refresh-progress', { done: ++done, total: targets.length });
      }
      if (!ids && !quitting) {
        store.data.lastRefresh = new Date().toISOString();
        store.save();
      }
      return { lastRefresh: store.data.lastRefresh, nextRefresh: nextRefreshAt() };
    } catch {
      store.log('Rank update could not finish');
      throw new Error('Could not update ranks. Check the API keys in Settings');
    } finally {
      send('refresh-progress', { done: targets.length, total: targets.length });
    }
  })();
  try { return await refreshing; }
  finally { refreshing = null; scheduleRefresh(); }
}
async function nativeChallengePending() {
  const operation = launchService?.getState();
  if (!operation?.needsAttention || !operation.nativeClient) return false;
  if (operation.status === 'running') return true;
  if (operation.status !== 'failed') return false;
  const state = await riotClient.readAuthenticationState().catch(() => null);
  return !['auth', 'authenticated'].includes(state?.type) || Boolean(state?.error);
}
function notifyFailure(error) {
  const reason = typeof error?.message === 'string' ? error.message : 'Não foi possível abrir as contas no Riot.';
  signInLog(reason);
  dialog.showMessageBox({
    type: 'error', title: 'Contas no Riot', message: 'Não foi possível abrir a interface integrada.',
    detail: reason + '\n\nEncerre a instância antiga após atualizar o projeto. Confira a preparação da cópia privada da interface Riot.',
    buttons: ['Entendi'], noLink: true,
  }).catch(() => {});
}
async function ensureClientIntegration() {
  if (clientBridge && nativeIntegration.active) return nativeIntegration;
  if (integrationStarting) return integrationStarting;
  integrationStarting = (async () => {
    const prepared = inspectPrivateClient(riotClient.detectClientPath(store.data.settings.riotClientPath));
    nativeIntegration = { active: prepared.active, mode: 'private', version: prepared.version, reason: prepared.reason };
    if (!nativeIntegration.active) throw new Error(prepared.reason || 'Prepare a cópia privada para abrir as contas dentro do Riot.');
    let bridge;
    try {
      bridge = createClientBridge({
        directory: store.dir, encodeToken: protectString,
        listAccounts: () => store.listAccounts(), getState: () => launchService.getState(),
        signIn: ({ accountId, game }) => launchService.start(accountId, game),
        cancel: () => launchService.cancel(), openManager: () => openRiot({ accounts: true }),
        manage: (method, args) => managerService.dispatch(method, args),
        onError: (error) => signInLog(error.message),
      });
      await bridge.start();
      clientBridge = bridge;
    } catch {
      await bridge?.stop().catch(() => {});
      nativeIntegration = { ...nativeIntegration, active: false, reason: 'A conexão local das contas não pôde ser iniciada.' };
      throw new Error(nativeIntegration.reason);
    }
    return nativeIntegration;
  })();
  try { return await integrationStarting; } finally { integrationStarting = null; }
}
async function openRiot({ accounts = false, reportFailure = true } = {}) {
  if (riotOpening) return riotOpening;
  riotOpening = (async () => {
    try {
      if (overlayMode) {
        const operation = launchService.getState();
        if (operation?.status === 'running' && !operation.needsAttention) throw new Error('O jogo está sendo aberto. Aguarde ou cancele pela bandeja.');
        await riotClient.openClient(store.data.settings.riotClientPath);
        if (accounts && !operation?.needsAttention) await overlay.open();
        return { ok: true };
      }
      if (await nativeChallengePending()) {
        privateClient.hide();
        await riotClient.openClient(store.data.settings.riotClientPath);
        return { ok: true };
      }
      const operation = launchService.getState();
      if (operation?.status === 'running' && !operation.needsAttention) throw new Error('O jogo está sendo aberto em segundo plano. Aguarde ou use Cancelar login na bandeja.');
      await ensureClientIntegration();
      const clientPath = riotClient.detectClientPath(store.data.settings.riotClientPath);
      if (accounts) await privateClient.openManager(clientPath);
      else await privateClient.open(clientPath);
      return { ok: true };
    } catch (error) {
      if (reportFailure) notifyFailure(error);
      return { ok: false, error: error.message };
    }
  })();
  try { return await riotOpening; } finally { riotOpening = null; }
}
async function createTray() {
  let icon;
  try { icon = await app.getFileIcon(process.execPath, { size: 'small' }); }
  catch { icon = nativeImage.createFromPath(APP_ICON); }
  tray = new Tray(icon);
  tray.setToolTip('Riot Client — Contas');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Contas no Riot', click: () => openRiot({ accounts: true }) },
    { label: 'Abrir Riot Client', click: () => openRiot() },
    { label: 'Cancelar login', click: () => launchService.cancel() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]));
  tray.on('double-click', () => openRiot({ accounts: true }));
  tray.on('balloon-click', () => openRiot({ accounts: true }));
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (startupComplete) openRiot({ accounts: true }); });
  app.whenReady().then(async () => {
    store = new Store();
    if (!overlayMode) privateClient = createPrivateClient({ encodeToken: protectString, ensureBackend: (clientPath) => riotClient.ensureBackgroundClient(clientPath) });
    launchService = createSignInService({
      store, riotClient, log: signInLog, onClosed: saveLeavingSession,
      operationUpdated: (operation) => {
        send('sign-in-operation', operation);
        if (operation.status === 'running') privateClient?.hide();
        overlay?.setBlocked(operation.status === 'running');
        overlay?.setOperation(operation);
        if (operation.status === 'failed') tray?.displayBalloon({ title: 'Não foi possível abrir o jogo', content: operation.text.slice(0, 240), noSound: true });
      },
      status: (payload) => {
        send('sign-in-status', payload);
        if (payload.needsAttention) tray?.displayBalloon({ title: 'O login precisa de sua atenção', content: payload.text, noSound: true });
      },
      accountUpdated: (account) => { if (account) send('account-updated', account); },
      releaseAfterLaunch: overlayMode,
      visibleLogin: overlayMode,
    });
    managerService = createManagerService({
      store, launchService, riotClient, clipboard, shell, dialog, events, refreshAll, scheduleRefresh,
      showRiotClient: () => openRiot({ reportFailure: false }),
      initContext: () => ({
        regions: REGIONS, valRegions: VAL_REGIONS, version: app.getVersion(),
        lastRefresh: store.data.lastRefresh, nextRefresh: nextRefreshAt(),
        nativeIntegration: { ...nativeIntegration, requested: true },
        clientFound: Boolean(riotClient.detectClientPath(store.data.settings.riotClientPath)),
      }),
    });
    await createTray();
    if (overlayMode) {
      nativeIntegration = { active: true, mode: 'overlay' };
      overlay = createRiotOverlay({
        readAuthenticationState: signal => riotClient.readLoginScreenState(signal),
        request: async (method, args) => ({ ok: true, value: await managerService.dispatch(method, args) }),
        onError: (error) => { signInLog(error.message); tray?.displayBalloon({ title: 'Contas no Riot', content: error.message.slice(0, 240), noSound: true }); },
      });
      const clientPath = riotClient.detectClientPath(store.data.settings.riotClientPath);
      if (!clientPath) throw new Error('Riot Client não encontrado. Instale o cliente oficial antes de iniciar o gerenciador.');
      await overlay.start(clientPath);
    }
    startupComplete = true;
    if (!overlayMode) await openRiot();
    const next = nextRefreshAt();
    if (next && Date.parse(next) <= Date.now() + 1000 && store.data.accounts.length) refreshAll().catch(() => {});
    else scheduleRefresh();
  }).catch((error) => { dialog.showErrorBox('Contas no Riot', error.message); app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    clearTimeout(refreshTimer);
    launchService?.cancel();
    Promise.allSettled([overlay?.stop(), privateClient?.stop(), riotClient.dispose(), clientBridge?.stop()]).finally(() => { tray?.destroy(); app.quit(); });
  });
  app.on('window-all-closed', () => {});
}
