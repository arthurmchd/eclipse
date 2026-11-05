const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MARKER, openArchive, encodeHeader, appendToArchive, integrityFor, verifyIntegrity, sha256File } = require('../../src/integration/asar');
const { prepare, withinRoot } = require('../../scripts/legacy/prepare-riot-integration');
const { PROJECT_ROOT } = require('../../src/paths');

function fixture(t, { invalidIntegrity = false } = {}) {
  const directory = fs.mkdtempSync(path.join(__dirname, '.archive-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const original = path.join(directory, 'original.asar');
  const destination = path.join(directory, 'prepared.asar');
  const files = {};
  const chunks = [];
  let offset = 0;
  function file(name, text, extra = {}) {
    const bytes = Buffer.from(text);
    const meta = { size: bytes.length, offset: String(offset), integrity: integrityFor(bytes, { algorithm: 'SHA256', blockSize: 8 }), ...extra };
    files[name] = meta;
    chunks.push(bytes);
    offset += bytes.length;
  }
  file('main.js', 'original main source;');
  file('preload.js', 'original preload;');
  file('unchanged.txt', 'content that stays identical');
  files['external.node'] = { size: 42, unpacked: true };
  files['linked.js'] = { link: 'main.js' };
  if (invalidIntegrity) files['main.js'].integrity.hash = '0'.repeat(64);
  const header = { files };
  fs.writeFileSync(original, Buffer.concat([encodeHeader(header), ...chunks]));
  return { original, destination, directory, header };
}

test('ASAR append preserves original packed bytes, unchanged metadata, links and unpacked entries', (t) => {
  const f = fixture(t);
  const beforeHash = sha256File(f.original);
  const changed = appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('globalThis.addon = true;'), 'preload.js': Buffer.from('globalThis.bridge = true;') });
  assert.equal(changed.length, 2);
  assert.equal(sha256File(f.original), beforeHash);
  const original = openArchive(f.original);
  const candidate = openArchive(f.destination);
  try {
    assert.equal(candidate.readFile('unchanged.txt').toString(), 'content that stays identical');
    for (const name of ['unchanged.txt', 'external.node', 'linked.js']) assert.deepEqual(candidate.entry(name), original.entry(name));
    const bytes = candidate.readFile('main.js');
    assert.ok(bytes.toString().startsWith(original.readFile('main.js').toString()));
    assert.ok(bytes.includes(Buffer.from(MARKER)));
    assert.ok(bytes.toString().endsWith('globalThis.addon = true;\n'));
    verifyIntegrity(bytes, candidate.entry('main.js'));
    assert.ok(candidate.entry('main.js').integrity.blocks.length > 1);
    const sourcePayload = fs.readFileSync(f.original).subarray(original.dataOffset);
    const candidatePayload = fs.readFileSync(f.destination).subarray(candidate.dataOffset, candidate.dataOffset + original.payloadSize);
    assert.deepEqual(candidatePayload, sourcePayload);
  } finally { original.close(); candidate.close(); }
});

test('ASAR header uses correctly aligned Chromium pickle sizes', () => {
  for (let size = 1; size <= 12; size++) {
    const header = encodeHeader({ files: {}, value: 'a'.repeat(size) });
    assert.equal(header.readUInt32LE(0), 4);
    assert.equal(header.readUInt32LE(4) + 8, header.length);
    assert.equal(header.readUInt32LE(8) + 4, header.readUInt32LE(4));
    assert.equal(header.length % 4, 0);
    assert.deepEqual(JSON.parse(header.subarray(16, 16 + header.readUInt32LE(12)).toString()), { files: {}, value: 'a'.repeat(size) });
  }
});

test('patch rejects a modified source entry without disabling integrity', (t) => {
  const f = fixture(t, { invalidIntegrity: true });
  assert.throws(() => appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('addon') }), /integrity mismatch/);
  assert.equal(fs.existsSync(f.destination), false);
});

test('patch refuses duplicate extension, replacing source, or overwriting a candidate', (t) => {
  const f = fixture(t);
  assert.throws(() => appendToArchive(f.original, f.original, { 'main.js': Buffer.from('addon') }), /different/);
  appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('addon') });
  assert.throws(() => appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('addon') }), /already exists/);
  assert.throws(() => appendToArchive(f.destination, path.join(f.directory, 'duplicate.asar'), { 'main.js': Buffer.from('addon') }), /already present/);
});

test('ASAR parser rejects traversal and out-of-bounds files', (t) => {
  const f = fixture(t);
  const invalid = path.join(f.directory, 'invalid.asar');
  fs.writeFileSync(invalid, encodeHeader({ files: { '..': { files: {} } } }));
  assert.throws(() => openArchive(invalid), /entry path/);
  fs.writeFileSync(invalid, encodeHeader({ files: { 'broken.js': { size: 100, offset: '0' } } }));
  assert.throws(() => openArchive(invalid), /bounds/);
});

test('ASAR edits reject missing and unpacked entries and preserve source on failure', (t) => {
  const f = fixture(t);
  const hash = sha256File(f.original);
  assert.throws(() => appendToArchive(f.original, f.destination, { 'missing.js': Buffer.from('addon') }), /not found/);
  assert.throws(() => appendToArchive(f.original, f.destination, { 'external.node': Buffer.from('addon') }), /not a packed file/);
  assert.equal(sha256File(f.original), hash);
  assert.deepEqual(fs.readdirSync(f.directory), ['original.asar']);
});

test('ASAR edits fail closed for unsupported integrity metadata', (t) => {
  const f = fixture(t);
  const archive = openArchive(f.original);
  try {
    assert.throws(() => integrityFor(Buffer.from('text'), { algorithm: 'MD5', blockSize: 8 }), /Unsupported/);
    assert.throws(() => integrityFor(Buffer.from('text'), { algorithm: 'SHA256', blockSize: 0 }), /block size/);
  } finally { archive.close(); }
});

test('explicit ASAR transforms validate originals first and update only selected logical entries', (t) => {
  const f = fixture(t);
  const originalHash = sha256File(f.original);
  const changed = appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('globalThis.extension = true;') }, {
    transformers: { 'main.js': (original) => Buffer.from(original.toString().replace('original main source', 'private main source')) },
  });
  const archive = openArchive(f.destination);
  try {
    const logicalMain = archive.readFile('main.js');
    assert.ok(logicalMain.toString().startsWith('private main source;'));
    assert.equal(logicalMain.includes(Buffer.from('original main source')), false);
    assert.equal(archive.readFile('preload.js').toString(), 'original preload;');
    verifyIntegrity(logicalMain, archive.entry('main.js'));
    assert.equal(typeof changed[0].transformedSha256, 'string');
  } finally { archive.close(); }
  assert.equal(sha256File(f.original), originalHash);
});

test('ASAR transforms cannot run before validating source integrity or target unrelated entries', (t) => {
  const f = fixture(t, { invalidIntegrity: true });
  let invoked = false;
  assert.throws(() => appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('addon') }, {
    transformers: { 'main.js': (bytes) => { invoked = true; return bytes; } },
  }), /integrity mismatch/);
  assert.equal(invoked, false);
  assert.throws(() => appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('addon') }, {
    transformers: { 'preload.js': (bytes) => bytes },
  }), /Invalid ASAR source transformers/);
  assert.equal(fs.existsSync(f.destination), false);
});

test('preparation validates the Riot package and writes a hash manifest beside the candidate', (t) => {
  const f = fixture(t);
  const buffers = [];
  let offset = 0;
  function packed(text) {
    const bytes = Buffer.from(text);
    const item = { size: bytes.length, offset: String(offset), integrity: integrityFor(bytes) };
    buffers.push(bytes); offset += bytes.length;
    return item;
  }
  const packageJson = packed(JSON.stringify({ name: 'riot-client-ux', version: 'test-version', main: './dist/main/main.js' }));
  const main = packed('globalThis.originalMain = true;');
  const preload = packed('globalThis.originalPreload = true;');
  const renderer = packed('globalThis.originalRenderer = true;');
  const header = { files: { 'package.json': packageJson, dist: { files: { main: { files: { 'main.js': main, 'preload.js': preload } }, renderer: { files: { 'renderer.js': renderer } } } } } };
  fs.writeFileSync(f.original, Buffer.concat([encodeHeader(header), ...buffers]));
  const sourceHash = sha256File(f.original);
  const output = path.join(f.directory, 'prepared', 'app.asar');
  const result = prepare({ source: f.original, output });
  assert.equal(result.manifest.source.sha256, sourceHash);
  assert.equal(result.manifest.source.package.version, 'test-version');
  assert.equal(result.manifest.candidate.sha256, sha256File(output));
  assert.equal(result.manifest.changedFiles.length, 3);
  assert.equal(sha256File(f.original), sourceHash);
  assert.equal(fs.existsSync(result.manifestFile), true);
  assert.throws(() => prepare({ source: f.original, output }), /already exists/);
});

test('preparation cannot target a path outside the workspace', () => {
  assert.throws(() => withinRoot(path.resolve(PROJECT_ROOT, '..', 'outside.asar')), /workspace/);
  assert.throws(() => prepare({ output: path.resolve(PROJECT_ROOT, '..', 'outside', 'app.asar') }), /workspace/);
});

const electronExecutable = path.resolve(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
test('Electron independently reads the prepared ASAR fixture and its updated integrity metadata', { skip: process.platform !== 'win32' || !fs.existsSync(electronExecutable) }, (t) => {
  const f = fixture(t);
  appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('globalThis.fixtureAddon = true;') });
  const read = spawnSync(electronExecutable, ['-e', "console.log(JSON.stringify(require('fs').readFileSync(process.argv[1], 'utf8')))", `${f.destination}/main.js`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(read.error, undefined);
  assert.equal(read.status, 0, read.stderr);
  const content = JSON.parse(read.stdout.trim());
  assert.ok(content.includes(MARKER));
  assert.ok(content.includes('globalThis.fixtureAddon = true;'));
});

test('raw ASAR parser and file hashing work inside Electron without global ASAR switches', { skip: process.platform !== 'win32' || !fs.existsSync(electronExecutable) }, (t) => {
  const f = fixture(t);
  appendToArchive(f.original, f.destination, { 'main.js': Buffer.from('globalThis.rawParserFixture = true;') });
  const modulePath = path.resolve(PROJECT_ROOT, 'src', 'integration', 'asar.js');
  const code = `
    const before = process.noAsar;
    const { openArchive, sha256File } = require(process.argv[1]);
    const archive = openArchive(process.argv[2]);
    try {
      console.log(JSON.stringify({
        main: archive.readFile('main.js').toString('utf8'),
        sha256: sha256File(process.argv[2]),
        rawSize: archive.size,
        globalSwitchUnchanged: process.noAsar === before,
      }));
    } finally { archive.close(); }
  `;
  const read = spawnSync(electronExecutable, ['-e', code, modulePath, f.destination], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(read.error, undefined);
  assert.equal(read.status, 0, read.stderr);
  const result = JSON.parse(read.stdout.trim());
  assert.ok(result.main.includes(MARKER));
  assert.ok(result.main.includes('globalThis.rawParserFixture = true;'));
  assert.equal(result.sha256, sha256File(f.destination));
  assert.equal(result.rawSize, fs.statSync(f.destination).size);
  assert.equal(result.globalSwitchUnchanged, true);
});

test('installer atomically applies and restores a fixture, retaining verified backup and refusing later updates', { skip: process.platform !== 'win32' }, (t) => {
  const f = fixture(t);
  const source = path.join(f.directory, 'RiotClientElectron', 'resources', 'app.asar');
  const candidate = path.join(f.directory, 'prepared', 'app.asar');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.writeFileSync(source, 'original fixture archive');
  fs.writeFileSync(candidate, 'prepared fixture archive');
  const originalHash = sha256File(source);
  const candidateHash = sha256File(candidate);
  const manifest = path.join(path.dirname(candidate), 'manifest.json');
  const plan = {
    schemaVersion: 1,
    mode: 'private-host',
    source: { path: source, size: fs.statSync(source).size, sha256: originalHash, package: { name: 'riot-client-ux', main: './dist/main/main.js' } },
    candidate: { path: candidate, size: fs.statSync(candidate).size, sha256: candidateHash },
  };
  fs.writeFileSync(manifest, JSON.stringify(plan));
  const script = path.resolve(PROJECT_ROOT, 'scripts', 'legacy', 'install-riot-integration.ps1');
  const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Manifest', manifest, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const privateAttempt = run();
  if (privateAttempt.stderr.includes('Close Riot Client')) {
    assert.equal(sha256File(source), originalHash);
    t.skip('Riot is open; installer correctly refused to run');
    return;
  }
  assert.equal(privateAttempt.status, 1, privateAttempt.stderr);
  assert.match(privateAttempt.stderr, /Private-host manifests cannot be installed/);
  assert.equal(sha256File(source), originalHash);
  assert.equal(fs.existsSync(`${source}.ram-backup`), false);
  delete plan.mode;
  fs.writeFileSync(manifest, JSON.stringify(plan));
  const installed = run();
  if (installed.stderr.includes('Close Riot Client')) {
    assert.equal(sha256File(source), originalHash);
    t.skip('Riot is open; installer correctly refused to run');
    return;
  }
  assert.equal(installed.error, undefined);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(sha256File(source), candidateHash);
  assert.equal(sha256File(`${source}.ram-backup`), originalHash);
  const restored = run('-Restore');
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(sha256File(source), originalHash);
  assert.equal(sha256File(`${source}.ram-backup`), originalHash);
  fs.writeFileSync(source, 'an unrelated client update');
  const updatedHash = sha256File(source);
  const refused = run('-Restore');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /changed after installation/);
  assert.equal(sha256File(source), updatedHash);
});
