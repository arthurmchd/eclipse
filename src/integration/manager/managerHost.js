const { pathToFileURL } = require('node:url');
const { MANAGER_RENDERER_FILE, MANAGER_PRELOAD_FILE } = require('../../paths');

const CHANNEL = 'ram-manager:invoke';
const METHODS = new Set(['init', 'saveAccount', 'deleteAccount', 'patchAccount', 'forgetSession', 'copy', 'refresh', 'runningGames', 'signIn', 'showRiotClient', 'cancelSignIn', 'saveSettings', 'pickClientPath', 'openDataFolder', 'events', 'operation', 'openExternal']);

function createManagerHost({ electron = require('electron'), request, rendererFile = MANAGER_RENDERER_FILE, preloadFile = MANAGER_PRELOAD_FILE, topInset = 38, onClose = () => {}, backgroundColor = '#05080d' } = {}) {
  if (typeof request !== 'function') throw new Error('The embedded account view requires a local service');
  const { WebContentsView, ipcMain } = electron;
  const expectedUrl = pathToFileURL(rendererFile).href;
  let view = null, parent = null, loading = null, disposed = false, attached = false;
  let generation = 0;

  function trusted(event) {
    try {
      return !disposed && view && !view.webContents.isDestroyed() && event.sender === view.webContents
        && event.senderFrame === view.webContents.mainFrame && event.senderFrame.url === expectedUrl
        && view.webContents.getURL() === expectedUrl;
    } catch { return false; }
  }

  function layout() {
    if (!view || !parent || parent.isDestroyed()) return;
    const [width, height] = parent.getContentSize();
    const inset = Math.min(Math.max(0, topInset), Math.max(0, height - 1));
    view.setBounds({ x: 0, y: inset, width: Math.max(1, width), height: Math.max(1, height - inset) });
  }

  function close() {
    if (!view) return;
    if (parent && !parent.isDestroyed() && attached) parent.contentView.removeChildView(view);
    view.setVisible(false);
    attached = false;
  }

  function releaseView() {
    generation++;
    const previous = view, previousParent = parent;
    close();
    view = null; parent = null; loading = null;
    previousParent?.removeListener('resize', layout);
    previousParent?.removeListener('closed', releaseView);
    if (previous && !previous.webContents.isDestroyed()) previous.webContents.close({ waitForBeforeUnload: false });
  }

  const handler = async (event, method, args) => {
    if (!trusted(event)) throw new Error('The account controls are only available in their embedded view');
    if (method === 'closeManager' && Array.isArray(args) && args.length === 0) { close(); onClose(); return { ok: true }; }
    if (!METHODS.has(method) || !Array.isArray(args) || args.length > 4) throw new Error('Invalid account command');
    try {
      if (Buffer.byteLength(JSON.stringify(args)) > 32768) throw new Error();
      const response = await request(method, args);
      if (!response || response.ok !== true || !Object.hasOwn(response, 'value')) throw new Error();
      return response.value;
    } catch { throw new Error('Não foi possível concluir a ação no serviço de contas.'); }
  };
  ipcMain.handle(CHANNEL, handler);

  async function open(window) {
    if (disposed || !window || window.isDestroyed()) throw new Error('The Riot window is unavailable');
    if (parent && parent !== window) releaseView();
    if (!view || view.webContents.isDestroyed()) {
      view = new WebContentsView({ webPreferences: {
        preload: preloadFile, contextIsolation: true, sandbox: true, nodeIntegration: false,
        webSecurity: true, partition: 'persist:ram-manager-panel',
      } });
      parent = window;
      const current = view, currentGeneration = ++generation;
      current.setBackgroundColor(backgroundColor);
      current.webContents.setWindowOpenHandler(({ url }) => {
        try {
          if (new URL(url).protocol === 'https:') Promise.resolve(request('openExternal', [url])).catch(() => {});
        } catch {}
        return { action: 'deny' };
      });
      current.webContents.on('will-navigate', (event, url) => { if (url !== expectedUrl) event.preventDefault(); });
      current.webContents.on('will-frame-navigate', (event, details) => { if ((details?.url || event.url) !== expectedUrl) event.preventDefault(); });
      current.webContents.on('will-attach-webview', (event) => event.preventDefault());
      current.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      current.webContents.session.setPermissionCheckHandler(() => false);
      parent.on('resize', layout);
      parent.once('closed', releaseView);
      loading = current.webContents.loadFile(rendererFile).then(() => {
        if (disposed || currentGeneration !== generation || current.webContents.isDestroyed()) throw new Error('The embedded account view was closed');
        return { ready: true, embedded: true };
      });
      loading.catch(() => {});
    }
    if (!attached) { parent.contentView.addChildView(view); attached = true; }
    layout();
    view.setVisible(true);
    const openingView = view;
    try { await loading; }
    catch {
      if (view === openingView) releaseView();
      throw new Error('The embedded account view could not load');
    }
    if (view && !view.webContents.isDestroyed()) view.webContents.focus();
    return { ready: true, embedded: true };
  }

  return {
    open, close,
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(CHANNEL);
      releaseView();
    },
  };
}

module.exports = { createManagerHost, CHANNEL };
