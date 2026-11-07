const test = require('node:test');
const assert = require('node:assert/strict');
const { createSignInFlow } = require('../../src/riot/signInFlow');

const account = { username: 'example-user', password: 'example-password', gameName: 'Example', tagLine: 'BR1' };
const reveals = (f) => f.events.filter((event) => event === 'reveal').length;

test('the login keeps the official interface open and closes its window only after the game is ready', async () => {
  const f = fixture();
  f.options.hasSavedSession = false;
  f.state.authorized = false;
  f.io.runningGames = async () => ({ lol: f.state.authorized, val: false });
  f.io.authenticate = async () => ({ supported: false });
  assert.equal((await f.run()).gameStarted, true);
  assert.equal(f.events.includes('closed'), false);
  assert.equal(f.events.some(e => Array.isArray(e) && e[0] === 'write'), false);
  assert.ok(f.events.indexOf('visible-interface') < f.events.findIndex(e => Array.isArray(e) && e[0] === 'type'));
  assert.equal(f.events.at(-1), 'close-client-window');
  assert.ok(f.events.indexOf('close-client-window') > f.events.indexOf('game-window'));
});

test('login errors keep Riot open without requesting or closing a game', async () => {
  const f = fixture();
  f.options.hasSavedSession = false;
  f.state.authorized = false;
  f.io.runningGames = async () => ({});
  f.io.authenticate = async () => { throw new Error('Wrong username or password'); };
  await assert.rejects(f.run(), /Wrong username/);
  for (const event of ['closed', 'request-launch', 'close-client-window']) assert.equal(f.events.includes(event), false);
});

test('the sign-in never hides the Riot or arms the window monitor', async () => {
  const f = fixture();
  const used = new Set();
  f.io.windows = new Proxy(f.io.windows, { get: (target, name) => { used.add(name); return target[name]; } });
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.deepEqual([...used].sort(), ['closeClient', 'gameWindow', 'reveal']);
  assert.equal(f.events[0], 'reveal');
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
    writeSettingsYaml: async (yaml) => { await new Promise((resolve) => setImmediate(resolve)); events.push(['write', yaml]); return true; },
    hasPersistedLogin: (yaml) => typeof yaml === 'string' && yaml.startsWith('token:'),
    stripPersistedLogin: () => 'stripped',
    sameRiotId: (a, b) => Boolean(a && b && a.gameName === b.gameName && a.tagLine === b.tagLine),
    sessionState: async () => ({ type: state.authorized ? 'authenticated' : 'auth' }),
    isAuthorized: async () => state.authorized,
    activeRiotId: async () => state.identity,
    localApi: async (method, endpoint) => { events.push([method, endpoint]); state.authorized = false; return { status: 200 }; },
    launchProduct: async () => { events.push('launch'); },
    requestLaunch: async () => { events.push('request-launch'); },
    typeCredentials: async (request) => { events.push(['type', request]); state.authorized = true; return ['remember:on']; },
    windows: {
      reveal: async () => { events.push('reveal'); },
      gameWindow: async () => { events.push('game-window'); return state.gameWindow; },
      closeClient: async () => { events.push('close-client-window'); },
    },
    runningGames: async () => ({ lol: true, val: true }),
    openVisibleInterface: async () => { events.push('visible-interface'); },
    closeGames: async () => { events.push('close-games'); },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  };
  const options = {
    account,
    game: 'lol',
    session: 'token:saved',
    hasSavedSession: true,
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

test('a Riot window that cannot be shown stops the login before touching Riot', async () => {
  const f = fixture();
  f.io.windows.reveal = async () => { throw new Error('window unavailable'); };
  await assert.rejects(f.run(), /window unavailable/);
  for (const event of ['launch', 'closed', 'visible-interface', 'close-games']) assert.equal(f.events.includes(event), false);
});

test('the Riot window closes only after a real game window is ready', async () => {
  const f = fixture();
  f.io.windows.gameWindow = async () => {
    const ready = f.elapsed() >= 5000;
    f.events.push(ready ? 'game-ready' : 'game-not-ready');
    return ready;
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(f.elapsed() >= 5000);
  assert.ok(f.events.lastIndexOf('close-client-window') > f.events.indexOf('game-ready'));
  assert.equal(f.events.filter((event) => event === 'close-client-window').length, 1);
  assert.equal(f.events.includes('request-launch'), true);
});

test('a running game process without a game window times out without reporting success', async () => {
  const f = fixture();
  f.state.gameWindow = false;
  await assert.rejects(f.run(), /game did not open/i);
  assert.ok(f.elapsed() >= 180000);
  assert.equal(f.events.includes('close-client-window'), false);
  assert.equal(reveals(f), 1);
  assert.equal(f.statuses.some((status) => status.text === 'Game opened'), false);
});

test('cancellation interrupts authentication polling and keeps the Riot open', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.options.hasSavedSession = false;
  f.state.authorized = false;
  f.io.typeCredentials = async () => [];
  const sleep = f.io.sleep;
  f.io.sleep = async (ms) => { await sleep(ms); if (f.elapsed() >= 1000) controller.abort(); };
  await assert.rejects(f.run(), /cancelled/i);
  assert.ok(f.elapsed() < 2000);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.includes('close-client-window'), false);
  assert.equal(reveals(f), 1);
});

test('Riot Client only signs in, keeps the session and shows the client without requesting any game', async () => {
  const f = fixture();
  f.options.game = 'riot';
  f.options.hasSavedSession = false;
  f.state.authorized = false;
  f.io.runningGames = async () => ({});
  f.io.authenticate = async () => ({ supported: false });
  const result = await f.run();
  assert.equal(result.clientOpened, true);
  assert.equal(result.gameStarted, false);
  assert.equal(result.session, 'token:current');
  assert.deepEqual(result.riotId, { gameName: 'Example', tagLine: 'BR1' });
  for (const event of ['request-launch', 'game-window', 'close-client-window']) assert.equal(f.events.includes(event), false);
  assert.equal(f.events.at(-1), 'reveal');
  assert.equal(f.statuses.at(-1).text, 'Riot Client opened');
  assert.equal(f.statuses.at(-1).signedIn, true);
});

test('Riot Client only never shows the client for a different signed-in account', async () => {
  const f = fixture();
  f.options.game = 'riot';
  f.options.hasSavedSession = false;
  f.state.authorized = false;
  f.io.runningGames = async () => ({});
  f.io.authenticate = async () => ({ supported: false });
  f.state.identity = { gameName: 'Someone', tagLine: 'ELSE' };
  await assert.rejects(f.run(), /does not match/);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(reveals(f), 1);
});

test('rejects unsupported products before touching client processes', async () => {
  const f = fixture();
  f.options.game = 'unrecognised';
  await assert.rejects(f.run(), /supported game/);
  assert.deepEqual(f.events, []);
});

test('rejects a different signed-in account after credential entry before saving its session', async () => {
  const f = fixture();
  f.options.hasSavedSession = false;
  f.state.authorized = false;
  f.state.identity = { gameName: 'AnotherAccount', tagLine: 'BR1' };
  let readSession = false;
  f.io.readSettingsYaml = () => { readSession = true; return 'token:wrong-account'; };
  await assert.rejects(f.run(), /does not match the selected account/);
  assert.equal(readSession, false);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(f.events.includes('close-client-window'), false);
});

test('cancelling while the Riot window is shown never closes games afterward', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.io.windows.reveal = async () => { f.events.push('reveal'); controller.abort(); };
  await assert.rejects(f.run(), /cancelled/i);
  for (const event of ['closed', 'launch', 'close-games', 'visible-interface']) assert.equal(f.events.includes(event), false);
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
  for (const event of ['closed', 'launch', 'authenticate']) assert.equal(f.events.includes(event), false);
  assert.equal(reveals(f), 1);
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
  assert.equal(reveals(f), 1);
});

test('player-session inspection errors cannot be mistaken for completed verification', async () => {
  const f = directFixture();
  f.state.authorized = true;
  f.io.readAuthenticationState = async () => { throw new Error('Could not inspect player session'); };
  await assert.rejects(f.run(), /Could not inspect player session/);
  assert.equal(f.events.includes('request-launch'), false);
  assert.equal(reveals(f), 1);
});

for (const game of ['lol', 'tft', 'val']) {
  test(`a signed-out Riot signs in directly for ${game} without restarting or typing`, async () => {
    const f = directFixture();
    f.options.game = game;
    const result = await f.run();
    assert.equal(result.gameStarted, true);
    assert.equal(f.events.filter((event) => event === 'authenticate').length, 1);
    for (const event of ['closed', 'launch']) assert.equal(f.events.includes(event), false);
    assert.equal(reveals(f), 1);
    assert.ok(f.events.indexOf('visible-interface') < f.events.indexOf('authenticate'));
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
    assert.equal(reveals(f), 1);
  }
});

test('an unsupported direct endpoint falls back to the visible form once', async () => {
  const f = directFixture();
  f.io.authenticate = async () => { f.events.push('authenticate'); return { supported: false }; };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'type').length, 1);
  assert.deepEqual(f.events.find((event) => Array.isArray(event) && event[0] === 'type')[1], { action: 'type', username: 'example-user', password: 'example-password', remember: true });
  assert.equal(f.events.includes('closed'), false);
  assert.equal(reveals(f), 1);
});

test('a CAPTCHA required before any credential submission uses the visible form once', async () => {
  const f = directFixture();
  f.io.authenticate = async () => { f.events.push('inspect-auth'); return { supported: true, requiresNativeForm: true, reason: 'captcha' }; };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'type').length, 1);
  assert.equal(f.events.includes('closed'), false);
  assert.equal(reveals(f), 1);
  assert.ok(f.statuses.some((status) => status.text === 'Entrando na conta…' && status.nativeClient === true && !status.needsAttention));
});

test('the visible form reports how the Riot interface was opened to the sign-in log', async () => {
  const f = directFixture();
  const logs = [];
  f.options.log = (line) => logs.push(line);
  f.io.authenticate = async () => ({ supported: true, requiresNativeForm: true, reason: 'captcha' });
  f.io.typeCredentials = async (request, signal, log) => {
    assert.equal(signal, f.options.signal);
    log('started the Riot Client with its interface');
    f.state.authorized = true;
    return ['remember:on'];
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(logs.includes('started the Riot Client with its interface'));
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
  assert.equal(reveals(f), 2);
  assert.ok(f.events.lastIndexOf('reveal') < f.events.indexOf('request-launch'));
  assert.equal(f.events.at(-1), 'close-client-window');
});

for (const challenge of [{ type: 'multifactor' }, { type: 'challenge' }, { type: 'auth', error: 'captcha_not_allowed' }]) {
  test(`native ${challenge.error || challenge.type} remains available after the verification expires`, async () => {
    const f = directFixture();
    let typed = false;
    f.io.authenticate = async () => ({ supported: false });
    f.io.typeCredentials = async () => { typed = true; f.events.push(['type', true]); return ['remember:on']; };
    f.io.sessionState = async () => typed ? challenge : { type: 'auth' };
    await assert.rejects(f.run(), (error) => {
      assert.match(error.message, /timed out waiting for your attention/);
      assert.equal(error.needsAttention, true);
      assert.equal(error.nativeClient, true);
      return true;
    });
    assert.equal(reveals(f), 2);
    assert.equal(f.events.at(-1), 'reveal');
    assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'type').length, 1);
    assert.equal(f.events.includes('request-launch'), false);
    assert.equal(f.events.includes('closed'), false);
    assert.equal(f.events.includes('launch'), false);
  });
}

test('a native verification remains recoverable when revealing its existing window fails', async () => {
  const f = directFixture();
  let typed = false;
  f.io.authenticate = async () => ({ supported: false });
  f.io.typeCredentials = async () => { typed = true; return ['remember:on']; };
  f.io.sessionState = async () => ({ type: typed ? 'multifactor' : 'auth' });
  f.io.windows.reveal = async () => { f.events.push('reveal'); if (typed) throw new Error('window-style-denied'); };
  await assert.rejects(f.run(), (error) => {
    assert.equal(error.message, 'window-style-denied');
    assert.equal(error.needsAttention, true);
    assert.equal(error.nativeClient, true);
    return true;
  });
  assert.equal(f.events.at(-1), 'reveal');
  assert.equal(f.events.includes('request-launch'), false);
});

for (const revealFails of [false, true]) {
  test(`a failure right after native entry recovers pending MFA${revealFails ? ' even if window recovery fails' : ''}`, async () => {
    const f = directFixture();
    let typed = false;
    let inspections = 0;
    const logs = [];
    f.options.log = (line) => { logs.push(line); if (line.startsWith('credentials entered')) throw new Error('original failure'); };
    f.io.authenticate = async () => ({ supported: false });
    f.io.typeCredentials = async () => { typed = true; f.events.push(['type', true]); return ['remember:on']; };
    f.io.readAuthenticationState = async () => { inspections++; return { type: 'multifactor' }; };
    f.io.windows.reveal = async () => { f.events.push('reveal'); if (typed && revealFails) throw new Error('recovery failed'); };
    await assert.rejects(f.run(), (error) => {
      assert.equal(error.message, 'original failure');
      assert.equal(error.needsAttention, true);
      assert.equal(error.nativeClient, true);
      return true;
    });
    assert.equal(inspections, 1);
    assert.equal(reveals(f), 2);
    assert.equal(f.events.at(-1), 'reveal');
    assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'type').length, 1);
    assert.equal(f.events.includes('request-launch'), false);
    assert.equal(f.events.includes('closed'), false);
    assert.equal(f.events.includes('launch'), false);
    assert.equal(logs.includes('could not recover the native sign-in verification window'), revealFails);
  });
}

test('an unreadable state during native error recovery keeps the original failure without inventing a challenge', async () => {
  const f = directFixture();
  let inspections = 0;
  f.options.log = (line) => { if (line.startsWith('credentials entered')) throw new Error('original failure'); };
  f.io.authenticate = async () => ({ supported: false });
  f.io.typeCredentials = async () => ['remember:on'];
  f.io.readAuthenticationState = async () => { inspections++; throw new Error('inspection failed'); };
  await assert.rejects(f.run(), (error) => {
    assert.equal(error.message, 'original failure');
    assert.equal(error.needsAttention, undefined);
    assert.equal(error.nativeClient, undefined);
    return true;
  });
  assert.equal(inspections, 1);
  assert.equal(reveals(f), 1);
});

test('cancellation after native entry never inspects or reveals another verification', async () => {
  const f = directFixture();
  const controller = new AbortController();
  f.options.signal = controller.signal;
  f.io.authenticate = async () => ({ supported: false });
  f.io.typeCredentials = async () => { controller.abort(); return ['remember:on']; };
  f.io.readAuthenticationState = async () => { assert.fail('A cancelled operation must not inspect authentication'); };
  await assert.rejects(f.run(), /cancelled/);
  assert.equal(reveals(f), 1);
});

test('a failure after native authentication completes never reopens a newly reported challenge', async () => {
  const f = directFixture();
  f.io.authenticate = async () => ({ supported: false });
  let finished = false;
  let extraInspections = 0;
  f.io.readAuthenticationState = async () => {
    if (finished) extraInspections++;
    return { type: finished ? 'multifactor' : 'authenticated' };
  };
  f.io.requestLaunch = async () => { finished = true; throw new Error('game launch failed'); };
  await assert.rejects(f.run(), (error) => {
    assert.equal(error.message, 'game launch failed');
    assert.equal(error.needsAttention, undefined);
    assert.equal(error.nativeClient, undefined);
    return true;
  });
  assert.equal(extraInspections, 0);
  assert.equal(reveals(f), 1);
  assert.equal(f.events.includes('close-client-window'), false);
});

test('a slow native sign-in preserves manual recovery without automatically revealing the client', async () => {
  const f = directFixture();
  f.io.authenticate = async () => ({ supported: false });
  f.io.typeCredentials = async () => ['remember:on'];
  await assert.rejects(f.run(), (error) => {
    assert.equal(error.needsAttention, true);
    assert.equal(error.nativeClient, true);
    return true;
  });
  assert.equal(reveals(f), 1);
  assert.equal(f.events.includes('request-launch'), false);
});

test('cancelling a revealed native verification clears recovery flags', async () => {
  const f = directFixture();
  const controller = new AbortController();
  let typed = false;
  f.options.signal = controller.signal;
  f.io.authenticate = async () => ({ supported: false });
  f.io.typeCredentials = async () => { typed = true; return ['remember:on']; };
  f.io.sessionState = async () => ({ type: typed ? 'multifactor' : 'auth' });
  const sleep = f.io.sleep;
  f.io.sleep = async (ms) => { await sleep(ms); controller.abort(); };
  await assert.rejects(f.run(), (error) => {
    assert.match(error.message, /cancelled/);
    assert.equal(error.needsAttention, undefined);
    assert.equal(error.nativeClient, undefined);
    return true;
  });
  assert.equal(reveals(f), 2);
  assert.equal(f.events.includes('request-launch'), false);
});

test('a game timeout after native verification does not retain authentication recovery flags', async () => {
  const f = directFixture();
  let typed = false;
  f.state.gameWindow = false;
  f.io.authenticate = async () => ({ supported: false });
  f.io.typeCredentials = async () => { typed = true; return ['remember:on']; };
  f.io.sessionState = async () => ({ type: f.state.authorized ? 'authenticated' : typed ? 'multifactor' : 'auth' });
  f.io.isAuthorized = async () => { if (f.elapsed() >= 1400) f.state.authorized = true; return f.state.authorized; };
  await assert.rejects(f.run(), (error) => {
    assert.match(error.message, /game did not open/);
    assert.equal(error.needsAttention, undefined);
    assert.equal(error.nativeClient, undefined);
    return true;
  });
  assert.ok(f.statuses.some((status) => status.needsAttention && /game is taking longer/i.test(status.text)));
  assert.equal(reveals(f), 2);
  assert.equal(f.events.includes('close-client-window'), false);
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
  f.io.closeEverything = async () => { f.events.push('closed'); f.state.authorized = false; f.state.processes.val = false; return { yaml: null }; };
  const result = await f.run();
  assert.equal(result.reusedCurrentSession, false);
  assert.ok(f.events.indexOf('closed') < f.events.indexOf('visible-interface'));
  assert.ok(f.events.indexOf('visible-interface') < f.events.indexOf('authenticate'));
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
  assert.equal(reveals(f), 1);
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

test('stay signed in off ignores saved sessions, types with remember off and keeps no session', async () => {
  const f = fixture();
  const typed = [];
  f.options.remember = false;
  f.io.closeEverything = async () => { f.events.push('closed'); f.state.authorized = false; return { yaml: null }; };
  f.options.session = () => { throw new Error('Saved sessions must not be read'); };
  f.io.typeCredentials = async (request) => { typed.push(request.remember); f.state.authorized = true; return ['remember:off']; };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(result.usedSavedSession, false);
  assert.equal(result.session, null);
  assert.deepEqual(typed, [false]);
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'write'), false);
});

test('direct sign-in forwards the stay signed in choice and marks every status after authorization', async () => {
  const f = directFixture();
  let options;
  f.options.remember = false;
  f.io.authenticate = async (_account, _signal, value) => { options = value; f.state.authorized = true; return { supported: true }; };
  await f.run();
  assert.deepEqual(options, { remember: false });
  const first = f.statuses.findIndex((status) => status.signedIn === true);
  assert.ok(first > 0);
  assert.equal(f.statuses[first].text, 'Signed in. Preparing the game…');
  assert.ok(f.statuses.slice(0, first).every((status) => status.signedIn !== true));
  assert.ok(f.statuses.slice(first).every((status) => status.signedIn === true));
});

function automaticCheckFixture(checkMs) {
  const f = directFixture();
  const timeline = [];
  let submittedAt = null;
  f.io.authenticate = async () => ({ supported: true, requiresNativeForm: true, reason: 'captcha' });
  f.io.typeCredentials = async () => { submittedAt = f.elapsed(); return ['remember:unknown']; };
  f.io.readAuthenticationState = async () => (submittedAt !== null && f.elapsed() - submittedAt < checkMs ? { type: 'challenge' } : { type: 'auth' });
  f.io.isAuthorized = async () => submittedAt !== null && f.elapsed() - submittedAt >= checkMs;
  f.io.windows.reveal = async () => { if (submittedAt !== null) timeline.push(['reveal', f.elapsed() - submittedAt]); };
  f.options.status = (text, details = {}) => { f.statuses.push({ text, ...details }); if (details.needsAttention) timeline.push(['attention', f.elapsed() - submittedAt]); };
  return { f, timeline };
}

test('a brief automatic Riot check after native credential entry does not ask for attention', async () => {
  const { f, timeline } = automaticCheckFixture(3000);
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.deepEqual(timeline, []);
  assert.equal(f.statuses.some((status) => status.needsAttention), false);
});

test('a Riot check that outlasts the grace period still asks for attention and reveals the native window', async () => {
  const { f, timeline } = automaticCheckFixture(20000);
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  const attention = timeline.find(([kind]) => kind === 'attention');
  assert.ok(attention && attention[1] >= 12000 && attention[1] < 20000);
  assert.ok(timeline.some(([kind]) => kind === 'reveal'));
});

const OUTDATED = { status: 424, errorCode: 'launch_failed_product_not_up_to_date' };

function outdatedFixture(updatedAt) {
  const f = directFixture();
  f.requests = [];
  f.io.requestLaunch = async (game) => {
    f.requests.push(f.elapsed());
    f.events.push('request-launch');
    if (f.elapsed() < updatedAt) return OUTDATED;
    f.state.processes[game === 'val' ? 'val' : 'lol'] = true;
    return { status: 200, errorCode: null };
  };
  return f;
}

test('an outdated game is requested again until the update finishes and then opens', async () => {
  const f = outdatedFixture(300000);
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(f.elapsed() >= 300000);
  assert.ok(f.requests.length > 2);
  for (let i = 1; i < f.requests.length; i += 1) assert.ok(f.requests[i] - f.requests[i - 1] >= 15000);
  assert.ok(f.statuses.some((status) => /waiting for the league of legends update/i.test(status.text) && status.signedIn === true && status.needsAttention === false));
  assert.equal(f.statuses.some((status) => /game is taking longer/i.test(status.text)), false);
});

test('an update that never finishes fails only after the update timeout', async () => {
  const f = outdatedFixture(Infinity);
  await assert.rejects(f.run(), /update did not finish in time/);
  assert.ok(f.elapsed() >= 1200000);
  assert.equal(f.statuses.some((status) => /game is taking longer/i.test(status.text)), false);
});

test('the open deadline counts from the accepted request after an update', async () => {
  const f = outdatedFixture(250000);
  let acceptedAt = null;
  const request = f.io.requestLaunch;
  f.io.requestLaunch = async (game) => {
    const launch = await request(game);
    if (launch.status === 200 && acceptedAt === null) acceptedAt = f.elapsed();
    return launch;
  };
  f.io.windows.gameWindow = async () => acceptedAt !== null && f.elapsed() >= acceptedAt + 100000;
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.ok(f.elapsed() > 180000 + 100000);
  assert.ok(f.statuses.some((status) => status.needsAttention && /game is taking longer/i.test(status.text)));
});

test('a launch refused for another reason is not repeated and keeps the open timeout', async () => {
  const f = directFixture();
  f.state.gameWindow = false;
  f.io.requestLaunch = async () => { f.events.push('request-launch'); return { status: 500, errorCode: 'other' }; };
  await assert.rejects(f.run(), /game did not open/);
  assert.equal(f.events.filter((event) => event === 'request-launch').length, 1);
  assert.ok(f.elapsed() < 200000);
});

function restoreFixture() {
  const f = fixture();
  f.state.authorized = false;
  f.state.launched = false;
  f.io.runningGames = async () => ({ lol: f.state.launched, val: false });
  f.io.launchProduct = async (_exe, game, visible) => { f.events.push(['launch', game, visible]); };
  f.io.authenticate = async () => ({ supported: false });
  f.io.requestLaunch = async () => { f.events.push('request-launch'); f.state.launched = true; return { status: 200 }; };
  const at = (match) => f.events.findIndex((event) => match(event));
  f.index = (name) => at((event) => event === name || (Array.isArray(event) && event[0] === name));
  return f;
}

test('restores a saved session in the background without opening Riot or typing', async () => {
  const f = restoreFixture();
  f.io.launchProduct = async (_exe, game, visible) => { f.events.push(['launch', game, visible]); f.state.authorized = true; };
  const result = await f.run();
  assert.equal(result.usedSavedSession, true);
  assert.equal(result.gameStarted, true);
  assert.equal(result.session, 'token:current');
  assert.deepEqual(f.events.find((event) => Array.isArray(event) && event[0] === 'write'), ['write', 'token:saved']);
  assert.deepEqual(f.events.find((event) => Array.isArray(event) && event[0] === 'launch'), ['launch', undefined, undefined]);
  for (const name of ['visible-interface', 'type', 'DELETE']) assert.equal(f.index(name), -1, name);
  assert.ok(f.index('closed') < f.index('write'));
  assert.ok(f.index('write') < f.index('launch'));
  assert.ok(f.index('launch') < f.index('request-launch'));
  assert.equal(f.events.at(-1), 'close-client-window');
  assert.ok(f.statuses.some((status) => status.text === 'Signing in with the saved session…'));
});

test('falls back to the visible Riot form when the saved session is no longer accepted', async () => {
  const f = restoreFixture();
  const result = await f.run();
  assert.equal(result.sessionRejected, true);
  assert.equal(result.usedSavedSession, false);
  assert.equal(result.gameStarted, true);
  assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'launch').length, 1);
  assert.ok(f.index('launch') < f.index('visible-interface'));
  assert.equal(f.index('DELETE'), -1);
  assert.ok(f.index('visible-interface') < f.index('type'));
  assert.ok(f.index('type') < f.index('request-launch'));
  assert.equal(f.events.at(-1), 'close-client-window');
});

test('closes a restored session of another account normally, hands it over before closing and types the selected one in the visible form', async () => {
  const f = restoreFixture();
  const leaving = [];
  f.io.authorization = async () => (f.state.authorized ? 'yes' : 'no');
  f.options.onRejected = () => f.events.push('rejected');
  f.options.onClosed = (closed) => { leaving.push(closed.yaml); f.events.push('persist-leaving'); };
  f.io.closeEverything = async () => {
    f.events.push('closed');
    const signedIn = f.state.authorized;
    f.state.authorized = false;
    return { signedIn, riotId: signedIn ? f.state.identity : null, yaml: signedIn ? 'token:another-renewed' : null };
  };
  f.io.launchProduct = async (_exe, game, visible) => {
    f.events.push(['launch', game, visible]);
    f.state.authorized = true;
    f.state.identity = { gameName: 'AnotherAccount', tagLine: 'BR1' };
  };
  f.io.typeCredentials = async () => {
    f.events.push(['type', true]);
    f.state.identity = { gameName: account.gameName, tagLine: account.tagLine };
    f.state.authorized = true;
    return ['remember:on'];
  };
  const result = await f.run();
  assert.equal(result.sessionRejected, true);
  assert.equal(result.usedSavedSession, false);
  assert.equal(result.gameStarted, true);
  assert.equal(f.index('DELETE'), -1);
  assert.deepEqual(leaving, [null, 'token:another-renewed']);
  const stripped = f.events.findIndex((event) => Array.isArray(event) && event[0] === 'write' && event[1] === 'stripped');
  assert.equal(f.events.filter((event) => event === 'rejected').length, 1);
  assert.ok(f.index('rejected') < f.events.lastIndexOf('closed'));
  assert.ok(f.events.lastIndexOf('closed') < f.events.lastIndexOf('persist-leaving'));
  assert.ok(f.events.lastIndexOf('persist-leaving') < stripped);
  assert.ok(stripped < f.index('visible-interface'));
  assert.ok(f.index('visible-interface') < f.index('type'));
});

test('an account Riot restores on its own is closed normally before the visible form, never signed out', async () => {
  const f = restoreFixture();
  const leaving = [];
  let opened = 0;
  f.options.hasSavedSession = false;
  f.options.onClosed = (closed) => { leaving.push(closed.yaml); f.events.push('persist-leaving'); };
  f.io.authorization = async () => (f.state.authorized ? 'yes' : 'no');
  f.io.openVisibleInterface = async () => {
    f.events.push('visible-interface');
    if (++opened > 1) return;
    f.state.authorized = true;
    f.state.identity = { gameName: 'AnotherAccount', tagLine: 'BR1' };
  };
  f.io.closeEverything = async () => {
    f.events.push('closed');
    f.state.authorized = false;
    return { signedIn: true, riotId: { gameName: 'AnotherAccount', tagLine: 'BR1' }, yaml: 'token:another' };
  };
  f.io.typeCredentials = async () => {
    f.events.push(['type', true]);
    f.state.identity = { gameName: account.gameName, tagLine: account.tagLine };
    f.state.authorized = true;
    return ['remember:on'];
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(f.index('DELETE'), -1);
  assert.deepEqual(leaving, ['token:another']);
  const reopened = f.events.lastIndexOf('visible-interface');
  assert.ok(f.index('visible-interface') < f.index('closed'));
  assert.ok(f.index('closed') < f.index('persist-leaving'));
  assert.ok(f.index('persist-leaving') < f.index('write'));
  assert.ok(f.index('write') < reopened);
  assert.ok(reopened < f.index('type'));
});

test('an account that stays signed in after a normal close stops the switch without being signed out', async () => {
  const f = restoreFixture();
  f.options.hasSavedSession = false;
  f.io.authorization = async () => 'yes';
  f.io.closeEverything = async () => { f.events.push('closed'); return { signedIn: true, riotId: null, yaml: null }; };
  await assert.rejects(f.run(), /Could not sign out the previous account/);
  assert.equal(f.index('DELETE'), -1);
  assert.equal(f.index('type'), -1);
  assert.equal(f.events.filter((event) => event === 'closed').length, 1);
  assert.equal(f.events.filter((event) => event === 'visible-interface').length, 2);
});

for (const scenario of [
  { label: 'a pending 2FA', state: { type: 'multifactor' }, account: 'no', cleared: true },
  { label: 'a failed attempt', state: { type: 'error', error: 'auth_failure' }, account: 'no', cleared: true },
  { label: 'a clean form', state: { type: 'auth' }, account: 'no', cleared: false },
  { label: 'a pending 2FA with an unreadable account state', state: { type: 'multifactor' }, account: 'unknown', cleared: false },
  { label: 'a pending security check', state: { type: 'challenge' }, account: 'no', cleared: false },
]) {
  test(`the visible form ${scenario.cleared ? 'clears' : 'never clears'} ${scenario.label} left in Riot`, async () => {
    const f = restoreFixture();
    let pending = true;
    f.options.hasSavedSession = false;
    f.io.authorization = async () => scenario.account;
    f.io.sessionState = async () => (f.state.authorized ? { type: 'authenticated' } : pending ? scenario.state : { type: 'auth' });
    f.io.localApi = async (method, endpoint) => { f.events.push([method, endpoint]); pending = false; return { status: 204 }; };
    f.io.typeCredentials = async () => {
      f.events.push(['type', true]);
      pending = false;
      f.state.identity = { gameName: account.gameName, tagLine: account.tagLine };
      f.state.authorized = true;
      return ['remember:on'];
    };
    const result = await f.run();
    assert.equal(result.gameStarted, true);
    if (!scenario.cleared) {
      assert.equal(f.index('DELETE'), -1);
      return;
    }
    assert.deepEqual(f.events[f.index('DELETE')], ['DELETE', '/rso-auth/v1/session']);
    assert.ok(f.index('visible-interface') < f.index('DELETE'));
    assert.ok(f.index('DELETE') < f.index('type'));
  });
}

test('stay signed in off never restarts Riot for a stored session', async () => {
  const f = restoreFixture();
  f.options.remember = false;
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(result.usedSavedSession, false);
  for (const name of ['closed', 'write', 'launch']) assert.equal(f.index(name), -1, name);
  assert.ok(f.index('visible-interface') < f.index('type'));
});

test('an account without a stored session keeps the visible form path', async () => {
  const f = restoreFixture();
  f.options.hasSavedSession = false;
  await f.run();
  for (const name of ['closed', 'write', 'launch']) assert.equal(f.index(name), -1, name);
  assert.ok(f.index('visible-interface') < f.index('type'));
});

test('Riot Client only opens the interface after the background restore', async () => {
  const f = restoreFixture();
  f.options.game = 'riot';
  f.io.launchProduct = async (_exe, game, visible) => { f.events.push(['launch', game, visible]); f.state.authorized = true; };
  const result = await f.run();
  assert.equal(result.clientOpened, true);
  assert.equal(result.usedSavedSession, true);
  for (const name of ['type', 'DELETE', 'request-launch', 'close-client-window']) assert.equal(f.index(name), -1, name);
  assert.ok(f.index('launch') < f.index('visible-interface'));
  assert.equal(f.events.at(-1), 'reveal');
});

test('after a background restore, only a session Riot has renewed is kept, never the copy that was just consumed', async () => {
  const f = restoreFixture();
  const logs = [];
  f.options.log = (line) => logs.push(line);
  f.io.launchProduct = async (_exe, game, visible) => { f.events.push(['launch', game, visible]); f.state.authorized = true; };
  f.io.readSettingsYaml = () => 'token:saved';
  const stale = await f.run();
  assert.equal(stale.usedSavedSession, true);
  assert.equal(stale.session, null);
  assert.ok(logs.includes('Riot has not renewed the restored session yet'));
  const renewed = restoreFixture();
  let reads = 0;
  renewed.io.launchProduct = async (_exe, game, visible) => { renewed.events.push(['launch', game, visible]); renewed.state.authorized = true; };
  renewed.io.readSettingsYaml = () => (++reads < 3 ? 'token:saved' : 'token:renewed');
  assert.equal((await renewed.run()).session, 'token:renewed');
});

test('closes another signed-in account normally, keeping its session, instead of signing it out', async () => {
  const f = restoreFixture();
  f.options.hasSavedSession = false;
  f.state.authorized = true;
  f.state.identity = { gameName: 'AnotherAccount', tagLine: 'BR1' };
  let leaving = null;
  f.options.onClosed = (closed) => { leaving = closed; f.events.push('persist-leaving'); };
  f.io.closeEverything = async () => { f.events.push('closed'); f.state.authorized = false; return { signedIn: true, riotId: { gameName: 'AnotherAccount', tagLine: 'BR1' }, yaml: 'token:other' }; };
  f.io.typeCredentials = async () => {
    f.events.push(['type', true]);
    f.state.identity = { gameName: account.gameName, tagLine: account.tagLine };
    f.state.authorized = true;
    return ['remember:on'];
  };
  const result = await f.run();
  assert.equal(result.gameStarted, true);
  assert.equal(leaving.yaml, 'token:other');
  assert.equal(f.index('DELETE'), -1);
  assert.ok(f.index('closed') < f.index('persist-leaving'));
  assert.ok(f.index('persist-leaving') < f.index('write'));
  assert.deepEqual(f.events.find((event) => Array.isArray(event) && event[0] === 'write'), ['write', 'stripped']);
  assert.ok(f.index('write') < f.index('visible-interface'));
  assert.ok(f.index('visible-interface') < f.index('type'));
});
