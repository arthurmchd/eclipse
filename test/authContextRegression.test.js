const test = require('node:test');
const assert = require('node:assert/strict');
const { createRiotAuthentication } = require('../src/riotAuthentication');

const AUTH = '/rso-authenticator/v1/authentication';
const START = `${AUTH}/riot-identity/start`;
const COMPLETE = `${AUTH}/riot-identity/complete`;

for (const context of [{ suuid: '' }, {}]) {
  test(`headless default auth response ${'suuid' in context ? 'with empty session ID' : 'without a session ID'} must initialize before sending credentials`, async () => {
    const calls = [];
    let initialized = false;
    const account = { username: 'synthetic-user-only', password: 'synthetic-password-only' };
    const api = createRiotAuthentication({ request: async (method, endpoint, body) => {
      calls.push({ method, endpoint, body });
      if (method === 'GET' && endpoint === AUTH) return { status: 200, json: { type: 'auth', captcha: { type: 'none' }, ...context } };
      if (method === 'DELETE' && endpoint === AUTH) return { status: 204, json: null };
      if (method === 'POST' && endpoint === START) {
        assert.equal(JSON.stringify(body).includes(account.password), false);
        assert.equal(JSON.stringify(body).includes(account.username), false);
        initialized = true;
        return { status: 200, json: { type: 'auth', suuid: 'synthetic-initialized-session', captcha: { type: 'none' } } };
      }
      if (method === 'POST' && endpoint === COMPLETE) return initialized
        ? { status: 200, json: { type: 'success' } }
        : { status: 400, json: { error: 'invalid_request' } };
      throw new Error('Unexpected synthetic request');
    } });
    assert.deepEqual(await api.authenticate(account), { supported: true });
    assert.deepEqual(calls.map(({ method, endpoint }) => [method, endpoint]), [['GET', AUTH], ['DELETE', AUTH], ['POST', START], ['POST', COMPLETE]]);
    assert.equal(calls.filter(({ endpoint }) => endpoint === COMPLETE).length, 1);
  });
}

test('an initial invalid_request state is deleted before starting a new context', async () => {
  const calls = [];
  let reset = false;
  const account = { username: 'synthetic-user-only', password: 'synthetic-password-only' };
  const api = createRiotAuthentication({ request: async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    if (method === 'GET') return { status: 200, json: { type: 'error', error: 'invalid_request', suuid: '' } };
    if (method === 'DELETE' && endpoint === AUTH) { reset = true; return { status: 204, json: null }; }
    if (endpoint === START) return reset
      ? { status: 200, json: { type: 'auth', suuid: 'synthetic-new-context', captcha: { type: 'none' } } }
      : { status: 403, json: { error: 'invalid_request', message: 'Invalid auth state' } };
    if (endpoint === COMPLETE) return { status: 200, json: { type: 'success' } };
    throw new Error('Unexpected synthetic request');
  } });
  assert.deepEqual(await api.authenticate(account), { supported: true });
  assert.deepEqual(calls.map(({ method, endpoint }) => [method, endpoint]), [['GET', AUTH], ['DELETE', AUTH], ['POST', START], ['POST', COMPLETE]]);
  assert.equal(JSON.stringify(calls.slice(0, 3)).includes(account.password), false);
});

test('an invalid_request returned after submitting credentials never retries or resets the context', async () => {
  const calls = [];
  const account = { username: 'synthetic-user-only', password: 'synthetic-password-only' };
  const api = createRiotAuthentication({ request: async (method, endpoint) => {
    calls.push([method, endpoint]);
    return method === 'GET'
      ? { status: 200, json: { type: 'auth', suuid: 'synthetic-existing-context', captcha: { type: 'none' } } }
      : { status: 400, json: { error: 'invalid_request', message: account.password } };
  } });
  await assert.rejects(api.authenticate(account), (error) => !error.message.includes(account.password));
  assert.deepEqual(calls, [['GET', AUTH], ['POST', COMPLETE]]);
});
