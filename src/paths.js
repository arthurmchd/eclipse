const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(PROJECT_ROOT, 'src');
const RENDERER_DIR = path.join(SOURCE_DIR, 'renderer');
const ADDON_DIR = path.join(SOURCE_DIR, 'integration', 'addon');
const WINDOWS_HELPERS_DIR = path.join(SOURCE_DIR, 'platform', 'windows');
const PRIVATE_HOST_ENTRY = path.join(SOURCE_DIR, 'integration', 'host', 'hostEntry.js');
const INTEGRATION_DATA_DIR = path.join(PROJECT_ROOT, '.client-integration');
const PRIVATE_HOST_DIR = path.join(INTEGRATION_DATA_DIR, 'private-v1');
const EMBEDDED_HOST_DIR = path.join(PRIVATE_HOST_DIR, 'embedded-v1');
const APP_ICON = path.join(RENDERER_DIR, 'assets', 'icon.png');
const APP_TRAY_ICON = path.join(RENDERER_DIR, 'assets', 'icon.ico');
const MANAGER_RENDERER_FILE = path.join(RENDERER_DIR, 'index.html');
const MANAGER_PRELOAD_FILE = path.join(SOURCE_DIR, 'integration', 'manager', 'manager-preload.js');
const OVERLAY_RENDERER_FILE = path.join(SOURCE_DIR, 'integration', 'overlay', 'overlay.html');
const OVERLAY_PRELOAD_FILE = path.join(SOURCE_DIR, 'integration', 'overlay', 'overlay-preload.js');
const ACCOUNT_CARDS_FILE = path.join(RENDERER_DIR, 'cards.html');
const OVERLAY_TOGGLE_FILE = path.join(SOURCE_DIR, 'integration', 'overlay', 'toggle.html');
const OVERLAY_TOGGLE_PRELOAD_FILE = path.join(SOURCE_DIR, 'integration', 'overlay', 'toggle-preload.js');
const OVERLAY_COVER_FILE = path.join(SOURCE_DIR, 'integration', 'overlay', 'cover.html');

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
  EMBEDDED_HOST_DIR,
  APP_ICON,
  APP_TRAY_ICON,
  MANAGER_RENDERER_FILE,
  MANAGER_PRELOAD_FILE,
  OVERLAY_RENDERER_FILE,
  OVERLAY_PRELOAD_FILE,
  ACCOUNT_CARDS_FILE,
  OVERLAY_TOGGLE_FILE,
  OVERLAY_TOGGLE_PRELOAD_FILE,
  OVERLAY_COVER_FILE,
  unpackedPath,
  windowsHelper,
};
