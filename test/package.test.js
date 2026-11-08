const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT, WINDOWS_HELPERS_DIR } = require('../src/paths');

const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const build = pkg.build;

test('the installed Eclipse keeps the data folder of npm start', () => {
  assert.equal(pkg.name, 'riot-account-manager');
  assert.equal(Object.hasOwn(pkg, 'productName'), false);
  assert.equal(build.productName, 'Eclipse');
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
});

test('only the code goes into the package, and every PowerShell helper stays outside the asar', () => {
  assert.deepEqual(build.files, ['src/**/*', 'package.json']);
  assert.deepEqual(build.asarUnpack, ['src/platform/windows/*.ps1']);
  const helpers = fs.readdirSync(WINDOWS_HELPERS_DIR).filter((name) => name.endsWith('.ps1'));
  assert.ok(helpers.length > 0);
  const scripts = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.ps1')) scripts.push(path.relative(WINDOWS_HELPERS_DIR, file));
    }
  })(path.join(PROJECT_ROOT, 'src'));
  assert.deepEqual(scripts.sort(), helpers.sort());
});

test('the installer is per user, without admin, with shortcuts and without publishing or auto-update files', () => {
  assert.deepEqual(build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(build.win.icon, 'src/renderer/assets/icon.ico');
  assert.ok(fs.existsSync(path.join(PROJECT_ROOT, build.win.icon)));
  assert.equal(build.publish, null);
  assert.equal(build.npmRebuild, false);
  assert.equal(Object.hasOwn(build, 'electronDist'), false);
  assert.deepEqual({ ...build.nsis, include: undefined }, {
    oneClick: true, guid: '1cee5ad5-fb20-5488-b349-ffcaaa593158', perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Eclipse',
    runAfterFinish: true, deleteAppDataOnUninstall: false, packElevateHelper: false, include: undefined,
  });
  assert.equal(pkg.devDependencies['electron-builder'], '26.18.0');
  assert.equal(pkg.scripts.dist, 'electron-builder --win nsis --x64');
});

test('uninstalling removes only the Eclipse start with Windows entry, and keeps it when a new version installs over the old one', () => {
  const script = fs.readFileSync(path.join(PROJECT_ROOT, build.nsis.include), 'utf8');
  assert.match(script, /!macro customUnInstall\s+\$\{ifNot\} \$\{isUpdated\}/);
  const removed = [...script.matchAll(/DeleteRegValue HKCU "([^"]+)" "([^"]+)"/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(removed, [
    ['Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'Eclipse'],
    ['Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', 'Eclipse'],
  ]);
  assert.doesNotMatch(script, /DeleteRegKey|RMDir|Delete\s|APPDATA|^\s*[;#]/m);
});

test('the installer names Eclipse as its maker and keeps the uninstall key of the first Setup, so a new one installs over it', () => {
  assert.equal(pkg.author, 'Eclipse');
  assert.equal(build.appId, 'Eclipse.AccountManager');
  assert.equal(build.copyright, undefined);
  assert.equal(build.nsis.guid, '1cee5ad5-fb20-5488-b349-ffcaaa593158');
  assert.doesNotMatch(JSON.stringify(pkg), /arthur/i);
});
