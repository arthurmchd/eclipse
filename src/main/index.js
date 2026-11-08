const fs = require('fs');
const path = require('path');
const { app, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const { APP_ICON, APP_TRAY_ICON } = require('../paths');
const { Store } = require('../core/store');
const { REGIONS, VAL_REGIONS, refreshAccount } = require('../core/rankApi');
const riotClient = require('../riot/riotClient');
const { createSignInService } = require('../core/signInService');
const { createSessionKeeper } = require('../core/sessionKeeper');
const { createRiotWakeup } = require('../core/riotWakeup');
const { createManagerService, createManagerEvents } = require('../core/managerService');
const { createRiotOverlay } = require('../integration/overlay/riotOverlay');
const { createStartWithWindows } = require('../platform/windows/startWithWindows');
const { localize, mainText, normalizeLanguage } = require('../core/language');

const APP_NAME = 'Eclipse';
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('wm-window-animations-disabled');
let store, launchService, managerService, tray, overlay, sessionKeeper, riotWakeup;
let refreshing = null, refreshingAll = false, queuedRefresh = null, refreshTimer = null, riotOpening = null;
let startupComplete = false, quitting = false;
const events = createManagerEvents();
const send = (channel, payload) => events.publish(channel, payload);
const language = () => normalizeLanguage(store?.data?.settings?.language);
const words = () => mainText(language());
const say = (text) => localize(text, language());
const startup = createStartWithWindows({ app, execPath: process.execPath, name: APP_NAME, log: (line) => signInLog(line) });

function signInLog(line) {
  try {
    const file = path.join(store.dir, 'sign-in.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n');
  } catch {}
}
function saveLeavingSession({ riotId, yaml }) {
  const owner = sessionKeeper?.keep(yaml);
  if (owner) {
    signInLog('updated the session of the account that was signed in');
    return;
  }
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
function refreshAll(ids) {
  if (!refreshing) {
    refreshingAll = !ids;
    refreshing = runRefresh(ids).finally(() => { refreshing = null; scheduleRefresh(); });
    return refreshing;
  }
  if (!ids && refreshingAll) return refreshing;
  if (!queuedRefresh) {
    const queued = queuedRefresh = { ids: ids ? new Set(ids) : null };
    queued.done = refreshing.catch(() => {}).then(() => {
      if (queuedRefresh === queued) queuedRefresh = null;
      return refreshAll(queued.ids ? [...queued.ids] : undefined);
    });
  } else if (!ids) queuedRefresh.ids = null;
  else if (queuedRefresh.ids) for (const id of ids) queuedRefresh.ids.add(id);
  return queuedRefresh.done;
}
async function runRefresh(ids) {
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
}
function notifyFailure(error) {
  const reason = typeof error?.message === 'string' ? error.message : 'Could not open the accounts in Riot.';
  signInLog(reason);
  const text = words();
  dialog.showMessageBox({
    type: 'error', title: APP_NAME, message: text.openFailed,
    detail: say(reason) + '\n\n' + text.openFailedDetail,
    buttons: [text.understood], noLink: true,
  }).catch(() => {});
}
async function openRiot({ accounts = false, reportFailure = true } = {}) {
  if (riotOpening) return riotOpening;
  riotOpening = (async () => {
    try {
      const operation = launchService.getState();
      if (operation?.status === 'running' && !operation.needsAttention) throw new Error('The game is opening. Wait or cancel from the tray.');
      await riotClient.openClient(store.data.settings.riotClientPath);
      if (accounts && !operation?.needsAttention) await overlay.open();
      return { ok: true };
    } catch (error) {
      if (reportFailure) notifyFailure(error);
      return { ok: false, error: say(error.message) };
    }
  })();
  try { return await riotOpening; } finally { riotOpening = null; }
}
function buildTrayMenu() {
  if (!tray || tray.isDestroyed?.()) return;
  const text = words();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text.trayAccounts, click: () => openRiot({ accounts: true }) },
    { label: text.trayOpenRiot, click: () => openRiot() },
    { label: text.trayCancel, click: () => launchService.cancel() },
    { type: 'separator' },
    ...(startup.available() ? [
      { label: text.trayStartWithWindows, type: 'checkbox', checked: startup.enabled(), click: () => { startup.set(!startup.enabled()); buildTrayMenu(); } },
      { type: 'separator' },
    ] : []),
    { label: text.trayQuit, click: () => app.quit() },
  ]));
}
function languageChanged() {
  buildTrayMenu();
  overlay?.setLanguage(language());
}
async function createTray() {
  let icon = nativeImage.createFromPath(APP_TRAY_ICON);
  if (icon.isEmpty()) {
    try { icon = await app.getFileIcon(process.execPath, { size: 'small' }); }
    catch { icon = nativeImage.createFromPath(APP_ICON); }
  }
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  buildTrayMenu();
  tray.on('double-click', () => openRiot({ accounts: true }));
  tray.on('balloon-click', () => openRiot({ accounts: true }));
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (startupComplete) openRiot({ accounts: true }); });
  app.whenReady().then(async () => {
    store = new Store();
    launchService = createSignInService({
      store, riotClient, log: signInLog, onClosed: saveLeavingSession,
      operationUpdated: (operation) => {
        send('sign-in-operation', operation);
        overlay?.setBlocked(operation.status === 'running');
        overlay?.setOperation(operation);
        if (operation.status !== 'running') sessionKeeper?.check();
        if (operation.status === 'failed') tray?.displayBalloon({ title: words().gameFailed, content: operation.text.slice(0, 240), noSound: true });
      },
      status: (payload) => {
        send('sign-in-status', payload);
        if (payload.needsAttention) tray?.displayBalloon({ title: words().needsAttention, content: payload.text, noSound: true });
      },
      accountUpdated: (account) => { if (account) send('account-updated', account); },
      translate: say,
    });
    managerService = createManagerService({
      store, launchService, riotClient, shell, events, refreshAll, scheduleRefresh,
      settingsChanged: languageChanged,
      initContext: () => ({
        regions: REGIONS, valRegions: VAL_REGIONS, version: app.getVersion(),
        lastRefresh: store.data.lastRefresh, nextRefresh: nextRefreshAt(),
      }),
    });
    await createTray();
    sessionKeeper = createSessionKeeper({
      riot: riotClient, store, busy: () => launchService.isBusy(), log: signInLog,
      onSaved: (account) => send('account-updated', store.publicAccount(account)),
    });
    sessionKeeper.start();
    riotWakeup = createRiotWakeup({ riot: riotClient, busy: () => launchService.isBusy(), log: signInLog });
    riotWakeup.start();
    overlay = createRiotOverlay({
      readAuthenticationState: signal => riotClient.readLoginScreenState(signal),
      closeClient: () => riotClient.closeClient(),
      request: async (method, args) => ({ ok: true, value: await managerService.dispatch(method, args) }),
      onError: (error) => { signInLog(error.message); tray?.displayBalloon({ title: APP_NAME, content: say(error.message).slice(0, 240), noSound: true }); },
    });
    overlay.setLanguage(language());
    const clientPath = riotClient.detectClientPath(store.data.settings.riotClientPath);
    if (!clientPath) throw new Error('Riot Client not found. Install the official client before starting Eclipse.');
    await overlay.start(clientPath);
    startupComplete = true;
    const next = nextRefreshAt();
    if (next && Date.parse(next) <= Date.now() + 1000 && store.data.accounts.length) refreshAll().catch(() => {});
    else scheduleRefresh();
  }).catch((error) => { dialog.showErrorBox(APP_NAME, say(error.message)); app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    clearTimeout(refreshTimer);
    launchService?.cancel();
    sessionKeeper?.stop();
    riotWakeup?.stop();
    Promise.allSettled([overlay?.stop(), riotClient.dispose()]).finally(() => { tray?.destroy(); app.quit(); });
  });
  app.on('window-all-closed', () => {});
}
