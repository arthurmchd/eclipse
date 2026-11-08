function createStartWithWindows({ app, execPath, name = 'Eclipse', log = () => {} }) {
  const available = () => app.isPackaged === true;
  const settings = () => app.getLoginItemSettings({ path: execPath });

  function enabled() {
    if (!available()) return false;
    try { return settings().executableWillLaunchAtLogin === true; }
    catch { return false; }
  }

  function set(on) {
    if (!available()) return false;
    try {
      if (on) app.setLoginItemSettings({ openAtLogin: true, path: execPath, name, enabled: true });
      else {
        const names = new Set([name]);
        for (const item of settings().launchItems || []) if (item?.scope === 'user' && item.name) names.add(item.name);
        for (const entry of names) app.setLoginItemSettings({ openAtLogin: false, path: execPath, name: entry });
      }
    } catch {
      log(`could not turn ${on ? 'on' : 'off'} the start with Windows`);
    }
    return enabled();
  }

  return { available, enabled, set };
}

module.exports = { createStartWithWindows };
