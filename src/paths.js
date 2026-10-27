const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(PROJECT_ROOT, 'src');
const RENDERER_DIR = path.join(SOURCE_DIR, 'renderer');
const ADDON_DIR = path.join(SOURCE_DIR, 'integration', 'addon');
const WINDOWS_HELPERS_DIR = path.join(SOURCE_DIR, 'platform', 'windows');
const PRIVATE_HOST_ENTRY = path.join(SOURCE_DIR, 'integration', 'host', 'hostEntry.js');
const INTEGRATION_DATA_DIR = path.join(PROJECT_ROOT, '.client-integration');
const PRIVATE_HOST_DIR = path.join(INTEGRATION_DATA_DIR, 'private-v1');
const APP_ICON = path.join(RENDERER_DIR, 'assets', 'icon.png');

function unpackedPath(file) {
  return file.replace('app.asar', 'app.asar.unpacked');
}

function windowsHelper(name) {
  return unpackedPath(path.join(WINDOWS_HELPERS_DIR, name));
}

module.exports = {
  PROJECT_ROOT,
  SOURCE_DIR,
  RENDERER_DIR,
  ADDON_DIR,
  WINDOWS_HELPERS_DIR,
  PRIVATE_HOST_ENTRY,
  INTEGRATION_DATA_DIR,
  PRIVATE_HOST_DIR,
  APP_ICON,
  unpackedPath,
  windowsHelper,
};
