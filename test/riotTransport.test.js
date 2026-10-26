const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRiotTransport } = require('../src/riotTransport');

function fixture(options = {}) {
  const calls = [];
  const req = new EventEmitter();
  req.end = (body) => { req.body = body; };
  req.destroy = () => { req.destroyed = true; };
  let respond;
  const transport = createRiotTransport({
    clientPath: () => 'synthetic-client', connection: () => ({ port: 54321, token: 'synthetic-secret' }),
    certificate: (file) => { assert.equal(file, 'synthetic-client'); return 'synthetic-ca'; },
    request: (args, callback) => { calls.push(args); respond = callback; return req; }, ...options,
  });
  function response(status, body) {
    const res = new EventEmitter();
    Object.assign(res, { statusCode: status, resume() {}, destroy() { res.destroyed = true; } });
    respond(res);
    if (body !== undefined) res.emit('data', Buffer.from(body));
    res.emit('end');
    return res;
  }
  return { transport, calls, req, response };
}

test('local Riot transport verifies TLS and transmits JSON only over loopback', async () => {
  const f = fixture();
  const pending = f.transport('POST', '/synthetic-login', { password: 'dummy-password' }, 9000);
  assert.equal(f.calls[0].hostname, '127.0.0.1');
  assert.equal(f.calls[0].rejectUnauthorized, true);
  assert.equal(f.calls[0].ca, 'synthetic-ca');
  assert.equal(f.calls[0].timeout, 9000);
  assert.equal(f.calls[0].auth, 'riot:synthetic-secret');
  assert.deepEqual(JSON.parse(f.req.body), { password: 'dummy-password' });
  f.response(200, '{"type":"success"}');
  assert.deepEqual(await pending, { status: 200, json: { type: 'success' } });
});

test('cancelled requests never start or stop immediately without leaking connection data', async () => {
  const before = fixture(), preCancelled = new AbortController();
  preCancelled.abort();
  await assert.rejects(before.transport('GET', '/state', null, 4000, { signal: preCancelled.signal }), /^Error: Sign-in cancelled$/);
  assert.equal(before.calls.length, 0);
  const active = fixture(), controller = new AbortController();
  const pending = active.transport('GET', '/state', null, 4000, { signal: controller.signal });
  const rejected = assert.rejects(pending, /^Error: Sign-in cancelled$/);
  controller.abort();
  await rejected;
  assert.equal(active.req.destroyed, true);
});

test('network and timeout errors are generic and release the request', async () => {
  for (const event of ['error', 'timeout']) {
    const f = fixture();
    const pending = f.transport('GET', '/state');
    const rejected = assert.rejects(pending, /^Error: The local Riot service could not complete the request$/);
    f.req.emit(event, new Error('untrusted synthetic-secret dummy-password'));
    await rejected;
    if (event === 'timeout') assert.equal(f.req.destroyed, true);
  }
});

test('response limits and interrupted streams fail without returning a partial response', async () => {
  const limited = fixture({ maxBytes: 8 });
  const pending = limited.transport('GET', '/state');
  const rejected = assert.rejects(pending, /could not complete/);
  const res = limited.response(200, '{"tooMuch":"data"}');
  await rejected;
  assert.equal(res.destroyed, true);
});

test('missing backend and invalid request paths fail without exposing a lockfile', async () => {
  const missing = fixture({ connection: () => { throw new Error('synthetic-secret'); } });
  await assert.rejects(missing.transport('GET', '/state'), /^Error: The local Riot service could not complete the request$/);
  assert.equal(missing.calls.length, 0);
  const f = fixture();
  for (const p of ['https://elsewhere.invalid', '/state\r\nInjected: yes']) await assert.rejects(f.transport('GET', p), /Invalid local Riot request/);
  assert.equal(f.calls.length, 0);
});
