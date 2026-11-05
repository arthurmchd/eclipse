const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { ADDON_DIR, INTEGRATION_DATA_DIR } = require('../../src/paths');

const demoData = path.join(INTEGRATION_DATA_DIR, `preview-data-${process.pid}`);
fs.mkdirSync(demoData, { recursive: true });
app.setPath('userData', demoData);
let window;
app.whenReady().then(() => {
  window = new BrowserWindow({
    title: 'Prévia — Contas no login Riot (demonstração)', width: 1280, height: 800,
    backgroundColor: '#121212',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.removeMenu();
  window.once('ready-to-show', () => { window.hide(); window.show(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(path.join(ADDON_DIR, 'preview.html'));
});
app.on('window-all-closed', () => app.quit());
