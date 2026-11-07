const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { HOST, createPreviewHandler, startPreview } = require('../../../scripts/dev/preview-server');

const root = path.resolve('/synthetic-preview-root');

function preview(files = {}) {
  const reads = [];
  const handler = createPreviewHandler({
    root,
    readFile: (file, done) => {
      const name = path.relative(root, file).split(path.sep).join('/');
      reads.push(name);
      if (Object.hasOwn(files, name)) done(null, Buffer.from(files[name]));
      else done(new Error(`ENOENT: ${file}`));
    },
  });
  const get = (url) => {
    const reply = {};
    handler({ url }, {
      writeHead(status, headers = {}) { reply.status = status; reply.headers = headers; },
      end(body = '') { reply.body = String(body); },
    });
    return reply;
  };
  return { get, reads };
}

test('the preview listens only on this computer', () => {
  assert.equal(HOST, '127.0.0.1');
  const calls = [];
  const lines = [];
  startPreview({
    port: 5199, log: (line) => lines.push(line), handler: () => {},
    createServer: (handler) => ({ listen(port, host, ready) { calls.push([typeof handler, port, host]); ready(); } }),
  });
  assert.deepEqual(calls, [['function', 5199, '127.0.0.1']]);
  assert.deepEqual(lines, ['Preview on http://localhost:5199']);
});

test('the preview serves the cards with the fake API, their files and the fonts', () => {
  const f = preview({
    'src/renderer/cards.html': '<script type="module" src="cards.js"></script>',
    'src/renderer/cards.js': 'export {};',
    'src/renderer/assets/lol.png': 'png',
    'node_modules/@fontsource/teko/files/teko-latin-500-normal.woff2': 'font',
    'scripts/dev/mock-api.js': 'window.api = {};',
  });
  assert.deepEqual(f.get('/'), { status: 302, headers: { Location: '/src/renderer/cards.html' }, body: '' });
  const page = f.get('/src/renderer/cards.html');
  assert.equal(page.status, 200);
  assert.equal(page.headers['Content-Type'], 'text/html');
  assert.equal(page.body, '<script src="/scripts/dev/mock-api.js"></script><script type="module" src="cards.js"></script>');
  assert.equal(f.get('/src/renderer/cards.js').headers['Content-Type'], 'text/javascript');
  assert.equal(f.get('/src/renderer/assets/lol.png').headers['Content-Type'], 'image/png');
  assert.equal(f.get('/node_modules/@fontsource/teko/files/teko-latin-500-normal.woff2').headers['Content-Type'], 'font/woff2');
  assert.equal(f.get('/scripts/dev/mock-api.js').status, 200);
  assert.equal(f.get('/src/renderer/missing.js').status, 404);
});

test('the preview refuses everything outside the cards, including encoded escapes and sibling folders', () => {
  const f = preview({ 'package.json': '{}' });
  for (const url of [
    '/package.json', '/.git/config', '/.client-integration/riot-client-bridge.json', '/scripts/dev/preview-server.js',
    '/src/main/index.js', '/src/renderer', '/src/renderer/', '/node_modules/electron/index.js',
    '/src/renderer/..%2F..%2Fpackage.json', '/src/renderer%2F..%2F..%2Fpackage.json', '/src/renderer/%2e%2e/%2e%2e/package.json',
    '/..%2Fsynthetic-preview-root-other%2Fsecret.txt', '/src/renderer-other/cards.js', '/src/renderer/cards.js%00.png',
  ]) {
    assert.equal(f.get(url).status, 403, url);
  }
  assert.deepEqual(f.reads, []);
});

test('a malformed address gets an error answer instead of stopping the preview', () => {
  const f = preview();
  assert.deepEqual(f.get('/src/renderer/%E0%A4%A'), { status: 400, headers: {}, body: 'Bad request' });
  assert.deepEqual(f.reads, []);
});
