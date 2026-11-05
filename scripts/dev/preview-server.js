const http = require('http');
const fs = require('fs');
const path = require('path');

const { PROJECT_ROOT: ROOT } = require('../../src/paths');
const PORT = Number(process.env.PORT || 5178);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') {
      res.writeHead(302, { Location: '/src/renderer/index.html' });
      return res.end();
    }
    const file = path.normalize(path.join(ROOT, url));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      if (url === '/src/renderer/index.html') {
        data = data.toString().replace('<script type="module" src="app.js">', '<script src="/scripts/dev/mock-api.js"></script>\n  <script type="module" src="app.js">');
      }
      if (url === '/src/renderer/cards.html') {
        data = data.toString().replace('<script type="module" src="cards.js">', '<script src="/scripts/dev/mock-api.js"></script><script type="module" src="cards.js">');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Preview on http://localhost:${PORT}`));
