const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { encodeHeader, sha256File } = require('../../../src/integration/asar');
const { hardenPrivateMainSource, buildLaunchArguments, validateHostRequest, PRIVATE_LOG_GUARD_MARKER, PRIVATE_COMPATIBILITY_MARKER, PRIVATE_BOOTSTRAP_SYMBOL, ORIGINAL_PROTOCOL_BOOTSTRAP, ORIGINAL_PROTOCOL_BOOTSTRAP_142, preparePrivateHostBeforeReady } = require('../../../src/integration/host/privateHostCore');
const { runPrivateHost } = require('../../../src/integration/host/privateHost');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const MARKER = 'RAM_LOGIN_INTEGRATION_V1';
const UNSAFE_LOG = 'log$d.info("Starting RiotClientUx electron with args",cliArgs)';
const protocolStub = `${ORIGINAL_PROTOCOL_BOOTSTRAP}(()=>{});}`;
const originalMain = `const log$d={hooks:[],info(){}};const cliArgs={};${UNSAFE_LOG};globalThis.keepThisCode=true;${protocolStub}`;

function writeArchive(file, contents) {
  const header = { files: {} };
  const buffers = [];
  let offset = 0;
  for (const [name, value] of Object.entries(contents)) {
    const parts = name.split('/');
    let current = header;
    while (parts.length > 1) {
      const part = parts.shift();
      current.files[part] ||= { files: {} };
      current = current.files[part];
    }
    const bytes = Buffer.from(value);
    current.files[parts[0]] = { offset: String(offset), size: bytes.length };
    offset += bytes.length;
    buffers.push(bytes);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([encodeHeader(header), ...buffers]));
}

function archiveFixture(t, { version = '141.0.0', main = hardenPrivateMainSource(originalMain), marker = MARKER } = {}) {
  const directory = fs.mkdtempSync(path.join(__dirname, 'private-host-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(__dirname));
    assert.ok(path.basename(directory).startsWith('private-host-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const sourcePath = path.join(directory, 'original', 'app.asar');
  const candidatePath = path.join(directory, 'candidate', 'app.asar');
  const manifestPath = path.join(directory, 'candidate', 'manifest.json');
  const pkg = { name: 'riot-client-ux', version, main: './dist/main/main.js' };
  const original = { 'package.json': JSON.stringify(pkg), 'dist/main/main.js': originalMain, 'dist/main/preload.js': '// original preload', 'dist/renderer/renderer.js': '// original renderer' };
  const candidate = { ...original, 'dist/main/main.js': `${main}\n/*${marker}*/`, 'dist/main/preload.js': `/*${marker}*/`, 'dist/renderer/renderer.js': `/*${marker}*/` };
  writeArchive(sourcePath, original);
  writeArchive(candidatePath, candidate);
  const manifest = {
    schemaVersion: 1,
    mode: 'private-host',
    privacy: { startupArgumentsRedacted: true, logGuardInstalled: true },
    source: { path: sourcePath, size: fs.statSync(sourcePath).size, sha256: sha256File(sourcePath), package: pkg },
    candidate: { path: candidatePath, size: fs.statSync(candidatePath).size, sha256: sha256File(candidatePath) },
    changedFiles: Object.entries(candidate).filter(([name]) => name !== 'package.json').map(([name, value]) => ({ name, size: Buffer.byteLength(value), sha256: hash(value) })),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const request = { candidatePath, manifestPath, appPort: 55555, appPid: 1234, encryptedAuthToken: Buffer.from('fake-dpapi-ciphertext').toString('base64'), userDataRoot: path.join(directory, 'state'), logDir: path.join(directory, 'logs') };
  return { directory, sourcePath, candidatePath, manifestPath, manifest, request, saveManifest: () => fs.writeFileSync(manifestPath, JSON.stringify(manifest)), validate: () => validateHostRequest(request, { workspaceRoot: directory }) };
}

test('private main hardening requires a unique startup log and is idempotent', () => {
  const hardened = hardenPrivateMainSource(originalMain);
  assert.ok(hardened.includes(PRIVATE_LOG_GUARD_MARKER));
  assert.ok(hardened.includes(PRIVATE_COMPATIBILITY_MARKER));
  assert.equal(hardened.includes(UNSAFE_LOG), false);
  assert.equal(hardenPrivateMainSource(hardened), hardened);
  assert.throws(() => hardenPrivateMainSource('const code=1;'), /not supported/);
  assert.throws(() => hardenPrivateMainSource(`${originalMain}${UNSAFE_LOG};`), /not supported/);
  assert.throws(() => hardenPrivateMainSource(originalMain.replace(protocolStub, '')), /runtime initialization layout/);
  assert.throws(() => hardenPrivateMainSource(`${originalMain}${protocolStub}`), /runtime initialization layout/);
});

test('private log guard redacts nested plaintext, Basic and URL credentials without mutating inputs', () => {
  const token = 'dummy:private/token';
  const basic = Buffer.from(`riot:${token}`).toString('base64');
  const events = [];
  const originalData = { headers: { Authorization: `Basic ${basic}` }, token };
  const logger = { hooks: [], info(...data) { let message = { data, level: 'info' }; for (const hook of this.hooks) message = hook(message); events.push(message); } };
  const source = `const log$d=logger;const cliArgs={remotingAuthToken:token};${UNSAFE_LOG};log$d.info(token,data,encodeURIComponent(token));${protocolStub}`;
  vm.runInNewContext(hardenPrivateMainSource(source), { logger, token, data: originalData, Buffer, require });
  const output = JSON.stringify(events);
  for (const secret of [token, basic, encodeURIComponent(token)]) assert.equal(output.includes(secret), false);
  assert.ok(events.every((event) => Array.isArray(event.data) && event.level === 'info'));
  assert.equal(originalData.token, token);
  assert.equal(originalData.headers.Authorization, `Basic ${basic}`);
});

test('private log guard fails before logging if the logger hook contract changes', () => {
  let logged = false;
  const source = `const log$d=logger;const cliArgs={remotingAuthToken:"dummy-token"};${UNSAFE_LOG};${protocolStub}`;
  assert.throws(() => vm.runInNewContext(hardenPrivateMainSource(source), { logger: { hooks: null, info() { logged = true; } }, Buffer, require }), /logging guard unavailable/);
  assert.equal(logged, false);
});

test('launch arguments use the real backend watchdog and contain no weakening switches', () => {
  const args = buildLaunchArguments({ appPort: 55555, remotingAuthToken: 'dummy-token', appPid: 1234, userDataRoot: path.resolve('test/state'), logDir: path.resolve('test/logs') });
  assert.ok(args.includes('--appPid=1234'));
  assert.ok(args.includes('--appPort=55555'));
  assert.ok(args.includes('--enableHardwareAcceleration=true'));
  assert.equal(args.some((arg) => /devtools|ignore-certificate|no-sandbox|test.mode|disable.web.security/i.test(arg)), false);
  for (const input of [{ appPort: 0 }, { appPort: '55555' }, { appPid: -1 }, { remotingAuthToken: 'token\ninjected' }]) {
    assert.throws(() => buildLaunchArguments({ appPort: 55555, remotingAuthToken: 'dummy-token', appPid: 1234, userDataRoot: path.resolve('test/state'), logDir: path.resolve('test/logs'), ...input }), /invalid/);
  }
});

function protocolFixture() {
  let ready = false;
  const calls = [];
  const app = { isReady: () => ready, disableHardwareAcceleration: () => calls.push('disable-gpu') };
  const protocol = { registerSchemesAsPrivileged: (schemes) => calls.push(['register', schemes]) };
  const context = {
    require$$0$f: { app, protocol }, SentryError$1: Error, PROTOCOL_SCHEME: 'sentry-ipc',
    whenAppReady: { then(callback) { calls.push('handlers'); callback(); } },
    logger: { hooks: [], info() {} }, Buffer, require,
  };
  const source = `const log$d=logger;const cliArgs={remotingAuthToken:"dummy-token"};${UNSAFE_LOG};${ORIGINAL_PROTOCOL_BOOTSTRAP}(()=>{globalThis.handlersConfigured=true});}`;
  return { app, protocol, context, calls, source, makeReady: () => { ready = true; } };
}

test('pre-ready setup preserves vendor GPU mode and the exact privileged Sentry scheme', () => {
  const f = protocolFixture();
  const state = preparePrivateHostBeforeReady({ app: f.app, protocol: f.protocol }, { globalObject: f.context });
  assert.deepEqual(f.calls, [
    'disable-gpu', ['register', [{ scheme: 'sentry-ipc', privileges: { bypassCSP: true, corsEnabled: true, supportFetchAPI: true, secure: true } }]],
  ]);
  assert.equal(state.gpuDisabled, true);
  assert.equal(f.context[Symbol.for(PRIVATE_BOOTSTRAP_SYMBOL)], state);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.privileges), true);
  assert.throws(() => preparePrivateHostBeforeReady({ app: f.app, protocol: f.protocol }, { globalObject: f.context }), /already been registered/);
});

test('prepared Sentry initialization after ready reuses registration and still installs handlers', () => {
  const f = protocolFixture();
  preparePrivateHostBeforeReady({ app: f.app, protocol: f.protocol }, { globalObject: f.context });
  f.makeReady();
  vm.runInNewContext(hardenPrivateMainSource(f.source), f.context);
  f.context.configureProtocol({});
  assert.equal(f.context.handlersConfigured, true);
  assert.equal(f.calls.filter((entry) => Array.isArray(entry) && entry[0] === 'register').length, 1);
  assert.equal(f.calls.at(-1), 'handlers');
});

test('unprepared Sentry keeps its original registration-before-ready and rejection-after-ready behavior', () => {
  const before = protocolFixture();
  vm.runInNewContext(hardenPrivateMainSource(before.source), before.context);
  before.context.configureProtocol({});
  assert.equal(before.context.handlersConfigured, true);
  assert.equal(before.calls[0][0], 'register');
  const after = protocolFixture();
  after.makeReady();
  vm.runInNewContext(hardenPrivateMainSource(after.source), after.context);
  assert.throws(() => after.context.configureProtocol({}), /initialized before/);
  assert.equal(after.calls.length, 0);
});

test('ready setup and mismatched protocol metadata fail closed', () => {
  const late = protocolFixture();
  late.makeReady();
  assert.throws(() => preparePrivateHostBeforeReady({ app: late.app, protocol: late.protocol }, { globalObject: late.context }), /before Electron is ready/);
  assert.equal(late.calls.length, 0);
  const altered = protocolFixture();
  preparePrivateHostBeforeReady({ app: altered.app, protocol: altered.protocol }, { globalObject: altered.context });
  altered.context[Symbol.for(PRIVATE_BOOTSTRAP_SYMBOL)] = { ...altered.context[Symbol.for(PRIVATE_BOOTSTRAP_SYMBOL)], privileges: { bypassCSP: true, corsEnabled: true, supportFetchAPI: true, secure: false } };
  altered.makeReady();
  vm.runInNewContext(hardenPrivateMainSource(altered.source), altered.context);
  assert.throws(() => altered.context.configureProtocol({}), /initialized before/);
  assert.equal(altered.context.handlersConfigured, undefined);
});

test('host request verifies hashes, version, addons and isolated workspace paths', (t) => {
  const f = archiveFixture(t);
  const config = f.validate();
  assert.equal(config.candidatePath, fs.realpathSync(f.candidatePath));
  assert.equal(config.sourcePath, fs.realpathSync(f.sourcePath));
  assert.equal(config.profilePath, path.join(fs.realpathSync(f.request.userDataRoot), 'private-electron-profile'));
  assert.ok(fs.statSync(config.profilePath).isDirectory());
  assert.equal(config.candidateSha256, f.manifest.candidate.sha256);
});

test('host request rejects changed source and candidate archives', (t) => {
  for (const changed of ['sourcePath', 'candidatePath']) {
    const f = archiveFixture(t);
    fs.appendFileSync(f[changed], 'changed');
    assert.throws(f.validate, /archive verification failed/);
  }
});

test('host request rejects unsupported versions, missing addons and unsafe logs', (t) => {
  assert.throws(archiveFixture(t, { version: '143.0.0' }).validate, /version is not supported/);
  assert.throws(archiveFixture(t, { marker: 'missing-addon' }).validate, /addon verification failed/);
  assert.throws(archiveFixture(t, { main: originalMain }).validate, /logging guard is missing/);
});

test('host request rejects paths outside workspace, extra fields and raw credentials', (t) => {
  const f = archiveFixture(t);
  const original = { ...f.request };
  for (const changes of [
    { userDataRoot: path.dirname(f.directory) },
    { logDir: path.dirname(f.directory) },
    { candidatePath: f.sourcePath, manifestPath: path.join(path.dirname(f.sourcePath), 'manifest.json') },
    { encryptedAuthToken: 'not-a-dpapi-blob' },
    { remotingAuthToken: 'plaintext-must-not-be-accepted' },
  ]) {
    f.request = { ...original, ...changes };
    assert.throws(() => validateHostRequest(f.request, { workspaceRoot: f.directory }));
  }
});

test('host request requires private mode and the prepared log-privacy guarantees', (t) => {
  const f = archiveFixture(t);
  f.manifest.mode = 'installed-patch'; f.saveManifest();
  assert.throws(f.validate, /privacy guarantees/);
  f.manifest.mode = 'private-host';
  f.manifest.privacy.startupArgumentsRedacted = false; f.saveManifest();
  assert.throws(f.validate, /privacy guarantees/);
});

function hostFixture(t, { ready = Promise.resolve(), unavailableEncryption = false, loadFailure = false, invalidHash = false, validateFailure = false } = {}) {
  const input = new PassThrough();
  const output = [];
  const errors = [];
  const paths = [];
  const startup = [];
  const windows = [];
  const processObject = new EventEmitter();
  Object.assign(processObject, { stdin: input, stdout: { write: (text) => { output.push(text); return true; } }, stderr: { write: (text) => { errors.push(text); return true; } }, env: {}, execPath: path.resolve('test/fake-electron.exe'), argv: ['fake-electron', 'privateHost.js'] });
  const originalArgv = processObject.argv;
  const app = new EventEmitter();
  let quits = 0;
  let decrypted = 0;
  let loaded = 0;
  let loadedArguments;
  let appReady = false;
  app.quit = () => { quits++; app.emit('will-quit'); };
  app.setPath = (...values) => paths.push(values);
  app.isReady = () => appReady;
  app.disableHardwareAcceleration = () => { startup.push('disable-gpu'); };
  app.whenReady = () => { startup.push('when-ready'); return ready.then(() => { appReady = true; }); };
  const config = { candidatePath: path.resolve('test/private/app.asar'), mainPath: path.resolve('test/private/app.asar/dist/main/main.js'), candidateSha256: 'expected-hash', profilePath: path.resolve('test/private/profile'), userDataRoot: path.resolve('test/private/state'), logDir: path.resolve('test/private/logs'), appPort: 55555, appPid: 1234, encryptedAuthToken: Buffer.from('fake-ciphertext').toString('base64') };
  const electron = { app, protocol: { registerSchemesAsPrivileged: (schemes) => startup.push(['register-protocol', schemes]) }, BrowserWindow: { getAllWindows: () => windows }, safeStorage: { isEncryptionAvailable: () => !unavailableEncryption, decryptString: () => { decrypted++; return 'dummy-decrypted-token'; } } };
  const launch = runPrivateHost({
    electron, processObject, input, mainGlobal: {},
    decryptToken: async () => {
      if (unavailableEncryption) throw new Error('synthetic DPAPI unavailable');
      return electron.safeStorage.decryptString();
    },
    validateRequest: () => { if (validateFailure) throw new Error('private-input-must-not-be-logged'); return { ...config }; },
    checkHash: () => invalidHash ? 'changed-hash' : 'expected-hash',
    loadMain: () => {
      loaded++;
      loadedArguments = [...processObject.argv];
      processObject.stdout.write('dummy-decrypted-token');
      processObject.stderr.write('dummy-decrypted-token');
      if (loadFailure) throw new Error('dummy-decrypted-token');
    },
  });
  const addWindow = (url, integrationReady = true) => {
    const window = new EventEmitter();
    window.webContents = new EventEmitter();
    window.webContents.getURL = () => url;
    window.webContents.executeJavaScript = async (code) => {
      assert.equal(/\.signIn\(|\.cancel\(|\.openManager\(/.test(code), false);
      return integrationReady;
    };
    window.isDestroyed = () => false;
    window.hides = 0; window.shows = 0; window.focuses = 0;
    window.hide = () => { window.hides++; };
    window.show = () => { window.shows++; window.emit('show'); };
    window.focus = () => { window.focuses++; };
    windows.push(window);
    app.emit('browser-window-created', {}, window);
    return window;
  };
  t.after(async () => { const control = await launch; control.stop(); input.destroy(); });
  return { input, output, errors, paths, startup, windows, app, processObject, originalArgv, config, launch, addWindow, loaded: () => loaded, args: () => loadedArguments, decrypted: () => decrypted, quits: () => quits, send: () => input.write(`${JSON.stringify({ encryptedAuthToken: config.encryptedAuthToken })}\n`), events: () => output.map((line) => JSON.parse(line)) };
}

test('host decrypts only after ready, loads with memory-only args and restores public argv', async (t) => {
  let makeReady;
  const f = hostFixture(t, { ready: new Promise((resolve) => { makeReady = resolve; }) });
  assert.equal(f.startup[0], 'disable-gpu');
  assert.equal(f.startup[1][0], 'register-protocol');
  assert.equal(f.startup.includes('when-ready'), false);
  f.send();
  await flush();
  assert.equal(f.decrypted(), 0);
  assert.equal(f.loaded(), 0);
  assert.ok(f.paths.some(([name, value]) => name === 'userData' && value === f.config.profilePath));
  makeReady();
  await f.launch;
  assert.equal(f.decrypted(), 1);
  assert.equal(f.loaded(), 1);
  assert.ok(f.args().includes('--remotingAuthToken=dummy-decrypted-token'));
  assert.equal(f.processObject.argv, f.originalArgv);
  assert.deepEqual(f.output, []);
  assert.deepEqual(f.errors, []);
});

test('host emits ready only for the main renderer and can keep it hidden', async (t) => {
  const f = hostFixture(t);
  f.send();
  await f.launch;
  const splash = f.addWindow('file:///fake-splash.html');
  splash.webContents.emit('did-finish-load');
  assert.deepEqual(f.events(), []);
  f.input.write('hide\n');
  const main = f.addWindow('http://127.0.0.1:55556/index.html');
  main.webContents.emit('did-finish-load');
  main.webContents.emit('did-finish-load');
  await flush();
  assert.deepEqual(f.events(), [{ event: 'ready', integrationReady: true, managerConnected: true }]);
  assert.equal(main.shows, 0);
  assert.ok(main.hides > 0);
  main.emit('show');
  assert.ok(main.hides > 1);
  f.input.write('show\n');
  assert.equal(main.shows, 1);
  assert.equal(main.focuses, 1);
  f.input.write('stop\n');
  assert.equal(f.quits(), 1);
});

test('host shows its main renderer after the hidden-startup first-show workaround', async (t) => {
  const f = hostFixture(t);
  f.send(); await f.launch;
  const main = f.addWindow('http://127.0.0.1:55556/index.html');
  main.webContents.emit('did-finish-load');
  await flush();
  assert.equal(main.hides, 1);
  assert.equal(main.shows, 1);
  assert.deepEqual(f.events(), [{ event: 'ready', integrationReady: true, managerConnected: true }]);
});

for (const [label, options, expectedStage] of [
  ['validation', { validateFailure: true }, 'validation'],
  ['decryption', { unavailableEncryption: true }, 'decryption'],
  ['archive changed', { invalidHash: true }, 'decryption'],
  ['module loading', { loadFailure: true }, 'load-main'],
]) {
  test(`host failure during ${label} emits a generic stage without secrets`, async (t) => {
    const f = hostFixture(t, options);
    f.send(); await f.launch;
    const events = f.events();
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'error');
    assert.equal(events[0].stage, expectedStage);
    assert.equal(JSON.stringify(events).includes('dummy-decrypted-token'), false);
    assert.equal(JSON.stringify(events).includes('private-input'), false);
    assert.equal(f.processObject.argv, f.originalArgv);
    assert.equal(f.quits(), 1);
  });
}

test('host stops when its controlling stdin closes and reports renderer crashes generically', async (t) => {
  const f = hostFixture(t);
  f.send(); await f.launch;
  const main = f.addWindow('http://127.0.0.1:55556/index.html');
  main.webContents.emit('render-process-gone', {}, { reason: 'dummy-decrypted-token' });
  assert.equal(f.events()[0].stage, 'renderer');
  assert.equal(JSON.stringify(f.events()).includes('dummy-decrypted-token'), false);
  assert.equal(f.quits(), 1);
  const other = hostFixture(t);
  other.send(); await other.launch;
  other.input.end();
  await flush();
  assert.equal(other.quits(), 1);
});

test('host refuses test-mode watchdog suppression', async (t) => {
  const f = hostFixture(t);
  f.processObject.env.RC_TEST_MODE = 'true';
  f.send(); await f.launch;
  assert.equal(f.loaded(), 0);
  assert.equal(f.events()[0].event, 'error');
  assert.equal(f.processObject.argv, f.originalArgv);
});

test('host refuses a renderer whose account addon did not load', async (t) => {
  const f = hostFixture(t);
  f.send(); await f.launch;
  const main = f.addWindow('http://127.0.0.1:55556/index.html', false);
  main.webContents.emit('did-finish-load');
  await flush();
  assert.equal(f.events()[0].event, 'error');
  assert.equal(f.events()[0].stage, 'renderer');
  assert.equal(main.shows, 0);
  assert.equal(f.quits(), 1);
});
