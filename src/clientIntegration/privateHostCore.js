const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openArchive, sha256File } = require('./asar');
const { PRIVATE_RENDERER_MFA_MARKER } = require('./privateRendererCore');

const SUPPORTED_VERSION = '141.0.0';
const SUPPORTED_VERSIONS = Object.freeze(['141.0.0', '142.0.0']);
const isSupportedVersion = (version) => SUPPORTED_VERSIONS.includes(version);
const PRIVATE_LOG_GUARD_MARKER = 'RAM_PRIVATE_HOST_LOG_GUARD_V1';
const PRIVATE_COMPATIBILITY_MARKER = 'RAM_PRIVATE_HOST_PRE_READY_COMPAT_V1';
const PRIVATE_BOOTSTRAP_SYMBOL = 'riot-account-manager.private-host.bootstrap.v1';
const UNSAFE_STARTUP_LOG = 'log$d.info("Starting RiotClientUx electron with args",cliArgs)';
const ORIGINAL_PROTOCOL_BOOTSTRAP = `function configureProtocol(t){if(require$$0$f.app.isReady())throw new SentryError$1("Sentry SDK should be initialized before the Electron app 'ready' event is fired");require$$0$f.protocol.registerSchemesAsPrivileged([{scheme:PROTOCOL_SCHEME,privileges:{bypassCSP:!0,corsEnabled:!0,supportFetchAPI:!0,secure:!0}}]),whenAppReady.then`;
const ORIGINAL_PROTOCOL_BOOTSTRAP_142 = `function configureProtocol(t,e,r){if(electron.app.isReady())throw new Error("Sentry SDK should be initialized before the Electron app 'ready' event is fired");const i={scheme:e.namespace,privileges:{bypassCSP:!0,corsEnabled:!0,supportFetchAPI:!0,secure:!0}};electron.protocol.registerSchemesAsPrivileged([i]),electron.protocol.registerSchemesAsPrivileged=new Proxy(electron.protocol.registerSchemesAsPrivileged,{apply:(a,s,o)=>{a([...o[0],i])}});const n=createRendererEventLoopBlockStatusHandler(t);`;
const PROTOCOL_PRIVILEGES = Object.freeze({ bypassCSP: true, corsEnabled: true, supportFetchAPI: true, secure: true });
const REQUIRED_ENTRIES = ['dist/main/main.js', 'dist/main/preload.js', 'dist/renderer/renderer.js'];
const DEFAULT_WORKSPACE = path.resolve(__dirname, '..', '..');

// Runs in the private candidate's own lexical scope, before its first args log.
// Only copies message.data for logging; it never mutates HTTP auth configuration.
const PRIVATE_LOG_GUARD_SOURCE = `(()=>{
/* ${PRIVATE_LOG_GUARD_MARKER} */
if(!Array.isArray(log$d.hooks))throw new Error("Private UI logging guard unavailable");
const privateAuthToken=String(cliArgs.remotingAuthToken||"");
if(!privateAuthToken)throw new Error("Private UI logging guard unavailable");
const privateSecrets=[privateAuthToken,encodeURIComponent(privateAuthToken),Buffer.from("riot:"+privateAuthToken).toString("base64")].filter(Boolean);
const privateSafeLogValue=value=>{
  let text;
  try{text=typeof value==="string"?value:require("util").inspect(value,{depth:6,customInspect:false,getters:false});}
  catch{return "[private UI log]";}
  for(const secret of privateSecrets)text=text.split(secret).join("[redacted]");
  return text;
};
log$d.hooks.push(message=>{
  try{return {...message,data:Array.isArray(message.data)?message.data.map(privateSafeLogValue):[privateSafeLogValue(message.data)]};}
  catch{return {...message,data:["[private UI log]"]};}
});
log$d.info("Starting private Riot UI");
})()`;

// The original registration still runs if our synchronous pre-ready setup did
// not occur. Its error after ready also remains intact in that fallback path.
// A prepared host reuses the identical privileged scheme and then continues
// into the original whenAppReady handler-registration code without skipping it.
const PRIVATE_PROTOCOL_BOOTSTRAP = `function configureProtocol(t){
/* ${PRIVATE_COMPATIBILITY_MARKER} */
const privateBootstrap=globalThis[Symbol.for("${PRIVATE_BOOTSTRAP_SYMBOL}")];
const privatePrivileges=privateBootstrap&&privateBootstrap.privileges;
const privatePrepared=Boolean(privateBootstrap&&privateBootstrap.version===1&&privateBootstrap.gpuDisabled===true&&privateBootstrap.protocolRegistered===true&&privateBootstrap.scheme==="sentry-ipc"&&PROTOCOL_SCHEME==="sentry-ipc"&&privatePrivileges&&Object.keys(privatePrivileges).length===4&&["bypassCSP","corsEnabled","supportFetchAPI","secure"].every(key=>privatePrivileges[key]===true));
if(!privatePrepared){if(require$$0$f.app.isReady())throw new SentryError$1("Sentry SDK should be initialized before the Electron app 'ready' event is fired");require$$0$f.protocol.registerSchemesAsPrivileged([{scheme:PROTOCOL_SCHEME,privileges:{bypassCSP:!0,corsEnabled:!0,supportFetchAPI:!0,secure:!0}}]);}
whenAppReady.then`;

const PRIVATE_PROTOCOL_BOOTSTRAP_142 = `function configureProtocol(t,e,r){
/* ${PRIVATE_COMPATIBILITY_MARKER} */
const privateBootstrap=globalThis[Symbol.for("${PRIVATE_BOOTSTRAP_SYMBOL}")];
const privatePrivileges=privateBootstrap&&privateBootstrap.privileges;
const privatePrepared=Boolean(privateBootstrap&&privateBootstrap.version===1&&privateBootstrap.gpuDisabled===true&&privateBootstrap.protocolRegistered===true&&privateBootstrap.scheme==="sentry-ipc"&&e.namespace==="sentry-ipc"&&privatePrivileges&&Object.keys(privatePrivileges).length===4&&["bypassCSP","corsEnabled","supportFetchAPI","secure"].every(key=>privatePrivileges[key]===true));
if(!privatePrepared&&electron.app.isReady())throw new Error("Sentry SDK should be initialized before the Electron app 'ready' event is fired");
const i={scheme:e.namespace,privileges:{bypassCSP:!0,corsEnabled:!0,supportFetchAPI:!0,secure:!0}};
if(!privatePrepared)electron.protocol.registerSchemesAsPrivileged([i]);
electron.protocol.registerSchemesAsPrivileged=new Proxy(electron.protocol.registerSchemesAsPrivileged,{apply:(a,s,o)=>{a([...o[0],i])}});
const n=createRendererEventLoopBlockStatusHandler(t);`;

function startupLoggingCalls(source) {
  return [...source.matchAll(/([A-Za-z_$][\w$]*)\.info\("Starting RiotClientUx electron with args",cliArgs\)/g)];
}
const hasUnsafeStartupLog = (source) => startupLoggingCalls(source).length > 0;

function preparePrivateHostBeforeReady({ app, protocol }, { globalObject = globalThis } = {}) {
  if (!app || typeof app.isReady !== 'function' || app.isReady() || typeof app.disableHardwareAcceleration !== 'function' || typeof protocol?.registerSchemesAsPrivileged !== 'function') throw new Error('Private UI must initialize its runtime before Electron is ready');
  const marker = Symbol.for(PRIVATE_BOOTSTRAP_SYMBOL);
  if (globalObject[marker]) throw new Error('Private UI runtime setup has already been registered');
  // This preserves the vendor's software-rendering default. The synthetic CLI
  // flag only prevents its main from repeating this call after app.whenReady.
  app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'sentry-ipc', privileges: { ...PROTOCOL_PRIVILEGES } }]);
  const state = Object.freeze({ version: 1, scheme: 'sentry-ipc', privileges: PROTOCOL_PRIVILEGES, gpuDisabled: true, protocolRegistered: true });
  globalObject[marker] = state;
  return state;
}

function hardenPrivateMainSource(source) {
  if (typeof source !== 'string') throw new Error('Private UI main source is invalid');
  if (source.includes(PRIVATE_LOG_GUARD_MARKER) || source.includes(PRIVATE_COMPATIBILITY_MARKER)) {
    if (!source.includes(PRIVATE_LOG_GUARD_MARKER) || !source.includes(PRIVATE_COMPATIBILITY_MARKER) || hasUnsafeStartupLog(source) || source.includes(ORIGINAL_PROTOCOL_BOOTSTRAP) || source.includes(ORIGINAL_PROTOCOL_BOOTSTRAP_142)) throw new Error('Private UI logging or runtime guard is inconsistent');
    return source;
  }
  const logging = startupLoggingCalls(source);
  if (logging.length !== 1) throw new Error('This Riot UI logging layout is not supported');
  const protocols = [[ORIGINAL_PROTOCOL_BOOTSTRAP, PRIVATE_PROTOCOL_BOOTSTRAP], [ORIGINAL_PROTOCOL_BOOTSTRAP_142, PRIVATE_PROTOCOL_BOOTSTRAP_142]];
  const matches = protocols.filter(([original]) => source.includes(original));
  if (matches.length !== 1) throw new Error('This Riot UI runtime initialization layout is not supported');
  const [originalProtocol, privateProtocol] = matches[0];
  if (source.indexOf(originalProtocol, source.indexOf(originalProtocol) + 1) >= 0) throw new Error('This Riot UI runtime initialization layout is not supported');
  const guard = PRIVATE_LOG_GUARD_SOURCE.replaceAll('log$d', () => logging[0][1]);
  const result = source.replace(logging[0][0], () => guard).replace(originalProtocol, () => privateProtocol);
  new Function(result);
  return result;
}

function absolutePath(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value) || !path.isAbsolute(value)) throw new Error('Private UI paths must be absolute');
  return path.resolve(value);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function canonicalWorkspacePath(value, workspaceRoot, { createDirectory = false } = {}) {
  const target = absolutePath(value);
  if (!isWithin(workspaceRoot, target)) throw new Error('Private UI files must stay inside the workspace');
  if (createDirectory) {
    // Verify the closest existing ancestor before creating any directory.
    let ancestor = target;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const realAncestor = fs.realpathSync(ancestor);
    if (realAncestor !== workspaceRoot && !isWithin(workspaceRoot, realAncestor)) throw new Error('Private UI path escapes the workspace');
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  }
  const real = fs.realpathSync(target);
  if (!isWithin(workspaceRoot, real)) throw new Error('Private UI path escapes the workspace');
  return real;
}

function validateConnection({ appPort, appPid, remotingAuthToken }) {
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) throw new Error('Private UI backend port is invalid');
  if (!Number.isSafeInteger(appPid) || appPid < 1 || appPid > 0xffffffff) throw new Error('Private UI backend process is invalid');
  if (typeof remotingAuthToken !== 'string' || remotingAuthToken.length < 1 || remotingAuthToken.length > 4096 || /[\x00-\x20\x7f]/.test(remotingAuthToken)) throw new Error('Private UI backend credential is invalid');
}

// This array is only assigned to process.argv in memory. It must never be
// supplied to child_process.spawn or printed to stdout, stderr, or a log.
function buildLaunchArguments({ appPort, remotingAuthToken, appPid, userDataRoot, logDir }) {
  validateConnection({ appPort, remotingAuthToken, appPid });
  userDataRoot = absolutePath(userDataRoot);
  logDir = absolutePath(logDir);
  return [
    `--appPort=${appPort}`, `--remotingAuthToken=${remotingAuthToken}`, `--appPid=${appPid}`,
    `--userDataRoot=${userDataRoot}`, `--logDir=${logDir}`,
    '--enableHardwareAcceleration=true',
    '--crashpadEnvironment=private-local', '--machineId=private-local', '--sessionId=private-local',
  ];
}

function readSmallJson(file) {
  const size = fs.statSync(file).size;
  if (size < 2 || size > 128 * 1024) throw new Error('Private UI manifest is invalid');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('Private UI manifest is invalid'); }
}

function validateHostRequest(request, { workspaceRoot = DEFAULT_WORKSPACE } = {}) {
  const expectedKeys = ['candidatePath', 'manifestPath', 'appPort', 'appPid', 'encryptedAuthToken', 'userDataRoot', 'logDir'];
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(request, key))) throw new Error('Private UI launch request is invalid');
  workspaceRoot = fs.realpathSync(absolutePath(workspaceRoot));
  const candidatePath = canonicalWorkspacePath(request.candidatePath, workspaceRoot);
  const manifestPath = canonicalWorkspacePath(request.manifestPath, workspaceRoot);
  if (path.basename(candidatePath).toLowerCase() !== 'app.asar' || path.dirname(candidatePath) !== path.dirname(manifestPath)) throw new Error('Private UI candidate and manifest do not match');
  if (typeof request.encryptedAuthToken !== 'string' || request.encryptedAuthToken.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(request.encryptedAuthToken) || request.encryptedAuthToken.length % 4 !== 0) throw new Error('Private UI encrypted credential is invalid');
  validateConnection({ appPort: request.appPort, appPid: request.appPid, remotingAuthToken: 'validated-after-decryption' });
  const manifest = readSmallJson(manifestPath);
  if (manifest.schemaVersion !== 1 || !manifest.source || !manifest.candidate || !Array.isArray(manifest.changedFiles)) throw new Error('Private UI manifest is invalid');
  if (manifest.mode !== 'private-host' || manifest.privacy?.startupArgumentsRedacted !== true || manifest.privacy?.logGuardInstalled !== true) throw new Error('Private UI manifest privacy guarantees are missing');
  const sourcePath = fs.realpathSync(absolutePath(manifest.source.path));
  if (sourcePath === candidatePath || fs.realpathSync(absolutePath(manifest.candidate.path)) !== candidatePath) throw new Error('Private UI archive paths do not match the manifest');
  for (const [file, details] of [[sourcePath, manifest.source], [candidatePath, manifest.candidate]]) {
    if (!Number.isSafeInteger(details.size) || details.size < 16 || !/^[a-f0-9]{64}$/.test(details.sha256) || fs.statSync(file).size !== details.size || sha256File(file) !== details.sha256) throw new Error('Private UI archive verification failed');
  }
  let source;
  let candidate;
  try {
    source = openArchive(sourcePath);
    candidate = openArchive(candidatePath);
    const sourcePackage = JSON.parse(source.readFile('package.json', 16384));
    const candidatePackage = JSON.parse(candidate.readFile('package.json', 16384));
    for (const pkg of [sourcePackage, candidatePackage, manifest.source.package]) {
      if (!pkg || pkg.name !== 'riot-client-ux' || pkg.main !== './dist/main/main.js' || !isSupportedVersion(pkg.version)) throw new Error('This Riot Client version is not supported by the private UI');
    }
    if (candidatePackage.version !== sourcePackage.version || manifest.source.package.version !== sourcePackage.version) throw new Error('Private UI package versions do not match');
    if (sourcePackage.version === '142.0.0' && (manifest.behavior?.externalMultifactorRecovery !== true || !candidate.readFile('dist/renderer/renderer.js', 20 * 1024 * 1024).includes(Buffer.from(PRIVATE_RENDERER_MFA_MARKER)))) throw new Error('Private UI multifactor recovery adapter is missing');
    for (const name of REQUIRED_ENTRIES) {
      const metadata = manifest.changedFiles.find((entry) => entry.name === name);
      const contents = candidate.readFile(name, 20 * 1024 * 1024);
      if (!metadata || metadata.size !== contents.length || metadata.sha256 !== crypto.createHash('sha256').update(contents).digest('hex') || !contents.includes(Buffer.from('RAM_LOGIN_INTEGRATION_V1'))) throw new Error('Private UI addon verification failed');
    }
    const main = candidate.readFile('dist/main/main.js', 20 * 1024 * 1024).toString('utf8');
    if (!main.includes(PRIVATE_LOG_GUARD_MARKER) || hasUnsafeStartupLog(main)) throw new Error('Private UI logging guard is missing');
    if (!main.includes(PRIVATE_COMPATIBILITY_MARKER) || main.includes(ORIGINAL_PROTOCOL_BOOTSTRAP) || main.includes(ORIGINAL_PROTOCOL_BOOTSTRAP_142)) throw new Error('Private UI runtime compatibility guard is missing');
  } finally { source?.close(); candidate?.close(); }
  const userDataRoot = canonicalWorkspacePath(request.userDataRoot, workspaceRoot, { createDirectory: true });
  const logDir = canonicalWorkspacePath(request.logDir, workspaceRoot, { createDirectory: true });
  const profilePath = canonicalWorkspacePath(path.join(userDataRoot, 'private-electron-profile'), workspaceRoot, { createDirectory: true });
  return {
    candidatePath, manifestPath, sourcePath, userDataRoot, logDir, profilePath,
    appPort: request.appPort, appPid: request.appPid, encryptedAuthToken: request.encryptedAuthToken,
    mainPath: path.join(candidatePath, 'dist', 'main', 'main.js'),
    candidateSha256: manifest.candidate.sha256,
  };
}

module.exports = { SUPPORTED_VERSION, SUPPORTED_VERSIONS, isSupportedVersion, hasUnsafeStartupLog, PRIVATE_LOG_GUARD_MARKER, PRIVATE_COMPATIBILITY_MARKER, PRIVATE_BOOTSTRAP_SYMBOL, ORIGINAL_PROTOCOL_BOOTSTRAP, ORIGINAL_PROTOCOL_BOOTSTRAP_142, preparePrivateHostBeforeReady, hardenPrivateMainSource, buildLaunchArguments, validateHostRequest };
