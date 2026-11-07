const ACCOUNT = new Set(['yes', 'no', 'unknown']);

function createRiotState({ runningGames, authorization = async () => 'unknown', sessionState = async () => null }) {
  function look() {
    let processes = null, account = null, services = null;
    const seen = () => (processes ??= Promise.resolve().then(() => runningGames()));
    const view = {
      processes: () => seen(),
      async running() { return Boolean((await seen())?.client); },
      async inGame() { const state = await seen(); return Boolean(state?.lol || state?.val); },
      async window() { return Boolean((await seen())?.clientWindow); },
      async account() {
        if (!(await view.running())) return 'no';
        account ??= Promise.resolve().then(() => authorization()).then((value) => (ACCOUNT.has(value) ? value : 'unknown'), () => 'unknown');
        return account;
      },
      async signedIn() { return (await view.account()) === 'yes'; },
      async services() {
        if (!(await view.running())) return 'off';
        services ??= Promise.resolve().then(() => sessionState()).then((value) => (value ? 'ready' : 'background'), () => 'background');
        return services;
      },
      async mode() {
        if (!(await view.running())) return 'closed';
        if (await view.inGame()) return 'game';
        if (await view.window()) return 'window';
        return (await view.services()) === 'ready' ? 'hidden' : 'background';
      },
    };
    return view;
  }
  return { look };
}

module.exports = { createRiotState };
