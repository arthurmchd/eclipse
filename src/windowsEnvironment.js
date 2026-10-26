const path = require('path');

// Tool-launched processes can inherit a temporary AppContainer LocalAppData.
// Riot's existing desktop service still owns the normal Windows user profile.
function localAppDataForRiot(env = process.env) {
  const value = env.LOCALAPPDATA || '';
  if (/\\AppData\\Local\\Packages\\sandbox\.\{[\da-f-]+\}\\AC(?:\\)?$/i.test(value)
      && typeof env.USERPROFILE === 'string' && /^[a-z]:\\/i.test(env.USERPROFILE)) {
    return path.win32.join(env.USERPROFILE, 'AppData', 'Local');
  }
  return value;
}

function environmentForRiot(env = process.env) {
  return { ...env, LOCALAPPDATA: localAppDataForRiot(env) };
}

module.exports = { localAppDataForRiot, environmentForRiot };
