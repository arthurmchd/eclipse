const { spawn: spawnProcess } = require('child_process');
const { environmentForRiot } = require('../platform/windows/windowsEnvironment');

function launchClient(exe, { visible = false, interfaceRequired = visible, spawn = spawnProcess } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, interfaceRequired ? [] : ['--headless'], {
      detached: true, stdio: 'ignore', windowsHide: !visible, env: environmentForRiot(),
    });
    child.once('error', () => reject(new Error('Could not start the Riot Client. Check its path and Windows permissions')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { launchClient };
