const { ACCOUNT_CARDS_FILE } = require('../../paths');
const { createManagerHost } = require('../manager/managerHost');
const { createRiotWindowObserver, PANEL_POINT } = require('../../platform/windows/riotWindowObserver');
const { createOverlayToggle, toggleRect } = require('./overlayToggle');
const { createOverlayCover } = require('./overlayCover');

const PANEL_HOLE = 5;

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
function coverRect({ width, height }) {
  return { x: 0, y: 0, width: Math.max(1, cardsLeft(width)), height: Math.max(1, height) };
}
function panelHole({ width, height }) {
  const x = Math.round(width * PANEL_POINT.x), y = Math.round(height * PANEL_POINT.y);
  return { x: x - PANEL_HOLE, y: y - PANEL_HOLE, width: PANEL_HOLE * 2 + 1, height: PANEL_HOLE * 2 + 1 };
}
function without(rect, hole) {
  const left = Math.max(rect.x, hole.x), top = Math.max(rect.y, hole.y);
  const right = Math.min(rect.x + rect.width, hole.x + hole.width), bottom = Math.min(rect.y + rect.height, hole.y + hole.height);
  if (left >= right || top >= bottom) return [rect];
  return [
    { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
    { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
    { x: right, y: top, width: rect.x + rect.width - right, height: bottom - top },
    { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
  ];
}
function coverShape({ width, height }, corner = 0) {
  const area = cardsLeft(width);
  if (area <= 0) return [];
  const insets = cornerInsets(Math.min(corner, area / 2, height / 2)), rows = insets.length;
  return [
    ...insets.map((inset, row) => ({ x: inset, y: row, width: area - inset, height: 1 })),
    ...without({ x: 0, y: rows, width: area, height: height - rows * 2 }, panelHole({ width, height })),
    ...insets.map((inset, row) => ({ x: inset, y: height - 1 - row, width: area - inset, height: 1 })),
  ].filter(part => part.width > 0 && part.height > 0);
}
function overlayShape({ width, height }, { hidden = false, corner = 0, covered = false, toggle = true } = {}) {
  const box = toggle ? [toggleRect({ width, height })] : [];
  const column = covered ? coverShape({ width, height }, corner) : [];
  if (hidden) return [...box, ...column];
  const left = cardsLeft(width), area = width - left;
  const insets = cornerInsets(Math.min(corner, area / 2, height / 2));
  if (!insets.length) return [...box, ...column, { x: left, y: 0, width: area, height }];
  const rows = insets.length;
  return [
    ...box,
    ...column,
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
function createRiotOverlay({ electron = require('electron'), request, readAuthenticationState = async () => null, createObserver = createRiotWindowObserver, createHost = createManagerHost, createToggle = createOverlayToggle, createCover = createOverlayCover, closeClient = async () => { throw new Error('The Riot Client is unavailable'); }, onError = () => {}, setInterval: repeat = setInterval, clearInterval: clear = clearInterval, now = Date.now } = {}) {
  const { BrowserWindow, screen } = electron;
  let window = null, host = null, toggle = null, cover = null, observer = null, target = null, disposed = false, loaded = false;
  let loginVisible = false, checkedAt = 0, timer = null, pending = null, generation = 0, signedIn = false, hidden = false, covered = false, formHidden = false, language = 'pt', corner = 0;
  const shape = bounds => overlayShape(bounds, { hidden, corner, covered, toggle: !formHidden });
  function reshape() {
    if (!window || window.isDestroyed()) return;
    const parts = shape(window.getBounds());
    if (parts.length) window.setShape(parts); else window.hide();
  }
  function setHidden(value) {
    if (hidden === value) return;
    hidden = value;
    reshape();
  }
  function setCovered(value) {
    if (covered === value) return;
    covered = value;
    if (covered) { cover?.setVisible(true); toggle?.setVisible(false); }
    reshape();
    if (!covered) { cover?.setVisible(false); if (!formHidden) toggle?.setVisible(true); }
  }
  function setFormHidden(value) {
    if (formHidden === value) return;
    formHidden = value;
    if (formHidden && !covered) toggle?.setVisible(false);
    reshape();
    if (!formHidden && !covered) toggle?.setVisible(true);
  }
  async function windowAction(action) {
    if (disposed || !observer) return false;
    if (action === 'minimize') return observer.command('minimize');
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
    if (!loaded || !target || target.minimized || target.dimmed || !loginVisible || signedIn || now() - checkedAt > 2500) { window.hide(); return; }
    const rect = screen.screenToDipRect(null, { x: target.x, y: target.y, width: target.width, height: target.height });
    const bounds = overlayBounds(rect), current = window.getBounds(), radius = cornerRadius(target, rect);
    if (!shape(bounds).length) { window.hide(); return; }
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
      cover = createCover({ electron, area: coverRect });
      await cover.open(window);
      if (disposed) return;
      cover.setVisible(covered);
      toggle = createToggle({ electron, language, onChange: setHidden });
      toggle.setVisible(!covered && !formHidden);
      await toggle.open(window);
      if (disposed) return;
      loaded = true;
      observer = createObserver({ onState(value) {
        if (disposed) return;
        const changed = target?.id !== value?.id;
        if (changed) resetSession();
        target = value;
        setFormHidden(value?.formHidden === true);
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
      const running = operation?.status === 'running';
      signedIn = running && operation.signedIn === true;
      setCovered(running && operation.needsAttention !== true);
      layout();
    },
    stop() { disposed = true; resetSession(); if (timer) clear(timer); observer?.stop(); toggle?.dispose(); cover?.dispose(); host?.dispose(); if (window && !window.isDestroyed()) window.destroy(); },
  };
}

module.exports = { createRiotOverlay, overlayBounds, overlayShape, coverRect, cardsLeft, cornerInsets, cornerRadius };
