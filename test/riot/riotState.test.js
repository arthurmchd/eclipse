const test = require('node:test');
const assert = require('node:assert/strict');
const { createRiotState } = require('../../src/riot/riotState');

function riot({ processes = {}, account = 'yes', session = { type: 'auth' } } = {}) {
  const calls = [];
  const state = createRiotState({
    runningGames: async () => { calls.push('processes'); if (processes instanceof Error) throw processes; return { ...processes }; },
    authorization: async () => { calls.push('authorization'); if (account instanceof Error) throw account; return account; },
    sessionState: async () => { calls.push('session'); if (session instanceof Error) throw session; return session; },
  });
  return { calls, look: () => state.look() };
}

test('a closed Riot has no account and no services, without asking its local API', async () => {
  const f = riot({ processes: { client: false } });
  const look = f.look();
  assert.equal(await look.running(), false);
  assert.equal(await look.account(), 'no');
  assert.equal(await look.signedIn(), false);
  assert.equal(await look.services(), 'off');
  assert.equal(await look.mode(), 'closed');
  assert.deepEqual(f.calls, ['processes']);
});

test('each mode of an open Riot comes from its processes, and from its services only without a window or game', async () => {
  const modes = [
    [{ client: true, lol: true, clientWindow: true }, 'game', ['processes']],
    [{ client: true, val: true }, 'game', ['processes']],
    [{ client: true, clientWindow: true }, 'window', ['processes']],
    [{ client: true }, 'hidden', ['processes', 'session']],
  ];
  for (const [processes, mode, calls] of modes) {
    const f = riot({ processes });
    assert.equal(await f.look().mode(), mode);
    assert.deepEqual(f.calls, calls);
  }
  const background = riot({ processes: { client: true }, session: null });
  assert.equal(await background.look().mode(), 'background');
});

test('the account of an open Riot is yes, no or unknown, and anything odd or failing is unknown', async () => {
  for (const [answer, expected] of [['yes', 'yes'], ['no', 'no'], ['unknown', 'unknown'], [true, 'unknown'], [null, 'unknown'], [new Error('synthetic failure'), 'unknown']]) {
    const look = riot({ processes: { client: true }, account: answer }).look();
    assert.equal(await look.account(), expected);
    assert.equal(await look.signedIn(), expected === 'yes');
  }
});

test('one look asks each question once, and a new look asks again', async () => {
  const f = riot({ processes: { client: true } });
  const look = f.look();
  await Promise.all([look.mode(), look.mode(), look.running(), look.inGame(), look.window(), look.account(), look.signedIn(), look.services()]);
  assert.deepEqual([...f.calls].sort(), ['authorization', 'processes', 'session']);
  await f.look().account();
  assert.deepEqual(f.calls.slice(3), ['processes', 'authorization']);
});

test('a failing service check means background, and a failing process list reaches the caller', async () => {
  assert.equal(await riot({ processes: { client: true }, session: new Error('synthetic failure') }).look().services(), 'background');
  const broken = riot({ processes: new Error('tasklist failed') }).look();
  await assert.rejects(broken.mode(), /tasklist failed/);
  await assert.rejects(broken.account(), /tasklist failed/);
});

test('the process list is read as it is, so a list without the Riot means closed', async () => {
  const f = riot({ processes: { lol: true } });
  const look = f.look();
  assert.equal(await look.inGame(), true);
  assert.equal(await look.mode(), 'closed');
});
