const CHANNEL = 'ram-manager:invoke';
const EVENT_CHANNELS = new Set(['account-updated', 'refresh-progress', 'next-refresh', 'sign-in-status', 'sign-in-operation']);

function createManagerApi({ ipcRenderer, setInterval: repeat = setInterval, clearInterval: clear = clearInterval, now = Date.now, pollMs = 500, signInTimeoutMs = 600000, onUnload } = {}) {
  const listeners = new Map(), waiting = new Map();
  let cursor = 0, timer = null, polling = false, disposed = false;
  const invoke = (method, args = []) => {
    if (disposed) return Promise.reject(new Error('The account view is closed'));
    return ipcRenderer.invoke(CHANNEL, method, args);
  };
  function publish(channel, payload) {
    if (channel === 'sign-in-operation') complete(payload);
    for (const callback of listeners.get(channel) || []) { try { callback(payload); } catch {} }
  }
  function complete(operation) {
    const id = operation?.id || operation?.operationId;
    const item = waiting.get(id);
    if (!item || operation.status === 'running') return;
    if (!['succeeded', 'failed', 'cancelled'].includes(operation.status)) return;
    waiting.delete(id);
    item.resolve(operation.status === 'succeeded'
      ? { ok: true, gameStarted: true }
      : { ok: false, error: operation.text || operation.error || 'Sign-in did not finish', cancelled: operation.status === 'cancelled' });
  }
  async function poll() {
    if (polling || disposed) return;
    polling = true;
    try {
      const result = await invoke('events', [cursor]);
      if (disposed) return;
      if (result && Array.isArray(result.events) && Number.isSafeInteger(result.cursor) && result.cursor >= cursor) {
        for (const event of result.events) {
          if (Number.isSafeInteger(event?.id) && event.id > cursor && EVENT_CHANNELS.has(event.channel)) publish(event.channel, event.payload);
        }
        cursor = result.cursor;
        if (result.reset) {
          const data = await invoke('init');
          for (const account of data.accounts || []) publish('account-updated', account);
          publish('next-refresh', data.nextRefresh);
          publish('sign-in-operation', data.operation);
        }
      }
      if (waiting.size) complete(await invoke('operation'));
    } catch {}
    finally {
      polling = false;
      for (const [id, item] of waiting) {
        if (now() >= item.deadline) { waiting.delete(id); item.resolve({ ok: false, error: 'Sign-in is taking longer. Open Riot Client to inspect it' }); }
      }
    }
  }
  function start() {
    if (!timer && !disposed) { timer = repeat(poll, pollMs); timer.unref?.(); }
  }
  const on = (channel) => (callback) => {
    if (typeof callback !== 'function') return () => {};
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);
    start();
    return () => listeners.get(channel)?.delete(callback);
  };
  function dispose() {
    disposed = true;
    if (timer) clear(timer);
    timer = null;
    listeners.clear();
    for (const item of waiting.values()) item.resolve({ ok: false, error: 'The account view was closed', cancelled: false });
    waiting.clear();
  }
  onUnload?.(dispose);
  const api = {
    async init() {
      const data = await invoke('init');
      if (Number.isSafeInteger(data?.eventCursor) && data.eventCursor >= 0) cursor = Math.max(cursor, data.eventCursor);
      start();
      return data;
    },
    saveAccount: (input) => invoke('saveAccount', [input]),
    deleteAccount: (id) => invoke('deleteAccount', [id]),
    patchAccount: (id, fields) => invoke('patchAccount', [id, fields]),
    forgetSession: (id) => invoke('forgetSession', [id]),
    copy: (id, what) => invoke('copy', [id, what]),
    refresh: (ids) => invoke('refresh', ids === undefined ? [] : [ids]),
    runningGames: () => invoke('runningGames'),
    async signIn(id, game) {
      const accepted = await invoke('signIn', [id, game]);
      if (accepted?.ok === false) return accepted;
      if (accepted?.ok !== true || typeof accepted.operationId !== 'string' || !accepted.operationId || accepted.operationId.length > 256) return { ok: false, error: 'The account service did not accept the sign-in request' };
      return new Promise((resolve) => {
        waiting.set(accepted.operationId, { resolve, deadline: now() + signInTimeoutMs });
        start();
        poll();
      });
    },
    showRiotClient: () => invoke('showRiotClient'),
    cancelSignIn: () => invoke('cancelSignIn'),
    saveSettings: (input) => invoke('saveSettings', [input]),
    pickClientPath: () => invoke('pickClientPath'),
    openDataFolder: () => invoke('openDataFolder'),
    closeManager: () => invoke('closeManager'),
    onAccountUpdated: on('account-updated'),
    onRefreshProgress: on('refresh-progress'),
    onNextRefresh: on('next-refresh'),
    onSignInStatus: on('sign-in-status'),
    onSignInOperation: on('sign-in-operation'),
  };
  return Object.freeze(api);
}

if (process.versions?.electron) {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('api', createManagerApi({
    ipcRenderer, onUnload: (callback) => window.addEventListener('unload', callback, { once: true }),
  }));
}

if (typeof module === 'object' && module.exports) module.exports = { createManagerApi };
