const net = require('net');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

function validBootstrapPath(value) {
  if (typeof value !== 'string') return false;
  if (process.platform === 'win32') return /^\\\\\.\\pipe\\riot-accounts-[a-f0-9]{32}$/.test(value);
  return path.dirname(value) === os.tmpdir() && /^riot-accounts-[a-f0-9]{32}\.sock$/.test(path.basename(value));
}

async function createBootstrapChannel({ timeoutMs = 30000 } = {}) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\riot-accounts-${nonce}` : path.join(os.tmpdir(), `riot-accounts-${nonce}.sock`);
  let socket, closed = false, listening = false, timer, accepted = false;
  let resolveConnection, rejectConnection;
  const connected = new Promise((resolve, reject) => { resolveConnection = resolve; rejectConnection = reject; });
  connected.catch(() => {});
  const server = net.createServer((incoming) => {
    if (closed || accepted) { incoming.destroy(); return; }
    accepted = true;
    socket = incoming;
    clearTimeout(timer);
    incoming.on('error', () => {});
    server.close();
    resolveConnection(incoming);
  });
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    socket?.destroy();
    if (listening) server.close();
    rejectConnection(new Error('The private UI startup channel closed'));
  }
  server.on('error', () => { rejectConnection(new Error('The private UI startup channel failed')); close(); });
  try {
    await new Promise((resolve, reject) => {
      const failed = () => reject(new Error('Could not create the private UI startup channel'));
      server.once('error', failed);
      server.listen({ path: pipePath, readableAll: false, writableAll: false }, () => {
        server.removeListener('error', failed); listening = true; resolve();
      });
    });
    timer = setTimeout(() => { rejectConnection(new Error('The private UI startup channel timed out')); close(); }, timeoutMs);
    return { path: pipePath, connected, close };
  } catch (error) { close(); throw error; }
}

function connectBootstrapChannel(pipePath) {
  if (!validBootstrapPath(pipePath)) throw new Error('Invalid private UI startup channel');
  return net.createConnection(pipePath);
}

module.exports = { createBootstrapChannel, connectBootstrapChannel, validBootstrapPath };
