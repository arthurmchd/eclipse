const KEPT_SINCE = Date.parse('2026-11-06T13:00:00Z');
const REOPEN_POLLS = 5;

function createSessionKeeper({ riot, store, busy = () => false, log = () => {}, onSaved = () => {}, setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout, delayMs = 1000, pollMs = 4000, keptSince = KEPT_SINCE, reopenPolls = REOPEN_POLLS }) {
  let watcher = null, timer = null, pollTimer = null, settling = null, again = false, stopped = false;
  let idleSeen = 0, gameSeen = false, failing = false, reopenLeft = 0, held = null;
  const enabled = () => store.data.settings.staySignedIn !== false;
  const idle = () => !stopped && enabled() && !busy();

  function ownerOf(yaml) {
    const subject = riot.persistedSubject(yaml);
    const bySubject = subject && store.data.accounts.find((account) => store.hasSession(account.id) && riot.persistedSubject(store.loadSession(account.id)) === subject);
    if (bySubject) return bySubject;
    const riotId = riot.persistedRiotId(yaml);
    const byRiotId = riotId ? store.data.accounts.filter((account) => riot.sameRiotId(riotId, account)) : [];
    return byRiotId.length === 1 ? byRiotId[0] : null;
  }

  function keep(yaml) {
    held = null;
    return keepSession(yaml);
  }

  function keepSession(yaml) {
    if (stopped || !enabled() || !riot.hasPersistedLogin(yaml)) return null;
    const owner = ownerOf(yaml);
    if (!owner) return null;
    if (store.loadSession(owner.id) !== yaml) {
      store.saveSession(owner.id, yaml);
      try { onSaved(owner); } catch {}
    }
    return owner;
  }

  function forgetOldSessions() {
    let forgotten = 0;
    for (const account of store.data.accounts) {
      try {
        if (!store.hasSession(account.id) || store.sessionSavedAt(account.id) >= keptSince) continue;
        store.forgetSession(account.id);
        forgotten++;
        try { onSaved(account); } catch {}
      } catch {}
    }
    if (forgotten) log(`forgot ${forgotten} saved session(s) from before cards mode kept sessions`);
  }

  async function noticeSignOut() {
    const last = held;
    if (!last) return;
    const look = riot.look();
    const running = await look.running();
    if (held !== last) return;
    if (!running || !idle()) { held = null; return; }
    const state = await look.account();
    if (held !== last) return;
    if (!idle()) { held = null; return; }
    if (state === 'unknown') return;
    held = null;
    if (state !== 'no' || riot.hasPersistedLogin(riot.readSettingsYaml())) return;
    const { account, yaml } = last;
    if (!store.hasSession(account.id) || store.loadSession(account.id) !== yaml) return;
    store.forgetSession(account.id);
    try { onSaved(account); } catch {}
    log('forgot the saved session of an account signed out in Riot');
  }

  async function settle() {
    if (!idle()) { held = null; return; }
    const yaml = riot.readSettingsYaml();
    if (!riot.hasPersistedLogin(yaml)) { await noticeSignOut(); return; }
    const owner = keepSession(yaml);
    const holding = await riot.look().signedIn();
    if (!idle()) { held = null; return; }
    if (holding) { held = owner ? { account: owner, yaml } : null; return; }
    held = null;
    if (!(await riot.writeSettingsYaml(riot.stripPersistedLogin(yaml), { expected: yaml }))) return;
    log(owner ? 'kept the Riot session for its account and cleared the remembered login' : 'cleared a remembered Riot login that is not from an account in Eclipse');
  }

  function schedule() {
    if (stopped) return;
    cancel(timer);
    timer = later(run, delayMs);
    timer?.unref?.();
  }

  async function run() {
    timer = null;
    if (settling) { again = true; return; }
    settling = settle().then(() => { failing = false; }, () => { if (!failing) log('could not keep the Riot session'); failing = true; });
    await settling;
    settling = null;
    if (again) { again = false; schedule(); }
  }

  function check() {
    schedule();
  }

  async function reopenClient(running) {
    reopenLeft--;
    if (running || riot.hasPersistedLogin(riot.readSettingsYaml())) {
      if (!reopenLeft) log('gave up reopening the Riot after closing it');
      return false;
    }
    reopenLeft = 0;
    if (!idle()) return true;
    try {
      if (await riot.startClient(store.data.settings.riotClientPath)) log('reopened the Riot at the sign-in screen after closing it');
    } catch {
      log('could not reopen the Riot after closing it');
    }
    return true;
  }

  async function inspectClient() {
    if (!idle()) { idleSeen = 0; reopenLeft = 0; held = null; return; }
    const look = riot.look();
    if (await look.inGame()) { gameSeen = true; idleSeen = 0; reopenLeft = 0; return; }
    const running = await look.running();
    const window = await look.window();
    if (!running) held = null;
    if (reopenLeft > 0 && await reopenClient(running)) return;
    if (window && !gameSeen && !riot.hasPersistedLogin(riot.readSettingsYaml())) { idleSeen = 0; await noticeSignOut(); return; }
    const signedIn = await look.signedIn();
    if (!idle()) { idleSeen = 0; return; }
    if (!signedIn) {
      gameSeen = false;
      idleSeen = 0;
      if (riot.hasPersistedLogin(riot.readSettingsYaml())) check();
      else await noticeSignOut();
      return;
    }
    if (window && !gameSeen) { idleSeen = 0; return; }
    if (++idleSeen < 2) return;
    log(gameSeen ? 'closing the signed-in Riot after the game; its session is kept' : 'closing the signed-in Riot left without a window; its session is kept');
    idleSeen = 0;
    gameSeen = false;
    await riot.quitClient();
    reopenLeft = window ? reopenPolls : 0;
    check();
  }

  function poll() {
    if (stopped || !pollMs) return;
    pollTimer = later(async () => {
      pollTimer = null;
      try { await inspectClient(); } catch { idleSeen = 0; }
      poll();
    }, pollMs);
    pollTimer?.unref?.();
  }

  return {
    start() {
      if (stopped || watcher) return;
      forgetOldSessions();
      watcher = riot.watchSettings(() => check());
      check();
      if (!pollTimer) poll();
    },
    check,
    keep,
    stop() {
      stopped = true;
      held = null;
      cancel(timer);
      cancel(pollTimer);
      timer = pollTimer = null;
      try { watcher?.close(); } catch {}
      watcher = null;
    },
  };
}

module.exports = { createSessionKeeper };
