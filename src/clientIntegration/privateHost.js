const { buildLaunchArguments, validateHostRequest, preparePrivateHostBeforeReady } = require('./privateHostCore');
const { sha256File } = require('./asar');
const { unprotectString } = require('./windowsDpapi');

// Separate Electron entry point. Its OS arguments contain only the script and
// a random local pipe name; connection credentials arrive encrypted over it.
async function runPrivateHost({
  electron = require('electron'), processObject = process,
  input = processObject.stdin, loadMain = (file) => require(file),
  protocolOutput = processObject.stdout,
  validateRequest = validateHostRequest, checkHash = sha256File,
  mainGlobal = globalThis,
  diagnostic = () => {},
  decryptToken = unprotectString,
  requestTimeoutMs = 30000,
} = {}) {
  const { app, BrowserWindow } = electron;
  const originalWrite = protocolOutput.write.bind(protocolOutput);
  // The vendor bundle owns its own logging. Keep its console output off the
  // parent protocol; its file transport is protected by the candidate log hook.
  processObject.stdout.write = () => true;
  processObject.stderr.write = () => true;
  const emit = (event) => originalWrite(`${JSON.stringify(event)}\n`);
  let stopped = false;
  let hidden = false;
  let ready = false;
  let readinessPending = false;
  let reportedError = false;
  let stage = 'validation';
  let config;
  let initial = true;
  let buffered = '';
  let resolveRequest;
  let rejectRequest;
  let timer;
  const request = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
  request.catch(() => {});
  const mark = (value) => { try { diagnostic(value); } catch {} };
  mark('bootstrap');

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mark('stop');
    clearTimeout(timer);
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('error', fail);
    try { app.quit(); } catch {}
  };
  const fail = () => {
    if (!reportedError && !stopped) {
      reportedError = true;
      emit({ event: 'error', stage, error: 'The private Riot interface could not be started or stopped responding' });
    }
    rejectRequest(new Error('Private UI startup failed'));
    stop();
  };
  const hide = () => {
    hidden = true;
    for (const window of BrowserWindow.getAllWindows()) {
      try { if (!window.isDestroyed()) window.hide(); } catch {}
    }
  };
  function isMainRenderer(window) {
    try {
      const url = new URL(window.webContents.getURL());
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/index.html';
    } catch { return false; }
  }
  const show = () => {
    hidden = false;
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed() && isMainRenderer(window)) {
          window.hide(); window.show(); window.focus();
        }
      } catch {}
    }
  };
  function onLine(line) {
    if (initial) {
      initial = false;
      clearTimeout(timer);
      try { resolveRequest(JSON.parse(line)); } catch { fail(); }
      mark('request-received');
      return;
    }
    if (line === 'hide') hide();
    else if (line === 'show') show();
    else if (line === 'stop') stop();
    else fail();
  }
  function onData(chunk) {
    if (stopped) return;
    buffered += chunk.toString('utf8');
    if (Buffer.byteLength(buffered) > (initial ? 65536 : 128)) { fail(); return; }
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0 || stopped) return;
      const line = buffered.slice(0, newline).replace(/\r$/, '');
      buffered = buffered.slice(newline + 1);
      onLine(line);
    }
  }
  function onEnd() { mark('stdin-ended'); stop(); rejectRequest(new Error('Private UI controller disconnected')); }
  function onWindow(_event, window) {
    window.on('show', () => { if (hidden) { try { window.hide(); } catch {} } });
    window.webContents.on('did-finish-load', async () => {
      if (hidden) { try { window.hide(); } catch {} }
      if (ready || readinessPending || stopped) return;
      // Ignore vendor splash screens and about:blank. This means the actual
      // renderer document loaded, not that authentication has been completed.
      if (!isMainRenderer(window)) return;
      readinessPending = true;
      stage = 'renderer';
      let integrationReady = false;
      try {
        integrationReady = await window.webContents.executeJavaScript(`(() => {
          const api = window.riotAccountManager;
          return Boolean(api && ['state', 'signIn', 'cancel', 'openManager'].every((name) => typeof api[name] === 'function') && window[Symbol.for('riot-account-manager.renderer.v1')]);
        })()`);
      } catch { fail(); return; }
      if (stopped) return;
      if (integrationReady !== true) { fail(); return; }
      let managerConnected = false;
      try {
        managerConnected = await window.webContents.executeJavaScript('Promise.resolve(window.riotAccountManager.state()).then((value) => Boolean(value && value.ok === true)).catch(() => false)');
      } catch {}
      ready = true;
      clearTimeout(timer);
      if (!hidden) {
        try { window.hide(); window.show(); } catch { fail(); return; }
      }
      emit({ event: 'ready', integrationReady: true, managerConnected: managerConnected === true });
    });
    window.webContents.on('render-process-gone', () => { stage = 'renderer'; fail(); });
    window.webContents.on('did-fail-load', (_loadEvent, _code, _description, _url, mainFrame) => {
      if (mainFrame !== false) { stage = 'renderer'; fail(); }
    });
  }
  input.setEncoding?.('utf8');
  input.on('data', onData);
  input.once('end', onEnd);
  input.once('error', fail);
  timer = setTimeout(fail, requestTimeoutMs);
  timer.unref?.();
  processObject.on('uncaughtException', fail);
  processObject.on('unhandledRejection', fail);
  app.on('browser-window-created', onWindow);
  app.once('will-quit', () => {
    mark('will-quit');
    stopped = true;
    clearTimeout(timer);
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('error', fail);
    processObject.removeListener('uncaughtException', fail);
    processObject.removeListener('unhandledRejection', fail);
    app.removeListener('browser-window-created', onWindow);
  });

  try {
    // Both vendor operations must happen synchronously before this function's
    // first await; DPAPI decryption and loading the private main happen later.
    preparePrivateHostBeforeReady(electron, { globalObject: mainGlobal });
    const message = await request;
    if (stopped) return { stop, hide, show };
    config = validateRequest(message);
    mark('validated');
    // Configure a separate Chromium profile before loading vendor code or
    // touching its default session. No installed Riot profile is modified.
    app.setPath('userData', config.profilePath);
    app.setPath('sessionData', config.profilePath);
    app.setPath('logs', config.logDir);
    await app.whenReady();
    mark('app-ready');
    if (stopped) return { stop, hide, show };
    stage = 'decryption';
    let remotingAuthToken;
    try { remotingAuthToken = await decryptToken(config.encryptedAuthToken); }
    catch { mark('decrypt-failed'); throw new Error('Private UI decryption is unavailable'); }
    mark('decrypted');
    const syntheticArguments = buildLaunchArguments({ ...config, remotingAuthToken });
    if (checkHash(config.candidatePath) !== config.candidateSha256) throw new Error('Private UI candidate changed');
    if (processObject.env?.RC_TEST_MODE) throw new Error('Private UI cannot disable its backend watchdog');
    stage = 'load-main';
    const originalArguments = processObject.argv;
    processObject.argv = [processObject.execPath, config.candidatePath, ...syntheticArguments];
    remotingAuthToken = '';
    config.encryptedAuthToken = '';
    // The vendor caches cliArgs synchronously while loading. Restore the public
    // wrapper argv afterwards so unrelated crash/diagnostic collectors cannot
    // pick up these transient synthetic arguments later.
    try { loadMain(config.mainPath); mark('main-loaded'); }
    finally { processObject.argv = originalArguments; }
    stage = 'renderer';
    if (!ready && !stopped) { timer = setTimeout(fail, 45000); timer.unref?.(); }
    return { stop, hide, show };
  } catch { fail(); return { stop, hide, show }; }
}

if (require.main === module) runPrivateHost();

module.exports = { runPrivateHost };
