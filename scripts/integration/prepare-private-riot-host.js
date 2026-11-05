const fs = require('fs');
const path = require('path');
const { openArchive, appendToArchive, sha256File } = require('../../src/integration/asar');
const { hardenPrivateMainSource, hasUnsafeStartupLog, isSupportedVersion } = require('../../src/integration/host/privateHostCore');
const { hardenPrivateRendererSource } = require('../../src/integration/host/privateRendererCore');

const { PROJECT_ROOT: ROOT, ADDON_DIR, EMBEDDED_HOST_DIR } = require('../../src/paths');
const DEFAULT_SOURCE = 'C:/Riot Games/Riot Client/RiotClientElectron/resources/app.asar';
const PRIVATE_LOG_GUARD = 'RAM_PRIVATE_HOST_LOG_GUARD_V1';
const UNSAFE_STARTUP_LOG = 'log$d.info("Starting RiotClientUx electron with args",cliArgs)';
const ENTRIES = {
  'dist/main/main.js': 'addon-main.js',
  'dist/main/preload.js': 'addon-preload.js',
  'dist/renderer/renderer.js': 'addon-renderer.js',
};

function withinRoot(file) {
  const relative = path.relative(ROOT, path.resolve(file));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Private host files must stay inside the project workspace');
}

function hardenBuffer(original) {
  if (typeof hardenPrivateMainSource !== 'function') throw new Error('Private host log hardening is unavailable');
  const hardened = hardenPrivateMainSource(original.toString('utf8'));
  if (typeof hardened !== 'string' || !hardened.includes(PRIVATE_LOG_GUARD) || hasUnsafeStartupLog(hardened)) throw new Error('Private host startup argument redaction could not be verified');
  return Buffer.from(hardened, 'utf8');
}

function preparePrivate({ source = DEFAULT_SOURCE, output = path.join(EMBEDDED_HOST_DIR, 'app.asar') } = {}) {
  source = path.resolve(source);
  output = path.resolve(output);
  withinRoot(output);
  if (path.basename(output).toLowerCase() !== 'app.asar') throw new Error('Private host archive must be named app.asar');
  const directory = path.dirname(output);
  const manifestFile = path.join(directory, 'manifest.json');
  if (fs.existsSync(output) || fs.existsSync(manifestFile)) throw new Error('Private host preparation already exists; choose a fresh output directory');
  const archive = openArchive(source);
  let pkg;
  try {
    pkg = JSON.parse(archive.readFile('package.json', 16384).toString('utf8'));
    if (pkg.name !== 'riot-client-ux' || pkg.main !== './dist/main/main.js' || typeof pkg.version !== 'string') throw new Error('This archive is not a supported Riot Client interface');
    if (!isSupportedVersion(pkg.version)) throw new Error('This Riot Client version has not been validated for the private UI');
    for (const entry of Object.keys(ENTRIES)) archive.entry(entry);
  } finally { archive.close(); }
  const originalHash = sha256File(source);
  const originalSize = fs.statSync(source).size;
  const additions = {};
  for (const [entry, addon] of Object.entries(ENTRIES)) {
    const file = path.join(ADDON_DIR, addon);
    const script = fs.readFileSync(file, 'utf8').replace('__RAM_DPAPI_HELPER_BASE64__', require('../../src/platform/windows/windowsDpapi').encodedCommand);
    if (!script.trim()) throw new Error(`Missing private host addon: ${addon}`);
    new Function(script);
    additions[entry] = Buffer.from(script, 'utf8');
  }
  fs.mkdirSync(directory, { recursive: true });
  withinRoot(path.join(fs.realpathSync(directory), path.basename(output)));
  let created = false;
  try {
    const changedFiles = appendToArchive(source, output, additions, { transformers: {
      'dist/main/main.js': hardenBuffer,
      'dist/renderer/renderer.js': (original) => Buffer.from(hardenPrivateRendererSource(original.toString('utf8'), { version: pkg.version }), 'utf8'),
    } });
    created = true;
    if (sha256File(source) !== originalHash) throw new Error('Riot Client changed while preparing the private copy; retry after the update finishes');
    const prepared = openArchive(output);
    try {
      const main = prepared.readFile('dist/main/main.js').toString('utf8');
      if (!main.includes(PRIVATE_LOG_GUARD) || hasUnsafeStartupLog(main)) throw new Error('Private host log privacy check failed');
    } finally { prepared.close(); }
    const manifest = {
      schemaVersion: 1,
      mode: 'private-host',
      createdAt: new Date().toISOString(),
      source: { path: source, size: originalSize, sha256: originalHash, package: { name: pkg.name, version: pkg.version, main: pkg.main } },
      candidate: { path: output, size: fs.statSync(output).size, sha256: sha256File(output) },
      changedFiles,
      privacy: { startupArgumentsRedacted: true, logGuardInstalled: true },
      behavior: { externalMultifactorRecovery: pkg.version === '142.0.0', fullManagerInClient: true },
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
    if (!['--source', '--output'].includes(option) || !argv[i + 1]) throw new Error('Usage: node scripts/integration/prepare-private-riot-host.js [--source app.asar] [--output workspace-folder/app.asar]');
    options[option.slice(2)] = argv[++i];
  }
  const result = preparePrivate(options);
  console.log(JSON.stringify({ manifest: result.manifestFile, mode: result.manifest.mode, clientVersion: result.manifest.source.package.version, startupArgumentsRedacted: true, sourceUnchanged: true }, null, 2));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { preparePrivate, hardenBuffer, PRIVATE_LOG_GUARD, UNSAFE_STARTUP_LOG };
