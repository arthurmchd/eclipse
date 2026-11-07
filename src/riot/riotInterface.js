const SHOW_INTERFACE = '/riot-client-lifecycle/v1/show';

function createInterfaceOpener({ runningGames, localApi, stopClient, launchClient, waitFor, showTimeoutMs = 10000, stopTimeoutMs = 10000 }) {
  function check(signal) {
    if (signal?.aborted) throw new Error('Sign-in cancelled');
  }

  async function requestShow() {
    try {
      const response = await localApi('POST', SHOW_INTERFACE);
      return Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  return async function openInterface({ exe, signal, log = () => {} }) {
    check(signal);
    const running = await runningGames();
    check(signal);
    if (running.clientWindow) return 'existing';
    if (running.client) {
      if (await requestShow()) {
        check(signal);
        const shown = await waitFor(async () => { check(signal); return (await runningGames()).clientWindow; }, showTimeoutMs);
        if (shown) {
          log('opened the Riot interface through the background service');
          return 'shown';
        }
      }
      check(signal);
      log('the background service did not open its interface; restarting it with the interface');
      await stopClient();
      const stopped = await waitFor(async () => { check(signal); return !(await runningGames()).client; }, stopTimeoutMs, 250);
      if (!stopped) throw new Error('Could not restart the Riot Client with its interface');
    }
    check(signal);
    await launchClient(exe, { visible: true });
    log('started the Riot Client with its interface');
    return 'launched';
  };
}

module.exports = { createInterfaceOpener, SHOW_INTERFACE };
