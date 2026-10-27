const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY_BYTES = 4096;
const ACCOUNT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const GAMES = new Set(['lol', 'tft', 'val']);

function pickString(source, target, key, limit = 256) {
  if (typeof source?.[key] === 'string') target[key] = source[key].slice(0, limit);
}

function publicAccounts(accounts) {
  if (!Array.isArray(accounts)) throw new Error('Invalid account list');
  return accounts.map((account) => {
    const result = {};
    for (const key of ['id', 'gameName', 'tagLine', 'region']) pickString(account, result, key, 128);
    result.hasSession = Boolean(account?.hasSession);
    result.hasPassword = Boolean(account?.hasPassword);
    return result;
  });
}

function publicOperation(operation) {
  if (!operation || typeof operation !== 'object') return null;
  const result = {};
  for (const key of ['id', 'operationId', 'accountId', 'game', 'status', 'startedAt', 'finishedAt']) pickString(operation, result, key);
  for (const key of ['text', 'error']) pickString(operation, result, key, 1024);
  result.needsAttention = Boolean(operation.needsAttention);
  if (typeof operation.cancelled === 'boolean') result.cancelled = operation.cancelled;
  if (result.id && !result.operationId) result.operationId = result.id;
  if (result.operationId && !result.id) result.id = result.operationId;
  return result;
}

function requestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJson(request) {
  if (Number(request.headers['content-length'] || 0) > MAX_BODY_BYTES) throw requestError(413, 'Request is too large');
  const contentType = request.headers['content-type'];
  if (contentType && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) throw requestError(415, 'Expected JSON');
  const body = await new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    let complete = false;
    request.on('data', (chunk) => {
      if (complete) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { complete = true; reject(requestError(413, 'Request is too large')); return; }
      chunks.push(chunk);
    });
    request.once('end', () => { if (!complete) { complete = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    request.once('error', () => { if (!complete) { complete = true; reject(requestError(400, 'Incomplete request')); } });
    request.once('aborted', () => { if (!complete) { complete = true; reject(requestError(400, 'Incomplete request')); } });
  });
  if (!body.trim()) return {};
  let input;
  try { input = JSON.parse(body); } catch { throw requestError(400, 'Invalid JSON'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw requestError(400, 'Expected a JSON object');
  return input;
}

function createClientBridge({ directory, encodeToken, listAccounts, getState, signIn, cancel, openManager, onError = () => {} } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('An absolute bridge directory is required');
  for (const [name, callback] of Object.entries({ encodeToken, listAccounts, getState, signIn, cancel, openManager })) {
    if (typeof callback !== 'function') throw new Error(`${name} callback is required`);
  }
  const discoveryPath = path.join(directory, 'riot-client-bridge.json');
  let instance = null;
  let starting = null;
  let stopping = null;

  function reportFailure() {
    try { onError(new Error('Riot Client bridge request failed')); } catch {}
  }

  function cleanupDiscovery(record) {
    try {
      const saved = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
      if (saved.version === record.version && saved.pid === record.pid && saved.port === record.port && saved.token === record.token) fs.unlinkSync(discoveryPath);
    } catch (error) {
      if (error.code !== 'ENOENT') reportFailure();
    }
  }

  function reply(response, status, value) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Connection': 'close',
    });
    response.end(JSON.stringify(value));
  }

  async function startInstance() {
    const token = crypto.randomBytes(32).toString('hex');
    const encryptedToken = await encodeToken(token);
    if (typeof encryptedToken !== 'string' || !encryptedToken || encryptedToken === token) throw new Error('Bridge token must be encoded before discovery');
    const tokenBytes = Buffer.from(token);
    const sockets = new Set();
    const current = { server: null, record: null, closing: false, sockets };
    const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000, keepAliveTimeout: 1000 }, (request, response) => {
      (async () => {
        if (current.closing) throw requestError(503, 'Bridge is stopping');
        const remote = request.socket.remoteAddress;
        if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') throw requestError(403, 'Local requests only');
        if (request.headers.host !== `127.0.0.1:${current.record?.port}`) throw requestError(403, 'Invalid local host');
        if (request.headers.origin !== undefined) throw requestError(403, 'Browser origins are not allowed');
        const authorization = request.headers.authorization;
        const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const supplied = Buffer.from(bearer);
        if (supplied.length !== tokenBytes.length || !crypto.timingSafeEqual(supplied, tokenBytes)) throw requestError(401, 'Unauthorized');

        if (request.method === 'GET' && request.url === '/v1/state') {
          if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) > 0) throw requestError(400, 'Unexpected request body');
          const [accounts, operation] = await Promise.all([listAccounts(), getState()]);
          reply(response, 200, { ok: true, accounts: publicAccounts(accounts), operation: publicOperation(operation) });
          return;
        }
        if (request.method !== 'POST' || !['/v1/sign-in', '/v1/cancel', '/v1/open-manager'].includes(request.url)) throw requestError(404, 'Endpoint not found');
        const input = await readJson(request);
        if (request.url === '/v1/sign-in') {
          if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'accountId') || !Object.hasOwn(input, 'game') || typeof input.accountId !== 'string' || !ACCOUNT_ID.test(input.accountId) || !GAMES.has(input.game)) throw requestError(400, 'Invalid account or game');
          const result = await signIn({ accountId: input.accountId, game: input.game });
          if (typeof result?.operationId !== 'string' || !result.operationId || result.operationId.length > 256) throw new Error('Invalid operation result');
          reply(response, 202, { ok: true, operationId: result.operationId });
          return;
        }
        if (Object.keys(input).length) throw requestError(400, 'Unexpected fields');
        if (request.url === '/v1/cancel') await cancel();
        else await openManager();
        reply(response, 200, { ok: true });
      })().catch((error) => {
        const expected = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
        if (!expected) reportFailure();
        reply(response, expected ? error.status : 503, { ok: false, error: expected ? error.message : 'The manager could not complete this request' });
      });
    });
    current.server = server;
    server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
    server.on('error', reportFailure);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      current.record = { version: 1, pid: process.pid, port: server.address().port, token: encryptedToken };
      fs.mkdirSync(directory, { recursive: true });
      const temporary = `${discoveryPath}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(current.record), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, discoveryPath);
      } finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
      instance = current;
      return { pid: current.record.pid, port: current.record.port, discoveryPath };
    } catch (error) {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => { if (!server.listening) resolve(); else server.close(resolve); });
      throw error;
    }
  }

  return {
    async start() {
      if (stopping) await stopping;
      if (instance) return { pid: instance.record.pid, port: instance.record.port, discoveryPath };
      if (starting) return starting;
      starting = startInstance();
      try { return await starting; } finally { starting = null; }
    },
    async stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (starting) await starting.catch(() => {});
        const current = instance;
        instance = null;
        if (!current) return;
        current.closing = true;
        cleanupDiscovery(current.record);
        let timer;
        try {
          await new Promise((resolve) => {
            timer = setTimeout(() => { for (const socket of current.sockets) socket.destroy(); resolve(); }, 1000);
            timer.unref?.();
            current.server.close(resolve);
            current.server.closeIdleConnections?.();
          });
        } finally { clearTimeout(timer); }
      })();
      try { await stopping; } finally { stopping = null; }
    },
  };
}

module.exports = { createClientBridge };
