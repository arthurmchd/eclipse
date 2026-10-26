const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const directory = path.join(__dirname, '..', 'src', 'clientIntegration');
const source = (file) => fs.readFileSync(path.join(directory, file), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function mainFixture({ config = {}, token = 'a'.repeat(64), response = {}, statusCode = 200, rawResponse, encrypted = true } = {}) {
  const handlers = new Map(), calls = [];
  const frame = { url: 'http://127.0.0.1:31245/' };
  const sender = { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url };
  const window = { isDestroyed: () => false, getTitle: () => 'Riot Client' };
  const event = { sender, senderFrame: frame };
  const electron = {
    app: { whenReady: () => Promise.resolve(), getPath: () => 'C:/Example/AppData/Roaming' },
    BrowserWindow: { fromWebContents: () => window },
    ipcMain: { handle: (name, callback) => { assert.equal(handlers.has(name), false); handlers.set(name, callback); } },
    safeStorage: { isEncryptionAvailable: () => encrypted, decryptString: () => token },
  };
  const mockFs = {
    statSync: () => ({ size: 150 }),
    readFileSync: () => JSON.stringify({ version: 1, pid: 128, port: 40122, token: Buffer.from('encrypted-token').toString('base64'), ...config }),
  };
  const http = {
    request(options, listener) {
      const request = new EventEmitter();
      request.end = (body) => {
        calls.push({ options, body });
        queueMicrotask(() => {
          const responseStream = new EventEmitter();
          responseStream.statusCode = statusCode;
          responseStream.destroy = () => {};
          listener(responseStream);
          responseStream.emit('data', Buffer.from(rawResponse === undefined ? JSON.stringify(response) : rawResponse));
          responseStream.emit('end');
        });
      };
      request.destroy = () => { request.emit('error', new Error('offline')); };
      return request;
    },
  };
  const context = vm.createContext({
    require(name) { return { electron, fs: mockFs, path, http, child_process: {
      execFile(_exe, args, options, callback) {
        assert.equal(args.includes(token), false);
        assert.equal(options.windowsHide, true);
        const stdin = new EventEmitter();
        stdin.end = (body) => {
          assert.equal(JSON.parse(body).action, 'unprotect');
          queueMicrotask(() => callback(encrypted ? null : new Error('synthetic unavailable'), JSON.stringify({ ok: true, value: token })));
        };
        return { stdin };
      },
    } }[name]; },
    process: { env: { APPDATA: 'C:/Example/AppData/Roaming' } }, Buffer, URL,
  });
  const code = source('addon-main.js');
  vm.runInContext(code, context);
  await flush();
  return { handlers, calls, event, frame, sender, window, context, code };
}

test('Riot addon sends the DPAPI token only from main and strips sensitive state fields', async () => {
  const f = await mainFixture({ response: {
    ok: true,
    accounts: [{ id: 'saved-id', gameName: 'Example', tagLine: 'BR1', hasPassword: true, hasSession: true, username: 'private', password: 'secret', session: 'token' }],
    operation: { id: 'op-one', accountId: 'saved-id', game: 'lol', status: 'running', text: 'Signing in', password: 'secret', token: 'private-token' },
    token: 'private-token',
  } });
  const result = await f.handlers.get('ram-client:state')(f.event);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.accounts[0]).sort(), ['gameName', 'hasPassword', 'hasSession', 'id', 'tagLine'].sort());
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(f.calls[0].options.hostname, '127.0.0.1');
  assert.equal(f.calls[0].options.port, 40122);
  assert.equal(f.calls[0].options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
  assert.equal(f.calls[0].options.headers.Origin, undefined);
  assert.equal(f.calls[0].options.timeout, 4000);
});

test('Riot addon refuses remote pages, child frames and a different window title', async () => {
  const f = await mainFixture();
  const state = f.handlers.get('ram-client:state');
  f.frame.url = 'https://example.com/';
  assert.equal((await state(f.event)).ok, false);
  f.frame.url = 'http://127.0.0.1:31245/';
  assert.equal((await state({ ...f.event, senderFrame: { url: f.frame.url } })).ok, false);
  f.window.getTitle = () => 'Other app';
  assert.equal((await state(f.event)).ok, false);
  assert.equal(f.calls.length, 0);
});

for (const config of [{ version: 2 }, { port: 0 }, { port: 70000 }, { port: '40122' }, { pid: -1 }, { token: 'invalid$' }]) {
  test(`Riot addon rejects malformed discovery ${JSON.stringify(config)}`, async () => {
    const f = await mainFixture({ config });
    const result = await f.handlers.get('ram-client:state')(f.event);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Open Riot Account Manager to connect');
    assert.equal(f.calls.length, 0);
  });
}

test('Riot addon refuses an unavailable DPAPI secret or a token with header injection', async () => {
  for (const options of [{ encrypted: false }, { token: `${'a'.repeat(64)}\r\nHeader: value` }]) {
    const f = await mainFixture(options);
    assert.equal((await f.handlers.get('ram-client:state')(f.event)).ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test('Riot addon validates sign-in input and exposes only the accepted operation ID', async () => {
  const f = await mainFixture({ response: { ok: true, operationId: 'op-two', password: 'secret' } });
  const signIn = f.handlers.get('ram-client:sign-in');
  assert.equal((await signIn(f.event, '../invalid', 'lol')).ok, false);
  assert.equal((await signIn(f.event, 'saved-id', 'invalid')).ok, false);
  assert.equal(f.calls.length, 0);
  const result = await signIn(f.event, 'saved-id', 'val');
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'operationId']);
  assert.deepEqual(JSON.parse(f.calls[0].body), { accountId: 'saved-id', game: 'val' });
});

test('Riot addon handles invalid and oversized service responses', async () => {
  for (const rawResponse of ['not-json', JSON.stringify({ oversized: 'x'.repeat(513 * 1024) })]) {
    const f = await mainFixture({ rawResponse });
    assert.equal((await f.handlers.get('ram-client:state')(f.event)).ok, false);
  }
});

test('appending the Riot main addon twice does not register duplicate IPC handlers', async () => {
  const f = await mainFixture();
  vm.runInContext(f.code, f.context);
  await flush();
  assert.equal(f.handlers.size, 4);
});

test('Riot preload exposes a fixed four-method API without a generic IPC method', async () => {
  let name, api;
  const calls = [];
  const context = vm.createContext({ require: () => ({
    contextBridge: { exposeInMainWorld: (key, value) => { name = key; api = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } },
  }) });
  vm.runInContext(source('addon-preload.js'), context);
  assert.equal(name, 'riotAccountManager');
  assert.deepEqual(Object.keys(api).sort(), ['cancel', 'openManager', 'signIn', 'state']);
  assert.equal(Object.isFrozen(api), true);
  await api.signIn('saved-id', 'tft');
  assert.deepEqual(calls[0], ['ram-client:sign-in', 'saved-id', 'tft']);
  vm.runInContext(source('addon-preload.js'), context);
  assert.equal(calls.length, 1);
});

function rendererFixture() {
  const events = new Map(), timeouts = new Map(), intervals = new Map();
  let nextTimer = 1, observer;
  const created = [];
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.hidden = false; this.style = {}; this.dataset = {}; this.attributes = {};
      this.listeners = {}; this.parentElement = null; this._text = '';
      this.classList = { toggle() {} };
      created.push(this);
    }
    append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((item) => item.textContent).join(''); }
    set innerHTML(_value) { throw new Error('Untrusted HTML must not be interpolated'); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    attachShadow() { return this.shadow = new Element('shadow'); }
    querySelectorAll() { return created.filter((item) => item.tagName === 'button' && item.dataset.accountId); }
    getBoundingClientRect() { return { width: 200, height: 40 }; }
  }
  const body = new Element('body'), password = new Element('input');
  password.parentElement = body;
  Object.defineProperty(password, 'value', { get() { throw new Error('A login password must never be read'); } });
  const document = {
    readyState: 'complete', body, documentElement: body,
    createElement: (tag) => new Element(tag),
    querySelectorAll: () => [password],
  };
  const state = { ok: true, accounts: [{ id: 'example', gameName: '<img src=x onerror=steal()>', tagLine: 'BR1', hasPassword: true, hasSession: true }], operation: null };
  const window = {
    innerWidth: 1300,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
    getComputedStyle: (item) => ({ display: item.hidden ? 'none' : 'block', visibility: 'visible', opacity: item.opacity ?? '1' }),
    setTimeout: (callback) => { const id = nextTimer++; timeouts.set(id, callback); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (callback) => { const id = nextTimer++; intervals.set(id, callback); return id; },
    clearInterval: (id) => intervals.delete(id),
    riotAccountManager: { state: async () => state },
  };
  const context = vm.createContext({ window, document, MutationObserver: class {
    constructor(callback) { observer = callback; }
    observe() {}
    disconnect() { observer = null; }
  } });
  vm.runInContext(source('addon-renderer.js'), context);
  function scan() {
    observer?.();
    for (const [id, callback] of [...timeouts]) { timeouts.delete(id); callback(); }
  }
  return { window, document, created, state, body, events, intervals, scan, context };
}

test('login panel renders untrusted account names as text without accessing a password', async () => {
  const f = rendererFixture();
  await flush();
  const host = f.created.find((item) => item.id === 'ram-login-account-panel-v1');
  assert.ok(host);
  assert.equal(host.hidden, false);
  assert.equal(f.created.some((item) => item.tagName === 'img'), false);
  assert.ok(host.shadow.textContent.includes('<img src=x onerror=steal()>#BR1'));
  assert.equal(f.intervals.size, 1);
});

test('login panel hides and stops polling when its login form is hidden or transparent', async () => {
  const f = rendererFixture();
  await flush();
  const host = f.created.find((item) => item.id === 'ram-login-account-panel-v1');
  f.body.opacity = '0';
  f.scan();
  assert.equal(host.hidden, true);
  assert.equal(f.intervals.size, 0);
  f.body.opacity = '1';
  f.scan();
  await flush();
  assert.equal(host.hidden, false);
  assert.equal(f.intervals.size, 1);
  f.events.get('beforeunload')();
  assert.equal(f.intervals.size, 0);
});
