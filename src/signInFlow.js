// The launch sequence is kept independent from Windows and Electron so its
// failure, cancellation and account-switching paths can be checked safely.
function createSignInFlow(io) {
  const {
    detectClientPath, closeEverything, readSettingsYaml, writeSettingsYaml,
    hasPersistedLogin, stripPersistedLogin, sameRiotId, sessionState, readAuthenticationState,
    isAuthorized, activeRiotId, localApi, launchProduct, requestLaunch,
    typeCredentials, authenticate, windows, runningGames,
    now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = io;

  return async function signIn({ account, session, hasSavedSession, game, clientPath, hide = true, closeClient = true, dryRun = false, status = () => {}, log = () => {}, onClosed = () => {}, signal }) {
    if (!['lol', 'tft', 'val'].includes(game)) throw new Error('Select a supported game');
    const exe = detectClientPath(clientPath);
    if (!exe) throw new Error('Riot Client not found. Set its path in Settings');
    let guardArmed = false;
    const check = () => {
      if (signal?.aborted) throw new Error('Sign-in cancelled');
      if (guardArmed) windows.assertHealthy?.();
    };
    const pause = async (ms) => {
      check();
      // Short slices keep cancellation responsive, including during updates.
      for (let left = ms; left > 0; left -= 100) { await sleep(Math.min(100, left)); check(); }
    };
    const wait = async (fn, timeoutMs, intervalMs = 500) => {
      const end = now() + timeoutMs;
      while (now() < end) {
        check();
        const value = await fn();
        check();
        if (value) return value;
        await pause(intervalMs);
      }
      return null;
    };
    const result = { riotId: null, gameStarted: false, session: null, usedSavedSession: false, reusedCurrentSession: false, sessionRejected: false };
    let manualAttention = false;
    let attentionText = '';
    let nativeFormUsed = false;
    function attention(text) {
      manualAttention = true;
      if (attentionText === text) return;
      attentionText = text;
      status(text, { needsAttention: true, nativeClient: nativeFormUsed });
    }
    async function authState() {
      const state = await (readAuthenticationState || sessionState)();
      if (state?.type === 'multifactor') {
        attention('Riot needs your 2FA code. Use Show Riot Client to enter it');
      } else if (state?.error === 'captcha_not_allowed' || /captcha|challenge/i.test(state?.type || '')) {
        attention('Riot needs a security check. Use Show Riot Client to complete it');
      } else if (state?.error) {
        const errors = { auth_failure: 'Wrong username or password', rate_limited: 'Too many attempts, wait a few minutes' };
        throw new Error(errors[state.error] || `Riot sign-in error: ${state.error}`);
      }
      return state;
    }
    async function awaitAuthorization(timeoutMs) {
      const began = now();
      let stalled = false;
      return wait(async () => {
        const state = await authState();
        const authorized = await isAuthorized();
        if (authorized && !isHumanStep(state)) return true;
        if (!manualAttention && !stalled && now() - began > 35000) {
          stalled = true;
          attention('Sign-in is taking longer. Use Show Riot Client if Riot needs your attention');
        }
        return false;
      }, timeoutMs, 700);
    }
    function isHumanStep(state) {
      return state?.type === 'multifactor' || state?.error === 'captcha_not_allowed' || /captcha|challenge/i.test(state?.type || '');
    }

    try {
      check();
      // Arm before closing/reopening too: shutdown can recreate a client window.
      if (hide) {
        if (typeof authenticate === 'function') await windows.conceal();
        else await windows.hide();
        guardArmed = true;
      }
      else await windows.reveal();
      check();
      let signedIn = false;
      let restoring = false;
      let reuseSignedOutBackend = false;
      const running = await runningGames();
      check();
      if (!running.lol && !running.val) {
        const existing = await sessionState();
        check();
        if (existing && await isAuthorized()) {
          const identity = await wait(activeRiotId, 8000);
          if (sameRiotId(identity, account)) {
            signedIn = true;
            result.reusedCurrentSession = true;
            log('reused the verified current account');
          }
        } else if (existing?.type === 'auth' && !existing.error && hasSavedSession === false && typeof authenticate === 'function') {
          // A clean login screen and no saved account session require neither
          // replacing settings nor restarting the Riot backend.
          reuseSignedOutBackend = true;
          log('reused the signed-out Riot background service');
        }
        check();
      }

      if (!signedIn && !reuseSignedOutBackend) {
        status('Closing Riot Client in the background…', { needsAttention: false });
        const closed = await closeEverything(log);
        check();
        await onClosed(closed);
        check();
        // Only read the session after shutdown persisted refreshed tokens.
        const saved = typeof session === 'function' ? await session() : session;
        check();
        restoring = hasPersistedLogin(saved);
        if (restoring) {
          writeSettingsYaml(saved);
          log('restored the saved session');
        } else if (hasPersistedLogin(closed.yaml)) {
          writeSettingsYaml(stripPersistedLogin(closed.yaml));
          log('cleared the previous remembered login');
        }

        status('Starting Riot services in the background…', { needsAttention: false });
        check();
        // This starts services only. Never include a game before identity is
        // verified, including when restoring an apparently valid saved token.
        await launchProduct(exe);
        const initial = await wait(sessionState, 45000);
        if (!initial) throw new Error('The Riot Client did not start. Use Show Riot Client in Settings to inspect it');
      }

      if (restoring) {
        status('Signing in with the saved session…', { needsAttention: false });
        signedIn = Boolean(await wait(isAuthorized, 15000));
        // A saved session can itself require a security check. Never type
        // credentials over a pending challenge, even if that challenge expires.
        const pendingState = !signedIn ? await sessionState() : null;
        if (pendingState?.type === 'multifactor' || pendingState?.error === 'captcha_not_allowed' || /captcha|challenge/i.test(pendingState?.type || '')) {
          signedIn = Boolean(await awaitAuthorization(180000));
          if (!signedIn) throw new Error('Riot security check timed out. Use Show Riot Client in Settings to continue');
        }
        if (signedIn) {
          const id = await wait(activeRiotId, 8000);
          if (!sameRiotId(id, account)) {
            result.sessionRejected = true;
            log('saved session identity did not match the selected account');
            await localApi('DELETE', '/rso-auth/v1/session');
            if (!(await wait(async () => !(await isAuthorized()), 15000))) throw new Error('Could not sign out the previous account');
            signedIn = false;
          } else {
            result.usedSavedSession = true;
            log('signed in with the saved session');
          }
        } else {
          result.sessionRejected = true;
          log('saved session is no longer usable');
        }
      }

      if (!signedIn) {
        status('Signing in in the background…', { needsAttention: false });
        let direct = { supported: false };
        if (!dryRun && typeof authenticate === 'function') {
          direct = await authenticate(account, signal);
          check();
          if (direct?.supported !== true && direct?.supported !== false) throw new Error('The Riot background sign-in service returned an invalid response');
        }
        if (!direct.supported || direct.requiresNativeForm === true) {
          check();
          // A CAPTCHA before credential submission must run in Riot's own
          // renderer. This is the first submission, never a password retry.
          nativeFormUsed = true;
          status('Finishing sign-in through the hidden Riot interface…', { needsAttention: false, nativeClient: true });
          if (hide && typeof authenticate === 'function') await windows.hide();
          check();
          const lines = await typeCredentials({
            action: 'type', username: account.username, password: account.password,
            hide, remember: true, submit: !dryRun,
          }, signal);
          log(`credentials entered (${lines.filter((line) => line.startsWith('remember:')).join(', ') || 'remember state unavailable'})`);
        } else {
          log('sign-in requested through the Riot background service');
          if (direct.needsAttention) attention(direct.reason === 'multifactor'
            ? 'Riot needs your 2FA code. Use Show Riot Client to enter it'
            : 'Riot needs a security check. Use Show Riot Client to complete it');
        }
        check();
        if (dryRun) return result;
        if (!(await awaitAuthorization(180000))) throw new Error('Sign-in timed out. Use Show Riot Client in Settings to inspect it');
      }
      if (dryRun) return result;

      // RSO authorization can already exist while the player session still
      // needs consent or another verification. Let the native UI finish it.
      if (isHumanStep(await authState())) {
        if (!(await awaitAuthorization(180000))) throw new Error('Riot security check timed out. Use Show Riot Client in Settings to continue');
      }

      // If the user opened the client for MFA, hide it again after completion.
      if (hide) await windows.conceal();
      manualAttention = false;
      status('Signed in. Preparing the game…', { needsAttention: false });
      result.riotId = await wait(activeRiotId, 8000);
      if (!result.riotId) throw new Error('Could not verify the signed-in account');
      if (!sameRiotId(result.riotId, account)) throw new Error('The signed-in Riot ID does not match the selected account. Check the Riot ID saved in this app');
      status(game === 'val' ? 'Starting VALORANT in the background…' : 'Starting League of Legends in the background…', { needsAttention: false });
      const processGame = game === 'val' ? 'val' : 'lol';
      const isGameReady = async () => (await runningGames())[processGame] && await windows.gameWindow(game);
      // Do not spend three seconds polling a product that has not been asked
      // to start yet. A running product still has to expose its real window.
      let ready = await isGameReady();
      check();
      if (!ready) {
        await requestLaunch(game, log);
        let notified = false;
        const began = now();
        ready = await wait(async () => {
          if (await isGameReady()) return true;
          if (!notified && now() - began > 40000) {
            notified = true;
            attention('The game is taking longer to open or updating. Use Show Riot Client for details');
          }
          return false;
        }, 180000, 1000);
      }
      if (!ready) throw new Error('The game did not open. Use Show Riot Client in Settings to check updates or installation');
      check();
      // Session persistence may lag behind authorization. It must not delay
      // the game launch request or require the login window to be reopened.
      result.session = await wait(async () => {
        const yaml = readSettingsYaml();
        return hasPersistedLogin(yaml) ? yaml : null;
      }, 6000);
      log(result.session ? 'session available for next launch' : 'no remembered login was written');
      check();
      // Never tear the watcher down at launch: Riot can create another window
      // while the game is loading or after a match. Only hide the Riot windows.
      if (hide || closeClient) await windows.conceal();
      result.gameStarted = true;
      status('Game opened', { needsAttention: false });
      return result;
    } catch (err) {
      // Ordinary failures must not unexpectedly display the sign-in screen.
      if (hide) await windows.conceal().catch((guardError) => log(`window guard: ${guardError.message}`));
      err.sessionRejected = result.sessionRejected;
      throw err;
    }
  };
}

module.exports = { createSignInFlow };
