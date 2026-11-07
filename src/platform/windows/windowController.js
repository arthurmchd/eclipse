const { spawn: spawnProcess } = require('child_process');
const { windowsHelper } = require('../../paths');

const HELPER_REASON = /^[a-z0-9-]{1,64}$/;
const GAMES = ['lol', 'tft', 'val'];

function safeReason(text) {
  return HELPER_REASON.test(text) ? text : 'unknown';
}

function createWindowController({ spawn = spawnProcess, timeoutMs = 15000, scriptPath = windowsHelper('windowGuard.ps1') } = {}) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
  let disposed = false;
  let queue = Promise.resolve();

  function sequence(fn) {
    const next = queue.then(() => {
      if (disposed) throw new Error('The background window guard is shutting down');
      return fn();
    });
    queue = next.catch(() => {});
    return next;
  }

  function run(request) {
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const lines = [];
      let partial = '';
      let failure = null;
      let errorOutput = '';
      let settled = false;
      let watchdog = null;
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (error) reject(error);
        else resolve(lines);
      }
      function line(text) {
        if (!text) return;
        lines.push(text);
        if (text.startsWith('error:') && !failure) failure = new Error(`Background window guard: ${safeReason(text.slice(6))}`);
      }
      watchdog = setTimeout(() => {
        finish(new Error('The background window helper timed out'));
        child.kill();
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        partial += data;
        const complete = partial.split(/\r?\n/);
        partial = complete.pop();
        complete.forEach(line);
      });
      child.stderr.on('data', (data) => { errorOutput = (errorOutput + data).slice(-2000); });
      child.on('error', finish);
      child.stdin.on('error', finish);
      child.on('close', (code) => {
        line(partial);
        partial = '';
        if (failure) finish(failure);
        else if (code === 0 && lines.includes('ok')) finish();
        else finish(new Error(`The background window guard stopped (${code})${errorOutput ? ': helper error' : ''}`));
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }

  return {
    reveal() { return sequence(async () => { await run({ action: 'reveal' }); }); },
    closeClient() { return sequence(async () => { await run({ action: 'close-client' }); }); },
    gameWindow(game) {
      if (!GAMES.includes(game)) return Promise.reject(new Error('Invalid game'));
      return sequence(async () => (await run({ action: 'game-window', game })).includes('game-ready'));
    },
    async stop() {
      disposed = true;
      await queue;
    },
  };
}

module.exports = { createWindowController };
