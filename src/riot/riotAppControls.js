const CLOSE_READS = Object.freeze({
  flag: '/client-feature-flags/v1/flags/lifecycle.backgroundRunning/enabled',
  playerChoice: '/data-store/v1/install-settings/lifecycle/enable_run_in_background_set_by_player',
  commandLine: '/riotclientapp/v1/command-line-args',
  fromXbox: '/product-launcher/v1/launching_from_xbgp',
  xboxRunning: '/riotclientapp/v1/isXbgpRunning',
  xboxNoticeDismissed: '/data-store/v1/install-settings/lifecycle/xbox_background_running_notification_dismissed',
});
const SWITCH_TO_BACKGROUND = '/riot-client-lifecycle/v1/quit/switch-background-mode';
const QUIT = '/riot-client-lifecycle/v1/quit';

function closeMode({ flag, playerChoice, commandLine, fromXbox, xboxRunning, xboxNoticeDismissed } = {}) {
  if (!xboxNoticeDismissed && !playerChoice && xboxRunning) return 'background';
  if (!flag && !fromXbox) return 'quit';
  const runInBackground = typeof playerChoice === 'boolean' ? playerChoice : true;
  const backgroundLaunch = Array.isArray(commandLine) && commandLine.some((arg) => typeof arg === 'string' && arg.includes('--launch-background-mode'));
  return runInBackground || backgroundLaunch || fromXbox ? 'background' : 'quit';
}

function createRiotAppControls({ request }) {
  const accepted = (response) => Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;
  async function read(path) {
    const response = await request('GET', path);
    return accepted(response) ? response.json : undefined;
  }
  return {
    async close() {
      const names = Object.keys(CLOSE_READS);
      const values = await Promise.all(names.map((name) => read(CLOSE_READS[name])));
      const mode = closeMode(Object.fromEntries(names.map((name, index) => [name, values[index]])));
      if (!accepted(await request('POST', mode === 'background' ? SWITCH_TO_BACKGROUND : QUIT))) throw new Error('The Riot Client did not accept the close request');
      return mode;
    },
  };
}

module.exports = { createRiotAppControls, closeMode, CLOSE_READS, SWITCH_TO_BACKGROUND, QUIT };
