const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createWindowController } = require('../platform/windows/windowController');
const { createSignInFlow } = require('./signInFlow');
const { localAppDataForRiot } = require('../platform/windows/windowsEnvironment');
const { createRiotTransport } = require('./riotTransport');
const { launchClient } = require('./riotProcess');
const { createInterfaceOpener, SHOW_INTERFACE } = require('./riotInterface');
const { createRiotAuthentication } = require('./riotAuthentication');
const { createRiotAppControls } = require('./riotAppControls');
const { windowsHelper } = require('../paths');
const windows = createWindowController();
let selectedClientPath = null;

const PRODUCTS = { lol: 'league_of_legends', tft: 'league_of_legends', val: 'valorant' };
const GAME_PROCESSES = {
  lol: ['LeagueClient.exe', 'LeagueClientUx.exe', 'LeagueClientUxRender.exe', 'League of Legends.exe'],
  val: ['VALORANT.exe', 'VALORANT-Win64-Shipping.exe'],
};
const CLIENT_PROCESSES = ['RiotClientServices.exe', 'Riot Client.exe', 'RiotClientUx.exe', 'RiotClientUxRender.exe'];
const AUTHORIZATION = '/rso-auth/v1/authorization';
const QUIT = '/process-control/v1/process/quit';
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const OWN_TEMP_FILE = /^eclipse-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

const RIOT_DIR = path.join(localAppDataForRiot(), 'Riot Games', 'Riot Client');
const SETTINGS_YAML = path.join(RIOT_DIR, 'Data', 'RiotGamesPrivateSettings.yaml');
const LOGIN_SCRIPT = windowsHelper('login.ps1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detectClientPath(override) {
  if (override && fs.existsSync(override)) return override;
  try {
    const installs = JSON.parse(fs.readFileSync('C:/ProgramData/Riot Games/RiotClientInstalls.json', 'utf8'));
    for (const p of [installs.rc_default, installs.rc_live]) if (p && fs.existsSync(p)) return p;
  } catch {}
  const fallback = 'C:/Riot Games/Riot Client/RiotClientServices.exe';
  return fs.existsSync(fallback) ? fallback : null;
}

function runningProcesses() {
  return new Promise((resolve, reject) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
      if (err) return reject(new Error('Could not check running Riot games. No accounts were switched'));
      resolve(new Set(out.split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, '').toLowerCase())));
    });
  });
}

async function runningGames() {
  const procs = await runningProcesses();
  const any = (list) => list.some((p) => procs.has(p.toLowerCase()));
  return {
    lol: any(GAME_PROCESSES.lol),
    val: any(GAME_PROCESSES.val),
    client: any(CLIENT_PROCESSES),
    clientWindow: any(['Riot Client.exe', 'RiotClientUx.exe']),
  };
}

function taskkill(names) {
  const args = ['/F', '/T'];
  for (const p of names) args.push('/IM', p);
  return new Promise((r) => execFile('taskkill', args, { windowsHide: true }, () => r()));
}

function readText(file, files = fs) {
  try {
    return files.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function removeStaleTemps(dir, files, now, staleMs) {
  let names;
  try {
    names = files.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!OWN_TEMP_FILE.test(String(name))) continue;
    const temp = path.join(dir, String(name));
    try {
      if (now() - files.statSync(temp).mtimeMs > staleMs) files.rmSync(temp, { force: true });
    } catch {}
  }
}

async function replaceFile(file, text, { expected, fs: files = fs, sleep: pause = sleep, attempts = 5, delayMs = 100, now = Date.now, staleMs = 60000 } = {}) {
  const dir = path.dirname(file);
  files.mkdirSync(dir, { recursive: true });
  removeStaleTemps(dir, files, now, staleMs);
  const temp = path.join(dir, `eclipse-${crypto.randomUUID()}.tmp`);
  try {
    files.writeFileSync(temp, text, { flag: 'wx', flush: true });
    for (let attempt = 1; ; attempt++) {
      if (expected !== undefined && readText(file, files) !== expected) return false;
      try {
        files.renameSync(temp, file);
        return true;
      } catch (err) {
        if (!RETRY_CODES.has(err?.code) || attempt >= attempts) throw err;
      }
      await pause(delayMs);
    }
  } finally {
    try { files.rmSync(temp, { force: true }); } catch {}
  }
}

function readSettingsYaml() {
  return readText(SETTINGS_YAML);
}

async function writeSettingsYaml(text, options) {
  try {
    return await replaceFile(SETTINGS_YAML, text, options);
  } catch {
    throw new Error('Could not update the Riot Client settings file');
  }
}

const hasPersistedLogin = (yaml) => /^\s+refresh_token:\s*\S/m.test(yaml || '') || /name:\s*"ssid"/.test(yaml || '');

function stripPersistedLogin(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  const indentOf = (l) => l.match(/^ */)[0].length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s+riot-client:\s*$/.test(line)) {
      const base = indentOf(line);
      out.push(`${' '.repeat(base)}riot-client: null`);
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '' && indentOf(lines[j]) > base) j++;
      i = j - 1;
      continue;
    }
    out.push(line);
    if (!/^\s*cookies:\s*$/.test(line)) continue;
    const base = indentOf(line);
    let j = i + 1;
    let item = null;
    const flush = () => {
      if (item && item.some((l) => /name:\s*"tdid"/.test(l))) out.push(...item);
      item = null;
    };
    for (; j < lines.length; j++) {
      const l = lines[j];
      const ind = indentOf(l);
      if (l.trim() === '') break;
      if (ind < base || (ind === base && !l.trimStart().startsWith('-'))) break;
      if (l.trimStart().startsWith('-') && ind <= base + 4) {
        flush();
        item = [l];
      } else if (item) {
        item.push(l);
      }
    }
    flush();
    i = j - 1;
  }
  return out.join('\n');
}

const SUBJECT = /^[A-Za-z0-9-]{8,100}$/;

function idTokenClaims(yaml) {
  const match = String(yaml || '').match(/^\s+id_token:\s*"?([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*"?\s*$/m);
  if (!match) return null;
  try {
    const claims = JSON.parse(Buffer.from(match[2], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

function persistedSubject(yaml) {
  const fromCookie = cookieSubject(yaml);
  if (fromCookie) return fromCookie;
  const sub = idTokenClaims(yaml)?.sub;
  return typeof sub === 'string' && SUBJECT.test(sub) ? sub : null;
}

function persistedRiotId(yaml) {
  const account = idTokenClaims(yaml)?.acct;
  const gameName = typeof account?.game_name === 'string' ? account.game_name.slice(0, 64) : '';
  const tagLine = typeof account?.tag_line === 'string' ? account.tag_line.slice(0, 16) : '';
  return gameName ? { gameName, tagLine } : null;
}

function cookieSubject(yaml) {
  let base = -1, name = null, value = null, found = null;
  const close = () => {
    if (!found && name === 'sub' && SUBJECT.test(value || '')) found = value;
    base = -1;
    name = value = null;
  };
  for (const line of String(yaml || '').split(/\r?\n/)) {
    const indent = line.match(/^ */)[0].length;
    const item = /^\s*-\s+/.test(line);
    if (item || (base >= 0 && line.trim() && indent <= base)) close();
    if (item) base = indent;
    if (base < 0) continue;
    const field = line.match(/^\s*(?:-\s+)?(name|value):\s*"([^"]*)"\s*$/);
    if (field && field[1] === 'name') name = field[2];
    else if (field) value = field[2];
  }
  close();
  return found;
}

function watchSettings(onChange) {
  const dir = path.dirname(SETTINGS_YAML);
  const prefix = path.basename(SETTINGS_YAML, '.yaml').toLowerCase();
  try {
    const watcher = fs.watch(dir, (_type, file) => {
      if (!file || String(file).toLowerCase().startsWith(prefix)) onChange();
    });
    watcher.on('error', () => {});
    return watcher;
  } catch {
    return null;
  }
}

function watchLockfile(onChange) {
  try {
    const watcher = fs.watch(path.join(RIOT_DIR, 'Config'), (_type, file) => {
      if (!file || String(file).toLowerCase() === 'lockfile') onChange();
    });
    watcher.on('error', () => {});
    return watcher;
  } catch {
    return null;
  }
}

const accepted = (response) => Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;

async function showInterface() {
  try {
    return accepted(await localApi('POST', SHOW_INTERFACE));
  } catch {
    return false;
  }
}

const sameRiotId = (a, b) =>
  Boolean(a && b && a.gameName && b.gameName) &&
  a.gameName.toLowerCase() === b.gameName.toLowerCase() &&
  (a.tagLine || '').toLowerCase() === (b.tagLine || '').toLowerCase();

const localApi = createRiotTransport({ clientPath: () => selectedClientPath || detectClientPath() });
const authentication = createRiotAuthentication({ request: localApi });
const appControls = createRiotAppControls({ request: localApi });

async function sessionState() {
  try {
    return await authentication.sessionState();
  } catch {
    return null;
  }
}

function authorizationOf(response) {
  if (response?.status === 200) return 'yes';
  if (response?.status === 404) return 'no';
  return 'unknown';
}

async function authorization() {
  try {
    return authorizationOf(await localApi('GET', AUTHORIZATION));
  } catch {
    return 'unknown';
  }
}

async function isAuthorized() {
  return (await authorization()) === 'yes';
}

async function activeRiotId() {
  try {
    const a = (await localApi('GET', '/player-account/aliases/v1/active')).json || {};
    const gameName = a.game_name || a.gameName;
    return gameName ? { gameName, tagLine: a.tag_line || a.tagLine || '' } : null;
  } catch {
    return null;
  }
}

async function waitFor(fn, timeoutMs, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs);
  }
  return null;
}

function createCloseEverything({ runningGames, authorization, activeRiotId, localApi, taskkill, readSettingsYaml, waitFor }) {
  return async function closeEverything(log) {
    const info = { signedIn: false, riotId: null, yaml: null };
    const running = await runningGames();
    const state = running.client ? await authorization() : 'no';
    if (state === 'yes') {
      info.signedIn = true;
      info.riotId = await activeRiotId();
    }
    await taskkill([...GAME_PROCESSES.lol, ...GAME_PROCESSES.val]);
    if (state !== 'no') {
      if (accepted(await localApi('POST', QUIT).catch(() => null))) {
        const quit = await waitFor(async () => !(await runningGames()).client, 10000);
        log(quit ? 'Riot Client quit normally' : 'Riot Client did not quit in 10 s, forcing');
      } else {
        log('Riot Client did not accept the quit request, forcing');
      }
    }
    await taskkill(CLIENT_PROCESSES);
    const gone = await waitFor(async () => {
      const s = await runningGames();
      return !s.lol && !s.val && !s.client;
    }, 10000, 250);
    if (!gone) throw new Error('Could not close the Riot Client');
    info.yaml = readSettingsYaml();
    return info;
  };
}

const closeEverything = createCloseEverything({ runningGames, authorization, activeRiotId, localApi, taskkill, readSettingsYaml, waitFor });

function runWindowScript(request, onLine = () => {}, signal) {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', LOGIN_SCRIPT], {
    windowsHide: true,
  });
  const promise = new Promise((resolve, reject) => {
    const cancelled = () => { ps.kill(); reject(new Error('Sign-in cancelled')); };
    const timer = setTimeout(() => { ps.kill(); reject(new Error('The Riot Client sign-in form did not respond')); }, 90000);
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) cancelled();
    let out = '';
    let pending = '';
    ps.stdout.on('data', (c) => {
      out += c;
      pending += c;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      lines.forEach((l) => l && onLine(l));
    });
    ps.stderr.on('data', (c) => (out += c));
    ps.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      reject(err);
    });
    ps.stdin.on('error', reject);
    ps.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      const lines = out.trim().split(/\r?\n/);
      const last = lines[lines.length - 1] || `exit code ${code}`;
      if (code === 0 && last === 'ok') resolve(lines);
      else if (out.includes('error:window-not-found')) reject(new Error('The Riot Client window did not open'));
      else if (out.includes('error:form-not-ready')) reject(new Error('The Riot Client sign-in screen did not load. Finish signing in there'));
      else if (out.includes('error:focus')) reject(new Error('Could not bring the Riot Client to the front'));
      else reject(new Error(`Riot Client window script failed: ${last}`));
    });
  });
  promise.catch(() => {});
  ps.stdin.end(JSON.stringify(request));
  return { promise, kill: () => ps.kill() };
}

function launchProduct(exe, game, visible = false) {
  return launchClient(exe, { visible });
}

async function openClient(clientPath) {
  const exe = detectClientPath(clientPath);
  if (!exe) throw new Error('Riot Client not found. Set its path in Settings');
  selectedClientPath = exe;
  await windows.reveal();
  if (!(await runningGames()).clientWindow) await openInterface({ exe, visible: true });
}

function createClientStarter({ detectClientPath: detect, runningGames: running, reveal, launchClient: launch, select = () => {} }) {
  return async function startClient(clientPath) {
    const exe = detect(clientPath);
    if (!exe) throw new Error('Riot Client not found. Set its path in Settings');
    if ((await running()).client) return false;
    select(exe);
    await reveal();
    if ((await running()).client) return false;
    await launch(exe, { visible: true, interfaceRequired: true });
    return true;
  };
}

const startClient = createClientStarter({
  detectClientPath, runningGames, launchClient,
  reveal: () => windows.reveal(),
  select: (exe) => { selectedClientPath = exe; },
});

async function requestLaunch(game, log) {
  const base = `/product-launcher/v1/products/${PRODUCTS[game]}/patchlines/live`;
  const eligibility = await localApi('GET', `${base}/eligibility`).catch(() => null);
  if (eligibility) log(`launch eligibility: HTTP ${eligibility.status} ${JSON.stringify(eligibility.json).slice(0, 300)}`);
  const r = await localApi('POST', base, null, 30000).catch((err) => ({ status: 0, json: err.message }));
  log(`launch request: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  const errorCode = typeof r.json?.errorCode === 'string' ? r.json.errorCode.slice(0, 100) : null;
  return { status: r.status, errorCode };
}

const openInterface = createInterfaceOpener({
  runningGames, localApi, launchClient, waitFor,
  stopClient: () => taskkill(CLIENT_PROCESSES),
});

const signIn = createSignInFlow({
  detectClientPath: (override) => {
    const exe = detectClientPath(override);
    if (exe) selectedClientPath = exe;
    return exe;
  }, closeEverything, readSettingsYaml, writeSettingsYaml,
  hasPersistedLogin, stripPersistedLogin, sameRiotId, sessionState,
  readAuthenticationState: authentication.sessionState,
  isAuthorized, authorization, activeRiotId, localApi, launchProduct, requestLaunch,
  authenticate: authentication.authenticate,
  typeCredentials: async (request, signal, log) => {
    await openInterface({ exe: selectedClientPath || detectClientPath(), visible: !request.hide, signal, log });
    if (signal?.aborted) throw new Error('Sign-in cancelled');
    return runWindowScript(request, () => {}, signal).promise;
  },
  windows, runningGames,
  openVisibleInterface: (exe, signal, log) => openInterface({ exe, visible: true, signal, log }),
  closeGames: () => taskkill([...GAME_PROCESSES.lol, ...GAME_PROCESSES.val]),
});

module.exports = {
  signIn, runningGames, detectClientPath, hasPersistedLogin, stripPersistedLogin, persistedSubject, persistedRiotId, sameRiotId,
  readSettingsYaml, writeSettingsYaml, replaceFile, authorizationOf, createCloseEverything, createClientStarter,
  watchSettings, watchLockfile, sessionState, showInterface,
  clientRunning: async () => (await runningGames()).client,
  isAuthorized,
  authorization,
  quitClient: () => localApi('POST', QUIT).catch(() => null),
  startClient,
  openClient,
  readLoginScreenState: signal => authentication.loginScreenState(signal),
  closeClient: () => appControls.close(),
  dispose: () => windows.stop(),
};
