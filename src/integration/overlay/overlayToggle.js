const { pathToFileURL } = require('node:url');
const { OVERLAY_TOGGLE_FILE, OVERLAY_TOGGLE_PRELOAD_FILE } = require('../../paths');
const { normalizeLanguage } = require('../../core/language');

const CHANNEL = 'ram-overlay:hide-accounts';
const LANGUAGE_CHANNEL = 'ram-overlay:language';
const HIDDEN_CHANNEL = 'ram-overlay:hidden';
const TOGGLE_AREA = { left: 200 / 1536, top: 418 / 864, right: 344 / 1536, bottom: 450 / 864 };

function toggleRect({ width, height }) {
  const x = Math.round(width * TOGGLE_AREA.left), y = Math.round(height * TOGGLE_AREA.top);
  return { x, y, width: Math.max(1, Math.round(width * TOGGLE_AREA.right) - x), height: Math.max(1, Math.round(height * TOGGLE_AREA.bottom) - y) };
}

function createOverlayToggle({ electron = require('electron'), onChange = () => {}, language = 'pt', file = OVERLAY_TOGGLE_FILE, preload = OVERLAY_TOGGLE_PRELOAD_FILE } = {}) {
  const { WebContentsView, ipcMain } = electron;
  const expectedUrl = pathToFileURL(file).href;
  let view = null, parent = null, disposed = false, loaded = false, current = normalizeLanguage(language), hidden = false, visible = true;
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
    view.setBounds(toggleRect({ width, height }));
  }
  function sendLanguage() {
    if (!loaded || !view || view.webContents.isDestroyed()) return;
    view.webContents.send(LANGUAGE_CHANNEL, current);
  }
  function sendHidden() {
    if (!loaded || !view || view.webContents.isDestroyed()) return;
    view.webContents.send(HIDDEN_CHANNEL, hidden);
  }
  ipcMain.handle(CHANNEL, (event, value) => {
    if (!trusted(event) || typeof value !== 'boolean') throw new Error('Invalid toggle command');
    hidden = value;
    onChange(value);
    return value;
  });
  return {
    async open(window) {
      if (disposed || view || !window || window.isDestroyed()) return;
      parent = window;
      view = new WebContentsView({ webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, partition: 'ram-overlay-toggle' } });
      view.setBackgroundColor('#00000000');
      view.setVisible(visible);
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.on('will-navigate', event => event.preventDefault());
      view.webContents.on('will-attach-webview', event => event.preventDefault());
      view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      view.webContents.session.setPermissionCheckHandler(() => false);
      parent.contentView.addChildView(view);
      parent.on('resize', layout);
      layout();
      await view.webContents.loadFile(file);
      if (disposed) return;
      loaded = true;
      sendLanguage();
      if (hidden) sendHidden();
    },
    setLanguage(value) {
      current = normalizeLanguage(value);
      sendLanguage();
    },
    setHidden(value) {
      hidden = value === true;
      sendHidden();
    },
    setVisible(value) {
      visible = value === true;
      if (view && !disposed) view.setVisible(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(CHANNEL);
      parent?.removeListener('resize', layout);
      if (view && !view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
      view = null; parent = null;
    },
  };
}

module.exports = { createOverlayToggle, toggleRect, CHANNEL, LANGUAGE_CHANNEL, HIDDEN_CHANNEL };
