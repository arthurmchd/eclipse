const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { hardenPrivateMainSource, ORIGINAL_PROTOCOL_BOOTSTRAP_142, preparePrivateHostBeforeReady, hasUnsafeStartupLog } = require('../../../src/integration/host/privateHostCore');

function fixture() {
  let ready = false;
  const registrations = [], events = [], handlers = [];
  const app = { isReady: () => ready, disableHardwareAcceleration() {}, whenReady: () => ({ then(callback) { handlers.push(callback); } }) };
  const protocol = { registerSchemesAsPrivileged: (schemes) => registrations.push(schemes) };
  const logger = { hooks: [], info(...data) { let message = { data }; for (const hook of this.hooks) message = hook(message); events.push(message); } };
  const context = {
    electron: { app, protocol }, Buffer, require, logger,
    createRendererEventLoopBlockStatusHandler: () => 'original-handler',
  };
  const source = `const log$h=logger;const cliArgs={remotingAuthToken:'dummy-142-token'};log$h.info("Starting RiotClientUx electron with args",cliArgs);${ORIGINAL_PROTOCOL_BOOTSTRAP_142}electron.app.whenReady().then(()=>{globalThis.handlersInstalled=n});}`;
  return { context, app, protocol, source, registrations, events, handlers, makeReady() { ready = true; } };
}

test('v142 logger adapter redacts the token and remains idempotent', () => {
  const f = fixture();
  const hardened = hardenPrivateMainSource(f.source);
  assert.equal(hasUnsafeStartupLog(hardened), false);
  assert.equal(hardenPrivateMainSource(hardened), hardened);
  vm.runInNewContext(hardened, f.context);
  assert.equal(JSON.stringify(f.events).includes('dummy-142-token'), false);
  assert.equal(f.events.length, 1);
});

test('v142 Sentry reuses the exact pre-ready scheme and preserves handlers and registration proxy', () => {
  const f = fixture();
  preparePrivateHostBeforeReady(f.context.electron, { globalObject: f.context });
  f.makeReady();
  vm.runInNewContext(hardenPrivateMainSource(f.source), f.context);
  f.context.configureProtocol({}, { namespace: 'sentry-ipc' }, {});
  assert.equal(f.registrations.length, 1);
  assert.equal(f.handlers.length, 1);
  f.handlers[0]();
  assert.equal(f.context.handlersInstalled, 'original-handler');
  f.protocol.registerSchemesAsPrivileged([{ scheme: 'original-extra' }]);
  assert.equal(f.registrations[1].length, 2);
  assert.equal(f.registrations[1][0].scheme, 'original-extra');
  assert.equal(f.registrations[1][1].scheme, 'sentry-ipc');
});

test('v142 refuses an unprepared or changed scheme after ready', () => {
  for (const prepared of [false, true]) {
    const f = fixture();
    if (prepared) preparePrivateHostBeforeReady(f.context.electron, { globalObject: f.context });
    f.makeReady();
    vm.runInNewContext(hardenPrivateMainSource(f.source), f.context);
    assert.throws(() => f.context.configureProtocol({}, { namespace: prepared ? 'unexpected-scheme' : 'sentry-ipc' }, {}), /initialized before/);
    assert.equal(f.handlers.length, 0);
  }
});

test('v142 unprepared startup before ready preserves the original registration', () => {
  const f = fixture();
  vm.runInNewContext(hardenPrivateMainSource(f.source), f.context);
  f.context.configureProtocol({}, { namespace: 'sentry-ipc' }, {});
  assert.equal(f.registrations.length, 1);
  assert.equal(f.registrations[0][0].scheme, 'sentry-ipc');
  assert.equal(f.handlers.length, 1);
});
