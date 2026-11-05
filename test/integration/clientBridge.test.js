const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const { createClientBridge } = require('../../src/integration/bridgeServer');

test('full management uses authenticated local commands with its own bounded payload', async (t) => {
  const commands = [];
  const f = await fixture(t, { manage: (method, args) => { commands.push([method, args]); return { saved: true }; } });
  const body = JSON.stringify({ method: 'saveAccount', args: [{ note: 'x'.repeat(5000) }] });
  const response = await f.request({ url: '/v1/manage', method: 'POST', body });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { ok: true, value: { saved: true } });
  assert.equal(commands[0][0], 'saveAccount');
  for (const options of [{ authenticated: false }, { headers: { Origin: 'null' } }, { headers: { Host: 'attacker.example' } }]) {
    const denied = await f.request({ url: '/v1/manage', method: 'POST', body, ...options });
    assert.ok([401, 403].includes(denied.status));
  }
  assert.equal(commands.length, 1);
  for (const chunked of [false, true]) {
    assert.equal((await f.request({ url: '/v1/manage', method: 'POST', body: 'x'.repeat(32769), chunked })).status, 413);
  }
});

test('management rejects malformed envelopes and hides unexpected service failures', async (t) => {
  const f = await fixture(t, { manage: () => { throw new Error('fixture-private-password'); } });
  for (const input of [{ method: 'init' }, { method: 'init', args: [], extra: true }, { method: 123, args: [] }, { method: 'init', args: {} }]) {
    assert.equal((await f.request({ url: '/v1/manage', method: 'POST', body: JSON.stringify(input) })).status, 400);
  }
  const response = await f.request({ url: '/v1/manage', method: 'POST', body: JSON.stringify({ method: 'init', args: [] }) });
  assert.equal(response.status, 503);
  assert.equal(response.raw.includes('fixture-private-password'), false);
});

test('management is unavailable without its service and rejects oversized responses', async (t) => {
  const body = JSON.stringify({ method: 'init', args: [] });
  const unavailable = await fixture(t);
  assert.equal((await unavailable.request({ url: '/v1/manage', method: 'POST', body })).status, 503);
  const oversized = await fixture(t, { manage: () => ({ data: 'x'.repeat(1024 * 1024) }) });
  const response = await oversized.request({ url: '/v1/manage', method: 'POST', body });
  assert.equal(response.status, 503);
  assert.ok(response.raw.length < 256);
});

async function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(__dirname, 'client-bridge-test-'));
  let plainToken;
  const calls = [];
  const errors = [];
  const bridge = createClientBridge({
    directory,
    encodeToken: (token) => { plainToken = token; return `encoded:${Buffer.from(token).toString('base64')}`; },
    listAccounts: () => [{ id: 'test-account', gameName: 'Example', tagLine: 'BR1', hasPassword: true, hasSession: true, password: 'secret-password', username: 'secret-username', session: 'secret-session', riotApiKey: 'secret-key' }],
    getState: () => ({ id: 'operation-1', accountId: 'test-account', status: 'running', text: 'Signing in', needsAttention: false, password: 'secret-password', yaml: 'secret-yaml' }),
    signIn: (input) => { calls.push(['sign-in', input]); return { operationId: 'operation-2', password: 'secret-password' }; },
    cancel: () => { calls.push(['cancel']); },
    openManager: () => { calls.push(['open-manager']); },
    onError: (error) => { errors.push(error.message); },
    ...overrides,
  });
  t.after(async () => {
    await bridge.stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(__dirname));
    assert.ok(path.basename(directory).startsWith('client-bridge-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const address = await bridge.start();
  function request({ url = '/v1/state', method = 'GET', headers = {}, body, authenticated = true, chunked = false } = {}) {
    return new Promise((resolve, reject) => {
      const supplied = { Host: `127.0.0.1:${address.port}`, ...headers };
      if (authenticated && !Object.hasOwn(supplied, 'Authorization')) supplied.Authorization = `Bearer ${plainToken}`;
      if (body !== undefined && !Object.hasOwn(supplied, 'Content-Type')) supplied['Content-Type'] = 'application/json';
      if (body !== undefined && !chunked) supplied['Content-Length'] = Buffer.byteLength(body);
      const req = http.request({ hostname: '127.0.0.1', port: address.port, path: url, method, headers: supplied }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data), raw: data }); }
          catch (error) { reject(error); }
        });
      });
      req.once('error', reject);
      if (chunked && body !== undefined) { req.write(body); req.end(); } else req.end(body);
    });
  }
  return { bridge, directory, address, request, calls, errors, token: () => plainToken };
}

test('bridge publishes encoded discovery and only permitted metadata', async (t) => {
  const f = await fixture(t);
  const raw = fs.readFileSync(f.address.discoveryPath, 'utf8');
  const discovery = JSON.parse(raw);
  assert.equal(discovery.version, 1);
  assert.equal(discovery.pid, process.pid);
  assert.equal(discovery.port, f.address.port);
  assert.equal(raw.includes(f.token()), false);
  assert.match(discovery.token, /^encoded:/);
  assert.deepEqual(fs.readdirSync(f.directory), ['riot-client-bridge.json']);
  const state = await f.request();
  assert.equal(state.status, 200);
  assert.equal(state.headers['cache-control'], 'no-store');
  assert.equal(state.headers['access-control-allow-origin'], undefined);
  assert.deepEqual(state.data.accounts, [{ id: 'test-account', gameName: 'Example', tagLine: 'BR1', hasPassword: true, hasSession: true }]);
  assert.equal(state.data.operation.id, 'operation-1');
  assert.equal(state.data.operation.operationId, 'operation-1');
  assert.equal(state.raw.includes('secret-'), false);
});

test('bridge denies missing and incorrect bearer tokens', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request({ authenticated: false })).status, 401);
  assert.equal((await f.request({ headers: { Authorization: `Bearer ${'f'.repeat(64)}` } })).status, 401);
  assert.equal((await f.request({ headers: { Authorization: 'Basic anything' } })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('bridge denies hostile Host headers and all browser Origin headers', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request({ headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await f.request({ headers: { Host: `127.0.0.1:${f.address.port + 1}` } })).status, 403);
  assert.equal((await f.request({ headers: { Origin: 'http://127.0.0.1' } })).status, 403);
  assert.equal((await f.request({ headers: { Origin: 'null' } })).status, 403);
});

test('sign-in accepts an account ID and game, returning only an operation identifier', async (t) => {
  const f = await fixture(t);
  const response = await f.request({ url: '/v1/sign-in', method: 'POST', body: JSON.stringify({ accountId: 'test-account', game: 'lol' }) });
  assert.equal(response.status, 202);
  assert.deepEqual(response.data, { ok: true, operationId: 'operation-2' });
  assert.deepEqual(f.calls, [['sign-in', { accountId: 'test-account', game: 'lol' }]]);
});

test('sign-in rejects traversal, extra fields and unsupported games', async (t) => {
  const f = await fixture(t);
  for (const input of [
    { accountId: '../outside', game: 'lol' },
    { accountId: 'test-account', game: 'lol\nreveal' },
    { accountId: 'test-account', game: 'unknown' },
    { accountId: 'test-account', game: 'lol', password: 'request-secret' },
    { accountId: 'test-account' },
    { accountId: 5, game: 'lol' },
    [],
  ]) {
    const response = await f.request({ url: '/v1/sign-in', method: 'POST', body: JSON.stringify(input) });
    assert.equal(response.status, 400);
    assert.equal(response.raw.includes('request-secret'), false);
  }
  assert.equal(f.calls.length, 0);
});

test('bridge rejects invalid JSON and oversized fixed and chunked bodies', async (t) => {
  const f = await fixture(t);
  const badJson = await f.request({ url: '/v1/sign-in', method: 'POST', body: '{"password":"private-input"' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.raw.includes('private-input'), false);
  for (const chunked of [false, true]) {
    const large = await f.request({ url: '/v1/sign-in', method: 'POST', body: 'a'.repeat(4097), chunked });
    assert.equal(large.status, 413);
  }
  assert.equal(f.calls.length, 0);
});

test('cancel and open-manager use restricted POST commands', async (t) => {
  const f = await fixture(t);
  for (const endpoint of ['/v1/cancel', '/v1/open-manager']) {
    const good = await f.request({ url: endpoint, method: 'POST', body: '{}' });
    assert.deepEqual(good.data, { ok: true });
    const bad = await f.request({ url: endpoint, method: 'POST', body: '{"extra":true}' });
    assert.equal(bad.status, 400);
    assert.equal((await f.request({ url: endpoint })).status, 404);
  }
  assert.deepEqual(f.calls, [['cancel'], ['open-manager']]);
});

test('callback failures never disclose exception details or credentials', async (t) => {
  const f = await fixture(t, { signIn: () => { throw new Error('secret-password and request credentials'); } });
  const result = await f.request({ url: '/v1/sign-in', method: 'POST', body: '{"accountId":"test-account","game":"val"}' });
  assert.equal(result.status, 503);
  assert.equal(result.data.ok, false);
  assert.equal(result.raw.includes('secret-password'), false);
  assert.deepEqual(f.errors, ['Riot Client bridge request failed']);
});

test('start is idempotent and stop removes only its own discovery file', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.bridge.start(), f.address);
  assert.deepEqual(await Promise.all([f.bridge.start(), f.bridge.start()]), [f.address, f.address]);
  await f.bridge.stop();
  assert.equal(fs.existsSync(f.address.discoveryPath), false);
  await f.bridge.stop();
  const restarted = await f.bridge.start();
  const another = { version: 1, pid: 1, port: restarted.port, token: 'another-instance' };
  fs.writeFileSync(restarted.discoveryPath, JSON.stringify(another));
  await f.bridge.stop();
  assert.deepEqual(JSON.parse(fs.readFileSync(restarted.discoveryPath, 'utf8')), another);
});

test('token encoding is required and raw tokens cannot be published', async () => {
  assert.throws(() => createClientBridge({ directory: __dirname }), /encodeToken callback/);
  const bridge = createClientBridge({ directory: __dirname, encodeToken: (value) => value, listAccounts: () => [], getState: () => null, signIn: () => {}, cancel: () => {}, openManager: () => {} });
  await assert.rejects(bridge.start(), /must be encoded/);
  await bridge.stop();
});

test('stop bounds open requests instead of waiting forever for a slow callback', async (t) => {
  const f = await fixture(t, { listAccounts: () => new Promise(() => {}) });
  const pending = f.request().catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const before = Date.now();
  await f.bridge.stop();
  assert.ok(Date.now() - before < 2000);
  const outcome = await pending;
  assert.ok(outcome instanceof Error);
});
