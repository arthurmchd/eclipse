const crypto = require('crypto');

function createSignInService({ store, riotClient, status = () => {}, operationUpdated = () => {}, accountUpdated = () => {}, log = () => {}, onClosed = () => {}, onLaunched = () => {}, translate = (text) => text }) {
  let operation = null;
  let controller = null;
  let busy = false;

  const say = (text) => {
    try { const value = translate(text); return typeof value === 'string' ? value : text; } catch { return text; }
  };
  const shown = (value) => ({ ...value, text: say(value.text), ...(value.error ? { error: say(value.error) } : {}) });

  function validate(id, game) {
    if (!['lol', 'tft', 'val', 'riot'].includes(game)) throw new Error('Select a supported game');
    const account = store.getAccount(id);
    if (!account) throw new Error('Account not found');
    if (!account.username || !account.password) throw new Error('Add the username and password first');
    return account;
  }

  function begin(id, game) {
    if (busy) throw new Error('A sign-in is already in progress');
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
      text: 'Preparing sign-in…', needsAttention: false, nativeClient: false, signedIn: false, startedAt: new Date().toISOString(),
    };
    current.operationId = current.id;
    busy = true;
    notify(operationUpdated, shown(current));
    setImmediate(async () => {
      try {
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
          signal: attempt.signal,
          remember: store.data.settings.staySignedIn !== false,
          status: (text, details = {}) => {
            if (current.status !== 'running') return;
            const publicText = safeText(text);
            Object.assign(current, { text: publicText, needsAttention: Boolean(details.needsAttention), nativeClient: Boolean(details.nativeClient), signedIn: current.signedIn || details.signedIn === true });
            writeLog(publicText);
            notify(status, { id, text: say(publicText), needsAttention: current.needsAttention, nativeClient: current.nativeClient });
            notify(operationUpdated, shown(current));
          },
          log: writeLog, onClosed,
          onRejected: () => {
            if (!store.getAccount(id)) return;
            try { store.forgetSession(id); }
            catch (storageError) { writeLog(`could not forget the rejected session: ${safeText(storageError?.message)}`); }
          },
        });
        if (result.sessionRejected && store.getAccount(id)) store.forgetSession(id);
        if (result.session && store.getAccount(id)) store.saveSession(id, result.session);
        if (store.getAccount(id)) {
          store.setCurrentAccount(id);
          const fields = result.gameStarted ? { lastPlayed: new Date().toISOString(), lastGame: game } : {};
          if (result.riotId?.gameName) Object.assign(fields, result.riotId);
          notify(accountUpdated, store.updateAccountFields(id, fields));
        }
        const clientOnly = game === 'riot' && result.clientOpened === true;
        if (!result.gameStarted && !clientOnly) throw new Error(game === 'riot' ? 'The Riot Client did not finish signing in. Open it to see what happened' : 'The game did not open. Open the Riot Client to see what happened');
        current.status = 'succeeded';
        current.text = clientOnly ? 'Riot Client opened' : 'Game opened';
        notify(onLaunched, result);
      } catch (err) {
        if (err?.sessionRejected && store.getAccount(id)) {
          try { store.forgetSession(id); notify(accountUpdated, store.publicAccount(store.getAccount(id))); }
          catch (storageError) { writeLog(`could not forget the rejected session: ${safeText(storageError?.message)}`); }
        }
        const cancelled = attempt.signal.aborted;
        Object.assign(current, {
          status: cancelled ? 'cancelled' : 'failed', cancelled,
          needsAttention: !cancelled && err?.needsAttention === true,
          nativeClient: !cancelled && err?.needsAttention === true && err?.nativeClient === true,
          error: safeText(err?.message), text: cancelled ? 'Sign-in cancelled' : safeText(err?.message),
        });
        writeLog(`sign-in ${current.status}: ${safeText(err?.message)}`);
      } finally {
        if (current.status !== 'failed') {
          current.needsAttention = false;
          current.nativeClient = false;
        }
        current.finishedAt = new Date().toISOString();
        controller = null;
        busy = false;
        decryptedPassword = '';
        notify(operationUpdated, shown(current));
      }
    });
    return current.id;
  }

  return {
    startFromManager(id, game) {
      return { ok: true, operationId: begin(id, game) };
    },
    cancel() { controller?.abort(); return { ok: true }; },
    getState() { return operation ? shown(operation) : null; },
    isBusy() { return busy; },
    activeAccountId() { return busy ? operation.accountId : null; },
  };
}

module.exports = { createSignInService };
