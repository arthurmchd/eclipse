const test = require('node:test');
const assert = require('node:assert/strict');
const { protectString, unprotectString } = require('../src/clientIntegration/windowsDpapi');

test('Windows DPAPI tokens survive separate helper processes', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const value = 'synthetic-local-token-ação-123';
  const encrypted = await protectString(value);
  assert.notEqual(encrypted, value);
  assert.equal(encrypted.includes(value), false);
  assert.equal(await unprotectString(encrypted), value);
});

test('invalid DPAPI ciphertext returns a generic error without the input', { skip: process.platform !== 'win32', timeout: 10000 }, async () => {
  const invalid = 'synthetic-invalid-ciphertext';
  await assert.rejects(unprotectString(invalid), (error) => {
    assert.equal(error.message.includes(invalid), false);
    assert.match(error.message, /Windows could not protect or open/);
    return true;
  });
});

test('empty and oversized local connection tokens are rejected before invoking Windows', async () => {
  for (const value of ['', null, 'x'.repeat(32769)]) {
    await assert.rejects(protectString(value), /Invalid protected connection token/);
  }
});
