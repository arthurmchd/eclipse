const test = require('node:test');
const assert = require('node:assert/strict');
const { createSignInFlow } = require('../src/signInFlow');

const account = { username: 'example-user', password: 'example-password', gameName: 'Example', tagLine: 'BR1' };

test('loss of the window guard interrupts login before requesting the product', async () => {
  const f = fixture();
  let healthy = true;
  f.io.windows.assertHealthy = () => { if (!healthy) throw new Error('guard stopped'); };
  f.io.sessionState = async () => { healthy = false; return { type: 'auth' }; };
  await assert.rejects(f.run(), /guard stopped/);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.some((entry) => Array.isArray(entry) && entry[0] === 'type'), false);
});

function fixture() {
  let clock = 0;
  const events = [];
  const statuses = [];
  const state = { authorized: true, gameWindow: true, identity: { gameName: 'Example', tagLine: 'BR1' } };
  const io = {
    detectClientPath: () => 'C:/Example/RiotClientServices.exe',
    closeEverything: async () => { events.push('closed'); return { yaml: null }; },
    readSettingsYaml: () => 'token:current',
    writeSettingsYaml: (yaml) => { events.push(['write', yaml]); },
    hasPersistedLogin: (yaml) => typeof yaml === 'string' && yaml.startsWith('token:'),
    stripPersistedLogin: () => 'stripped',
    sameRiotId: (a, b) => Boolean(a && b && a.gameName === b.gameName && a.tagLine === b.tagLine),
    sessionState: async () => ({ type: state.authorized ? 'authenticated' : 'auth' }),
    isAuthorized: async () => state.authorized,
    activeRiotId: async () => state.identity,
    localApi: async (method, endpoint) => { events.push([method, endpoint]); state.authorized = false; return { status: 200 }; },
    launchProduct: async () => { events.push('launch'); },
    requestLaunch: async () => { events.push('request-launch'); },
    typeCredentials: async (request) => { events.push(['type', request.submit]); state.authorized = true; return ['remember:on']; },
    windows: {
      hide: async () => { events.push('hide'); },
      conceal: async () => { events.push('conceal'); },
      reveal: async () => { events.push('reveal'); },
      gameWindow: async () => { events.push('game-window'); return state.gameWindow; },
    },
    runningGames: async () => ({ lol: true, val: true }),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  };
  const options = {
    account,
    game: 'lol',
    session: 'token:saved',
    status: (text, details) => { statuses.push({ text, ...details }); },
  };
  return { io, options, state, events, statuses, elapsed: () => clock, run: () => createSignInFlow(io)(options) };
}

test('loads the latest remembered session only after the leaving session is persisted', async () => {
  const f = fixture();
  let saved = 'token:old';
  f.options.onClosed = async () => { f.events.push('persist-leaving'); saved = 'token:updated'; };
  f.options.session = async () => { f.events.push('load-session'); return saved; };
  const result = await f.run();
  assert.equal(result.usedSavedSession, true);
  assert.ok(f.events.indexOf('persist-leaving') > f.events.indexOf('closed'));
  assert.ok(f.events.indexOf('load-session') > f.events.indexOf('persist-leaving'));
  assert.deepEqual(f.events.find((entry) => Array.isArray(entry) && entry[0] === 'write'), ['write', 'token:updated']);
  assert.equal(f.events.some((entry) => Array.isArray(entry) && entry[0] === 'type'), false);
});

test('falls back to hidden credential entry for an expired saved session', async () => {
  const f = fixture();
  f.state.authorized = false;
  const result = await f.run();
  assert.equal(result.sessionRejected, true);
  assert.equal(result.gameStarted, true);
  assert.deepEqual(f.events.find((entry) => Array.isArray(entry) && entry[0] === 'type'), ['type', true]);
  assert.equal(f.events.includes('reveal'), false);
});

test('refuses to start Riot when the background guard cannot be armed', async () => {
  const f = fixture();
  f.io.windows.hide = async () => { throw new Error('guard unavailable'); };
  await assert.rejects(f.run(), /guard unavailable/);
  assert.equal(f.events.includes('launch'), false);
  assert.equal(f.events.includes('closed'), false);
  assert.equal(f.events.includes('reveal'), false);
});

test('MFA requests manual attention without revealing the client or typing over the code form', async () => {
  const f = fixture();
  f.state.authorized = false;
  f.io.sessionState = async () => ({ type: f.state.authorized ? 'authenticated' : 'multifactor' });
  f.io.isAuthorized = async () => {
    if (f.elapsed() > 16000) f.state.authorized = true;
    return f.state.authorized;
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(f.statuses.some((status) => status.needsAttention && /2FA/.test(status.text)));
  assert.equal(f.events.includes('reveal'), false);
  assert.equal(f.events.some((entry) => Array.isArray(entry) && entry[0] === 'type'), false);
});

test('retains the concealment watcher after a real game window is ready', async () => {
  const f = fixture();
  f.io.windows.gameWindow = async () => {
    const ready = f.elapsed() >= 5000;
    f.events.push(ready ? 'game-ready' : 'game-not-ready');
    return ready;
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(f.elapsed() >= 5000);
  assert.ok(f.events.lastIndexOf('conceal') > f.events.indexOf('game-ready'));
  assert.equal(f.events.includes('reveal'), false);
  assert.equal(f.events.includes('request-launch'), true);
});

test('a running game process without a game window times out without reporting success', async () => {
  const f = fixture();
  f.state.gameWindow = false;
  await assert.rejects(f.run(), /game did not open/i);
  assert.ok(f.elapsed() >= 180000);
  assert.equal(f.events.at(-1), 'conceal');
  assert.equal(f.events.includes('reveal'), false);
  assert.equal(f.statuses.some((status) => status.text === 'Game opened'), false);
});

test('cancellation interrupts authentication polling and does not reveal the client', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.options.session = null;
  f.state.authorized = false;
  f.io.typeCredentials = async () => [];
  const sleep = f.io.sleep;
  f.io.sleep = async (ms) => { await sleep(ms); if (f.elapsed() >= 1000) controller.abort(); };
  await assert.rejects(f.run(), /cancelled/i);
  assert.ok(f.elapsed() < 2000);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.includes('reveal'), false);
  assert.equal(f.events.at(-1), 'conceal');
});

test('rejects unsupported products before touching client processes', async () => {
  const f = fixture();
  f.options.game = 'unrecognised';
  await assert.rejects(f.run(), /supported game/);
  assert.deepEqual(f.events, []);
});

for (const challenge of [
  { label: 'captcha error', type: 'auth', error: 'captcha_not_allowed' },
  { label: 'challenge screen', type: 'challenge' },
]) {
  test(`saved session ${challenge.label} requests attention without overwriting the challenge`, async () => {
    const f = fixture();
    f.state.authorized = false;
    f.io.sessionState = async () => f.state.authorized ? { type: 'authenticated' } : challenge;
    f.io.isAuthorized = async () => {
      if (f.elapsed() > 17000) f.state.authorized = true;
      return f.state.authorized;
    };
    const result = await f.run();
    assert.equal(result.gameStarted, true);
    assert.equal(result.usedSavedSession, true);
    assert.equal(f.statuses.filter((status) => status.needsAttention).length, 1);
    assert.equal(f.events.some((entry) => Array.isArray(entry) && entry[0] === 'type'), false);
    assert.equal(f.events.includes('reveal'), false);
  });
}

test('a saved-session MFA timeout fails without falling back to credential entry', async () => {
  const f = fixture();
  f.state.authorized = false;
  f.io.sessionState = async () => ({ type: 'multifactor' });
  await assert.rejects(f.run(), /security check timed out/i);
  assert.ok(f.elapsed() >= 195000);
  assert.equal(f.events.some((entry) => Array.isArray(entry) && entry[0] === 'type'), false);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.includes('reveal'), false);
});

test('rejects a different signed-in account after credential entry before saving its session', async () => {
  const f = fixture();
  f.options.session = null;
  f.state.authorized = false;
  f.state.identity = { gameName: 'AnotherAccount', tagLine: 'BR1' };
  let readSession = false;
  f.io.readSettingsYaml = () => { readSession = true; return 'token:wrong-account'; };
  await assert.rejects(f.run(), /does not match the selected account/);
  assert.equal(readSession, false);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.includes('reveal'), false);
  assert.equal(f.events.at(-1), 'conceal');
});

test('signs a mismatched saved session out and falls back to the selected credentials', async () => {
  const f = fixture();
  f.state.identity = { gameName: 'AnotherAccount', tagLine: 'BR1' };
  f.io.typeCredentials = async () => {
    f.events.push(['type', true]);
    f.state.identity = { gameName: account.gameName, tagLine: account.tagLine };
    f.state.authorized = true;
    return ['remember:on'];
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(result.sessionRejected, true);
  assert.equal(result.usedSavedSession, false);
  const signOutIndex = f.events.findIndex((entry) => Array.isArray(entry) && entry[0] === 'DELETE');
  const typeIndex = f.events.findIndex((entry) => Array.isArray(entry) && entry[0] === 'type');
  assert.ok(signOutIndex >= 0 && typeIndex > signOutIndex);
});

test('cancelling while the guard starts never closes games afterward', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.io.windows.hide = async () => { f.events.push('hide'); controller.abort(); };
  await assert.rejects(f.run(), /cancelled/i);
  assert.equal(f.events.includes('closed'), false);
  assert.equal(f.events.includes('launch'), false);
});

test('cancelling during session loading never replaces the Riot settings afterward', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.options.session = async () => { controller.abort(); return 'token:saved'; };
  await assert.rejects(f.run(), /cancelled/i);
  assert.equal(f.events.some((entry) => Array.isArray(entry) && entry[0] === 'write'), false);
  assert.equal(f.events.includes('launch'), false);
});

function directFixture() {
  const f = fixture();
  f.state.authorized = false;
  f.state.processes = { client: true, lol: false, val: false };
  f.options.hasSavedSession = false;
  f.io.runningGames = async () => ({ ...f.state.processes });
  f.io.activeRiotId = async () => { f.events.push('identity'); return f.state.identity; };
  f.io.authenticate = async (_account, signal) => {
    f.events.push('authenticate');
    assert.equal(signal, f.options.signal);
    f.state.authorized = true;
    return { supported: true };
  };
  f.io.requestLaunch = async (game) => {
    f.events.push('request-launch');
    f.state.processes[game === 'val' ? 'val' : 'lol'] = true;
  };
  return f;
}

test('a verified current account opens the selected game without restarting or submitting credentials', async () => {
  const f = directFixture();
  f.state.authorized = true;
  f.options.session = () => { throw new Error('The current account needs no stored-session read'); };
  const result = await f.run();
  assert.equal(result.reusedCurrentSession, true);
  assert.equal(result.gameStarted, true);
  for (const event of ['closed', 'launch', 'authenticate', 'reveal']) assert.equal(f.events.includes(event), false);
  assert.equal(f.events.some((event) => Array.isArray(event) && ['type', 'write'].includes(event[0])), false);
  assert.ok(f.events.indexOf('identity') < f.events.indexOf('request-launch'));
  assert.equal(f.elapsed(), 0);
});

test('an authorized account still waits for a required player-session verification before launching', async () => {
  const f = directFixture();
  f.state.authorized = true;
  f.io.sessionState = async () => ({ type: f.elapsed() < 2100 ? 'challenge' : 'authenticated' });
  const launch = f.io.requestLaunch;
  f.io.requestLaunch = async (game) => { assert.ok(f.elapsed() >= 2100); return launch(game); };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(f.statuses.some((status) => status.needsAttention));
  assert.equal(f.events.includes('authenticate'), false);
  assert.equal(f.events.includes('closed'), false);
});

test('an unresolved player-session verification never opens a game despite existing RSO authorization', async () => {
  const f = directFixture();
  f.state.authorized = true;
  f.io.sessionState = async () => ({ type: 'challenge' });
  await assert.rejects(f.run(), /security check timed out/);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.includes('authenticate'), false);
  assert.equal(f.events.includes('reveal'), false);
});

test('player-session inspection errors cannot be mistaken for completed verification', async () => {
  const f = directFixture();
  f.state.authorized = true;
  f.io.readAuthenticationState = async () => { throw new Error('Could not inspect player session'); };
  await assert.rejects(f.run(), /Could not inspect player session/);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.includes('reveal'), false);
});

for (const game of ['lol', 'tft', 'val']) {
  test(`a signed-out backend signs in directly for ${game} without restarting or typing`, async () => {
    const f = directFixture();
    f.options.game = game;
    const result = await f.run();
    assert.equal(result.gameStarted, true);
    assert.equal(f.events.filter((event) => event === 'authenticate').length, 1);
    for (const event of ['closed', 'launch', 'reveal']) assert.equal(f.events.includes(event), false);
    assert.equal(f.events.some((event) => Array.isArray(event) && ['type', 'write'].includes(event[0])), false);
    assert.ok(f.events.indexOf('identity') < f.events.indexOf('request-launch'));
    assert.equal(f.elapsed(), 0);
  });
}

test('direct authentication errors never fall back to typing or launch a game', async () => {
  for (const error of ['Wrong username or password', 'Network unavailable', 'Too many attempts']) {
    const f = directFixture();
    f.io.authenticate = async () => { f.events.push('authenticate'); throw new Error(error); };
    await assert.rejects(f.run(), new RegExp(error));
    assert.equal(f.events.filter((event) => event === 'authenticate').length, 1);
    assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'type'), false);
    assert.equal(f.events.includes('request-launch'), false);
    assert.equal(f.events.includes('reveal'), false);
  }
});

test('an unsupported direct endpoint permits hidden credential compatibility', async () => {
  const f = directFixture();
  f.io.authenticate = async () => { f.events.push('authenticate'); return { supported: false }; };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'type').length, 1);
  assert.equal(f.events.includes('closed'), false);
  assert.equal(f.events.includes('reveal'), false);
});

test('a CAPTCHA required before any credential submission uses the native hidden form once', async () => {
  const f = directFixture();
  f.io.authenticate = async () => { f.events.push('inspect-auth'); return { supported: true, requiresNativeForm: true, reason: 'captcha' }; };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'type').length, 1);
  assert.equal(f.events.includes('closed'), false);
  assert.equal(f.events.includes('reveal'), false);
  assert.ok(f.statuses.some((status) => status.nativeClient === true && !status.needsAttention));
});

test('manual verification after native credential entry identifies the original challenge window', async () => {
  const f = directFixture();
  let typed = false;
  f.io.authenticate = async () => ({ supported: true, requiresNativeForm: true, reason: 'captcha' });
  f.io.typeCredentials = async () => { typed = true; f.events.push(['type', true]); return ['remember:on']; };
  f.io.sessionState = async () => ({ type: f.state.authorized ? 'authenticated' : typed ? 'multifactor' : 'auth' });
  f.io.isAuthorized = async () => { if (f.elapsed() >= 1400) f.state.authorized = true; return f.state.authorized; };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(f.statuses.some((status) => status.needsAttention && status.nativeClient === true));
  assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'type').length, 1);
  assert.equal(f.events.includes('reveal'), false);
});

test('an invalid direct-login result fails closed without duplicate credential submission', async () => {
  const f = directFixture();
  f.io.authenticate = async () => undefined;
  await assert.rejects(f.run(), /invalid response/);
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'type'), false);
  assert.equal(f.events.includes('request-launch'), false);
});

test('direct login never requests a game when the signed-in identity differs', async () => {
  const f = directFixture();
  f.state.identity = { gameName: 'Unexpected', tagLine: 'BR1' };
  let sessionRead = false;
  f.io.readSettingsYaml = () => { sessionRead = true; return 'token:unexpected'; };
  await assert.rejects(f.run(), /does not match the selected account/);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(sessionRead, false);
});

test('an existing different account is restarted before reading the target saved session', async () => {
  const f = directFixture();
  f.state.authorized = true;
  f.state.identity = { gameName: 'Previous', tagLine: 'BR1' };
  f.options.hasSavedSession = true;
  f.options.onClosed = async () => { f.events.push('persist-leaving'); };
  f.options.session = () => { f.events.push('load-session'); return 'token:target'; };
  f.io.launchProduct = async (_exe, game) => {
    assert.equal(game, undefined);
    f.events.push('launch');
    f.state.identity = { gameName: account.gameName, tagLine: account.tagLine };
  };
  const result = await f.run();
  assert.equal(result.usedSavedSession, true);
  assert.equal(result.reusedCurrentSession, false);
  assert.ok(f.events.indexOf('load-session') > f.events.indexOf('persist-leaving'));
  assert.ok(f.events.indexOf('persist-leaving') > f.events.indexOf('closed'));
  assert.equal(f.events.includes('authenticate'), false);
});

test('an expired saved session uses direct authentication after restoring only background services', async () => {
  const f = directFixture();
  f.options.hasSavedSession = true;
  f.io.launchProduct = async (_exe, game) => { assert.equal(game, undefined); f.events.push('launch'); };
  const result = await f.run();
  assert.equal(result.sessionRejected, true);
  assert.equal(result.gameStarted, true);
  assert.ok(f.events.indexOf('authenticate') > f.events.indexOf('launch'));
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'type'), false);
});

test('a game already running prevents reusing even a matching current session', async () => {
  const f = directFixture();
  f.state.authorized = true;
  f.state.processes.val = true;
  const result = await f.run();
  assert.equal(result.reusedCurrentSession, false);
  assert.equal(f.events.includes('closed'), true);
  assert.equal(f.events.includes('launch'), true);
});

test('direct MFA waits for user intervention without typing or submitting credentials twice', async () => {
  const f = directFixture();
  f.io.sessionState = async () => ({ type: f.state.authorized ? 'authenticated' : f.events.includes('authenticate') ? 'multifactor' : 'auth' });
  f.io.authenticate = async () => { f.events.push('authenticate'); return { supported: true }; };
  f.io.isAuthorized = async () => {
    if (f.elapsed() >= 1400) f.state.authorized = true;
    return f.state.authorized;
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(f.events.filter((event) => event === 'authenticate').length, 1);
  assert.equal(f.statuses.filter((status) => status.needsAttention).length, 1);
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'type'), false);
  assert.equal(f.events.includes('reveal'), false);
});

test('cancellation during direct authentication never launches a product or types credentials afterward', async () => {
  const f = directFixture();
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.io.authenticate = async () => { controller.abort(); return { supported: true }; };
  await assert.rejects(f.run(), /cancelled/);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'type'), false);
});

test('saving a delayed session never delays requesting the verified game', async () => {
  const f = directFixture();
  f.io.readSettingsYaml = () => {
    assert.equal(f.events.includes('request-launch'), true);
    return f.elapsed() >= 1500 ? 'token:fresh' : null;
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(result.session, 'token:fresh');
  assert.ok(f.elapsed() < 2500);
});

test('dry runs never submit background authentication or launch even an already verified account', async () => {
  for (const authorized of [false, true]) {
    const f = directFixture();
    f.state.authorized = authorized;
    f.options.dryRun = true;
    const result = await f.run();
    assert.equal(result.gameStarted, false);
    assert.equal(f.events.includes('authenticate'), false);
    assert.equal(f.events.includes('request-launch'), false);
    assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'type' && event[1] === true), false);
  }
});
