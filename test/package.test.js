const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT } = require('../src/paths');

const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const tauri = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const cargo = fs.readFileSync(path.join(PROJECT_ROOT, 'src-tauri', 'Cargo.toml'), 'utf8');

test('npm no longer builds or runs an Electron Eclipse', () => {
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['preview', 'test']);
  assert.equal(Object.hasOwn(pkg, 'main'), false);
  assert.equal(Object.hasOwn(pkg, 'build'), false);
  assert.equal(Object.hasOwn(pkg, 'devDependencies'), false);
  assert.doesNotMatch(JSON.stringify(pkg), /electron/i);
  assert.equal(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'main')), false);
  assert.equal(fs.existsSync(path.join(PROJECT_ROOT, 'scripts', 'build')), false);
});

test('npm keeps only the fonts the Tauri Setup packs', () => {
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@fontsource/inter', '@fontsource/teko']);
  for (const family of Object.keys(pkg.dependencies)) assert.ok(Object.keys(tauri.bundle.resources).some((source) => source.includes(`node_modules/${family}/`)));
});

test('npm, Tauri and Cargo agree on one version, 2.0.0 or later', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  const [major] = pkg.version.split('.').map(Number);
  assert.ok(major >= 2);
  assert.equal(tauri.version, pkg.version);
  assert.equal(cargo.match(/^version = "([^"]+)"$/m)[1], pkg.version);
});

test('the package keeps the data folder name and names Eclipse as its maker', () => {
  assert.equal(pkg.name, 'riot-account-manager');
  assert.equal(pkg.author, 'Eclipse');
  assert.equal(tauri.identifier, 'Eclipse.AccountManager');
  assert.doesNotMatch(JSON.stringify(pkg), /arthur/i);
});
