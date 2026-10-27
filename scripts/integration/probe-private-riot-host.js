const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createPrivateClient } = require('../../src/integration/privateClient');
const { readBackend } = require('../../src/integration/backend');
const { protectString } = require('../../src/platform/windows/windowsDpapi');
const { createClientBridge } = require('../../src/integration/bridgeServer');

const { PROJECT_ROOT: root, PRIVATE_HOST_DIR } = require('../../src/paths');
const directory = path.join(PRIVATE_HOST_DIR, 'probe-controller');
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', directory);
app.setPath('sessionData', directory);
const resultFile = path.join(directory, 'result.json');

app.whenReady().then(async () => {
  const controller = createPrivateClient({
    workspaceRoot: root,
    encodeToken: protectString,
    ensureBackend: async () => { readBackend(); },
  });
  let result;
  let probeBridge;
  try {
    const bridgeDirectory = path.join(app.getPath('appData'), 'riot-account-manager');
    if (!fs.existsSync(path.join(bridgeDirectory, 'riot-client-bridge.json'))) {
      probeBridge = createClientBridge({
        directory: bridgeDirectory, encodeToken: protectString, listAccounts: () => [], getState: () => null,
        signIn: () => { throw new Error('Authentication is disabled in this probe'); }, cancel: () => {}, openManager: () => {},
      });
      await probeBridge.start();
    }
    const value = await controller.open('C:/Riot Games/Riot Client/RiotClientServices.exe');
    result = { ok: value.ready && value.managerConnected, rendererReady: value.ready, managerConnected: value.managerConnected, mode: value.mode, authenticationTested: false };
  } catch (error) {
    result = { ok: false, error: error.message, diagnostic: error.diagnostic, authenticationTested: false };
  } finally {
    await controller.stop();
    await probeBridge?.stop();
  }
  result.runtime = { electron: process.versions.electron || null, executable: path.basename(process.execPath) };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
}).catch(() => {
  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: 'Private compatibility probe failed before startup' }));
  app.exit(1);
});
