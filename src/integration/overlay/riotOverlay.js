const { ACCOUNT_CARDS_FILE } = require('../../paths');
const { createManagerHost } = require('../manager/managerHost');
const { createRiotWindowObserver } = require('../../platform/windows/riotWindowObserver');

function overlayBounds(rect) {
  const left = Math.round(rect.width * (400 / 1536));
  return { x: Math.round(rect.x + left), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width - left)), height: Math.max(1, Math.round(rect.height)) };
}
function overlayShape({ width, height }) {
  const right = Math.min(Math.max(96, Math.ceil(width * 104 / 1136)), Math.max(0, width - 1));
  const footer = Math.min(104, height);
  return [
    { x: 0, y: 0, width: width - right, height },
    { x: 0, y: height - footer, width, height: footer },
  ];
}
function nativeHandle(window) {
  const handle = window.getNativeWindowHandle?.();
  if (!Buffer.isBuffer(handle) || handle.length < 4) return null;
  return (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
}
function createRiotOverlay({ electron = require('electron'), request, readAuthenticationState = async () => null, createObserver = createRiotWindowObserver, createHost = createManagerHost, onError = () => {}, setInterval: repeat = setInterval, clearInterval: clear = clearInterval, now = Date.now } = {}) {
  const { BrowserWindow, screen } = electron;
  let window = null, host = null, observer = null, target = null, disposed = false, loaded = false;
  let loginVisible = false, checkedAt = 0, timer = null, pending = null, generation = 0, signedIn = false;
  function resetSession() {
    generation++;
    loginVisible = false;
    pending?.abort();
    pending = null;
  }
  async function checkSession() {
    if (disposed || !target || pending) return;
    const controller = new AbortController(), version = generation;
    pending = controller;
    try {
      const state = await readAuthenticationState(controller.signal);
      if (disposed || version !== generation) return;
      loginVisible = state?.type === 'auth' && !state.error || state?.type === 'error' && state.error === 'auth_failure';
      checkedAt = now();
    } catch {
      if (!disposed && version === generation) loginVisible = false;
    } finally {
      if (pending === controller) pending = null;
      if (!disposed) layout();
    }
  }
  function layout() {
    if (!window || window.isDestroyed()) return;
    if (!loaded || !target || target.minimized || !loginVisible || signedIn || now() - checkedAt > 2500) { window.hide(); return; }
    const rect = screen.screenToDipRect(null, { x: target.x, y: target.y, width: target.width, height: target.height });
    const bounds = overlayBounds(rect), current = window.getBounds();
    if (Object.keys(bounds).some(key => current[key] !== bounds[key])) {
      window.setBounds(bounds, false);
      if (current.width !== bounds.width || current.height !== bounds.height) window.setShape(overlayShape(bounds));
    }
    if (!window.isVisible()) window.showInactive();
  }
  return {
    async start(clientPath) {
      if (disposed || window) return;
      window = new BrowserWindow({ width: 900, height: 650, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: false, backgroundColor: '#00000000', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
      window.setMenu(null);
      window.on('close', event => { if (!disposed) { event.preventDefault(); window.hide(); } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      await window.webContents.loadURL('about:blank');
      if (disposed) return;
      host = createHost({ electron, request, rendererFile: ACCOUNT_CARDS_FILE, topInset: 0, backgroundColor: '#00000000' });
      await host.open(window);
      if (disposed) return;
      loaded = true;
      observer = createObserver({ onState(value) {
        if (disposed) return;
        const changed = target?.id !== value?.id;
        if (changed) resetSession();
        target = value;
        layout();
        if (changed && target) void checkSession();
      }, onError });
      timer = repeat(() => { layout(); void checkSession(); }, 750);
      timer.unref?.();
      observer.start(clientPath, nativeHandle(window));
    },
    async open() { await checkSession(); layout(); },
    setBlocked() {},
    setOperation(operation) {
      signedIn = operation?.status === 'running' && operation.signedIn === true;
      layout();
    },
    stop() { disposed = true; resetSession(); if (timer) clear(timer); observer?.stop(); host?.dispose(); if (window && !window.isDestroyed()) window.destroy(); },
  };
}

module.exports = { createRiotOverlay, overlayBounds, overlayShape };
