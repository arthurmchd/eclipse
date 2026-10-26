// Serves the renderer in a normal browser with mock data: npm run preview
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 5178);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') {
      res.writeHead(302, { Location: '/renderer/index.html' });
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
      if (url === '/renderer/index.html') {
        data = data.toString().replace('<script type="module" src="app.js">', '<script src="/scripts/mock-api.js"></script>\n  <script type="module" src="app.js">');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Preview on http://localhost:${PORT}`));
