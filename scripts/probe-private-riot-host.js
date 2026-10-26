// Read-only compatibility probe: starts no Riot process and never requests
// sign-in, sign-out, a game launch or changes to a saved account.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createPrivateClient } = require('../src/clientIntegration/privateClient');
const { readBackend } = require('../src/clientIntegration/backend');
const { protectString } = require('../src/clientIntegration/windowsDpapi');
const { createClientBridge } = require('../src/clientIntegration/bridgeServer');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.client-integration', 'private-v1', 'probe-controller');
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
