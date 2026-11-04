const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createPrivateClient, inspectPrivateClient } = require('../../src/integration/privateClient');
const { PRIVATE_HOST_ENTRY } = require('../../src/paths');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const syntheticToken = 'synthetic-connection-token-for-tests-only';
const encryptedToken = Buffer.from('synthetic-DPAPI-ciphertext-only').toString('base64');

function fixture(t, options = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(__dirname, '.private-client-'));
  const directory = path.join(workspaceRoot, '.client-integration', 'private-v1');
  const clientPath = path.join(workspaceRoot, 'official-fixture', 'RiotClientServices.exe');
  const candidatePath = path.join(directory, 'app.asar');
  const manifestPath = path.join(directory, 'manifest.json');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(candidatePath, 'fake candidate; never executed');
  const manifest = {
    mode: 'private-host',
    privacy: { startupArgumentsRedacted: true, logGuardInstalled: true },
    behavior: { fullManagerInClient: true },
    source: { path: path.join(path.dirname(clientPath), 'RiotClientElectron', 'resources', 'app.asar'), package: { version: '141.0.0' } },
    candidate: { path: candidatePath },
  };
  const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  saveManifest();
  const children = [], calls = [], events = [], channels = [];
  const createChannel = async () => {
    const socket = new PassThrough();
    const channel = { path: `\\\\.\\pipe\\riot-accounts-${'a'.repeat(32)}`, socket, connected: Promise.resolve(socket), close: () => socket.destroy() };
    channels.push(channel);
    return channel;
  };
  const connection = { port: 54321, pid: 12345, token: syntheticToken };
  const cert = Buffer.from('synthetic embedded certificate');
  let reveals = 0;
  const spawn = (...args) => {
    calls.push(args);
    events.push('spawn');
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.transport = channels.at(-1).socket;
    child.input = [];
    child.kills = 0;
    child.exited = false;
    let pending = '';
    child.transport.on('data', (bytes) => {
      pending += bytes.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop();
      child.input.push(...lines);
    });
    child.reply = (response) => child.transport.write(`${JSON.stringify(response)}\n`);
    child.close = (code = 0) => {
      if (child.exited) return;
      child.exited = true;
      child.emit('close', code);
    };
    child.kill = () => {
      child.kills++;
      if (options.closeOnKill !== false) child.close(1);
      return true;
    };
    child.transport.on('finish', () => {
      if (options.closeOnEnd !== false) queueMicrotask(() => child.close());
    });
    children.push(child);
    return child;
  };
  const controller = createPrivateClient({
    workspaceRoot,
    electronPath: path.join(workspaceRoot, 'fake-electron.exe'),
    spawn,
    createChannel,
    ensureBackend: options.ensureBackend || (async (exe) => { assert.equal(exe, clientPath); events.push('ensure'); }),
    readConnection: () => { events.push('read'); return connection; },
    certificate: (exe) => { assert.equal(exe, clientPath); events.push('certificate'); return cert; },
    verify: options.verify || (async (value, ca) => {
      assert.equal(value, connection);
      assert.equal(value.token, syntheticToken);
      assert.equal(ca, cert);
      events.push('verify');
    }),
    encodeToken: options.encodeToken || ((value) => { assert.equal(value, syntheticToken); events.push('encode'); return encryptedToken; }),
    revealOfficial: async () => { reveals++; },
    timeoutMs: options.timeoutMs || 500,
  });
  t.after(async () => {
    for (const child of children) child.close();
    await controller.stop();
    assert.equal(path.dirname(path.resolve(workspaceRoot)), path.resolve(__dirname));
    assert.ok(path.basename(workspaceRoot).startsWith('.private-client-'));
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  return { controller, workspaceRoot, directory, clientPath, candidatePath, manifestPath, manifest, saveManifest, children, calls, events, channels, connection, reveals: () => reveals };
}

async function opened(f) {
  const opening = f.controller.open(f.clientPath);
  await flush();
  const child = f.children[0];
  assert.ok(child, 'startup must reach the simulated process');
  child.reply({ event: 'ready', integrationReady: true, managerConnected: true });
  assert.deepEqual(await opening, { ready: true, mode: 'private', managerConnected: true });
  return child;
}

test('the complete embedded copy takes priority without moving the previous private interface', (t) => {
  const f = fixture(t);
  const directory = path.join(f.directory, 'embedded-v1');
  fs.mkdirSync(directory);
  const candidatePath = path.join(directory, 'app.asar');
  fs.writeFileSync(candidatePath, 'synthetic complete interface');
  const manifest = { ...f.manifest, candidate: { path: candidatePath } };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  const plan = inspectPrivateClient(f.clientPath, { workspaceRoot: f.workspaceRoot });
  assert.equal(plan.directory, directory);
  assert.equal(plan.candidatePath, candidatePath);
  assert.equal(fs.existsSync(f.candidatePath), true);
});

test('a private interface without complete account management is rejected before starting', async (t) => {
  const f = fixture(t);
  delete f.manifest.behavior.fullManagerInClient;
  f.saveManifest();
  assert.equal(inspectPrivateClient(f.clientPath, { workspaceRoot: f.workspaceRoot }).active, false);
  await assert.rejects(f.controller.open(f.clientPath), /ausente ou desatualizada/);
  assert.equal(f.calls.length, 0);
});

test('private UI startup waits for a complete ready protocol event', async (t) => {
  const f = fixture(t);
  let settled = false;
  const opening = f.controller.open(f.clientPath).then((result) => { settled = true; return result; });
  await flush();
  assert.equal(settled, false);
  const child = f.children[0];
  child.stdout.write('vendor output is ignored\n');
  child.transport.write('{"event":"rea');
  await flush();
  assert.equal(settled, false);
  child.transport.write('dy","integrationReady":true,"managerConnected":true}\r\n');
  assert.deepEqual(await opening, { ready: true, mode: 'private', managerConnected: true });
});

test('private UI verifies HTTPS before spawn and sends only encrypted credentials over its local channel', async (t) => {
  const f = fixture(t);
  await opened(f);
  assert.ok(f.events.indexOf('verify') < f.events.indexOf('encode'));
  assert.ok(f.events.indexOf('encode') < f.events.indexOf('spawn'));
  const [executable, args, processOptions] = f.calls[0];
  assert.equal(executable, path.join(f.workspaceRoot, 'fake-electron.exe'));
  assert.deepEqual(args, [PRIVATE_HOST_ENTRY, `--ram-bootstrap-pipe=${f.channels[0].path}`]);
  assert.equal(processOptions.windowsHide, true);
  assert.deepEqual(processOptions.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(JSON.stringify(f.calls).includes(syntheticToken), false);
  assert.equal(JSON.stringify(f.calls).includes(encryptedToken), false);
  const request = JSON.parse(f.children[0].input[0]);
  assert.equal(request.encryptedAuthToken, encryptedToken);
  assert.equal(request.appPort, 54321);
  assert.equal(request.appPid, 12345);
  assert.equal(request.candidatePath, f.candidatePath);
  assert.equal(request.manifestPath, f.manifestPath);
  assert.equal(JSON.stringify(request).includes(syntheticToken), false);
  assert.equal(f.connection.token, '');
});

test('concurrent private UI openings share one startup and one child', async (t) => {
  const f = fixture(t);
  const first = f.controller.open(f.clientPath);
  const second = f.controller.open(f.clientPath);
  await flush();
  assert.equal(f.children.length, 1);
  assert.equal(f.events.filter((event) => event === 'ensure').length, 1);
  f.children[0].reply({ event: 'ready', integrationReady: true, managerConnected: true });
  assert.deepEqual(await first, { ready: true, mode: 'private', managerConnected: true });
  assert.deepEqual(await second, { ready: true, mode: 'private', managerConnected: true });
});

test('unsupported private UI manifests fail before starting any backend or process', async (t) => {
  const f = fixture(t);
  for (const change of [
    () => { f.manifest.mode = 'installed-patch'; },
    () => { f.manifest.mode = 'private-host'; f.manifest.privacy.logGuardInstalled = false; },
    () => { f.manifest.privacy.logGuardInstalled = true; f.manifest.source.package.version = '143.0.0'; },
    () => { f.manifest.source.package.version = '141.0.0'; f.manifest.candidate.path = path.join(f.workspaceRoot, 'outside.asar'); },
  ]) {
    change(); f.saveManifest();
    assert.equal(inspectPrivateClient(f.clientPath, { workspaceRoot: f.workspaceRoot }).active, false);
    await assert.rejects(f.controller.open(f.clientPath), /ausente ou desatualizada/);
  }
  assert.equal(f.children.length, 0);
  assert.deepEqual(f.events, []);
});

test('host startup errors close the child and reveal the official client without exposing error details', async (t) => {
  const f = fixture(t);
  const rejection = assert.rejects(f.controller.open(f.clientPath), (error) => {
    assert.match(error.message, /could not start \(decryption\)/);
    assert.equal(error.message.includes(syntheticToken), false);
    return true;
  });
  await flush();
  f.children[0].stderr.write(`synthetic vendor diagnostic ${syntheticToken}`);
  f.children[0].reply({ event: 'error', stage: 'decryption', error: syntheticToken });
  await rejection;
  assert.equal(f.children[0].kills, 1);
  assert.equal(f.reveals(), 1);
});

test('TLS verification failure never encodes a token or launches a host and restores the official UI', async (t) => {
  const f = fixture(t, { verify: async () => { throw new Error('synthetic TLS failure'); } });
  await assert.rejects(f.controller.open(f.clientPath), /TLS failure/);
  assert.equal(f.children.length, 0);
  assert.equal(f.events.includes('encode'), false);
  assert.equal(f.reveals(), 1);
});

test('hide and reopen send commands to the existing private host', async (t) => {
  const f = fixture(t);
  const child = await opened(f);
  f.controller.hide();
  assert.equal(child.input.at(-1), 'hide');
  assert.deepEqual(await f.controller.open(f.clientPath), { ready: true, mode: 'private', managerConnected: true });
  assert.equal(child.input.at(-1), 'show');
  assert.equal(f.children.length, 1);
});

test('opening account management reuses the Riot host and waits for its embedded view acknowledgement', async (t) => {
  const f = fixture(t);
  const child = await opened(f);
  const first = f.controller.openManager(f.clientPath);
  const second = f.controller.openManager(f.clientPath);
  await flush();
  assert.equal(child.input.filter((line) => line === 'open-manager').length, 1);
  child.reply({ event: 'manager-ready' });
  assert.deepEqual(await first, { ready: true, embedded: true });
  assert.deepEqual(await second, { ready: true, embedded: true });
  assert.equal(f.children.length, 1);
});

test('an embedded account view failure preserves the Riot interface and never echoes host payloads', async (t) => {
  const f = fixture(t);
  const child = await opened(f);
  const pending = assert.rejects(f.controller.openManager(f.clientPath), (error) => {
    assert.equal(error.message.includes(syntheticToken), false);
    assert.match(error.message, /embedded account view could not open/);
    return true;
  });
  await flush();
  child.reply({ event: 'manager-error', error: syntheticToken });
  await pending;
  assert.equal(child.kills, 0);
  assert.equal(child.exited, false);
});

test('closing the host releases a pending embedded view request', async (t) => {
  const f = fixture(t);
  const child = await opened(f);
  const pending = assert.rejects(f.controller.openManager(f.clientPath), /closed before/);
  await flush();
  child.close();
  await pending;
});

test('stopping the private host sends stop and permanently rejects further openings', async (t) => {
  const f = fixture(t);
  const child = await opened(f);
  await f.controller.stop();
  assert.equal(child.input.at(-1), 'stop');
  assert.equal(child.transport.writableEnded, true);
  assert.equal(child.exited, true);
  await assert.rejects(f.controller.open(f.clientPath), /shutting down/);
  assert.equal(f.children.length, 1);
});

test('stopping during backend verification never creates a private host afterward', async (t) => {
  let releaseVerification;
  const verification = new Promise((resolve) => { releaseVerification = resolve; });
  const f = fixture(t, { verify: async () => verification });
  const rejection = assert.rejects(f.controller.open(f.clientPath), /shutting down/);
  await flush();
  await f.controller.stop();
  releaseVerification(true);
  await rejection;
  assert.equal(f.children.length, 0);
  assert.equal(f.events.includes('encode'), false);
});

test('private host startup timeout rejects and restores the official UI', async (t) => {
  const f = fixture(t, { timeoutMs: 20 });
  await assert.rejects(f.controller.open(f.clientPath), /did not finish loading|closed before loading/);
  assert.ok(f.children[0].kills >= 1);
  assert.equal(f.reveals(), 1);
});

test('malformed JSON protocol objects do not throw from the stdout event handler', async (t) => {
  const f = fixture(t);
  const opening = f.controller.open(f.clientPath);
  await flush();
  const child = f.children[0];
  assert.doesNotThrow(() => child.transport.write('null\nfalse\n[]\n{"ignored":true}\n'));
  child.reply({ event: 'ready', integrationReady: true, managerConnected: true });
  assert.deepEqual(await opening, { ready: true, mode: 'private', managerConnected: true });
});
