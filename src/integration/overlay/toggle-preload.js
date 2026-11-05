const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('toggle', Object.freeze({
  setHidden: (hidden) => ipcRenderer.invoke('ram-overlay:hide-accounts', hidden === true),
  onLanguage: (callback) => { ipcRenderer.on('ram-overlay:language', (_event, language) => callback(language === 'en' ? 'en' : 'pt')); },
  onHidden: (callback) => { ipcRenderer.on('ram-overlay:hidden', (_event, hidden) => callback(hidden === true)); },
}));
