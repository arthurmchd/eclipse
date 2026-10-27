const crypto = require('crypto');

function createSignInService({ store, riotClient, status = () => {}, operationUpdated = () => {}, accountUpdated = () => {}, log = () => {}, onClosed = () => {}, onLaunched = () => {} }) {
  let operation = null;
  let controller = null;
  let pending = null;

  function validate(id, game) {
    if (!['lol', 'tft', 'val'].includes(game)) throw new Error('Select a supported game');
    const account = store.getAccount(id);
    if (!account) throw new Error('Account not found');
    if (!account.username || !account.password) throw new Error('Add the username and password first');
    return account;
  }

  function begin(id, game, { requireIdle = false } = {}) {
    if (pending) throw new Error('A sign-in is already in progress');
    const account = validate(id, game);
    const selected = { username: account.username, gameName: account.gameName, tagLine: account.tagLine };
    const encryptedPassword = account.password;
    let decryptedPassword = '';
    function safeText(value) {
      let text = typeof value === 'string' ? value : 'Sign-in failed';
      for (const secret of [selected.username, decryptedPassword]) {
        if (!secret || !text.includes(secret)) continue;
        if (secret.length < 4) return 'Sign-in failed';
        text = text.split(secret).join('[redacted]');
      }
      return text;
    }
    const writeLog = (text) => {
      try { Promise.resolve(log(safeText(text))).catch(() => {}); } catch {}
    };
    const notify = (callback, ...args) => {
      try {
        Promise.resolve(callback(...args)).catch(() => writeLog('A sign-in observer could not be notified'));
      } catch { writeLog('A sign-in observer could not be notified'); }
    };
    controller = new AbortController();
    const attempt = controller;
    const current = operation = {
      id: crypto.randomUUID(), accountId: id, game, status: 'running',
      text: 'Preparing sign-in…', needsAttention: false, nativeClient: false, startedAt: new Date().toISOString(),
    };
    current.operationId = current.id;
    let finish;
    pending = new Promise((resolve) => { finish = resolve; });
    const completion = pending;
    notify(operationUpdated, { ...current });
    setImmediate(async () => {
      let response;
      try {
        if (attempt.signal.aborted) throw new Error('Sign-in cancelled');
        if (requireIdle) {
          const running = await riotClient.runningGames();
          if (running.lol || running.val) throw new Error('Close League of Legends or VALORANT before switching from the Riot login screen');
        }
        if (attempt.signal.aborted) throw new Error('Sign-in cancelled');
        const latest = store.getAccount(id);
        if (!latest || latest.username !== selected.username || latest.password !== encryptedPassword) throw new Error('Account credentials changed. Start sign-in again');
        writeLog(`--- sign in (${game})`);
        decryptedPassword = store.getPassword(id);
        const result = await riotClient.signIn({
          account: { ...selected, password: decryptedPassword },
          session: () => store.loadSession(id), game,
          hasSavedSession: store.hasSession(id),
          clientPath: store.data.settings.riotClientPath,
          hide: requireIdle ? true : store.data.settings.hideRiotClient,
          closeClient: requireIdle ? true : store.data.settings.closeRiotClient,
          signal: attempt.signal,
          status: (text, details = {}) => {
            const publicText = safeText(text);
            Object.assign(current, { text: publicText, needsAttention: Boolean(details.needsAttention), nativeClient: Boolean(details.nativeClient) });
            writeLog(publicText);
            notify(status, { id, text: publicText, needsAttention: current.needsAttention, nativeClient: current.nativeClient });
            notify(operationUpdated, { ...current });
          },
          log: writeLog, onClosed,
        });
        if (result.sessionRejected && store.getAccount(id)) store.forgetSession(id);
        if (result.session && store.getAccount(id)) store.saveSession(id, result.session);
        if (store.getAccount(id)) {
          store.setCurrentAccount(id);
          const fields = result.gameStarted ? { lastPlayed: new Date().toISOString(), lastGame: game } : {};
          if (result.riotId?.gameName) Object.assign(fields, result.riotId);
          notify(accountUpdated, store.updateAccountFields(id, fields));
        }
        if (!result.gameStarted) throw new Error('The game did not open. Use Show Riot Client to inspect it');
        current.status = 'succeeded';
        current.text = 'Game opened';
        response = { ok: true, gameStarted: true };
        notify(onLaunched, result);
      } catch (err) {
        if (err?.sessionRejected && store.getAccount(id)) {
          try { store.forgetSession(id); notify(accountUpdated, store.publicAccount(store.getAccount(id))); }
          catch (storageError) { writeLog(`could not forget the rejected session: ${safeText(storageError?.message)}`); }
        }
        const cancelled = attempt.signal.aborted;
        Object.assign(current, {
          status: cancelled ? 'cancelled' : 'failed', cancelled,
          error: safeText(err?.message), text: cancelled ? 'Sign-in cancelled' : safeText(err?.message),
        });
        writeLog(`sign-in ${current.status}: ${safeText(err?.message)}`);
        response = { ok: false, error: current.text, cancelled };
      } finally {
        current.needsAttention = false;
        current.finishedAt = new Date().toISOString();
        controller = null;
        pending = null;
        decryptedPassword = '';
        notify(operationUpdated, { ...current });
        finish(response);
      }
    });
    return { operationId: current.id, completion };
  }

  return {
    async signIn(id, game) {
      try { return await begin(id, game).completion; }
      catch (err) { return { ok: false, error: typeof err?.message === 'string' ? err.message : 'Sign-in failed' }; }
    },
    start(id, game) {
      return { ok: true, operationId: begin(id, game, { requireIdle: true }).operationId };
    },
    cancel() { controller?.abort(); return { ok: true }; },
    getState() { return operation ? { ...operation } : null; },
    isBusy() { return Boolean(pending); },
    activeAccountId() { return pending ? operation.accountId : null; },
  };
}

module.exports = { createSignInService };
