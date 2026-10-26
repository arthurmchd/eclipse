// Minimal ASAR reader/writer for preparing a local, reversible UI extension.
// No extraction or execution takes place. Packed bytes outside the changed
// entries are preserved, along with unpacked/link entries and integrity data.
// Electron virtualizes fs paths containing .asar. Header parsing and whole-file
// hashes must operate on the physical archive, without changing process.noAsar.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const MARKER = 'RAM_LOGIN_INTEGRATION_V1';
const MAX_HEADER = 64 * 1024 * 1024;
const MAX_EDIT = 32 * 1024 * 1024;
const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024;

function archivePath(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || /[\x00-\x1f:]/.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid ASAR entry path');
  }
  return name;
}

function readExact(fd, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const count = fs.readSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (!count) throw new Error('Truncated ASAR archive');
    offset += count;
  }
}

function writeExact(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const payloadSize = Math.ceil((4 + json.length) / 4) * 4;
  const headerSize = payloadSize + 4;
  if (headerSize > MAX_HEADER) throw new Error('ASAR header is too large');
  const out = Buffer.alloc(8 + headerSize);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(headerSize, 4);
  out.writeUInt32LE(payloadSize, 8);
  out.writeUInt32LE(json.length, 12);
  json.copy(out, 16);
  return out;
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function validateTree(header, payloadSize) {
  if (!object(header) || !object(header.files)) throw new Error('Invalid ASAR directory');
  function walk(files, prefix, depth) {
    if (depth > 128) throw new Error('ASAR directory is too deep');
    for (const [name, entry] of Object.entries(files)) {
      const full = archivePath(prefix ? `${prefix}/${name}` : name);
      // Every key represents exactly one path component.
      if (name.includes('/') || !object(entry)) throw new Error('Invalid ASAR entry');
      if (entry.files !== undefined) {
        if (!object(entry.files)) throw new Error('Invalid ASAR directory');
        walk(entry.files, full, depth + 1);
      } else if (entry.link !== undefined) {
        archivePath(entry.link);
      } else {
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid ASAR file size');
        if (entry.unpacked) continue;
        if (typeof entry.offset !== 'string' || !/^\d+$/.test(entry.offset)) throw new Error('Invalid ASAR file offset');
        const offset = Number(entry.offset);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset + entry.size > payloadSize) throw new Error('ASAR file exceeds archive bounds');
      }
    }
  }
  walk(header.files, '', 0);
}

function openArchive(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 16) throw new Error('Invalid ASAR file');
    const first = Buffer.alloc(16);
    readExact(fd, first, 0);
    const headerSize = first.readUInt32LE(4);
    const payloadSize = first.readUInt32LE(8);
    const jsonSize = first.readUInt32LE(12);
    if (first.readUInt32LE(0) !== 4 || headerSize < 8 || headerSize > MAX_HEADER || headerSize % 4 || payloadSize !== headerSize - 4 || jsonSize < 2 || jsonSize > payloadSize - 4 || 8 + headerSize > stat.size) throw new Error('Invalid ASAR header');
    const raw = Buffer.alloc(jsonSize);
    readExact(fd, raw, 16);
    const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const dataOffset = 8 + headerSize;
    validateTree(header, stat.size - dataOffset);
    let closed = false;
    function entry(name) {
      archivePath(name);
      let current = header;
      for (const part of name.split('/')) {
        if (!object(current.files) || !Object.hasOwn(current.files, part)) throw new Error(`ASAR entry not found: ${name}`);
        current = current.files[part];
      }
      return current;
    }
    return {
      fd, header, dataOffset, size: stat.size, payloadSize: stat.size - dataOffset,
      entry,
      readFile(name, limit = MAX_EDIT) {
        if (closed) throw new Error('ASAR archive is closed');
        const meta = entry(name);
        if (meta.files || meta.link !== undefined || meta.unpacked) throw new Error(`ASAR entry is not a packed file: ${name}`);
        if (meta.size > limit) throw new Error(`ASAR entry exceeds read limit: ${name}`);
        const bytes = Buffer.alloc(meta.size);
        readExact(fd, bytes, dataOffset + Number(meta.offset));
        return bytes;
      },
      close() { if (!closed) { closed = true; fs.closeSync(fd); } },
    };
  } catch (error) { fs.closeSync(fd); throw error; }
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function integrityFor(bytes, previous) {
  if (previous && previous.algorithm !== 'SHA256') throw new Error('Unsupported ASAR integrity algorithm');
  const blockSize = previous ? previous.blockSize : DEFAULT_BLOCK_SIZE;
  if (!Number.isSafeInteger(blockSize) || blockSize < 1 || blockSize > MAX_HEADER) throw new Error('Invalid ASAR integrity block size');
  const blocks = [];
  for (let i = 0; i < bytes.length; i += blockSize) blocks.push(sha256(bytes.subarray(i, i + blockSize)));
  return { ...(previous || {}), algorithm: 'SHA256', hash: sha256(bytes), blockSize, blocks };
}

function verifyIntegrity(bytes, meta) {
  if (!meta.integrity) return;
  const actual = integrityFor(bytes, meta.integrity);
  if (meta.integrity.hash !== actual.hash || !Array.isArray(meta.integrity.blocks) || JSON.stringify(meta.integrity.blocks) !== JSON.stringify(actual.blocks)) throw new Error('ASAR source entry integrity mismatch');
}

function sha256File(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function appendToArchive(source, destination, additions, { transformers = {} } = {}) {
  if (path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) throw new Error('Source and destination must be different');
  if (fs.existsSync(destination)) throw new Error('Prepared archive already exists; choose a new output directory');
  if (!object(additions) || !Object.keys(additions).length) throw new Error('No ASAR additions supplied');
  if (!object(transformers) || Object.entries(transformers).some(([name, transform]) => !Object.hasOwn(additions, name) || typeof transform !== 'function')) throw new Error('Invalid ASAR source transformers');
  const archive = openArchive(source);
  let outputFd;
  const temp = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    const changed = [];
    let nextOffset = archive.payloadSize;
    for (const [name, addon] of Object.entries(additions)) {
      const original = archive.readFile(name);
      if (original.includes(Buffer.from(MARKER))) throw new Error('Client integration is already present; restore the original before preparing again');
      if (!Buffer.isBuffer(addon) || !addon.length || addon.length > MAX_EDIT) throw new Error('Invalid ASAR addon');
      const meta = archive.entry(name);
      verifyIntegrity(original, meta);
      // Transform only after validating the original integrity. Transforms
      // are explicit per changed entry; all other payload bytes are retained.
      const transformed = Object.hasOwn(transformers, name) ? transformers[name](Buffer.from(original)) : original;
      if (!Buffer.isBuffer(transformed) || !transformed.length || transformed.length > MAX_EDIT) throw new Error('Invalid transformed ASAR source');
      // A separator also prevents the original sourceMappingURL or trailing
      // line comment from swallowing the extension appended after it.
      const bytes = Buffer.concat([transformed, Buffer.from(`\n;/* ${MARKER} */\n`), addon, Buffer.from('\n')]);
      changed.push({ name, bytes, originalSha256: sha256(original), ...(transformed !== original ? { transformedSha256: sha256(transformed) } : {}), addonSha256: sha256(addon), sha256: sha256(bytes) });
      meta.offset = String(nextOffset);
      meta.size = bytes.length;
      meta.integrity = integrityFor(bytes, meta.integrity);
      nextOffset += bytes.length;
    }
    const newHeader = encodeHeader(archive.header);
    outputFd = fs.openSync(temp, 'wx');
    writeExact(outputFd, newHeader);
    const buffer = Buffer.alloc(1024 * 1024);
    for (let copied = 0; copied < archive.payloadSize;) {
      const count = Math.min(buffer.length, archive.payloadSize - copied);
      readExact(archive.fd, buffer.subarray(0, count), archive.dataOffset + copied);
      writeExact(outputFd, buffer.subarray(0, count));
      copied += count;
    }
    for (const item of changed) writeExact(outputFd, item.bytes);
    fs.fsyncSync(outputFd);
    fs.closeSync(outputFd); outputFd = undefined;
    // The candidate is never active. COPYFILE_EXCL provides no-clobber
    // semantics without requiring hard-link privileges on Windows.
    fs.copyFileSync(temp, destination, fs.constants.COPYFILE_EXCL);
    return changed.map(({ bytes, ...item }) => ({ ...item, size: bytes.length }));
  } finally {
    archive.close();
    if (outputFd !== undefined) fs.closeSync(outputFd);
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

module.exports = { MARKER, openArchive, encodeHeader, appendToArchive, integrityFor, verifyIntegrity, sha256File };
