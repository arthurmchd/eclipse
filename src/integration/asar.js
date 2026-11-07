const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const { TextDecoder } = require('util');

const MAX_HEADER = 64 * 1024 * 1024;
const MAX_READ = 32 * 1024 * 1024;

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

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function validateTree(header, payloadSize) {
  if (!object(header) || !object(header.files)) throw new Error('Invalid ASAR directory');
  function walk(files, prefix, depth) {
    if (depth > 128) throw new Error('ASAR directory is too deep');
    for (const [name, entry] of Object.entries(files)) {
      const full = archivePath(prefix ? `${prefix}/${name}` : name);
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
      readFile(name, limit = MAX_READ) {
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

module.exports = { openArchive };
