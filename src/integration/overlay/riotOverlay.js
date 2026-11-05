const { ACCOUNT_CARDS_FILE } = require('../../paths');
const { createManagerHost } = require('../manager/managerHost');
const { createRiotWindowObserver } = require('../../platform/windows/riotWindowObserver');
const { createOverlayToggle, toggleRect } = require('./overlayToggle');

function overlayBounds(rect) {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
}
function cardsLeft(width) {
  return Math.min(Math.round(width * 400 / 1536), Math.max(0, width - 1));
}
function cornerInsets(radius) {
  const insets = [];
  for (let row = 0; row < Math.ceil(radius); row += 1) {
    const inset = Math.round(radius - Math.sqrt(Math.max(0, radius * radius - (radius - row - 0.5) ** 2)));
    if (inset <= 0) break;
    insets.push(inset);
  }
  return insets;
}
function cornerRadius(target, rect) {
  if (!Number.isSafeInteger(target?.corner) || target.corner <= 1 || !(target.width > 0)) return 0;
  return Math.round((target.corner - 1) * rect.width / target.width * 100) / 100;
}
function overlayShape({ width, height }, { hidden = false, corner = 0 } = {}) {
  const toggle = toggleRect({ width, height });
  if (hidden) return [toggle];
  const left = cardsLeft(width), area = width - left;
  const insets = cornerInsets(Math.min(corner, area / 2, height / 2));
  if (!insets.length) return [toggle, { x: left, y: 0, width: area, height }];
  const rows = insets.length;
  return [
    toggle,
    ...insets.map((inset, row) => ({ x: left, y: row, width: area - inset, height: 1 })),
    { x: left, y: rows, width: area, height: height - rows * 2 },
    ...insets.map((inset, row) => ({ x: left, y: height - 1 - row, width: area - inset, height: 1 })),
  ];
}
function nativeHandle(window) {
  const handle = window.getNativeWindowHandle?.();
  if (!Buffer.isBuffer(handle) || handle.length < 4) return null;
  return (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
}
function createRiotOverlay({ electron = require('electron'), request, readAuthenticationState = async () => null, createObserver = createRiotWindowObserver, createHost = createManagerHost, createToggle = createOverlayToggle, closeClient = async () => { throw new Error('The Riot Client is unavailable'); }, onError = () => {}, setInterval: repeat = setInterval, clearInterval: clear = clearInterval, now = Date.now } = {}) {
  const { BrowserWindow, screen } = electron;
  let window = null, host = null, toggle = null, observer = null, target = null, disposed = false, loaded = false;
  let loginVisible = false, checkedAt = 0, timer = null, pending = null, generation = 0, signedIn = false, hidden = false, language = 'pt', corner = 0;
  const shape = bounds => overlayShape(bounds, { hidden, corner });
  function reshape() { if (window && !window.isDestroyed()) window.setShape(shape(window.getBounds())); }
  function setHidden(value) {
    if (hidden === value) return;
    hidden = value;
    reshape();
  }
  async function windowAction(action) {
    if (disposed || !observer) return false;
    if (action === 'minimize') return observer.command('minimize');
    if (action === 'reveal') {
      setHidden(true);
      toggle?.setHidden(true);
      return true;
    }
    if (action !== 'close') return false;
    let mode = null;
    try { mode = await closeClient(); } catch {}
    if (mode !== 'background' && !disposed) observer?.command('close');
    return true;
  }
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
    const bounds = overlayBounds(rect), current = window.getBounds(), radius = cornerRadius(target, rect);
    const resized = current.width !== bounds.width || current.height !== bounds.height;
    if (Object.keys(bounds).some(key => current[key] !== bounds[key])) window.setBounds(bounds, false);
    if (resized || radius !== corner) {
      corner = radius;
      window.setShape(shape(bounds));
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
      host = createHost({ electron, request, rendererFile: ACCOUNT_CARDS_FILE, topInset: 0, leftInset: cardsLeft, backgroundColor: '#f2f2f2', onWindowAction: windowAction });
      await host.open(window);
      if (disposed) return;
      toggle = createToggle({ electron, language, onChange: setHidden });
      await toggle.open(window);
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
    setLanguage(value) {
      language = value === 'en' ? 'en' : 'pt';
      toggle?.setLanguage(language);
    },
    setOperation(operation) {
      signedIn = operation?.status === 'running' && operation.signedIn === true;
      layout();
    },
    stop() { disposed = true; resetSession(); if (timer) clear(timer); observer?.stop(); toggle?.dispose(); host?.dispose(); if (window && !window.isDestroyed()) window.destroy(); },
  };
}

module.exports = { createRiotOverlay, overlayBounds, overlayShape, cardsLeft, cornerInsets, cornerRadius };
