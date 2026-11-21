const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT } = require('../../src/paths');

const REPOSITORY = 'arthurmchd/eclipse';
const PLATFORM = 'windows-x86_64';
const BUNDLE_DIR = path.join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');

function setupName(version) {
  return `Eclipse_${version}_x64-setup.exe`;
}

function downloadUrl(version) {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${setupName(version)}`;
}

function manifest({ version, signature, notes, date }) {
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new Error('invalid version');
  const clean = String(signature || '').trim();
  if (!/^[A-Za-z0-9+/=]{100,}$/.test(clean)) throw new Error('invalid signature');
  return {
    version,
    notes: String(notes || ''),
    pub_date: date.toISOString(),
    platforms: { [PLATFORM]: { signature: clean, url: downloadUrl(version) } },
  };
}

function writeManifest({ version, notes, date = new Date(), dir = BUNDLE_DIR }) {
  const setup = path.join(dir, setupName(version));
  if (!fs.existsSync(setup)) throw new Error(`missing ${setupName(version)}`);
  const signature = fs.readFileSync(`${setup}.sig`, 'utf8');
  const target = path.join(dir, 'latest.json');
  fs.writeFileSync(target, JSON.stringify(manifest({ version, signature, notes, date }), null, 2) + '\n');
  return target;
}

if (require.main === module) {
  const { version } = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const notes = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8').trim() : '';
  process.stdout.write(writeManifest({ version, notes }) + '\n');
}

module.exports = { REPOSITORY, PLATFORM, setupName, downloadUrl, manifest, writeManifest };
