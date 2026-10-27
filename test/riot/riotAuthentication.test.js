const test = require('node:test');
const assert = require('node:assert/strict');
const { createRiotAuthentication } = require('../../src/riot/riotAuthentication');

const AUTH = '/rso-authenticator/v1/authentication';
const START = `${AUTH}/riot-identity/start`;
const COMPLETE = `${AUTH}/riot-identity/complete`;
const PLAYER_SESSION = '/player-session-lifecycle/v1/session';
const account = { username: 'synthetic-private-login', password: 'synthetic-private-password' };
const auth = { type: 'auth', suuid: 'synthetic-active-auth-context', captcha: { type: 'none' } };
const response = (json, status = 200) => ({ status, json });

function fixture(replies) {
  const calls = [];
  const service = createRiotAuthentication({ request: async (...args) => {
    calls.push(args);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(...args);
    assert.notEqual(next, undefined, 'No further local requests were expected');
    return next;
  } });
  return { ...service, calls, replies };
}

test('direct sign-in uses the existing context and submits credentials only once to the modern local endpoint', async () => {
  const f = fixture([response(auth), response({ type: 'success', token: 'synthetic-token-never-returned' })]);
  const controller = new AbortController();
  assert.deepEqual(await f.authenticate(account, controller.signal), { supported: true });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], ['GET', AUTH, undefined, 4000, { signal: controller.signal }]);
  assert.deepEqual(f.calls[1], ['POST', COMPLETE, { ...account, remember: true, language: 'en_US', captcha: '' }, 30000, { signal: controller.signal }]);
});

test('a missing context is initialized without credentials before a single complete request', async () => {
  const f = fixture([response(null, 404), response(null, 204), response(auth), response({ type: 'success' })]);
  assert.deepEqual(await f.authenticate(account), { supported: true });
  assert.deepEqual(f.calls.map(([method, endpoint]) => [method, endpoint]), [['GET', AUTH], ['DELETE', AUTH], ['POST', START], ['POST', COMPLETE]]);
  assert.deepEqual(f.calls[2][2], { language: 'en_US', productId: 'riot-client', state: 'auth', intendedProductId: '' });
  assert.equal(JSON.stringify(f.calls.slice(0, 3)).includes(account.password), false);
});

test('an accepted empty start response is checked with GET before credentials are submitted', async () => {
  const f = fixture([response(null, 404), response(null, 204), response(null, 204), response(auth), response(null, 202)]);
  assert.deepEqual(await f.authenticate(account), { supported: true });
  assert.deepEqual(f.calls.map((call) => call.slice(0, 2)), [['GET', AUTH], ['DELETE', AUTH], ['POST', START], ['GET', AUTH], ['POST', COMPLETE]]);
});

test('a stale failed attempt creates one new context but does not retry a rejected password', async () => {
  const f = fixture([response({ type: 'error', error: 'auth_failure' }), response(null, 204), response(auth), response({ type: 'error', error: 'auth_failure', password: account.password })]);
  await assert.rejects(f.authenticate(account), /^Error: Wrong username or password$/);
  assert.equal(f.calls.filter((call) => call[1] === COMPLETE).length, 1);
  assert.equal(f.calls.filter((call) => call[1] === START).length, 1);
  assert.equal(f.calls.filter((call) => call[0] === 'DELETE').length, 1);
});

test('a failed reset stops initialization before start or credentials and never echoes a response body', async () => {
  for (const failed of [response({ error: account.password }, 403), response(['invalid'], 200), response(null, 500)]) {
    const f = fixture([response({ type: 'auth', suuid: '', captcha: { type: 'none' } }), failed]);
    await assert.rejects(f.authenticate(account), (error) => !error.message.includes(account.password));
    assert.deepEqual(f.calls.map((call) => call.slice(0, 2)), [['GET', AUTH], ['DELETE', AUTH]]);
  }
});

test('a missing reset route can continue to start but rate limits and unsupported methods cannot submit a password', async () => {
  const absent = fixture([response(null, 404), response(null, 404), response(auth), response({ type: 'success' })]);
  assert.deepEqual(await absent.authenticate(account), { supported: true });
  assert.deepEqual(absent.calls.map((call) => call.slice(0, 2)), [['GET', AUTH], ['DELETE', AUTH], ['POST', START], ['POST', COMPLETE]]);
  for (const status of [405, 501, 429]) {
    const f = fixture([response({ type: 'auth' }), response(null, status)]);
    if (status === 429) await assert.rejects(f.authenticate(account), /Too many attempts/);
    else assert.deepEqual(await f.authenticate(account), { supported: false });
    assert.equal(f.calls.length, 2);
    assert.equal(JSON.stringify(f.calls).includes(account.password), false);
  }
});

test('cancelling immediately after reset prevents creating a context or submitting credentials', async () => {
  const controller = new AbortController();
  const f = fixture([response({ type: 'auth' }), () => { controller.abort(); return response(null, 204); }]);
  await assert.rejects(f.authenticate(account, controller.signal), /cancelled/);
  assert.deepEqual(f.calls.map((call) => call.slice(0, 2)), [['GET', AUTH], ['DELETE', AUTH]]);
});

test('unavailable routes before submission permit the UI fallback without retrying authentication', async () => {
  for (const status of [404, 405, 501]) {
    const before = status === 404 ? [response(null, status), response(null, status), response(null, status)] : [response(null, status)];
    const f = fixture(before);
    assert.deepEqual(await f.authenticate(account), { supported: false });
    assert.equal(f.calls.some((call) => call[1] === COMPLETE), false);
  }
});

test('an unavailable route after the password was submitted fails instead of allowing a second submission', async () => {
  for (const status of [404, 405, 501]) {
    for (const body of [null, { error: 'unexpected_server_detail' }]) {
      const after = fixture([response(auth), response(body, status)]);
      await assert.rejects(after.authenticate(account), (error) => {
        assert.match(error.message, /Riot could not complete sign-in\. Open Riot Client to continue/);
        assert.equal(error.message.includes(account.password), false);
        return true;
      });
      assert.equal(after.calls.filter((call) => call[1] === COMPLETE).length, 1);
    }
  }
});

test('existing MFA and all human verification screens receive no password or reset request', async () => {
  const states = [
    { type: 'multifactor', email: 'private@example.invalid' },
    { type: 'auth', captcha: { type: 'hcaptcha', data: 'private-challenge' } },
    { type: 'auth', error: 'captcha_not_allowed' },
    ...['healup', 'confirm_age', 'kr-id-verification', 'ambiguous_auth', 'ambiguous_username', 'unexpected_new_screen'].map((type) => ({ type })),
  ];
  for (const state of states) {
    const f = fixture([response(state)]);
    const nativeCaptcha = state.type === 'auth' && (state.error === 'captcha_not_allowed' || state.captcha?.type === 'hcaptcha');
    assert.deepEqual(await f.authenticate(account), nativeCaptcha
      ? { supported: true, requiresNativeForm: true, reason: 'captcha' }
      : { supported: true, needsAttention: true, reason: state.type === 'multifactor' ? 'multifactor' : 'challenge' });
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(f.calls).includes(account.password), false);
  }
});

test('a new challenge after start or complete is returned for manual intervention without further submissions', async () => {
  for (const position of ['start', 'complete']) {
    const f = fixture(position === 'start'
      ? [response(null, 404), response(null, 204), response({ type: 'auth', captcha: { type: 'hcaptcha' } })]
      : [response(auth), response({ type: 'multifactor', token: 'do-not-return' })]);
    assert.deepEqual(await f.authenticate(account), position === 'start'
      ? { supported: true, requiresNativeForm: true, reason: 'captcha' }
      : { supported: true, needsAttention: true, reason: 'multifactor' });
    assert.equal(f.calls.length, position === 'start' ? 3 : 2);
  }
});

test('a CAPTCHA required by the new context selects the native form before any password is sent', async () => {
  const f = fixture([
    response({ type: 'auth', suuid: '', captcha: { type: 'none' } }),
    response(null, 204),
    response({ type: 'auth', suuid: 'synthetic-new-context', captcha: { type: 'hcaptcha' } }),
  ]);
  assert.deepEqual(await f.authenticate(account), { supported: true, requiresNativeForm: true, reason: 'captcha' });
  assert.deepEqual(f.calls.map((call) => call.slice(0, 2)), [['GET', AUTH], ['DELETE', AUTH], ['POST', START]]);
  assert.equal(JSON.stringify(f.calls).includes(account.password), false);
});

test('captcha rejection requests manual attention and does not retry a submitted password', async () => {
  const f = fixture([response(auth), response({ error: 'captcha_not_allowed', token: 'private' }, 400)]);
  assert.deepEqual(await f.authenticate(account), { supported: true, needsAttention: true, reason: 'challenge' });
  assert.equal(f.calls.filter((call) => call[1] === COMPLETE).length, 1);
});

test('malformed verification metadata and unknown initial failures cannot trigger a password submission', async () => {
  for (const state of [{ type: 'auth', captcha: {} }, { type: 'auth', error: { private: account.password } }, { type: 'error', error: account.password }]) {
    const f = fixture([response(state)]);
    await assert.rejects(f.authenticate(account), (error) => !error.message.includes(account.password));
    assert.equal(f.calls.length, 1);
  }
});

test('rate limiting fails without resetting context or falling back to UI', async () => {
  for (const reply of [response(null, 429), response({ type: 'error', error: 'rate_limited' })]) {
    const f = fixture([reply]);
    await assert.rejects(f.authenticate(account), /^Error: Too many attempts, wait a few minutes$/);
    assert.equal(f.calls.length, 1);
  }
});

test('transport, unauthorized, malformed and unknown failures never expose raw responses or retry passwords', async () => {
  const secret = `${account.username} ${account.password}`;
  for (const reply of [new Error(secret), response({ type: secret }, 401), response({ error: secret }, 403), response({ type: 'error', error: secret }, 400), response(null), response(['unexpected']), { status: '200', json: auth }]) {
    const f = fixture([response(auth), reply]);
    await assert.rejects(f.authenticate(account), (error) => {
      assert.equal(error.message.includes(account.password), false);
      assert.equal(error.message.includes(account.username), false);
      return true;
    });
    assert.equal(f.calls.filter((call) => call[1] === COMPLETE).length, 1);
  }
});

test('already authenticated state is not overwritten and still requires launch-flow identity verification', async () => {
  const f = fixture([response({ type: 'success' })]);
  assert.deepEqual(await f.authenticate(account), { supported: true });
  assert.equal(f.calls.length, 1);
});

test('session state returns only fixed type and error values and falls back read-only on old clients', async () => {
  for (const [raw, expected] of [
    [{ type: 'success', access_token: 'private' }, { type: 'authenticated' }],
    [{ type: 'auth', captcha: { type: 'none' }, username: account.username }, { type: 'auth' }],
    [{ type: 'multifactor', email: 'private@example.invalid' }, { type: 'multifactor' }],
    [{ type: 'auth', captcha: { type: 'hcaptcha', token: 'private' } }, { type: 'challenge' }],
    [{ type: 'error', error: account.password }, { type: 'error', error: 'authentication_error' }],
    [{ type: 'auth', error: 'auth_failure' }, { type: 'error', error: 'auth_failure' }],
    [{ type: 'confirm_age', token: 'private' }, { type: 'challenge' }],
  ]) {
    const modern = fixture(expected.type === 'authenticated' ? [response(raw), response({ loginState: 'PendingProductContext' })] : [response(raw)]);
    assert.deepEqual(await modern.sessionState(), expected);
    const legacy = fixture([response(null, 404), response(raw)]);
    assert.deepEqual(await legacy.sessionState(), expected);
    assert.deepEqual(legacy.calls.map((call) => call.slice(0, 2)), [['GET', AUTH], ['GET', '/rso-auth/v1/session']]);
  }
  const absent = fixture([response(null, 404), response(null, 404)]);
  assert.equal(await absent.sessionState(), null);
});

test('successful identity authentication still reports pending player-session verification without returning session data', async () => {
  for (const loginState of ['PendingConsent', 'PendingEulaAcceptance', 'PendingForget', 'PendingAgeVerification', 'PendingHealup', 'PendingMultifactor', 'PendingKRIdVerification', 'PendingDisambiguation', 'PendingRiotID', 'PendingLolRegionSelection', 'PendingVNGProfile', 'Error']) {
    const f = fixture([response({ type: 'success', access_token: 'private-identity-token' }), response({ loginState, account: account.username, sessionToken: account.password })]);
    assert.deepEqual(await f.sessionState(), { type: loginState === 'PendingMultifactor' ? 'multifactor' : 'challenge' });
    assert.deepEqual(f.calls.map((call) => call.slice(0, 2)), [['GET', AUTH], ['GET', PLAYER_SESSION]]);
  }
});

test('initializing and pending product context remain eligible for the later verified launch', async () => {
  for (const loginState of ['Initializing', 'PendingProductContext']) {
    const f = fixture([response({ type: 'success' }), response({ loginState })]);
    assert.deepEqual(await f.sessionState(), { type: 'authenticated' });
  }
});

test('authorized and automatic Riot player-session steps do not ask for attention', async () => {
  for (const loginState of ['Authorized', 'PendingProductContextInitialization', 'PendingInitialization', 'RestoreAuthorization', 'RefreshAuthorization', 'LoginTokenExchange', 'PendingEulaData', 'PendingUserInfoData', 'PendingLoginQueue', 'PendingGameSession']) {
    const f = fixture([response({ type: 'success' }), response({ loginState })]);
    assert.deepEqual(await f.sessionState(), { type: 'authenticated' }, loginState);
  }
});

test('restriction, consent and account choice player-session states block the launch', async () => {
  for (const loginState of ['SignupAgeRestricted', 'ConfirmedAgeTooYoung', 'PlatformAgeRestricted', 'ProductAgeRestricted', 'GamePlayRestricted', 'PendingParentalEmail', 'MultifactorChallengeDenied', 'PendingUsernameChangedConfirmation', 'PendingRecoverableAccount', 'ReauthenticationRequired', 'PendingCreateAccountStrategy', 'PendingSignup', 'PendingPlatformAuthorizationConsent', 'PendingProviderCredentials', 'PendingPlatformUser', 'PendingAuthIntent', 'PendingLoginStrategy', 'PendingSignInStrategy', 'KeyPairError']) {
    const f = fixture([response({ type: 'success' }), response({ loginState })]);
    assert.deepEqual(await f.sessionState(), { type: 'challenge' }, loginState);
  }
});

test('an unknown player-session state fails closed as a verification step', async () => {
  for (const loginState of ['PendingFutureVerification', 'SomethingNew', account.password]) {
    const f = fixture([response({ type: 'success' }), response({ loginState })]);
    assert.deepEqual(await f.sessionState(), { type: 'challenge' });
  }
});

test('unavailable player-session routes keep compatibility but other failures cannot conceal pending verification', async () => {
  for (const status of [404, 405, 501]) {
    const f = fixture([response({ type: 'success' }), response(null, status)]);
    assert.deepEqual(await f.sessionState(), { type: 'authenticated' });
    assert.equal(f.calls.length, 2);
  }
  for (const failed of [response({ loginState: account.password }, 500), new Error(account.password), response(null), response({ state: 'PendingConsent' })]) {
    const f = fixture([response({ type: 'success' }), failed]);
    await assert.rejects(f.sessionState(), (error) => !error.message.includes(account.password));
    assert.equal(f.calls.length, 2);
  }
});

test('cancellation before and between requests prevents any later credential submission', async () => {
  const already = new AbortController(); already.abort();
  const before = fixture([]);
  await assert.rejects(before.authenticate(account, already.signal), /cancelled/);
  assert.equal(before.calls.length, 0);
  const controller = new AbortController();
  const after = fixture([() => { controller.abort(); return response(auth); }]);
  await assert.rejects(after.authenticate(account, controller.signal), /cancelled/);
  assert.equal(after.calls.length, 1);
});

test('invalid credential inputs are rejected without any local requests', async () => {
  for (const value of [null, { ...account, password: '' }, { ...account, username: 'bad\nlogin' }, { ...account, password: 'x'.repeat(257) }]) {
    const f = fixture([]);
    await assert.rejects(f.authenticate(value), /username and password/);
    assert.equal(f.calls.length, 0);
  }
});
