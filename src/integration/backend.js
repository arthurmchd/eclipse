const fs = require('fs');
const path = require('path');
const https = require('https');
const { localAppDataForRiot } = require('../platform/windows/windowsEnvironment');
const { openArchive } = require('./asar');

function parseBackendLockfile(text) {
  if (typeof text !== 'string' || text.length > 8192) throw new Error('Riot backend lockfile is invalid');
  const parts = text.trim().split(':');
  const [, pidText, portText, token, protocol] = parts;
  const pid = Number(pidText), port = Number(portText);
  if (parts.length !== 5 || !Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port < 1 || port > 65535
      || !token || token.length > 256 || /[\x00-\x20\x7f]/.test(token) || protocol !== 'https') {
    throw new Error('Riot backend lockfile is invalid');
  }
  return { pid, port, token };
}

function readBackend({ localAppData = localAppDataForRiot(), readFile = fs.readFileSync } = {}) {
  if (!localAppData || !path.isAbsolute(localAppData)) throw new Error('The Windows Riot profile could not be located');
  try {
    return parseBackendLockfile(readFile(path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile'), 'utf8'));
  } catch {
    throw new Error('The Riot background service is not ready');
  }
}

function readBackendCertificate(clientPath) {
  const file = path.join(path.dirname(clientPath), 'RiotClientElectron', 'resources', 'app.asar');
  const archive = openArchive(file);
  try { return archive.readFile('dist/main/root.pem', 64 * 1024); }
  finally { archive.close(); }
}

function verifyBackend(backend, certificate, { request = https.request, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('Could not verify the Riot background service over HTTPS'));
    const req = request({
      hostname: '127.0.0.1', port: backend.port, method: 'GET', path: '/rso-auth/v1/session',
      auth: `riot:${backend.token}`, ca: certificate, rejectUnauthorized: true, timeout: timeoutMs,
    }, (response) => {
      response.resume();
      response.once('error', fail);
      response.once('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(true);
        else fail();
      });
    });
    req.once('error', fail);
    req.once('timeout', () => { req.destroy(); fail(); });
    req.end();
  });
}

module.exports = { parseBackendLockfile, readBackend, readBackendCertificate, verifyBackend };
