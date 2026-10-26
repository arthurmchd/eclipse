// Drives the Riot Client: close it, reopen it, sign the right account in and
// launch the game. Sign-in state is read from the client's local API, whose
// port and password are in its lockfile.
//
// Switching accounts reuses the client's own "Stay signed in": after an account
// signs in once with it ticked, the client's RiotGamesPrivateSettings.yaml holds
// that login. The app keeps a copy per account and puts it back before starting
// the client, which then signs in by itself with no window or typing. When a
// copy is missing or expired, the credentials are typed into the client.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createWindowController } = require('./windowController');
const { createSignInFlow } = require('./signInFlow');
const { localAppDataForRiot } = require('./windowsEnvironment');
const { createRiotTransport } = require('./riotTransport');
const { launchClient } = require('./riotProcess');
const { createRiotAuthentication } = require('./riotAuthentication');
const windows = createWindowController();
let selectedClientPath = null;

const PRODUCTS = { lol: 'league_of_legends', tft: 'league_of_legends', val: 'valorant' };
const GAME_PROCESSES = {
  lol: ['LeagueClient.exe', 'LeagueClientUx.exe', 'LeagueClientUxRender.exe', 'League of Legends.exe'],
  val: ['VALORANT.exe', 'VALORANT-Win64-Shipping.exe'],
};
const CLIENT_PROCESSES = ['RiotClientServices.exe', 'Riot Client.exe', 'RiotClientUx.exe', 'RiotClientUxRender.exe'];

const RIOT_DIR = path.join(localAppDataForRiot(), 'Riot Games', 'Riot Client');
const SETTINGS_YAML = path.join(RIOT_DIR, 'Data', 'RiotGamesPrivateSettings.yaml');
const LOGIN_SCRIPT = path.join(__dirname, 'login.ps1').replace('app.asar', 'app.asar.unpacked');

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

// ---- processes --------------------------------------------------------------

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
    // The client's window; RiotClientServices runs in the background without it.
    clientWindow: any(['Riot Client.exe', 'RiotClientUx.exe']),
  };
}

function taskkill(names) {
  const args = ['/F', '/T'];
  for (const p of names) args.push('/IM', p);
  return new Promise((r) => execFile('taskkill', args, { windowsHide: true }, () => r()));
}

// ---- Riot Client settings file ------------------------------------------------

function readSettingsYaml() {
  try {
    return fs.readFileSync(SETTINGS_YAML, 'utf8');
  } catch {
    return null;
  }
}

function writeSettingsYaml(text) {
  fs.mkdirSync(path.dirname(SETTINGS_YAML), { recursive: true });
  fs.writeFileSync(SETTINGS_YAML, text);
}

// What signs the client in on its own: a refresh token under
// psl.authorization.riot-client (Riot Client v141), or an "ssid" cookie (older).
const hasPersistedLogin = (yaml) => /^\s+refresh_token:\s*\S/m.test(yaml || '') || /name:\s*"ssid"/.test(yaml || '');

// Removes the remembered login, keeping only the device id (tdid) so Riot still
// recognises this computer: psl.authorization.riot-client becomes null and
// riot-login.persist.session.cookies keeps only the tdid cookie.
function stripPersistedLogin(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  const indentOf = (l) => l.match(/^ */)[0].length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s+riot-client:\s*$/.test(line)) {
      // A mapping follows (the stored tokens); replace it with null.
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
    // List items sit at the same indent as "cookies:" (or deeper), each starting with "-".
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

const sameRiotId = (a, b) =>
  Boolean(a && b && a.gameName && b.gameName) &&
  a.gameName.toLowerCase() === b.gameName.toLowerCase() &&
  (a.tagLine || '').toLowerCase() === (b.tagLine || '').toLowerCase();

// ---- local API ----------------------------------------------------------------

const localApi = createRiotTransport({ clientPath: () => selectedClientPath || detectClientPath() });
const authentication = createRiotAuthentication({ request: localApi });

async function sessionState() {
  try {
    return await authentication.sessionState();
  } catch {
    return null;
  }
}

// 404 while signed out, 200 once a Riot account is signed in.
async function isAuthorized() {
  try {
    return (await localApi('GET', '/rso-auth/v1/authorization')).status === 200;
  } catch {
    return false;
  }
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

// Closes the games and the Riot Client. A signed-in client is asked to quit
// normally first, so it writes its latest session to disk. Returns who was
// signed in and the settings file as it was left.
async function closeEverything(log) {
  const info = { signedIn: false, riotId: null, yaml: null };
  const running = await runningGames();
  if (running.client && (await isAuthorized())) {
    info.signedIn = true;
    info.riotId = await activeRiotId();
  }
  await taskkill([...GAME_PROCESSES.lol, ...GAME_PROCESSES.val]);
  if (info.signedIn) {
    await localApi('POST', '/process-control/v1/process/quit').catch(() => {});
    const quit = await waitFor(async () => !(await runningGames()).client, 10000);
    log(quit ? 'Riot Client quit normally' : 'Riot Client did not quit in 10 s, forcing');
  }
  await taskkill(CLIENT_PROCESSES);
  const gone = await waitFor(async () => {
    const s = await runningGames();
    return !s.lol && !s.val && !s.client;
  }, 10000, 250);
  if (!gone) throw new Error('Could not close the Riot Client');
  info.yaml = readSettingsYaml();
  return info;
}

// ---- window script ------------------------------------------------------------

// Runs login.ps1 with one JSON request on stdin. Returns { promise, kill };
// the promise resolves with the script's output lines. onLine sees each line
// as it is printed.
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
  if (!(await runningGames()).clientWindow) await launchProduct(exe, null, true);
}

async function ensureBackgroundClient(clientPath) {
  const exe = detectClientPath(clientPath);
  if (!exe) throw new Error('Riot Client not found. Set its path in Settings');
  selectedClientPath = exe;
  await windows.hide();
  if (!(await runningGames()).client) await launchProduct(exe);
  if (!(await waitFor(sessionState, 45000))) throw new Error('The Riot background service did not become ready');
  return exe;
}

// Asks the signed-in client to start the game, logging why if it refuses
// (for example while the game still needs an update).
async function requestLaunch(game, log) {
  const base = `/product-launcher/v1/products/${PRODUCTS[game]}/patchlines/live`;
  const eligibility = await localApi('GET', `${base}/eligibility`).catch(() => null);
  if (eligibility) log(`launch eligibility: HTTP ${eligibility.status} ${JSON.stringify(eligibility.json).slice(0, 300)}`);
  const r = await localApi('POST', base, null, 30000).catch((err) => ({ status: 0, json: err.message }));
  log(`launch request: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
}

const signIn = createSignInFlow({
  detectClientPath: (override) => {
    const exe = detectClientPath(override);
    if (exe) selectedClientPath = exe;
    return exe;
  }, closeEverything, readSettingsYaml, writeSettingsYaml,
  hasPersistedLogin, stripPersistedLogin, sameRiotId, sessionState,
  readAuthenticationState: authentication.sessionState,
  isAuthorized, activeRiotId, localApi, launchProduct, requestLaunch,
  authenticate: authentication.authenticate,
  typeCredentials: async (request, signal) => {
    if (signal?.aborted) throw new Error('Sign-in cancelled');
    // Only an unavailable direct-login API uses this compatibility route.
    // The guard is already armed; opening a window is unnecessary otherwise.
    if (!(await runningGames()).clientWindow) {
      if (signal?.aborted) throw new Error('Sign-in cancelled');
      await launchClient(selectedClientPath || detectClientPath(), { visible: !request.hide, interfaceRequired: true });
    }
    if (signal?.aborted) throw new Error('Sign-in cancelled');
    return runWindowScript(request, () => {}, signal).promise;
  },
  windows, runningGames,
});

module.exports = {
  signIn, runningGames, detectClientPath, hasPersistedLogin, stripPersistedLogin, sameRiotId,
  showClient: () => openClient(selectedClientPath || detectClientPath()),
  openClient,
  ensureBackgroundClient,
  dispose: () => windows.stop(),
};
