const test = require('node:test');
const assert = require('node:assert/strict');
const { createRiotAppControls, closeMode, CLOSE_READS, SWITCH_TO_BACKGROUND, QUIT } = require('../../src/riot/riotAppControls');

test('closing follows the same choice as the Riot close button', () => {
  const cases = [
    [{}, 'quit'],
    [{ flag: true }, 'background'],
    [{ flag: true, playerChoice: true }, 'background'],
    [{ flag: true, playerChoice: false }, 'quit'],
    [{ flag: true, playerChoice: 'off' }, 'background'],
    [{ flag: true, playerChoice: false, commandLine: ['--launch-product=valorant', '--launch-background-mode'] }, 'background'],
    [{ flag: true, playerChoice: false, commandLine: '--launch-background-mode' }, 'quit'],
    [{ flag: false, playerChoice: true }, 'quit'],
    [{ flag: false, playerChoice: false, fromXbox: true }, 'background'],
    [{ flag: false, xboxRunning: true }, 'background'],
    [{ flag: false, xboxRunning: true, xboxNoticeDismissed: true }, 'quit'],
    [{ flag: true, playerChoice: false, xboxRunning: true }, 'background'],
    [{ flag: true, playerChoice: false, xboxRunning: true, xboxNoticeDismissed: true }, 'quit'],
  ];
  for (const [input, expected] of cases) assert.equal(closeMode(input), expected, JSON.stringify(input));
  assert.equal(closeMode(), 'quit');
});

function fixture(values, post = { status: 204, json: null }) {
  const calls = [];
  const controls = createRiotAppControls({ request: async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === 'POST') return typeof post === 'function' ? post(path) : post;
    return Object.hasOwn(values, path) ? { status: 200, json: values[path] } : { status: 404, json: { errorCode: 'RESOURCE_NOT_FOUND' } };
  } });
  return { controls, calls };
}

test('closing reads the Riot settings and asks the local service to go to the background', async () => {
  const f = fixture({ [CLOSE_READS.flag]: true });
  assert.equal(await f.controls.close(), 'background');
  assert.deepEqual(f.calls.filter(([method]) => method === 'GET').map(([, path]) => path).sort(), Object.values(CLOSE_READS).sort());
  assert.deepEqual(f.calls.at(-1), ['POST', SWITCH_TO_BACKGROUND, undefined]);
  assert.equal(f.calls.filter(([method]) => method === 'POST').length, 1);
});

test('closing quits through the local service when the player turned background running off', async () => {
  const f = fixture({ [CLOSE_READS.flag]: true, [CLOSE_READS.playerChoice]: false, [CLOSE_READS.commandLine]: ['--launch-product=league_of_legends'] });
  assert.equal(await f.controls.close(), 'quit');
  assert.deepEqual(f.calls.at(-1), ['POST', QUIT, undefined]);
});

test('closing fails without a second request when the service refuses or is unreachable', async () => {
  const refused = fixture({ [CLOSE_READS.flag]: true }, { status: 500, json: null });
  await assert.rejects(refused.controls.close(), /did not accept the close request/);
  assert.equal(refused.calls.filter(([method]) => method === 'POST').length, 1);
  const calls = [];
  const unreachable = createRiotAppControls({ request: async (method, path) => {
    calls.push([method, path]);
    throw new Error('The local Riot service could not complete the request');
  } });
  await assert.rejects(unreachable.close(), /could not complete the request/);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 0);
});
