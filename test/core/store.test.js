const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'core', 'store.js'), 'utf8');

function createStore(t, fsOverride = fs) {
  const dir = fs.mkdtempSync(path.join(__dirname, 'riot-store-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(__dirname));
    assert.ok(path.basename(dir).startsWith('riot-store-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const electron = {
    app: { getPath: () => dir },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(`test-encrypted:${Buffer.from(text).toString('base64')}`),
      decryptString: (blob) => {
        const text = blob.toString();
        assert.ok(text.startsWith('test-encrypted:'));
        return Buffer.from(text.slice('test-encrypted:'.length), 'base64').toString();
      },
    },
  };
  const loaded = { exports: {} };
  const wrapped = vm.runInNewContext(`(function (require, module, exports) { ${source}\n})`, { Buffer });
  wrapped((name) => name === 'electron' ? electron : name === 'fs' ? fsOverride : require(name), loaded, loaded.exports);
  const store = new loaded.exports.Store();
  const account = store.upsertAccount({ gameName: 'Test', tagLine: 'TEST', username: 'fictional-login', password: 'fictional-password' });
  return { store, account, dir };
}

test('session operations reject traversal and unknown accounts', (t) => {
  const { store, dir } = createStore(t);
  const outside = path.join(dir, 'outside.bin');
  fs.writeFileSync(outside, 'sentinel');
  for (const id of ['../outside', '..\\outside', 'a/b', 'a:b', '', null, {}, 'a'.repeat(129), 'CON', 'nul', 'COM1', 'LPT9']) {
    assert.throws(() => store.sessionFile(id), /Invalid account ID/);
    assert.throws(() => store.forgetSession(id), /Invalid account ID/);
    assert.throws(() => store.saveSession(id, 'fictional-session'), /Invalid account ID/);
    assert.throws(() => store.sessionSavedAt(id), /Invalid account ID/);
  }
  assert.equal(fs.readFileSync(outside, 'utf8'), 'sentinel');
  assert.throws(() => store.saveSession('unknown-account', 'fictional-session'), /Account not found/);
  assert.throws(() => store.forgetSession('unknown-account'), /Account not found/);
});

test('sessions round trip using encrypted bytes for UUID and legacy IDs', (t) => {
  const { store, account } = createStore(t);
  store.saveSession(account.id, 'fictional-session');
  assert.equal(store.loadSession(account.id), 'fictional-session');
  assert.ok(fs.readFileSync(store.sessionFile(account.id), 'utf8').startsWith('test-encrypted:'));
  assert.equal(fs.readFileSync(store.sessionFile(account.id), 'utf8').includes('fictional-session'), false);
  const savedAt = store.sessionSavedAt(account.id);
  assert.ok(Math.abs(savedAt - fs.statSync(store.sessionFile(account.id)).mtimeMs) < 1 && savedAt > Date.now() - 60000);
  store.forgetSession(account.id);
  assert.equal(store.hasSession(account.id), false);
  assert.equal(store.sessionSavedAt(account.id), 0);
  store.data.accounts[0].id = 'legacy-account_01';
  store.saveSession('legacy-account_01', 'legacy-fictional-session');
  assert.equal(store.loadSession('legacy-account_01'), 'legacy-fictional-session');
});

test('failed session replacement preserves the previous session and removes temporary files', (t) => {
  let failReplacement = false;
  const wrappedFs = Object.create(fs);
  wrappedFs.renameSync = (from, to) => {
    if (failReplacement && to.endsWith('.bin')) throw new Error('simulated rename failure');
    return fs.renameSync(from, to);
  };
  const { store, account } = createStore(t, wrappedFs);
  store.saveSession(account.id, 'old-fictional-session');
  failReplacement = true;
  assert.throws(() => store.saveSession(account.id, 'new-fictional-session'), /simulated rename failure/);
  assert.equal(store.loadSession(account.id), 'old-fictional-session');
  assert.deepEqual(fs.readdirSync(store.sessionsDir), [`${account.id}.bin`]);
});

test('backups track account and settings edits without rank or launch churn', (t) => {
  const { store, account } = createStore(t);
  const initial = store.listBackups().length;
  store.updateAccountFields(account.id, { note: 'Edited note' });
  assert.equal(store.listBackups().length, initial + 1);
  store.updateSettings({ refreshMinutes: 15 });
  assert.equal(store.listBackups().length, initial + 2);
  store.updateAccountFields(account.id, {
    stats: { lol: { tier: 'GOLD' } },
    puuidCache: { fictional: 'cache' },
    lastPlayed: new Date().toISOString(),
    lastGame: 'lol',
  });
  store.setCurrentAccount(account.id);
  assert.equal(store.listBackups().length, initial + 2);
  const newest = JSON.parse(fs.readFileSync(path.join(store.backupsDir, store.listBackups()[0]), 'utf8'));
  assert.equal(newest.accounts[0].note, 'Edited note');
  assert.equal(newest.settings.refreshMinutes, 15);
});

test('stay signed in is on by default and can be turned off', (t) => {
  const { store } = createStore(t);
  assert.equal(store.publicSettings().staySignedIn, true);
  assert.equal(store.updateSettings({ staySignedIn: false }).staySignedIn, false);
  assert.equal(store.data.settings.staySignedIn, false);
});

test('language is Portuguese by default and only switches when saved', (t) => {
  const { store } = createStore(t);
  assert.equal(store.data.settings.language, 'pt');
  assert.equal(store.publicSettings().language, 'pt');
  assert.equal(store.updateSettings({ refreshMinutes: 10 }).language, 'pt');
  assert.equal(store.updateSettings({ language: 'en' }).language, 'en');
  assert.equal(store.data.settings.language, 'en');
  store.data.settings.language = 'fr';
  assert.equal(store.publicSettings().language, 'pt');
});

test('options of the removed legacy mode are dropped from an old data file', (t) => {
  const { store } = createStore(t);
  const retired = ['minimizeOnLaunch', 'hideRiotClient', 'closeRiotClient', 'streamerMode'];
  fs.writeFileSync(store.file, JSON.stringify({ accounts: [], settings: { refreshMinutes: 10, minimizeOnLaunch: false, hideRiotClient: false, closeRiotClient: false, streamerMode: true } }));
  store.data = store.load();
  assert.equal(store.data.settings.refreshMinutes, 10);
  for (const key of retired) {
    assert.equal(Object.hasOwn(store.data.settings, key), false);
    assert.equal(Object.hasOwn(store.publicSettings(), key), false);
  }
  store.save();
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8')).settings;
  for (const key of retired) assert.equal(Object.hasOwn(saved, key), false);
  store.updateSettings({ streamerMode: true, hideRiotClient: false });
  for (const key of retired) assert.equal(Object.hasOwn(store.data.settings, key), false);
});
