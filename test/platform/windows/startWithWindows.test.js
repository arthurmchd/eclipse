const test = require('node:test');
const assert = require('node:assert/strict');
const { createStartWithWindows } = require('../../../src/platform/windows/startWithWindows');

const EXE = 'C:/Users/synthetic/AppData/Local/Programs/Eclipse/Eclipse.exe';

function fakeApp({ isPackaged = true, run = {}, disabled = [], failSet = false, failGet = false } = {}) {
  const calls = [];
  const registry = { run: { ...run }, disabled: new Set(disabled) };
  const app = {
    isPackaged,
    getLoginItemSettings(options) {
      calls.push(['get', options]);
      if (failGet) throw new Error('synthetic registry failure');
      const launchItems = Object.entries(registry.run).filter(([, path]) => path === options.path)
        .map(([name, path]) => ({ name, path, args: [], scope: 'user', enabled: !registry.disabled.has(name) }));
      return { openAtLogin: false, launchItems, executableWillLaunchAtLogin: launchItems.some((item) => item.enabled) };
    },
    setLoginItemSettings(options) {
      calls.push(['set', options]);
      if (failSet) throw new Error('synthetic registry failure');
      if (options.openAtLogin) {
        registry.run[options.name] = options.path;
        if (options.enabled) registry.disabled.delete(options.name);
      } else {
        delete registry.run[options.name];
        registry.disabled.delete(options.name);
      }
    },
  };
  return { app, calls, registry };
}

test('starting with Windows is off by default and turns on as an Eclipse entry for the installed executable', () => {
  const f = fakeApp();
  const startup = createStartWithWindows({ app: f.app, execPath: EXE });
  assert.equal(startup.available(), true);
  assert.equal(startup.enabled(), false);
  assert.equal(f.calls.some(([kind]) => kind === 'set'), false);
  assert.equal(startup.set(true), true);
  assert.deepEqual(f.calls.find(([kind]) => kind === 'set')[1], { openAtLogin: true, path: EXE, name: 'Eclipse', enabled: true });
  assert.deepEqual(f.registry.run, { Eclipse: EXE });
  assert.equal(startup.enabled(), true);
});

test('turning it off removes the Eclipse entry and any other user entry for the same executable, and leaves other programs alone', () => {
  const f = fakeApp({ run: { Eclipse: EXE, 'electron.app.Eclipse': EXE, OtherProgram: 'C:/Other/other.exe' } });
  const startup = createStartWithWindows({ app: f.app, execPath: EXE });
  assert.equal(startup.enabled(), true);
  assert.equal(startup.set(false), false);
  assert.deepEqual(f.registry.run, { OtherProgram: 'C:/Other/other.exe' });
  for (const [kind, options] of f.calls.filter(([kind]) => kind === 'set')) assert.deepEqual([kind, options.openAtLogin, options.path], ['set', false, EXE]);
});

test('an entry disabled in Task Manager reads as off, and turning it on enables it again', () => {
  const f = fakeApp({ run: { Eclipse: EXE }, disabled: ['Eclipse'] });
  const startup = createStartWithWindows({ app: f.app, execPath: EXE });
  assert.equal(startup.enabled(), false);
  assert.equal(startup.set(true), true);
  assert.equal(f.registry.disabled.has('Eclipse'), false);
});

test('running from the project never reads or writes the Windows startup entries', () => {
  const f = fakeApp({ isPackaged: false });
  const startup = createStartWithWindows({ app: f.app, execPath: 'C:/project/node_modules/electron/dist/electron.exe' });
  assert.equal(startup.available(), false);
  assert.equal(startup.enabled(), false);
  assert.equal(startup.set(true), false);
  assert.deepEqual(f.calls, []);
});

test('a registry failure reads as off and is logged with a fixed line', () => {
  const lines = [];
  const failing = createStartWithWindows({ app: fakeApp({ failSet: true }).app, execPath: EXE, log: (line) => lines.push(line) });
  assert.equal(failing.set(true), false);
  assert.deepEqual(lines, ['could not turn on the start with Windows']);
  const unreadable = createStartWithWindows({ app: fakeApp({ failGet: true }).app, execPath: EXE, log: (line) => lines.push(line) });
  assert.equal(unreadable.enabled(), false);
  assert.equal(unreadable.set(false), false);
  assert.deepEqual(lines.at(-1), 'could not turn off the start with Windows');
});
