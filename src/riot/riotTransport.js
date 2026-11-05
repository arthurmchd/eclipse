const https = require('https');
const { readBackend, readBackendCertificate } = require('../integration/backend');

function createRiotTransport({ clientPath, connection = readBackend, certificate = readBackendCertificate, request = https.request, maxBytes = 1024 * 1024 } = {}) {
  return function localApi(method, apiPath, body, timeoutMs = 4000, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(new Error('Sign-in cancelled'));
    if (typeof apiPath !== 'string' || !apiPath.startsWith('/') || /[\r\n\0]/.test(apiPath)) return Promise.reject(new Error('Invalid local Riot request'));
    return new Promise((resolve, reject) => {
      let req, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(value);
      };
      const fail = () => finish(new Error('The local Riot service could not complete the request'));
      const cancel = () => { finish(new Error('Sign-in cancelled')); req?.destroy(); };
      try {
        const backend = connection();
        const ca = certificate(typeof clientPath === 'function' ? clientPath() : clientPath);
        req = request({
          hostname: '127.0.0.1', port: backend.port, method, path: apiPath,
          ca, rejectUnauthorized: true, auth: `riot:${backend.token}`,
          headers: { 'Content-Type': 'application/json' }, timeout: timeoutMs,
        }, (res) => {
          if (settled) { res.resume(); return; }
          let size = 0;
          const chunks = [];
          res.on('data', (chunk) => {
            size += Buffer.byteLength(chunk);
            if (size > maxBytes) { fail(); res.destroy(); return; }
            if (!settled) chunks.push(Buffer.from(chunk));
          });
          res.on('error', fail);
          res.on('aborted', fail);
          res.on('end', () => {
            let json = null;
            try { json = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch {}
            finish(null, { status: res.statusCode, json });
          });
        });
        req.on('error', fail);
        req.on('timeout', () => { fail(); req.destroy(); });
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        req.end(body === undefined || body === null ? undefined : JSON.stringify(body));
      } catch { fail(); }
    });
  };
}

module.exports = { createRiotTransport };
