// Electron can load entry scripts through its default application module.
// Keep startup explicit instead of relying on require.main identity.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const bootstrapRoot = path.join(__dirname, '..', '.client-integration', 'private-v1');
const bootstrapProfile = path.join(bootstrapRoot, 'user-data', 'private-electron-profile');
fs.mkdirSync(bootstrapProfile, { recursive: true });
// Choose the isolated profile before the first event-loop turn, including
// while waiting for the encrypted launch request over stdin.
app.setPath('userData', bootstrapProfile);
app.setPath('sessionData', bootstrapProfile);
fs.writeFileSync(path.join(bootstrapRoot, 'bootstrap-status.json'), JSON.stringify({
  started: true, electron: process.versions.electron || null,
  executable: path.basename(process.execPath), hasStdin: Boolean(process.stdin), hasStdout: Boolean(process.stdout),
}));
const { connectBootstrapChannel } = require('../src/clientIntegration/bootstrapChannel');
const flag = process.argv.find((argument) => argument.startsWith('--ram-bootstrap-pipe='));
if (!flag) app.exit(1);
const channel = connectBootstrapChannel(flag.slice('--ram-bootstrap-pipe='.length));
const write = channel.write.bind(channel);
function failed(error) {
  const locations = [];
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  for (const match of stack.matchAll(/(privateHost(?:Core)?\.js):(\d+):(\d+)/g)) locations.push(`${match[1]}:${match[2]}:${match[3]}`);
  write(`${JSON.stringify({ event: 'error', stage: 'bootstrap', kind: ['Error', 'TypeError', 'SyntaxError', 'ReferenceError'].includes(error?.name) ? error.name : 'Error', locations: locations.slice(0, 3) })}\n`);
  require('electron').app.exit(1);
}
const stages = [];
try {
  Promise.resolve(require('../src/clientIntegration/privateHost').runPrivateHost({
    input: channel, protocolOutput: channel,
    diagnostic: (stage) => { stages.push(stage); fs.writeFileSync(path.join(bootstrapRoot, 'bootstrap-status.json'), JSON.stringify({ started: true, stages: stages.slice(-12) })); },
  })).catch(failed);
}
catch (error) { failed(error); }
