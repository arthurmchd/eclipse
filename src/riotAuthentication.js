const AUTHENTICATION = '/rso-authenticator/v1/authentication';
const START = `${AUTHENTICATION}/riot-identity/start`;
const COMPLETE = `${AUTHENTICATION}/riot-identity/complete`;
const LEGACY_SESSION = '/rso-auth/v1/session';
const PLAYER_SESSION = '/player-session-lifecycle/v1/session';
const UNSUPPORTED = new Set([404, 405, 501]);
const HUMAN_STEPS = new Set(['challenge', 'captcha', 'healup', 'confirm_age', 'kr-id-verification', 'ambiguous_auth', 'ambiguous_username']);
const HUMAN_SESSION_STEPS = new Set([
  'pendingconsent', 'pendingeulaacceptance', 'pendingforget', 'pendingageverification',
  'pendinghealup', 'pendingkridverification', 'pendingdisambiguation', 'pendingriotid',
  'pendinglolregionselection', 'pendingvngprofile', 'error',
]);
const SAFE_ERRORS = new Map([
  ['auth_failure', 'auth_failure'], ['invalid_credentials', 'auth_failure'], ['bad_credentials', 'auth_failure'],
  ['rate_limited', 'rate_limited'], ['too_many_requests', 'rate_limited'],
  ['captcha_not_allowed', 'captcha_not_allowed'], ['captcha_required', 'captcha_not_allowed'],
  ['invalid_request', 'invalid_request'],
]);

const validObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function cancelled(signal) {
  if (signal?.aborted) throw new Error('Sign-in cancelled');
}

// Authentication responses can contain tokens, usernames, challenge payloads
// and user-provided error messages. Only these fixed values leave this module.
function normalizeState(value) {
  if (!validObject(value) || typeof value.type !== 'string' || !value.type) throw new Error('The Riot authentication service returned an invalid response');
  const type = value.type.toLowerCase();
  if (value.error != null && typeof value.error !== 'string') throw new Error('The Riot authentication service returned an invalid response');
  const error = typeof value.error === 'string' && value.error ? SAFE_ERRORS.get(value.error.toLowerCase()) || 'authentication_error' : null;
  if (error === 'captcha_not_allowed') return { type: 'challenge', error };
  if (error) return { type: 'error', error };
  const captcha = value.captcha;
  if (captcha != null && (!validObject(captcha) || typeof captcha.type !== 'string')) throw new Error('The Riot authentication service returned an invalid response');
  if (captcha && captcha.type.toLowerCase() !== 'none') return { type: 'challenge' };
  if (type === 'success' || type === 'authenticated') return { type: 'authenticated' };
  if (type === 'multifactor') return { type: 'multifactor' };
  if (HUMAN_STEPS.has(type)) return { type: 'challenge' };
  if (type === 'auth') return { type: 'auth' };
  if (type === 'error') return { type: 'error', error: 'authentication_error' };
  // An unfamiliar verification screen must not receive an automatic password
  // submission. The normal client can display the required action instead.
  return { type: 'challenge' };
}

function attention(state) {
  if (state.type === 'multifactor') return { supported: true, needsAttention: true, reason: 'multifactor' };
  if (state.type === 'challenge') return { supported: true, needsAttention: true, reason: 'challenge' };
  return null;
}

function preSubmissionAttention(state, value) {
  if (state.type === 'challenge' && validObject(value) && ['auth', 'error'].includes(value.type)) {
    const captchaError = typeof value.error === 'string' && SAFE_ERRORS.get(value.error.toLowerCase()) === 'captcha_not_allowed';
    const activeCaptcha = value.type === 'auth' && validObject(value.captcha)
      && typeof value.captcha.type === 'string' && value.captcha.type.toLowerCase() !== 'none';
    if (captchaError || activeCaptcha) {
      // No credentials have been submitted by this operation. Let the native
      // form execute its normal CAPTCHA path rather than sending an empty token.
      return { supported: true, requiresNativeForm: true, reason: 'captcha' };
    }
  }
  return attention(state);
}

function failForState(state) {
  if (state.error === 'auth_failure') throw new Error('Wrong username or password');
  if (state.error === 'rate_limited') throw new Error('Too many attempts, wait a few minutes');
  if (state.type === 'error') throw new Error('Riot could not complete sign-in. Open Riot Client to continue');
}

function createRiotAuthentication({ request } = {}) {
  if (typeof request !== 'function') throw new Error('A local Riot request transport is required');

  async function call(method, endpoint, body, signal, timeoutMs = 4000) {
    cancelled(signal);
    let response;
    try { response = await request(method, endpoint, body, timeoutMs, { signal }); }
    catch {
      cancelled(signal);
      throw new Error('Could not contact the Riot authentication service');
    }
    cancelled(signal);
    if (!validObject(response) || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new Error('The Riot authentication service returned an invalid response');
    return response;
  }

  function successfulState(response, { allowEmpty = false } = {}) {
    if (response.status === 429) throw new Error('Too many attempts, wait a few minutes');
    if (response.status < 200 || response.status >= 300) {
      // Error bodies are untrusted. Only known error codes may affect the
      // message, never server diagnostics or echoed request data.
      if (validObject(response.json) && typeof response.json.error === 'string') {
        const error = SAFE_ERRORS.get(response.json.error.toLowerCase()) || 'authentication_error';
        if (error === 'captcha_not_allowed') return { type: 'challenge', error };
        failForState({ type: 'error', error });
      }
      throw new Error('Riot could not complete sign-in. Open Riot Client to continue');
    }
    if (allowEmpty && (response.status === 202 || response.status === 204) && response.json == null) return null;
    return normalizeState(response.json);
  }

  async function sessionState(signal) {
    let response = await call('GET', AUTHENTICATION, undefined, signal);
    let legacy = false;
    if (UNSUPPORTED.has(response.status)) {
      legacy = true;
      response = await call('GET', LEGACY_SESSION, undefined, signal);
    }
    if (response.status === 429) return { type: 'error', error: 'rate_limited' };
    if (response.status !== 200) return null;
    const state = normalizeState(response.json);
    if (legacy || state.type !== 'authenticated') return state;
    // Identity authentication can succeed while the player session still
    // requires consent, age verification or another screen. Do not let an
    // already-issued authorization token skip these normal user actions.
    const playerSession = await call('GET', PLAYER_SESSION, undefined, signal);
    if (UNSUPPORTED.has(playerSession.status)) return state;
    if (playerSession.status !== 200) throw new Error('Riot could not confirm the sign-in session. Open Riot Client to continue');
    if (!validObject(playerSession.json) || typeof playerSession.json.loginState !== 'string' || !playerSession.json.loginState) throw new Error('The Riot authentication service returned an invalid response');
    const loginState = playerSession.json.loginState.toLowerCase();
    if (loginState === 'pendingmultifactor') return { type: 'multifactor' };
    if (HUMAN_SESSION_STEPS.has(loginState)) return { type: 'challenge' };
    // Initializing and PendingProductContext are not verification screens.
    // Product context can be supplied later by the verified launch request.
    return state;
  }

  async function authenticate(account, signal) {
    cancelled(signal);
    if (!account || typeof account.username !== 'string' || !account.username || account.username.length > 256
        || typeof account.password !== 'string' || !account.password || account.password.length > 256
        || /[\r\n\x00]/.test(account.username) || /[\r\n\x00]/.test(account.password)) throw new Error('Add the username and password first');
    const initial = await call('GET', AUTHENTICATION, undefined, signal);
    if (initial.status === 405 || initial.status === 501) return { supported: false };
    let state = initial.status === 404 ? null : successfulState(initial);
    let contextResponse = initial;
    if (state) {
      const required = preSubmissionAttention(state, initial.json);
      if (required) return required;
      if (state.type === 'authenticated') return { supported: true };
      if (state.error === 'rate_limited' || state.error === 'authentication_error') failForState(state);
    }
    // A successful GET can expose the default auth object even when no login
    // context exists. Only a non-empty session identifier confirms an existing
    // context; the type alone is insufficient after a headless restart.
    const contextId = initial.json?.suuid;
    const activeContext = typeof contextId === 'string' && contextId.length > 0
      && contextId.length <= 256 && !/[\x00-\x20\x7f]/.test(contextId);
    if (!state || state.type === 'error' || !activeContext) {
      // Match the native form: reset first, then start. Starting while the
      // authenticator is still in its error state is refused by the backend.
      // This reset happens before this attempt has submitted any credentials.
      const reset = await call('DELETE', AUTHENTICATION, undefined, signal);
      if (reset.status === 405 || reset.status === 501) return { supported: false };
      if (reset.status === 429) throw new Error('Too many attempts, wait a few minutes');
      if (reset.status !== 404 && (reset.status < 200 || reset.status >= 300
          || (reset.json != null && (!validObject(reset.json) || reset.json.error)))) {
        throw new Error('Riot could not initialize sign-in. Open Riot Client to continue');
      }
      const started = await call('POST', START, { language: 'en_US', productId: 'riot-client', state: 'auth', intendedProductId: '' }, signal, 15000);
      if (UNSUPPORTED.has(started.status)) return { supported: false };
      state = successfulState(started, { allowEmpty: true });
      contextResponse = started;
      if (!state) {
        const current = await call('GET', AUTHENTICATION, undefined, signal);
        if (UNSUPPORTED.has(current.status)) return { supported: false };
        state = successfulState(current);
        contextResponse = current;
      }
    }
    const required = preSubmissionAttention(state, contextResponse.json);
    if (required) return required;
    failForState(state);
    if (state.type === 'authenticated') return { supported: true };
    if (state.type !== 'auth') throw new Error('Riot needs your attention. Open Riot Client to continue');
    cancelled(signal);
    const completed = await call('POST', COMPLETE, {
      username: account.username, password: account.password, remember: true,
      language: 'en_US', captcha: '',
    }, signal, 30000);
    if (UNSUPPORTED.has(completed.status)) return { supported: false };
    const result = successfulState(completed, { allowEmpty: true });
    if (result) {
      const challenge = attention(result);
      if (challenge) return challenge;
      failForState(result);
    }
    // Successful transport only acknowledges this attempt. The launch flow
    // independently waits for authorization and verifies the selected Riot ID.
    return { supported: true };
  }

  return { authenticate, sessionState };
}

module.exports = { createRiotAuthentication };
