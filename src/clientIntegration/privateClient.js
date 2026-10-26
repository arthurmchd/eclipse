// Inspect the physical file without Electron's ASAR cache retaining a handle
// in the manager process after a failed startup or a Riot update.
const fs = process.versions.electron ? require('original-fs') : require('fs');
const path = require('path');
const { spawn: spawnProcess } = require('child_process');
const { readBackend, readBackendCertificate, verifyBackend } = require('./backend');
const { createBootstrapChannel } = require('./bootstrapChannel');
const { isSupportedVersion } = require('./privateHostCore');

function inspectPrivateClient(clientPath, { workspaceRoot = path.resolve(__dirname, '..', '..') } = {}) {
  const directory = path.join(workspaceRoot, '.client-integration', 'private-v1');
  const manifestPath = path.join(directory, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const expectedSource = path.join(path.dirname(clientPath || ''), 'RiotClientElectron', 'resources', 'app.asar');
    if (manifest.mode !== 'private-host' || !isSupportedVersion(manifest.source?.package?.version)
        || (manifest.source.package.version === '142.0.0' && manifest.behavior?.externalMultifactorRecovery !== true)
        || manifest.privacy?.startupArgumentsRedacted !== true || manifest.privacy?.logGuardInstalled !== true
        || path.resolve(manifest.source.path) !== path.resolve(expectedSource)
        || path.resolve(manifest.candidate.path) !== path.join(directory, 'app.asar')
        || !fs.existsSync(manifest.candidate.path)) throw new Error('unsupported');
    return { active: true, mode: 'private', version: manifest.source.package.version, manifestPath, candidatePath: manifest.candidate.path, directory };
  } catch {
    return { active: false, mode: 'private', reason: 'Prepare the private Riot interface before using this experimental launcher' };
  }
}

function createPrivateClient({
  electronPath = process.execPath, workspaceRoot = path.resolve(__dirname, '..', '..'),
  spawn = spawnProcess, encodeToken, ensureBackend, revealOfficial = async () => {},
  readConnection = readBackend, certificate = readBackendCertificate, verify = verifyBackend,
  createChannel = createBootstrapChannel,
  timeoutMs = 45000,
} = {}) {
  if (typeof encodeToken !== 'function' || typeof ensureBackend !== 'function') throw new Error('Private UI controller requires a credential encoder and backend starter');
  let current = null, opening = null, disposed = false;

  function write(command) {
    if (current?.alive && current.transport && !current.transport.destroyed) current.transport.write(`${command}\n`);
  }

  async function open(clientPath) {
    if (disposed) throw new Error('The private Riot interface is shutting down');
    if (opening) return opening;
    if (current?.alive) { write('show'); return { ready: true, mode: 'private', managerConnected: current.managerConnected === true }; }
    opening = (async () => {
      const plan = inspectPrivateClient(clientPath, { workspaceRoot });
      if (!plan.active) throw new Error(plan.reason);
      let entry;
      try {
        await ensureBackend(clientPath);
        if (disposed) throw new Error('The private Riot interface is shutting down');
        const connection = readConnection();
        await verify(connection, certificate(clientPath));
        if (disposed) throw new Error('The private Riot interface is shutting down');
        const encryptedAuthToken = await encodeToken(connection.token);
        connection.token = '';
        if (typeof encryptedAuthToken !== 'string' || !encryptedAuthToken) throw new Error('Could not protect the private UI connection');
        const channel = await createChannel({ timeoutMs });
        entry = { child: null, channel, alive: false, transport: null };
        if (disposed) throw new Error('The private Riot interface is shutting down');
        const child = spawn(electronPath, [path.join(workspaceRoot, 'scripts', 'run-private-riot-host.js'), `--ram-bootstrap-pipe=${channel.path}`], {
          windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        entry.child = child;
        entry.alive = true;
        current = entry;
        return await new Promise((resolve, reject) => {
          let partial = '', settled = false, startupDiagnostic = 'unknown', managerConnected = false;
          const done = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve({ ready: true, mode: 'private', managerConnected });
          };
          const timer = setTimeout(() => {
            child.kill();
            done(new Error('The private Riot interface did not finish loading'));
          }, timeoutMs);
          const receive = (chunk) => {
            partial += chunk;
            if (partial.length > 65536) { child.kill(); done(new Error('Invalid private UI startup response')); return; }
            const lines = partial.split(/\r?\n/); partial = lines.pop();
            for (const line of lines) {
              let response;
              try { response = JSON.parse(line); } catch { continue; }
              if (!response || typeof response !== 'object' || Array.isArray(response)) continue;
              if (response.event === 'ready') {
                if (response.integrationReady !== true) { done(new Error('The private Riot account panel did not load')); continue; }
                managerConnected = response.managerConnected === true;
                entry.managerConnected = managerConnected;
                done();
              }
              if (response.event === 'error') {
                const stages = ['bootstrap', 'validation', 'decryption', 'load-main', 'renderer'];
                const error = new Error('The private Riot interface could not start' + (stages.includes(response.stage) ? ` (${response.stage})` : ''));
                if (response.stage === 'bootstrap') error.diagnostic = {
                  kind: ['Error', 'TypeError', 'SyntaxError', 'ReferenceError'].includes(response.kind) ? response.kind : 'Error',
                  locations: Array.isArray(response.locations) ? response.locations.filter((item) => /^privateHost(?:Core)?\.js:\d+:\d+$/.test(item)).slice(0, 3) : [],
                };
                done(error);
              }
            }
          };
          child.stdout.on('data', () => {});
          // Vendor output can contain connection material. Never forward it.
          child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            if (/Cannot find module|Unable to find Electron app|Cannot find package/.test(text)) startupDiagnostic = 'module-not-found';
            else if (/SyntaxError/.test(text)) startupDiagnostic = 'syntax-error';
            else if (/not allowed in NODE_OPTIONS|bad option/.test(text)) startupDiagnostic = 'unsupported-runtime-option';
            else if (/stdin|stdout|stderr|uv_pipe_open/.test(text)) startupDiagnostic = 'stdio-error';
          });
          child.on('error', () => { entry.alive = false; done(new Error('Could not start the private Riot interface')); });
          child.on('close', (code) => {
            entry.alive = false;
            if (current === entry) current = null;
            channel.close();
            const error = new Error('The private Riot interface closed before loading');
            error.diagnostic = { exitCode: Number.isInteger(code) ? code : null, startup: startupDiagnostic };
            done(error);
          });
          channel.connected.then((socket) => {
            if (settled || !entry.alive || disposed) { socket.destroy(); return; }
            entry.transport = socket;
            socket.setEncoding('utf8');
            socket.on('data', receive);
            socket.on('error', () => done(new Error('The private UI connection was interrupted')));
            socket.on('close', () => done(new Error('The private UI connection closed before loading')));
            socket.write(`${JSON.stringify({
              candidatePath: plan.candidatePath, manifestPath: plan.manifestPath,
              appPort: connection.port, appPid: connection.pid, encryptedAuthToken,
              userDataRoot: path.join(plan.directory, 'user-data'), logDir: path.join(plan.directory, 'logs'),
            })}\n`);
          }, () => done(new Error('The private UI startup channel did not connect')));
        });
      } catch (error) {
        entry?.channel.close();
        if (entry?.alive) entry.child.kill();
        if (current === entry) current = null;
        await revealOfficial().catch(() => {});
        throw error;
      }
    })();
    try { return await opening; }
    finally { opening = null; }
  }

  return {
    open,
    hide() { write('hide'); },
    async stop() {
      disposed = true;
      const entry = current;
      current = null;
      if (!entry?.alive) { entry?.channel.close(); return; }
      try { await new Promise((resolve) => {
        const timer = setTimeout(() => { entry.child.kill(); resolve(); }, 3000);
        entry.child.once('close', () => { clearTimeout(timer); resolve(); });
        if (entry.transport && !entry.transport.destroyed) { entry.transport.write('stop\n'); entry.transport.end(); }
        else { entry.channel.close(); entry.child.kill(); }
      }); } finally { entry.channel.close(); }
    },
  };
}

module.exports = { createPrivateClient, inspectPrivateClient };
