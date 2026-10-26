const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  saveAccount: (input) => ipcRenderer.invoke('account:save', input),
  deleteAccount: (id) => ipcRenderer.invoke('account:delete', id),
  patchAccount: (id, fields) => ipcRenderer.invoke('account:patch', id, fields),
  forgetSession: (id) => ipcRenderer.invoke('account:forget-session', id),
  copy: (id, what) => ipcRenderer.invoke('copy', id, what),
  refresh: (ids) => ipcRenderer.invoke('refresh', ids),
  runningGames: () => ipcRenderer.invoke('running-games'),
  signIn: (id, game) => ipcRenderer.invoke('sign-in', id, game),
  showRiotClient: () => ipcRenderer.invoke('show-riot-client'),
  cancelSignIn: () => ipcRenderer.invoke('cancel-sign-in'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  pickClientPath: () => ipcRenderer.invoke('pick-client-path'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  onAccountUpdated: on('account-updated'),
  onRefreshProgress: on('refresh-progress'),
  onNextRefresh: on('next-refresh'),
  onSignInStatus: on('sign-in-status'),
  onSignInOperation: on('sign-in-operation'),
});
