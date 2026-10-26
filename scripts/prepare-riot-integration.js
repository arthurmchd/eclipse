// Creates a candidate inside this workspace. Never writes to the Riot install.
const fs = require('fs');
const path = require('path');
const { openArchive, appendToArchive, sha256File } = require('../src/clientIntegration/asar');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = 'C:/Riot Games/Riot Client/RiotClientElectron/resources/app.asar';
const ENTRIES = {
  'dist/main/main.js': 'addon-main.js',
  'dist/main/preload.js': 'addon-preload.js',
  'dist/renderer/renderer.js': 'addon-renderer.js',
};

function withinRoot(file) {
  const relative = path.relative(ROOT, path.resolve(file));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Prepared files must stay inside the project workspace');
}

function prepare({ source = DEFAULT_SOURCE, output = path.join(ROOT, '.client-integration', 'app.asar') } = {}) {
  source = path.resolve(source);
  output = path.resolve(output);
  withinRoot(output);
  if (path.basename(output).toLowerCase() !== 'app.asar') throw new Error('Prepared archive must be named app.asar');
  const directory = path.dirname(output);
  const manifestFile = path.join(directory, 'manifest.json');
  if (fs.existsSync(output) || fs.existsSync(manifestFile)) throw new Error('Preparation already exists; choose a fresh output directory');
  const archive = openArchive(source);
  let pkg;
  try {
    pkg = JSON.parse(archive.readFile('package.json', 16384).toString('utf8'));
    if (pkg.name !== 'riot-client-ux' || pkg.main !== './dist/main/main.js' || typeof pkg.version !== 'string') throw new Error('This archive is not a supported Riot Client interface');
    for (const entry of Object.keys(ENTRIES)) archive.entry(entry);
  } finally { archive.close(); }
  const originalHash = sha256File(source);
  const originalSize = fs.statSync(source).size;
  const additions = {};
  for (const [entry, addon] of Object.entries(ENTRIES)) {
    const file = path.join(ROOT, 'src', 'clientIntegration', addon);
    const text = fs.readFileSync(file, 'utf8').replace('__RAM_DPAPI_HELPER_BASE64__', require('../src/clientIntegration/windowsDpapi').encodedCommand);
    if (!text.trim()) throw new Error(`Missing addon: ${addon}`);
    // All addons are standalone functions/scripts, not module import syntax.
    new Function(text);
    additions[entry] = Buffer.from(text, 'utf8');
  }
  fs.mkdirSync(directory, { recursive: true });
  // Reject a symlinked output directory resolving outside the workspace.
  withinRoot(path.join(fs.realpathSync(directory), path.basename(output)));
  let created = false;
  try {
    const changedFiles = appendToArchive(source, output, additions);
    created = true;
    if (sha256File(source) !== originalHash) throw new Error('Riot Client changed while preparing; retry after the update finishes');
    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      source: { path: source, size: originalSize, sha256: originalHash, package: { name: pkg.name, version: pkg.version, main: pkg.main } },
      candidate: { path: output, size: fs.statSync(output).size, sha256: sha256File(output) },
      changedFiles,
    };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    return { manifestFile, manifest };
  } catch (error) {
    if (created) try { fs.rmSync(output, { force: true }); } catch {}
    throw error;
  }
}

function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (!['--source', '--output'].includes(option) || !argv[i + 1]) throw new Error('Usage: node scripts/prepare-riot-integration.js [--source app.asar] [--output workspace-folder/app.asar]');
    options[option.slice(2)] = argv[++i];
  }
  const result = prepare(options);
  console.log(JSON.stringify({ manifest: result.manifestFile, clientVersion: result.manifest.source.package.version, changedEntries: result.manifest.changedFiles.map((item) => item.name), sourceUnchanged: true }, null, 2));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { prepare, withinRoot };
