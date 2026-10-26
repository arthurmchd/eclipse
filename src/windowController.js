const path = require('path');
const { spawn: spawnProcess } = require('child_process');

// One guard lives for the whole game session. Commands are acknowledged before
// the caller proceeds, so startup cannot race an uninitialised window watcher.
function createWindowController({ spawn = spawnProcess, timeoutMs = 15000, scriptPath = path.join(__dirname, 'windowGuard.ps1').replace('app.asar', 'app.asar.unpacked') } = {}) {
  let guard = null;
  let starting = null;
  let disposed = false;
  let queue = Promise.resolve();
  function sequence(fn) {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  }
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];

  function open(request, persistent = false) {
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    let partial = '';
    let ended = false;
    let failure = null;
    let errorOutput = '';
    let sawOk = false;
    let rejectDone;
    const lines = [];
    function fail(err) {
      failure = failure || err;
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(failure); }
      pending.clear();
      rejectDone?.(failure);
    }
    function wait(key) {
      if (failure) return Promise.reject(failure);
      if (ended) return Promise.reject(new Error('The background window guard has stopped'));
      return new Promise((resolve, reject) => {
        const keys = Array.isArray(key) ? key : [key];
        const timer = setTimeout(() => {
          // Invalidate this process after a timeout. A late acknowledgement
          // must never satisfy a later command with the same response string.
          fail(new Error('The background window guard did not respond'));
          child.stdin.end();
        }, timeoutMs);
        keys.forEach((item) => pending.set(item, { resolve, reject, timer, keys }));
      });
    }
    function line(text) {
      if (!text) return;
      if (!persistent) lines.push(text);
      if (text === 'ok') sawOk = true;
      if (text.startsWith('error:')) fail(new Error(`Background window guard: ${text.slice(6)}`));
      const item = pending.get(text);
      if (item) { clearTimeout(item.timer); item.keys.forEach((key) => pending.delete(key)); item.resolve(text); }
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data) => {
      partial += data;
      const complete = partial.split(/\r?\n/);
      partial = complete.pop();
      complete.forEach(line);
    });
    child.stderr.on('data', (data) => { errorOutput = (errorOutput + data).slice(-2000); });
    child.on('error', fail);
    child.stdin.on('error', fail);
    const closed = new Promise((resolve) => {
      child.once('close', resolve);
      child.once('error', resolve);
    });
    const done = new Promise((resolve, reject) => {
      rejectDone = reject;
      child.on('close', (code) => {
        if (partial) line(partial);
        ended = true;
        const err = failure || new Error(`The background window guard stopped (${code})${errorOutput ? ': helper error' : ''}`);
        if (code === 0 && sawOk && !failure) {
          for (const item of pending.values()) { clearTimeout(item.timer); item.reject(err); }
          pending.clear();
          resolve(lines);
        } else fail(err);
      });
      child.on('error', reject);
    });
    done.catch(() => {});
    const watchdog = !persistent ? setTimeout(() => {
      fail(new Error('The background window helper timed out'));
      child.kill();
    }, timeoutMs) : null;
    if (watchdog) done.then(() => clearTimeout(watchdog), () => clearTimeout(watchdog));
    const ready = persistent ? wait('ready') : null;
    if (ready) ready.catch(() => {});
    child.stdin.write(`${JSON.stringify(request)}\n`);
    if (!persistent) child.stdin.end();
    return {
      ready, done, closed,
      alive: () => !ended && !failure,
      async command(command, response = `command:${command}`) {
        const ack = wait(response);
        if (!failure && !ended) child.stdin.write(`${command}\n`);
        return ack;
      },
      end: () => child.stdin.end(),
      kill: () => child.kill(),
    };
  }

  async function shutdown(current) {
    current.end();
    let timer;
    try {
      await Promise.race([current.closed, new Promise((resolve) => {
        timer = setTimeout(() => { current.kill(); resolve(); }, 3000);
        timer.unref?.();
      })]);
    } finally { clearTimeout(timer); }
  }

  async function start() {
    if (disposed) throw new Error('The background window guard is shutting down');
    if (starting) return starting;
    if (guard?.alive()) return guard;
    if (guard) {
      const previous = guard;
      await shutdown(previous);
      if (guard === previous) guard = null;
      if (disposed) throw new Error('The background window guard is shutting down');
    }
    const candidate = open({ ownerPid: process.pid }, true);
    guard = candidate;
    starting = (async () => {
      try {
        await candidate.ready;
        if (disposed) throw new Error('The background window guard is shutting down');
        return candidate;
      } catch (err) {
        await shutdown(candidate);
        if (guard === candidate) guard = null;
        throw err;
      } finally { starting = null; }
    })();
    return starting;
  }

  return {
    assertHealthy() {
      if (disposed || !guard?.alive()) throw new Error('The background window guard stopped. Try Play again');
    },
    hide() { return sequence(async () => (await start()).command('hide')); },
    conceal() { return sequence(async () => (await start()).command('conceal')); },
    reveal() { return sequence(async () => {
      if (disposed) throw new Error('The background window guard is shutting down');
      if (guard?.alive()) await guard.command('reveal');
      else await open({ action: 'restore' }).done;
    }); },
    gameWindow(game) { return sequence(async () => {
      if (disposed) throw new Error('The background window guard is shutting down');
      if (!['lol', 'tft', 'val'].includes(game)) throw new Error('Invalid game');
      if (guard) {
        const answer = await guard.command(`game-window:${game}`, [`game-window:${game}:ready`, `game-window:${game}:waiting`]);
        return answer.endsWith(':ready');
      }
      const lines = await open({ action: 'game-window', game }).done;
      return lines.includes('game-ready');
    }); },
    async stop() {
      disposed = true;
      const current = guard;
      guard = null;
      if (!current) return;
      await shutdown(current);
    },
  };
}

module.exports = { createWindowController };
