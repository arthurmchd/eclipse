;(() => {
  'use strict';
  const marker = Symbol.for('riot-account-manager.main.v1');
  if (globalThis[marker]) return;
  globalThis[marker] = true;
  try {
    const { app, BrowserWindow, ipcMain } = require('electron');
    const { execFile } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    const OFFLINE = 'Open Riot Account Manager to connect';
    const MAX_RESPONSE_BYTES = 512 * 1024;
    const DPAPI_COMMAND = '__RAM_DPAPI_HELPER_BASE64__';
    let cachedConnection = null;
    const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
    const shortText = (value, max = 512) => typeof value === 'string' ? value.slice(0, max) : '';

    function trustedSender(event) {
      try {
        const sender = event.sender;
        if (!sender || sender.isDestroyed() || event.senderFrame !== sender.mainFrame) return false;
        const window = BrowserWindow.fromWebContents(sender);
        if (!window || window.isDestroyed() || window.getTitle() !== 'Riot Client') return false;
        const url = new URL(event.senderFrame.url);
        return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
          && !url.username && !url.password && /^\d+$/.test(url.port)
          && Number(url.port) > 0 && Number(url.port) <= 65535
          && sender.getURL() === event.senderFrame.url;
      } catch { return false; }
    }

    function unprotectToken(value) {
      return new Promise((resolve, reject) => {
        const failed = () => reject(new Error(OFFLINE));
        const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', DPAPI_COMMAND], {
          windowsHide: true, timeout: 6000, maxBuffer: 65536, encoding: 'utf8',
        }, (error, output) => {
          if (error) { failed(); return; }
          try {
            const result = JSON.parse(output.trim());
            if (result.ok !== true || typeof result.value !== 'string') throw new Error();
            resolve(result.value);
          } catch { failed(); }
        });
        child.stdin.on('error', failed);
        child.stdin.end(JSON.stringify({ action: 'unprotect', value }));
      });
    }

    async function discovery() {
      const base = process.env.APPDATA || app.getPath('appData');
      const file = path.join(base, 'riot-account-manager', 'riot-client-bridge.json');
      if (fs.statSync(file).size > 8192) throw new Error(OFFLINE);
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (config.version !== 1 || !Number.isInteger(config.pid) || config.pid <= 0
          || !Number.isInteger(config.port) || config.port <= 0 || config.port > 65535
          || typeof config.token !== 'string' || config.token.length > 8192
          || !/^[a-zA-Z0-9+/]+={0,2}$/.test(config.token)) throw new Error(OFFLINE);
      if (cachedConnection?.blob === config.token && cachedConnection.pid === config.pid && cachedConnection.port === config.port) return cachedConnection;
      const token = await unprotectToken(config.token);
      if (typeof token !== 'string' || token.length < 32 || token.length > 256 || /[\r\n\x00]/.test(token)) throw new Error(OFFLINE);
      cachedConnection = { pid: config.pid, port: config.port, token, blob: config.token };
      return cachedConnection;
    }

    async function request(method, endpoint, payload) {
      let config;
      try { config = await discovery(); } catch { throw new Error(OFFLINE); }
      return new Promise((resolve, reject) => {
        const body = payload === undefined ? null : JSON.stringify(payload);
        const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/json' };
        if (body) {
          headers['Content-Type'] = 'application/json';
          headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = http.request({ hostname: '127.0.0.1', port: config.port, path: endpoint, method, headers, timeout: 4000 }, (res) => {
          let size = 0;
          const chunks = [];
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              res.destroy();
              reject(new Error('Account Manager returned too much data'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', () => reject(new Error(OFFLINE)));
          res.on('end', () => {
            let result;
            try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { reject(new Error('Account Manager returned an invalid response')); return; }
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
              reject(new Error('Account Manager returned an invalid response')); return;
            }
            if (res.statusCode < 200 || res.statusCode >= 300 || result.ok === false) {
              reject(new Error(shortText(result.error) || 'Account Manager could not complete the request')); return;
            }
            resolve(result);
          });
        });
        req.on('error', () => reject(new Error(OFFLINE)));
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end(body);
      });
    }

    function publicState(value) {
      const accounts = (Array.isArray(value.accounts) ? value.accounts : []).filter((account) => account && validId(account.id)).slice(0, 1000).map((account) => ({
        id: account.id, gameName: shortText(account.gameName, 64), tagLine: shortText(account.tagLine, 32),
        hasPassword: account.hasPassword === true, hasSession: account.hasSession === true,
      }));
      const input = value.operation;
      let operation = null;
      if (input && typeof input === 'object' && ['running', 'succeeded', 'failed', 'cancelled'].includes(input.status)) {
        operation = {
          id: shortText(input.id || input.operationId, 128), accountId: validId(input.accountId) ? input.accountId : '',
          game: ['lol', 'tft', 'val'].includes(input.game) ? input.game : '',
          status: input.status, text: shortText(input.text), needsAttention: input.needsAttention === true,
          error: shortText(input.error), cancelled: input.cancelled === true,
        };
      }
      return { ok: true, accounts, operation };
    }

    function register(name, handler) {
      ipcMain.handle(`ram-client:${name}`, async (event, ...args) => {
        if (!trustedSender(event)) return { ok: false, error: 'This account panel is only available in the Riot Client' };
        try { return await handler(...args); }
        catch (error) { return { ok: false, error: shortText(error.message) || OFFLINE }; }
      });
    }

    app.whenReady().then(() => {
      register('state', async () => publicState(await request('GET', '/v1/state')));
      register('sign-in', async (accountId, game) => {
        if (!validId(accountId) || !['lol', 'tft', 'val'].includes(game)) return { ok: false, error: 'Select a saved account and a game' };
        const result = await request('POST', '/v1/sign-in', { accountId, game });
        if (typeof result.operationId !== 'string' || result.operationId.length > 128) return { ok: false, error: 'Account Manager did not accept the sign-in operation' };
        return { ok: true, operationId: result.operationId };
      });
      register('cancel', async () => { await request('POST', '/v1/cancel', {}); return { ok: true }; });
      register('open-manager', async () => { await request('POST', '/v1/open-manager', {}); return { ok: true }; });
    }).catch(() => {});
  } catch {
  }
})();
