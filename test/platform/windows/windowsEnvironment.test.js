const test = require('node:test');
const assert = require('node:assert/strict');
const { localAppDataForRiot, environmentForRiot } = require('../../../src/platform/windows/windowsEnvironment');

test('normal Windows LocalAppData and other profiles remain unchanged', () => {
  assert.equal(localAppDataForRiot({ LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local', USERPROFILE: 'C:\\Users\\Example' }), 'C:\\Users\\Example\\AppData\\Local');
  assert.equal(localAppDataForRiot({ LOCALAPPDATA: 'D:\\RiotProfile', USERPROFILE: 'C:\\Users\\Example' }), 'D:\\RiotProfile');
  assert.equal(localAppDataForRiot({ LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local\\Packages\\OtherApp\\AC', USERPROFILE: 'C:\\Users\\Example' }), 'C:\\Users\\Example\\AppData\\Local\\Packages\\OtherApp\\AC');
});

test('temporary AppContainer LocalAppData resolves to the same Windows users normal profile', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local\\Packages\\sandbox.{01234567-89ab-cdef-0123-456789abcdef}\\AC',
    USERPROFILE: 'C:\\Users\\Example',
  };
  assert.equal(localAppDataForRiot(env), 'C:\\Users\\Example\\AppData\\Local');
  assert.equal(localAppDataForRiot({ ...env, LOCALAPPDATA: `${env.LOCALAPPDATA}\\` }), 'C:\\Users\\Example\\AppData\\Local');
});

test('invalid or absent profile information never invents a normal user directory', () => {
  const sandbox = 'C:\\Users\\Example\\AppData\\Local\\Packages\\sandbox.{01234567-89ab-cdef-0123-456789abcdef}\\AC';
  assert.equal(localAppDataForRiot({ LOCALAPPDATA: sandbox }), sandbox);
  assert.equal(localAppDataForRiot({ LOCALAPPDATA: sandbox, USERPROFILE: 'relative-user' }), sandbox);
  assert.equal(localAppDataForRiot({ USERPROFILE: 'C:\\Users\\Example' }), '');
});

test('Riot child process environment is copied and preserves all unrelated settings', () => {
  const source = {
    LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local\\Packages\\sandbox.{01234567-89ab-cdef-0123-456789abcdef}\\AC',
    USERPROFILE: 'C:\\Users\\Example', PATH: 'synthetic-path', CUSTOM_SETTING: 'retained',
  };
  const result = environmentForRiot(source);
  assert.notEqual(result, source);
  assert.equal(result.LOCALAPPDATA, 'C:\\Users\\Example\\AppData\\Local');
  assert.equal(result.PATH, source.PATH);
  assert.equal(result.CUSTOM_SETTING, source.CUSTOM_SETTING);
  assert.ok(source.LOCALAPPDATA.includes('sandbox.'));
});
