const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { encodeHeader } = require('./asarFixture');
const { parseBackendLockfile, readBackend, readBackendCertificate } = require('../../src/integration/backend');

const token = 'synthetic-backend-token-only';

test('backend lockfile parsing accepts a bounded HTTPS connection without logging it', () => {
  assert.deepEqual(parseBackendLockfile(`RiotClient:1234:54321:${token}:https\r\n`), { pid: 1234, port: 54321, token });
  for (const value of [
    null, '', 'x'.repeat(8193), `RiotClient:0:54321:${token}:https`,
    `RiotClient:1:65536:${token}:https`, `RiotClient:1:0:${token}:https`,
    `RiotClient:1:1:${token}:http`, 'RiotClient:1:1::https',
    'RiotClient:1:1:invalid token:https', 'RiotClient:1:1:line\nbreak:https',
    `RiotClient:1:1:${'a'.repeat(257)}:https`, `RiotClient:1:1:${token}:https:unexpected`,
  ]) assert.throws(() => parseBackendLockfile(value), /^Error: Riot backend lockfile is invalid$/);
});

test('backend discovery reads only the supplied normal Riot profile lockfile', () => {
  const localAppData = path.join(__dirname, 'synthetic-profile');
  const reads = [];
  const result = readBackend({ localAppData, readFile: (file, encoding) => {
    reads.push({ file, encoding });
    return `RiotClient:1234:54321:${token}:https`;
  } });
  assert.equal(result.port, 54321);
  assert.deepEqual(reads, [{ file: path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile'), encoding: 'utf8' }]);
});

test('missing or malformed backend discovery returns a generic error without the lockfile content', () => {
  for (const readFile of [() => { throw new Error(`synthetic failure ${token}`); }, () => token]) {
    assert.throws(() => readBackend({ localAppData: path.join(__dirname, 'synthetic-profile'), readFile }), /^Error: The Riot background service is not ready$/);
  }
  assert.throws(() => readBackend({ localAppData: 'relative-profile', readFile: () => { throw new Error('must not read'); } }), /profile could not be located/);
});

test('backend certificate comes from the supplied fixture archive and not a global certificate override', (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.backend-cert-'));
  t.after(() => {
    assert.equal(path.dirname(directory), __dirname);
    assert.ok(path.basename(directory).startsWith('.backend-cert-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const certificate = Buffer.from('synthetic PEM payload only');
  const resources = path.join(directory, 'RiotClientElectron', 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const header = { files: { dist: { files: { main: { files: { 'root.pem': { size: certificate.length, offset: '0' } } } } } } };
  fs.writeFileSync(path.join(resources, 'app.asar'), Buffer.concat([encodeHeader(header), certificate]));
  assert.deepEqual(readBackendCertificate(path.join(directory, 'RiotClientServices.exe')), certificate);
});
