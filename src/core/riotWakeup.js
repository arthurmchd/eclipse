function createRiotWakeup({ riot, busy = () => false, log = () => {}, setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout, settleMs = 1000, retryMs = 1000, attempts = 8, graceMs = 2000 }) {
  let watcher = null, timer = null, stopped = false, background = false, generation = 0;

  function follow(id, wasBackground, delayMs, left, graced) {
    cancel(timer);
    timer = later(async () => {
      timer = null;
      if (stopped || id !== generation) return;
      if (busy()) { background = false; return; }
      let current;
      try { current = await riot.look().mode(); } catch { return; }
      if (stopped || id !== generation) return;
      if (busy()) { background = false; return; }
      if (current !== 'background' && current !== 'hidden') { background = false; return; }
      if (current === 'background') {
        if (!wasBackground) { background = true; return; }
        if (left > 0) follow(id, true, retryMs, left - 1, false);
        return;
      }
      if (!wasBackground) { background = false; return; }
      if (!graced) { follow(id, true, graceMs, left, true); return; }
      background = false;
      const shown = await riot.showInterface().catch(() => false);
      log(shown ? 'opened the Riot window after it left background mode without one' : 'Riot left background mode without a window and did not show it');
    }, delayMs);
    timer?.unref?.();
  }

  return {
    start() {
      if (stopped || watcher) return;
      watcher = riot.watchLockfile(() => {
        if (!stopped) follow(++generation, background, settleMs, attempts, false);
      });
      follow(++generation, false, 0, 0, false);
    },
    stop() {
      stopped = true;
      cancel(timer);
      timer = null;
      try { watcher?.close(); } catch {}
      watcher = null;
    },
  };
}

module.exports = { createRiotWakeup };
