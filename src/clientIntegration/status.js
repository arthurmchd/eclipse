const fs = require('fs');
const path = require('path');
const { openArchive } = require('./asar');

function inspectClientIntegration(clientPath) {
  if (!clientPath) return { active: false, reason: 'Riot Client not found' };
  const file = path.join(path.dirname(clientPath), 'RiotClientElectron', 'resources', 'app.asar');
  if (!fs.existsSync(file)) return { active: false, reason: 'Riot Client interface not found' };
  let archive;
  try {
    archive = openArchive(file);
    const pkg = JSON.parse(archive.readFile('package.json', 16384));
    if (pkg.name !== 'riot-client-ux' || pkg.version !== '141.0.0') return { active: false, version: pkg.version, reason: 'This Riot Client version has not been validated for the experimental panel' };
    const entries = ['dist/main/main.js', 'dist/main/preload.js', 'dist/renderer/renderer.js'];
    const active = entries.every((entry) => archive.readFile(entry, 20 * 1024 * 1024).includes(Buffer.from('RAM_LOGIN_INTEGRATION_V1')));
    return {
      active, version: pkg.version,
      reason: active ? null : 'The Riot Client is using its original interface. The experimental account panel is not installed or was replaced when Riot started',
    };
  } catch {
    return { active: false, reason: 'Could not verify the experimental Riot login integration' };
  } finally { archive?.close(); }
}

module.exports = { inspectClientIntegration };
