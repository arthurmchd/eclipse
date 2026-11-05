;(() => {
  'use strict';
  const marker = Symbol.for('riot-account-manager.preload.v1');
  if (globalThis[marker]) return;
  globalThis[marker] = true;
  try {
    const { contextBridge, ipcRenderer } = require('electron');
    contextBridge.exposeInMainWorld('riotAccountManager', Object.freeze({
      state: () => ipcRenderer.invoke('ram-client:state'),
      signIn: (accountId, game) => ipcRenderer.invoke('ram-client:sign-in', accountId, game),
      cancel: () => ipcRenderer.invoke('ram-client:cancel'),
      openManager: () => ipcRenderer.invoke('ram-client:open-manager'),
    }));
  } catch {
  }
})();
