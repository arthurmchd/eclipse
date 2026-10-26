const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createBootstrapChannel, connectBootstrapChannel, validBootstrapPath } = require('../src/clientIntegration/bootstrapChannel');

test('private startup channel carries bounded test messages in both directions without GUI stdio', async (t) => {
  const channel = await createBootstrapChannel();
  t.after(() => channel.close());
  assert.equal(validBootstrapPath(channel.path), true);
  const client = connectBootstrapChannel(channel.path);
  t.after(() => client.destroy());
  const server = await channel.connected;
  const incoming = once(client, 'data');
  server.write('synthetic encrypted bootstrap\n');
  assert.equal((await incoming)[0].toString(), 'synthetic encrypted bootstrap\n');
  const ready = once(server, 'data');
  client.write('{"event":"ready"}\n');
  assert.equal((await ready)[0].toString(), '{"event":"ready"}\n');
  const closed = once(client, 'close');
  channel.close();
  await closed;
});

test('startup channel expires when its intended child never connects', async (t) => {
  const channel = await createBootstrapChannel({ timeoutMs: 20 });
  t.after(() => channel.close());
  await assert.rejects(channel.connected, /timed out/);
});

test('host cannot connect to an arbitrary local path supplied as a bootstrap channel', () => {
  for (const value of ['', null, '127.0.0.1:1234', '\\\\.\\pipe\\unrelated-application', 'C:\\private.txt']) {
    assert.equal(validBootstrapPath(value), false);
    assert.throws(() => connectBootstrapChannel(value), /Invalid private UI/);
  }
});
