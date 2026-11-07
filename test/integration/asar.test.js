const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openArchive } = require('../../src/integration/asar');
const { encodeHeader } = require('./asarFixture');

function folder(t) {
  const directory = fs.mkdtempSync(path.join(__dirname, '.asar-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function archive(t, files, chunks = []) {
  const file = path.join(folder(t), 'app.asar');
  fs.writeFileSync(file, Buffer.concat([encodeHeader({ files }), ...chunks]));
  return file;
}

test('a packed file is read from its offset, and the archive file is never changed', (t) => {
  const first = Buffer.from('first file'), second = Buffer.from('second file');
  const file = archive(t, {
    dist: { files: { 'a.txt': { size: first.length, offset: '0' }, 'b.txt': { size: second.length, offset: String(first.length) } } },
  }, [first, second]);
  const before = fs.readFileSync(file);
  const reader = openArchive(file);
  try {
    assert.deepEqual(reader.readFile('dist/b.txt'), second);
    assert.deepEqual(reader.readFile('dist/a.txt'), first);
  } finally { reader.close(); }
  assert.deepEqual(fs.readFileSync(file), before);
  assert.throws(() => reader.readFile('dist/a.txt'), /closed/);
});

test('entries outside the archive, with traversal or with a bad offset are refused when opening', (t) => {
  assert.throws(() => openArchive(archive(t, { '..': { files: {} } })), /entry path/);
  assert.throws(() => openArchive(archive(t, { 'broken.js': { size: 100, offset: '0' } })), /bounds/);
  assert.throws(() => openArchive(archive(t, { 'odd.js': { size: 1, offset: '-1' } }, [Buffer.from('x')])), /offset/);
  const truncated = path.join(folder(t), 'short.asar');
  fs.writeFileSync(truncated, Buffer.from('tiny'));
  assert.throws(() => openArchive(truncated), /Invalid ASAR/);
});

test('missing, unpacked, linked and oversized entries are never read', (t) => {
  const bytes = Buffer.from('payload');
  const reader = openArchive(archive(t, {
    'packed.txt': { size: bytes.length, offset: '0' },
    'native.node': { size: 42, unpacked: true },
    'linked.txt': { link: 'packed.txt' },
  }, [bytes]));
  try {
    assert.throws(() => reader.readFile('missing.txt'), /not found/);
    assert.throws(() => reader.readFile('native.node'), /not a packed file/);
    assert.throws(() => reader.readFile('linked.txt'), /not a packed file/);
    assert.throws(() => reader.readFile('packed.txt', 3), /read limit/);
    assert.throws(() => reader.readFile('../packed.txt'), /entry path/);
  } finally { reader.close(); }
});
