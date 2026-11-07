function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const payloadSize = Math.ceil((4 + json.length) / 4) * 4;
  const headerSize = payloadSize + 4;
  const out = Buffer.alloc(8 + headerSize);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(headerSize, 4);
  out.writeUInt32LE(payloadSize, 8);
  out.writeUInt32LE(json.length, 12);
  json.copy(out, 16);
  return out;
}

module.exports = { encodeHeader };
