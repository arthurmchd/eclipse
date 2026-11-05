const { spawn: spawnProcess } = require('child_process');
const { windowsHelper } = require('../../paths');

const GUARD_REASON = /^[a-z0-9-]{1,64}$/;
const MAX_INCIDENTS = 20;

function guardError(message, reason) {
  return Object.assign(new Error(message), { guardReason: reason });
}

function safeReason(text) {
  return GUARD_REASON.test(text) ? text : 'unknown';
}

function tagged(error, reason) {
  if (error && typeof error === 'object' && !error.guardReason) error.guardReason = reason;
  return error;
}

function createWindowController({
  spawn = spawnProcess, timeoutMs = 15000, scriptPath = windowsHelper('windowGuard.ps1'),
  maxRecoveries = 3, recoveryWindowMs = 60000, now = Date.now,
} = {}) {
  let guard = null;
  let starting = null;
  let disposed = false;
  let queue = Promise.resolve();
  let armed = null;
  let healing = 0;
  let lostReason = null;
  let restoreRequired = false;
  let stopping = null;
  let recoveries = [];
  const incidents = [];
  function sequence(fn) {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  }
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];

  function open(request, persistent = false, onLost = () => {}) {
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    let partial = '';
    let ended = false;
    let failure = null;
    let errorOutput = '';
    let sawOk = false;
    let wasReady = false;
    let lostNotified = false;
    let rejectDone;
    const lines = [];
    function end(handoff = false) {
      if (ended || child.stdin.destroyed || child.stdin.writableEnded) return;
      if (handoff) restoreRequired = true;
      child.stdin.end(handoff ? 'handoff\n' : undefined);
    }
    function fail(err) {
      failure = failure || err;
      if (persistent) restoreRequired = true;
      const becameLost = persistent && wasReady && !lostNotified;
      if (becameLost) {
        lostNotified = true;
        failure.guardLost = true;
      }
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(failure); }
      pending.clear();
      rejectDone?.(failure);
      if (becameLost) onLost(failure);
    }
    function wait(key) {
      if (failure) return Promise.reject(failure);
      if (ended) return Promise.reject(new Error('The background window guard has stopped'));
      return new Promise((resolve, reject) => {
        const keys = Array.isArray(key) ? key : [key];
        const timer = setTimeout(() => {
          fail(guardError('The background window guard did not respond', 'no-response'));
          end(persistent && !disposed && Boolean(armed));
        }, timeoutMs);
        keys.forEach((item) => pending.set(item, { resolve, reject, timer, keys }));
      });
    }
    function line(text) {
      if (!text) return;
      if (!persistent) lines.push(text);
      if (text === 'ok') sawOk = true;
      if (persistent && text === 'ready') wasReady = true;
      if (text.startsWith('error:')) {
        const reason = safeReason(text.slice(6));
        fail(guardError(`Background window guard: ${reason}`, reason));
      }
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
    child.on('error', (err) => fail(tagged(err, 'spawn-error')));
    child.stdin.on('error', (err) => fail(tagged(err, 'input-closed')));
    const closed = new Promise((resolve) => {
      child.once('close', resolve);
      child.once('error', resolve);
    });
    const done = new Promise((resolve, reject) => {
      rejectDone = reject;
      child.on('close', (code) => {
        if (partial) line(partial);
        ended = true;
        const err = failure || guardError(
          `The background window guard stopped (${code})${errorOutput ? ': helper error' : ''}`,
          safeReason(`exit-${Number.isInteger(code) ? code : 'unknown'}`),
        );
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
      fail(guardError('The background window helper timed out', 'helper-timeout'));
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
      end,
      kill: () => child.kill(),
    };
  }

  async function shutdown(current, { handoff = false } = {}) {
    current.end(handoff);
    let timer;
    try {
      await Promise.race([current.closed, new Promise((resolve) => {
        timer = setTimeout(() => { restoreRequired = true; current.kill(); resolve(); }, 3000);
        timer.unref?.();
      })]);
    } finally { clearTimeout(timer); }
  }

  function report(reason, recovered) {
    incidents.push({ reason, recovered });
    if (incidents.length > MAX_INCIDENTS) incidents.shift();
    lostReason = recovered ? null : reason;
  }

  function allowRecovery() {
    const at = now();
    recoveries = recoveries.filter((time) => at - time < recoveryWindowMs);
    if (recoveries.length >= maxRecoveries) return false;
    recoveries.push(at);
    return true;
  }

  function lost(candidate, error) {
    if (disposed || !armed) return;
    const reason = error.guardReason || 'unknown';
    healing++;
    sequence(async () => {
      if (disposed || !armed || (guard !== candidate && guard?.alive())) return;
      if (!allowRecovery()) { report(reason, false); return; }
      await (await start()).command(armed);
      report(reason, true);
    }).catch((retryError) => report(retryError?.guardReason || reason, false))
      .finally(() => { healing--; });
  }

  async function retrying(task) {
    try { return await task(); }
    catch (error) {
      if (disposed || !error?.guardLost) throw error;
      const reason = error.guardReason || 'unknown';
      if (!armed || !allowRecovery()) { report(reason, false); throw error; }
      healing++;
      try {
        const result = await task();
        report(reason, true);
        return result;
      } catch (retryError) {
        report(reason, false);
        throw retryError;
      } finally { healing--; }
    }
  }

  async function start() {
    if (disposed) throw new Error('The background window guard is shutting down');
    if (starting) return starting;
    if (guard?.alive()) return guard;
    if (guard) {
      const previous = guard;
      await shutdown(previous, { handoff: !disposed && Boolean(armed) });
      if (guard === previous) guard = null;
      if (disposed) throw new Error('The background window guard is shutting down');
    }
    const candidate = open({ ownerPid: process.pid, initialMode: armed || 'hide' }, true, (error) => lost(candidate, error));
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

  function arm(command) {
    return sequence(() => {
      armed = command;
      return retrying(async () => (await start()).command(command));
    });
  }

  return {
    assertHealthy() {
      if (!disposed && (healing > 0 || guard?.alive())) return;
      throw new Error(`The background window guard stopped${lostReason ? ` (${lostReason})` : ''}. Try Play again`);
    },
    drainIncidents() { return incidents.splice(0); },
    hide() { return arm('hide'); },
    conceal() { return arm('conceal'); },
    closeClient() { return sequence(async () => {
      if (disposed) throw new Error('The background window guard is shutting down');
      armed = null;
      if (guard?.alive()) await guard.command('reveal');
      await open({ action: 'close-client' }).done;
      restoreRequired = false;
    }); },
    park() { return sequence(async () => {
      if (disposed) throw new Error('The background window guard is shutting down');
      armed = null;
      if (guard?.alive()) await guard.command('park');
      else {
        const previous = guard;
        guard = null;
        if (previous) await shutdown(previous);
        await open({ action: 'park' }).done;
      }
      restoreRequired = false;
    }); },
    reveal() { return sequence(async () => {
      if (disposed) throw new Error('The background window guard is shutting down');
      armed = null;
      if (guard?.alive()) await guard.command('reveal');
      else {
        const previous = guard;
        guard = null;
        if (previous) await shutdown(previous);
        await open({ action: 'restore' }).done;
      }
      restoreRequired = false;
    }); },
    gameWindow(game) { return sequence(() => retrying(async () => {
      if (disposed) throw new Error('The background window guard is shutting down');
      if (!['lol', 'tft', 'val'].includes(game)) throw new Error('Invalid game');
      if (guard?.alive()) {
        const answer = await guard.command(`game-window:${game}`, [`game-window:${game}:ready`, `game-window:${game}:waiting`]);
        return answer.endsWith(':ready');
      }
      const lines = await open({ action: 'game-window', game }).done;
      return lines.includes('game-ready');
    })); },
    async stop() {
      if (stopping) return stopping;
      disposed = true;
      armed = null;
      const current = guard;
      guard = null;
      stopping = (async () => {
        if (current) await shutdown(current);
        await starting?.catch(() => {});
        await queue;
        if (restoreRequired) {
          await open({ action: 'restore', activate: false }).done;
          restoreRequired = false;
        }
      })();
      return stopping;
    },
  };
}

module.exports = { createWindowController };
