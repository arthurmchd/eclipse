const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { openArchive, encodeHeader, integrityFor, sha256File, verifyIntegrity } = require('../../../src/integration/asar');
const { preparePrivate, PRIVATE_LOG_GUARD, UNSAFE_STARTUP_LOG } = require('../../../scripts/integration/prepare-private-riot-host');
const { ORIGINAL_PROTOCOL_BOOTSTRAP, PRIVATE_COMPATIBILITY_MARKER } = require('../../../src/integration/host/privateHostCore');

function fixture(t, startup = UNSAFE_STARTUP_LOG) {
  const directory = fs.mkdtempSync(path.join(__dirname, '.private-archive-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'original.asar');
  const output = path.join(directory, 'private', 'app.asar');
  let offset = 0;
  const payload = [];
  function file(text) {
    const bytes = Buffer.from(text);
    const entry = { size: bytes.length, offset: String(offset), integrity: integrityFor(bytes) };
    payload.push(bytes); offset += bytes.length;
    return entry;
  }
  const pkg = file(JSON.stringify({ name: 'riot-client-ux', version: '141.0.0', main: './dist/main/main.js' }));
  const protocolStub = `${ORIGINAL_PROTOCOL_BOOTSTRAP}(()=>{});}`;
  const main = file(`const log$d={hooks:[],info(){}};const cliArgs={};${startup};globalThis.keepThisCode=true;${protocolStub}`);
  const preload = file('globalThis.originalPreload=true;');
  const renderer = file('globalThis.originalRenderer=true;');
  const untouched = file('fixture content outside changed files');
  fs.writeFileSync(source, Buffer.concat([encodeHeader({ files: {
    'package.json': pkg,
    dist: { files: { main: { files: { 'main.js': main, 'preload.js': preload } }, renderer: { files: { 'renderer.js': renderer, 'untouched.txt': untouched } } } },
  } }), ...payload]));
  return { source, output, directory };
}

test('private host candidate redacts startup arguments in its logical main and leaves the source untouched', (t) => {
  const f = fixture(t);
  const sourceHash = sha256File(f.source);
  const result = preparePrivate(f);
  assert.equal(result.manifest.mode, 'private-host');
  assert.equal(result.manifest.privacy.startupArgumentsRedacted, true);
  assert.equal(result.manifest.privacy.logGuardInstalled, true);
  assert.equal(result.manifest.source.sha256, sourceHash);
  assert.equal(result.manifest.candidate.sha256, sha256File(f.output));
  assert.equal(sha256File(f.source), sourceHash);
  assert.equal(result.manifest.changedFiles.length, 3);
  const archive = openArchive(f.output);
  try {
    const main = archive.readFile('dist/main/main.js');
    assert.ok(main.includes(Buffer.from(PRIVATE_LOG_GUARD)));
    assert.ok(main.includes(Buffer.from(PRIVATE_COMPATIBILITY_MARKER)));
    assert.equal(main.includes(Buffer.from(UNSAFE_STARTUP_LOG)), false);
    assert.ok(main.includes(Buffer.from('globalThis.keepThisCode=true;')));
    verifyIntegrity(main, archive.entry('dist/main/main.js'));
    assert.equal(archive.readFile('dist/renderer/untouched.txt').toString(), 'fixture content outside changed files');
  } finally { archive.close(); }
});

test('private host preparation fails closed when the expected startup logger is missing', (t) => {
  const f = fixture(t, 'log$d.info("some other log",cliArgs)');
  assert.throws(() => preparePrivate(f), /startup|logging|log|expected|unique|supported/i);
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(fs.existsSync(path.join(path.dirname(f.output), 'manifest.json')), false);
});

test('private host preparation refuses ambiguous duplicate startup logging calls', (t) => {
  const f = fixture(t, `${UNSAFE_STARTUP_LOG};${UNSAFE_STARTUP_LOG}`);
  assert.throws(() => preparePrivate(f), /startup|logging|log|expected|unique|supported/i);
  assert.equal(fs.existsSync(f.output), false);
});

test('private host preparation cannot target the installed client or leave the workspace', () => {
  assert.throws(() => preparePrivate({ output: 'C:/Riot Games/Riot Client/RiotClientElectron/resources/app.asar' }), /workspace/);
});
