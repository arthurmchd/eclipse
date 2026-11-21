const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT } = require('../../../src/paths');
const { REPOSITORY, PLATFORM, setupName, downloadUrl, manifest, writeManifest } = require('../../../scripts/release/latest-json');

const SIGNATURE = Buffer.from('untrusted comment: signature from tauri secret key\n' + 'x'.repeat(120)).toString('base64');
const DATE = new Date('2026-11-21T12:00:00Z');

test('the update manifest points at the signed Setup of the same release tag', () => {
  const tauri = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.equal(REPOSITORY, 'arthurmchd/eclipse');
  assert.ok(tauri.plugins.updater.endpoints[0].startsWith(`https://github.com/${REPOSITORY}/releases/latest/download/latest.json`));
  assert.equal(setupName('2.20.0'), 'Eclipse_2.20.0_x64-setup.exe');
  assert.equal(downloadUrl('2.20.0'), 'https://github.com/arthurmchd/eclipse/releases/download/v2.20.0/Eclipse_2.20.0_x64-setup.exe');
  assert.deepEqual(manifest({ version: '2.20.0', signature: `${SIGNATURE}\r\n`, notes: 'Novidades', date: DATE }), {
    version: '2.20.0',
    notes: 'Novidades',
    pub_date: '2026-11-21T12:00:00.000Z',
    platforms: { [PLATFORM]: { signature: SIGNATURE, url: downloadUrl('2.20.0') } },
  });
});

test('a bad version or a missing signature never becomes a manifest', () => {
  for (const version of ['2.20', 'v2.20.0', '2.20.0-beta', '../2.20.0']) assert.throws(() => manifest({ version, signature: SIGNATURE, date: DATE }), /invalid version/);
  for (const signature of ['', 'short', `${SIGNATURE} extra`, undefined]) assert.throws(() => manifest({ version: '2.20.0', signature, date: DATE }), /invalid signature/);
});

test('the manifest is written next to the Setup and its signature', (t) => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'tmp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => writeManifest({ version: '2.20.0', dir, date: DATE }), /missing Eclipse_2.20.0_x64-setup.exe/);
  fs.writeFileSync(path.join(dir, setupName('2.20.0')), 'setup');
  fs.writeFileSync(path.join(dir, `${setupName('2.20.0')}.sig`), SIGNATURE);
  const target = writeManifest({ version: '2.20.0', notes: '', dir, date: DATE });
  assert.equal(target, path.join(dir, 'latest.json'));
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).platforms[PLATFORM].signature, SIGNATURE);
});
