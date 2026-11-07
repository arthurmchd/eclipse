const { OVERLAY_COVER_FILE } = require('../../paths');

function createOverlayCover({ electron = require('electron'), area, file = OVERLAY_COVER_FILE } = {}) {
  const { WebContentsView } = electron;
  let view = null, parent = null, disposed = false, visible = false;
  function layout() {
    if (!view || !parent || parent.isDestroyed()) return;
    const [width, height] = parent.getContentSize();
    view.setBounds(area({ width, height }));
  }
  return {
    async open(window) {
      if (disposed || view || !window || window.isDestroyed()) return;
      parent = window;
      view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, javascript: false, partition: 'ram-overlay-cover' } });
      view.setBackgroundColor('#fcfcfc');
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
    },
    setVisible(value) {
      visible = value === true;
      if (view && !disposed) view.setVisible(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      parent?.removeListener('resize', layout);
      if (view && !view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
      view = null; parent = null;
    },
  };
}

module.exports = { createOverlayCover };
