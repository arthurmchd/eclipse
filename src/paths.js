const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(PROJECT_ROOT, 'src');
const RENDERER_DIR = path.join(SOURCE_DIR, 'renderer');
const WINDOWS_HELPERS_DIR = path.join(SOURCE_DIR, 'platform', 'windows');
const APP_ICON = path.join(RENDERER_DIR, 'assets', 'icon.png');
const APP_TRAY_ICON = path.join(RENDERER_DIR, 'assets', 'icon.ico');
const MANAGER_PRELOAD_FILE = path.join(SOURCE_DIR, 'integration', 'manager', 'manager-preload.js');
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
  WINDOWS_HELPERS_DIR,
  APP_ICON,
  APP_TRAY_ICON,
  MANAGER_PRELOAD_FILE,
  ACCOUNT_CARDS_FILE,
  OVERLAY_TOGGLE_FILE,
  OVERLAY_TOGGLE_PRELOAD_FILE,
  OVERLAY_COVER_FILE,
  unpackedPath,
  windowsHelper,
};
