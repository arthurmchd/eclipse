const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { encodeHeader } = require('../src/clientIntegration/asar');
const { inspectClientIntegration } = require('../src/clientIntegration/status');

function fixture(t, markers, version = '141.0.0') {
  const directory = fs.mkdtempSync(path.join(__dirname, '.integration-status-'));
  t.after(() => {
    assert.equal(path.dirname(directory), __dirname);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const entries = {
    'package.json': JSON.stringify({ name: 'riot-client-ux', version }),
    'dist/main/main.js': markers[0] ? 'RAM_LOGIN_INTEGRATION_V1' : 'original main',
    'dist/main/preload.js': markers[1] ? 'RAM_LOGIN_INTEGRATION_V1' : 'original preload',
    'dist/renderer/renderer.js': markers[2] ? 'RAM_LOGIN_INTEGRATION_V1' : 'original renderer',
  };
  const header = { files: {} }, chunks = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const parts = name.split('/');
    let current = header;
    for (const part of parts.slice(0, -1)) current = current.files[part] ||= { files: {} };
    const data = Buffer.from(text);
    current.files[parts.at(-1)] = { offset: String(offset), size: data.length };
    chunks.push(data); offset += data.length;
  }
  const resources = path.join(directory, 'RiotClientElectron', 'resources');
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, 'app.asar'), Buffer.concat([encodeHeader(header), ...chunks]));
  return path.join(directory, 'RiotClientServices.exe');
}

test('original or partially replaced Riot interfaces never activate the bridge', (t) => {
  assert.equal(inspectClientIntegration(fixture(t, [false, false, false])).active, false);
  assert.equal(inspectClientIntegration(fixture(t, [true, true, false])).active, false);
});

test('all three addon entries are required on the compatible client version', (t) => {
  assert.equal(inspectClientIntegration(fixture(t, [true, true, true])).active, true);
  assert.equal(inspectClientIntegration(fixture(t, [true, true, true], '142.0.0')).active, false);
});

test('missing Riot installations fail closed without requiring a client process', () => {
  assert.equal(inspectClientIntegration(null).active, false);
  assert.equal(inspectClientIntegration(path.join(__dirname, 'does-not-exist', 'client.exe')).active, false);
});
