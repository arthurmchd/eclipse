const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { persistedSubject, persistedRiotId, hasPersistedLogin, stripPersistedLogin, replaceFile, authorizationOf, createCloseEverything, createClientStarter } = require('../../src/riot/riotClient');

const cookie = (name, value, domain = 'auth.riotgames.com') => [
  `            -   domain: "${domain}"`,
  '                hostOnly: true',
  '                httpOnly: true',
  `                name: "${name}"`,
  '                path: "/"',
  '                persistent: true',
  '                secureOnly: true',
  `                value: "${value}"`,
];
const subject = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const remembered = [
  'psl:',
  '    authorization:',
  '        riot-client:',
  '            refresh_token: "synthetic-refresh"',
  'riot-login:',
  '    persist:',
  '        region: "BR"',
  '        session:',
  '            cookies:',
  ...cookie('tdid', 'synthetic-device', 'riotgames.com'),
  ...cookie('ssid', 'synthetic-session'),
  ...cookie('sub', subject),
  'rso-authenticator:',
  '    tdid:',
  '        domain: "riotgames.com"',
  '        name: "tdid"',
  '        value: "synthetic-device"',
].join('\n');

test('the subject of a remembered Riot login comes only from its sub cookie', () => {
  assert.equal(persistedSubject(remembered), subject);
  assert.equal(persistedSubject(remembered.replace(/\n/g, '\r\n')), subject);
  for (const value of [null, '', 'riot-login: null', stripPersistedLogin(remembered)]) assert.equal(persistedSubject(value), null);
});

test('a sub outside the cookie list or with an unexpected format is not trusted', () => {
  const outside = ['other:', '    name: "sub"', `    value: "${subject}"`].join('\n');
  assert.equal(persistedSubject(outside), null);
  const strange = remembered.replace(`value: "${subject}"`, 'value: "../../etc"');
  assert.equal(persistedSubject(strange), null);
  const trailing = ['cookies:', ...cookie('tdid', 'x'), 'after:', '    name: "sub"', `    value: "${subject}"`].join('\n');
  assert.equal(persistedSubject(trailing), null);
});

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (claims) => `${encode({ kid: 's1', typ: 'JWT', alg: 'RS256' })}.${encode(claims)}.c2lnbmF0dXJl`;
const tokenSubject = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
const current = (token) => [
  'psl:',
  '    authorization:',
  '        riot-client:',
  '            claims: {}',
  `            id_token: "${token}"`,
  '            refresh_token: "synthetic-refresh"',
  '            scopes:',
  '            - "openid"',
  'riot-login:',
  '    persist:',
  '        session:',
  '            cookies:',
  ...cookie('tdid', 'synthetic-device', 'riotgames.com'),
].join('\r\n');

test('the current Riot format without a sub cookie identifies the account by its id token', () => {
  const yaml = current(idToken({ sub: tokenSubject, acct: { game_name: 'Example Name', tag_line: 'BR1' }, iss: 'https://auth.riotgames.com' }));
  assert.equal(hasPersistedLogin(yaml), true);
  assert.equal(persistedSubject(yaml), tokenSubject);
  assert.deepEqual(persistedRiotId(yaml), { gameName: 'Example Name', tagLine: 'BR1' });
  const cleared = stripPersistedLogin(yaml);
  assert.equal(hasPersistedLogin(cleared), false);
  assert.equal(persistedSubject(cleared), null);
  assert.equal(persistedRiotId(cleared), null);
  assert.equal(persistedSubject(`${remembered}\n${current(idToken({ sub: tokenSubject }))}`), subject);
});

test('an unreadable id token or claims of the wrong shape identify nobody', () => {
  for (const token of ['not-a-token', 'a.b.c', `${encode({})}.${Buffer.from('[1]').toString('base64url')}.x`, idToken({ sub: '../../x', acct: { game_name: 7 } }), idToken({ acct: {} })]) {
    const yaml = current(token);
    assert.equal(persistedSubject(yaml), null, token);
    assert.equal(persistedRiotId(yaml), null, token);
  }
});

test('clearing a remembered login keeps only the device cookie', () => {
  assert.equal(hasPersistedLogin(remembered), true);
  const cleared = stripPersistedLogin(remembered);
  assert.equal(hasPersistedLogin(cleared), false);
  assert.match(cleared, /riot-client: null/);
  assert.match(cleared, /name: "tdid"/);
  for (const secret of ['synthetic-refresh', 'synthetic-session', subject]) assert.equal(cleared.includes(secret), false);
});

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(__dirname, 'riot-settings-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(__dirname));
    assert.ok(path.basename(dir).startsWith('riot-settings-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const temporaries = (dir) => fs.readdirSync(dir).filter((name) => name.startsWith('eclipse-'));
const failing = (code) => Object.assign(new Error(code), { code });

test('the Riot settings are replaced whole through a temporary file in the same folder', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'Data', 'RiotGamesPrivateSettings.yaml');
  const renames = [];
  const files = { ...fs, renameSync: (from, to) => { renames.push([from, to]); return fs.renameSync(from, to); } };
  assert.equal(await replaceFile(file, 'first', { fs: files }), true);
  assert.equal(await replaceFile(file, 'second', { fs: files }), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  assert.equal(renames.length, 2);
  for (const [from, to] of renames) {
    assert.equal(path.dirname(from), path.dirname(file));
    assert.match(path.basename(from), /^eclipse-[0-9a-f-]{36}\.tmp$/);
    assert.equal(path.basename(from).toLowerCase().startsWith('riotgamesprivatesettings'), false);
    assert.equal(to, file);
  }
  assert.deepEqual(temporaries(path.dirname(file)), []);
});

test('a Riot settings file that changed since it was read is left as Riot wrote it', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'RiotGamesPrivateSettings.yaml');
  fs.writeFileSync(file, 'renewed by Riot');
  assert.equal(await replaceFile(file, 'stripped', { expected: 'read before' }), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'renewed by Riot');
  assert.equal(await replaceFile(file, 'stripped', { expected: 'renewed by Riot' }), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'stripped');
  assert.deepEqual(temporaries(dir), []);
});

test('a Riot settings file in use is tried again, and a Riot write during the wait wins', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'RiotGamesPrivateSettings.yaml');
  fs.writeFileSync(file, 'original');
  let busy = 2;
  const files = { ...fs, renameSync: (from, to) => { if (busy-- > 0) throw failing('EBUSY'); return fs.renameSync(from, to); } };
  const pauses = [];
  assert.equal(await replaceFile(file, 'stripped', { fs: files, sleep: async (ms) => { pauses.push(ms); } }), true);
  assert.deepEqual(pauses, [100, 100]);
  assert.equal(fs.readFileSync(file, 'utf8'), 'stripped');
  busy = 1;
  const written = await replaceFile(file, 'stripped again', { fs: files, expected: 'stripped', sleep: async () => { fs.writeFileSync(file, 'renewed by Riot'); } });
  assert.equal(written, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'renewed by Riot');
  assert.deepEqual(temporaries(dir), []);
});

test('a failed replacement keeps the Riot settings and leaves no temporary file', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'RiotGamesPrivateSettings.yaml');
  fs.writeFileSync(file, 'original');
  let tries = 0;
  const locked = { ...fs, renameSync: () => { tries++; throw failing('EPERM'); } };
  await assert.rejects(replaceFile(file, 'new', { fs: locked, sleep: async () => {} }), { code: 'EPERM' });
  assert.equal(tries, 5);
  tries = 0;
  const missing = { ...fs, renameSync: () => { tries++; throw failing('ENOENT'); } };
  await assert.rejects(replaceFile(file, 'new', { fs: missing, sleep: async () => {} }), { code: 'ENOENT' });
  assert.equal(tries, 1);
  const full = { ...fs, writeFileSync: (target) => { fs.writeFileSync(target, 'part'); throw failing('ENOSPC'); } };
  await assert.rejects(replaceFile(file, 'new', { fs: full }), { code: 'ENOSPC' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.deepEqual(temporaries(dir), []);
});

test('only old temporary files of Eclipse are removed from the Riot folder', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'RiotGamesPrivateSettings.yaml');
  const old = 'eclipse-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.tmp';
  const recent = 'eclipse-1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e.tmp';
  const others = ['RiotGamesPrivateSettings.yaml.tmp', 'eclipse-notes.tmp', 'other.tmp'];
  for (const name of [old, recent, ...others]) fs.writeFileSync(path.join(dir, name), 'x');
  const now = Date.now();
  fs.utimesSync(path.join(dir, old), new Date(now - 120000), new Date(now - 120000));
  assert.equal(await replaceFile(file, 'new', { now: () => now }), true);
  const names = fs.readdirSync(dir);
  assert.equal(names.includes(old), false);
  for (const name of [recent, ...others, 'RiotGamesPrivateSettings.yaml']) assert.ok(names.includes(name), name);
});

test('the Riot account state reads 200 as signed in, 404 as signed out and anything else as unknown', () => {
  assert.equal(authorizationOf({ status: 200 }), 'yes');
  assert.equal(authorizationOf({ status: 404 }), 'no');
  for (const response of [{ status: 401 }, { status: 204 }, { status: 500 }, {}, null, undefined]) assert.equal(authorizationOf(response), 'unknown');
});

const QUIT = ['POST', '/process-control/v1/process/quit'];

function closer({ state = 'yes', client = true, quit = { status: 204 }, quits = true, stays = false } = {}) {
  const events = [], logs = [];
  const processes = { client, lol: true, val: false };
  let waits = 0;
  const close = createCloseEverything({
    runningGames: async () => ({ ...processes }),
    authorization: async () => { events.push('authorization?'); return state; },
    activeRiotId: async () => { events.push('identity?'); return { gameName: 'Leaving', tagLine: 'BR1' }; },
    localApi: async (method, endpoint) => {
      events.push([method, endpoint]);
      if (quit instanceof Error) throw quit;
      if (quits) processes.client = false;
      return quit;
    },
    taskkill: async (names) => {
      const games = names.includes('League of Legends.exe');
      events.push(games ? 'kill-games' : 'kill-riot');
      if (games) processes.lol = processes.val = false;
      else if (!stays) processes.client = false;
    },
    readSettingsYaml: () => { events.push('read'); return 'token:leaving'; },
    waitFor: async (fn) => { waits++; return (await fn()) || null; },
  });
  return { events, logs, waits: () => waits, run: () => close((line) => logs.push(line)) };
}

test('a signed-in Riot gets the normal quit after the games close, and is forced only afterwards', async () => {
  const f = closer();
  assert.deepEqual(await f.run(), { signedIn: true, riotId: { gameName: 'Leaving', tagLine: 'BR1' }, yaml: 'token:leaving' });
  assert.deepEqual(f.events, ['authorization?', 'identity?', 'kill-games', QUIT, 'kill-riot', 'read']);
  assert.deepEqual(f.logs, ['Riot Client quit normally']);
});

test('a Riot whose account state cannot be read still gets the normal quit, without a Riot ID', async () => {
  const f = closer({ state: 'unknown' });
  const info = await f.run();
  assert.equal(info.signedIn, false);
  assert.equal(info.riotId, null);
  assert.deepEqual(f.events, ['authorization?', 'kill-games', QUIT, 'kill-riot', 'read']);
  assert.deepEqual(f.logs, ['Riot Client quit normally']);
});

test('a Riot without an account and a closed Riot are never asked to quit', async () => {
  const signedOut = closer({ state: 'no' });
  assert.equal((await signedOut.run()).signedIn, false);
  assert.deepEqual(signedOut.events, ['authorization?', 'kill-games', 'kill-riot', 'read']);
  assert.deepEqual(signedOut.logs, []);
  const closed = closer({ client: false });
  await closed.run();
  assert.deepEqual(closed.events, ['kill-games', 'kill-riot', 'read']);
});

for (const refusal of [{ label: 'an error', quit: new Error('offline') }, { label: 'a refusal', quit: { status: 404 } }]) {
  test(`a quit request answered with ${refusal.label} is forced at once instead of waiting`, async () => {
    const f = closer({ quit: refusal.quit, quits: false });
    await f.run();
    assert.deepEqual(f.logs, ['Riot Client did not accept the quit request, forcing']);
    assert.equal(f.waits(), 1);
    assert.deepEqual(f.events.slice(-2), ['kill-riot', 'read']);
  });
}

test('a Riot that does not quit is forced after the wait, and one that will not close stops the switch', async () => {
  const slow = closer({ quits: false });
  await slow.run();
  assert.deepEqual(slow.logs, ['Riot Client did not quit in 10 s, forcing']);
  assert.equal(slow.waits(), 2);
  const stuck = closer({ quits: false, stays: true });
  await assert.rejects(stuck.run(), /Could not close the Riot Client/);
  assert.equal(stuck.events.includes('read'), false);
});

function starter({ exe = 'riot-client.exe', running = [false] } = {}) {
  const events = [], states = [...running];
  const startClient = createClientStarter({
    detectClientPath: (override) => { events.push(['detect', override]); return exe; },
    runningGames: async () => { events.push('processes?'); return { client: states.length > 1 ? states.shift() : states[0] }; },
    reveal: async () => { events.push('reveal'); },
    launchClient: async (file, options) => { events.push(['launch', file, options]); },
    select: (file) => { events.push(['select', file]); },
  });
  return { events, startClient };
}

test('a closed Riot is started with its interface, after its window is brought to the front', async () => {
  const f = starter();
  assert.equal(await f.startClient('custom-client.exe'), true);
  assert.deepEqual(f.events, [
    ['detect', 'custom-client.exe'], 'processes?', ['select', 'riot-client.exe'], 'reveal', 'processes?',
    ['launch', 'riot-client.exe', { visible: true }],
  ]);
});

test('a running Riot, or one that starts meanwhile, is never started again, closed or restarted', async () => {
  const running = starter({ running: [true] });
  assert.equal(await running.startClient(), false);
  assert.deepEqual(running.events.filter((event) => typeof event === 'string'), ['processes?']);
  assert.equal(running.events.some((event) => Array.isArray(event) && event[0] === 'launch'), false);
  const racing = starter({ running: [false, true] });
  assert.equal(await racing.startClient(), false);
  assert.equal(racing.events.some((event) => Array.isArray(event) && event[0] === 'launch'), false);
  const missing = starter({ exe: null });
  await assert.rejects(missing.startClient(), /Riot Client not found/);
  assert.deepEqual(missing.events, [['detect', undefined]]);
});
