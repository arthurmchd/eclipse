const { spawn: spawnProcess } = require('child_process');
const { windowsHelper } = require('../../paths');

function validTarget(value) {
  return value && /^\d{1,20}$/.test(value.id)
    && ['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(value[key]) && Math.abs(value[key]) <= 100000)
    && value.width >= 320 && value.height >= 240
    && (value.minimized === undefined || value.minimized === true);
}

function createRiotWindowObserver({ spawn = spawnProcess, ownerPid = process.pid, onState, onError = () => {}, setInterval: repeat = setInterval, clearInterval: clear = clearInterval, now = Date.now } = {}) {
  let child = null, disposed = false, timer = null;
  return {
    start(clientPath, overlayWindow = null) {
      if (disposed || child) return;
      let partial = '', last = now();
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsHelper('riotWindowObserver.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const failed = () => { onState(null); onError(new Error('Não foi possível acompanhar a janela do Riot. Reinicie o gerenciador.')); };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        partial += chunk;
        if (partial.length > 16384) { partial = ''; failed(); return; }
        const lines = partial.split(/\r?\n/); partial = lines.pop();
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.target !== null && !validTarget(data.target)) throw new Error();
            last = now();
            if (!disposed) onState(data.target);
          } catch { if (!disposed) failed(); }
        }
      });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      child.on('error', () => { if (!disposed) failed(); });
      child.on('close', () => { if (!disposed) failed(); });
      child.stdin.end(JSON.stringify({ ownerPid, clientPath, overlayWindow: typeof overlayWindow === 'string' && /^\d{1,20}$/.test(overlayWindow) ? overlayWindow : null }) + '\n');
      timer = repeat(() => { if (!disposed && now() - last > 3000) onState(null); }, 1000);
      timer.unref?.();
    },
    stop() { disposed = true; if (timer) clear(timer); child?.kill(); child = null; },
  };
}

module.exports = { createRiotWindowObserver, validTarget };
