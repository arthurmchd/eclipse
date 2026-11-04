const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', Object.freeze({
  open: () => ipcRenderer.invoke('ram-overlay:open'),
  cancel: () => ipcRenderer.invoke('ram-overlay:cancel'),
  onState: (callback) => { if (typeof callback === 'function') ipcRenderer.on('ram-overlay:state', (_event, value) => callback(value)); },
}));
