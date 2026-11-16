const http = require('http');
const fs = require('fs');
const path = require('path');

const { PROJECT_ROOT } = require('../../src/paths');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 5178);
const PAGE = '/src/renderer/cards.html';
const FOLDERS = ['src/renderer', 'node_modules/@fontsource'];
const FILES = ['scripts/dev/mock-api.js'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };

function inside(folder, file) {
  const relative = path.relative(folder, file);
  return relative !== '' && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative);
}

function createPreviewHandler({ root = PROJECT_ROOT, readFile = fs.readFile } = {}) {
  const allowed = (file) => FOLDERS.some((folder) => inside(path.join(root, folder), file))
    || FILES.some((name) => path.relative(path.join(root, name), file) === '');
  return (req, res) => {
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch {
      res.writeHead(400);
      return res.end('Bad request');
    }
    if (url === '/') {
      res.writeHead(302, { Location: PAGE });
      return res.end();
    }
    const file = path.join(root, url);
    if (url.includes('\0') || !allowed(file)) {
      res.writeHead(403);
      return res.end();
    }
    readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      if (url === PAGE) {
        data = data.toString().replace('<script type="module" src="cards.js">', '<script src="/scripts/dev/mock-api.js"></script><script type="module" src="cards.js">');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  };
}

function startPreview({ port = PORT, createServer = http.createServer, handler = createPreviewHandler(), log = console.log } = {}) {
  const server = createServer(handler);
  server.listen(port, HOST, () => log(`Preview on http://localhost:${port}`));
  return server;
}

if (require.main === module) startPreview();

module.exports = { HOST, createPreviewHandler, startPreview };
