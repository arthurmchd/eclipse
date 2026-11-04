const AUTOMATIC_CHECK_GRACE_MS = 12000;
const GAME_OPEN_TIMEOUT_MS = 180000;
const GAME_UPDATE_TIMEOUT_MS = 1200000;
const RELAUNCH_INTERVAL_MS = 15000;
const outdated = (launch) => launch?.status === 424 && launch.errorCode === 'launch_failed_product_not_up_to_date';

function createSignInFlow(io) {
  const {
    detectClientPath, closeEverything, readSettingsYaml, writeSettingsYaml,
    hasPersistedLogin, stripPersistedLogin, sameRiotId, sessionState, readAuthenticationState,
    isAuthorized, activeRiotId, localApi, launchProduct, requestLaunch,
    typeCredentials, authenticate, windows, runningGames, openVisibleInterface, closeGames,
    now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = io;

  return async function signIn({ account, session, hasSavedSession, game, clientPath, hide = true, closeClient = true, dryRun = false, releaseAfterLaunch = false, visibleLogin = false, remember = true, status = () => {}, log = () => {}, onClosed = () => {}, signal }) {
    if (visibleLogin) hide = false;
    if (!['lol', 'tft', 'val'].includes(game)) throw new Error('Select a supported game');
    const exe = detectClientPath(clientPath);
    if (!exe) throw new Error('Riot Client not found. Set its path in Settings');
    let guardArmed = false;
    const reportGuard = () => {
      for (const incident of windows.drainIncidents?.() || []) {
        log(`window guard ${incident.recovered ? 'restarted' : 'could not be restarted'} after ${incident.reason}`);
      }
    };
    const check = () => {
      if (signal?.aborted) throw new Error('Sign-in cancelled');
      if (guardArmed) {
        reportGuard();
        windows.assertHealthy?.();
      }
    };
    const pause = async (ms) => {
      check();
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
    let nativeAuthenticationComplete = false;
    let nativeAttentionPending = false;
    let nativeAttentionRevealed = false;
    let automaticCheckUntil = 0;
    function attention(text) {
      manualAttention = true;
      if (attentionText === text) return;
      attentionText = text;
      status(text, { needsAttention: true, nativeClient: nativeFormUsed });
    }
    async function authenticationAttention(text, revealNative = true) {
      attention(text);
      if (!nativeFormUsed) return;
      nativeAttentionPending = true;
      if (revealNative && !nativeAttentionRevealed) {
        await windows.reveal();
        nativeAttentionRevealed = true;
      }
    }
    async function authState() {
      const state = await (readAuthenticationState || sessionState)();
      if (state?.type === 'multifactor') {
        await authenticationAttention('Riot needs your 2FA code. Use Show Riot Client to enter it');
      } else if (state?.error === 'captcha_not_allowed' || /captcha|challenge/i.test(state?.type || '')) {
        if (now() < automaticCheckUntil) return state;
        await authenticationAttention('Riot needs a security check. Use Show Riot Client to complete it');
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
          await authenticationAttention('Sign-in is taking longer. Use Show Riot Client if Riot needs your attention', false);
        }
        return false;
      }, timeoutMs, 700);
    }
    function isHumanStep(state) {
      return state?.type === 'multifactor' || state?.error === 'captcha_not_allowed' || /captcha|challenge/i.test(state?.type || '');
    }

    try {
      check();
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
          reuseSignedOutBackend = true;
          log('reused the signed-out Riot background service');
        }
        check();
      }

      if (visibleLogin) {
        status('Preparando o login no Riot Client…', { needsAttention: false });
        if (running.lol || running.val) await closeGames();
        if (!await sessionState()) {
          await launchProduct(exe, null, true);
          if (!await wait(sessionState, 45000)) throw new Error('The Riot Client did not start');
        }
        await openVisibleInterface(exe, signal, log);
        if (!signedIn) {
          await localApi('DELETE', '/rso-auth/v1/session');
          if (!await wait(async () => !await isAuthorized(), 15000)) throw new Error('Could not sign out the previous account');
          check();
        }
      }
      if (!visibleLogin && !signedIn && !reuseSignedOutBackend) {
        status('Closing Riot Client in the background…', { needsAttention: false });
        const closed = await closeEverything(log);
        check();
        await onClosed(closed);
        check();
        const saved = !remember ? null : typeof session === 'function' ? await session() : session;
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
        await launchProduct(exe);
        const initial = await wait(sessionState, 45000);
        if (!initial) throw new Error('The Riot Client did not start. Use Show Riot Client in Settings to inspect it');
      }

      if (restoring) {
        status('Signing in with the saved session…', { needsAttention: false });
        signedIn = Boolean(await wait(isAuthorized, 15000));
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
          direct = await authenticate(account, signal, { remember });
          check();
          if (direct?.supported !== true && direct?.supported !== false) throw new Error('The Riot background sign-in service returned an invalid response');
        }
        if (!direct.supported || direct.requiresNativeForm === true) {
          check();
          nativeFormUsed = true;
          status(visibleLogin ? 'Entrando na conta…' : 'Finishing sign-in through the hidden Riot interface…', { needsAttention: false, nativeClient: true });
          if (hide && typeof authenticate === 'function') await windows.hide();
          check();
          const lines = await typeCredentials({
            action: 'type', username: account.username, password: account.password,
            hide, remember, submit: !dryRun,
          }, signal, log);
          automaticCheckUntil = now() + AUTOMATIC_CHECK_GRACE_MS;
          log(`credentials entered (${lines.filter((line) => line.startsWith('remember:')).join(', ') || 'remember state unavailable'})`);
        } else {
          log('sign-in requested through the Riot background service');
          if (direct.needsAttention) attention(direct.reason === 'multifactor'
            ? 'Riot needs your 2FA code. Use Show Riot Client to enter it'
            : 'Riot needs a security check. Use Show Riot Client to complete it');
        }
        check();
        if (dryRun) return result;
        if (!(await awaitAuthorization(180000))) throw new Error(nativeAttentionPending
          ? 'Sign-in timed out waiting for your attention. Complete the pending step in Riot Client, then try Play again'
          : 'Sign-in timed out. Use Show Riot Client in Settings to inspect it');
      }
      if (dryRun) return result;

      if (isHumanStep(await authState())) {
        if (!(await awaitAuthorization(180000))) throw new Error('Riot security check timed out. Use Show Riot Client in Settings to continue');
      }

      nativeAuthenticationComplete = true;
      nativeAttentionPending = false;
      if (hide) await windows.conceal();
      manualAttention = false;
      const signedInStatus = (text) => status(text, { needsAttention: false, signedIn: true });
      signedInStatus('Signed in. Preparing the game…');
      result.riotId = await wait(activeRiotId, 8000);
      if (!result.riotId) throw new Error('Could not verify the signed-in account');
      if (!sameRiotId(result.riotId, account)) throw new Error('The signed-in Riot ID does not match the selected account. Check the Riot ID saved in this app');
      signedInStatus(game === 'val' ? 'Starting VALORANT in the background…' : 'Starting League of Legends in the background…');
      const processGame = game === 'val' ? 'val' : 'lol';
      const isGameReady = async () => (await runningGames())[processGame] && await windows.gameWindow(game);
      let ready = await isGameReady();
      check();
      if (!ready) {
        let launch = await requestLaunch(game, log);
        let requestedAt = now();
        let updating = false;
        let notified = false;
        const began = now();
        const limit = () => (outdated(launch) ? began + GAME_UPDATE_TIMEOUT_MS : requestedAt + GAME_OPEN_TIMEOUT_MS);
        while (!ready && now() < limit()) {
          check();
          ready = await isGameReady();
          check();
          if (ready) break;
          if (outdated(launch)) {
            if (!updating) {
              updating = true;
              signedInStatus(game === 'val' ? 'Waiting for the VALORANT update to finish…' : 'Waiting for the League of Legends update to finish…');
            }
            if (now() - requestedAt >= RELAUNCH_INTERVAL_MS) {
              launch = await requestLaunch(game, log);
              requestedAt = now();
              check();
            }
          } else if (!notified && now() - requestedAt > 40000) {
            notified = true;
            attention('The game is taking longer to open or updating. Use Show Riot Client for details');
          }
          await pause(1000);
        }
        if (!ready && outdated(launch)) throw new Error('The game update did not finish in time. Open Riot Client to check the update');
      }
      if (!ready) throw new Error('The game did not open. Use Show Riot Client in Settings to check updates or installation');
      check();
      result.session = remember ? await wait(async () => {
        const yaml = readSettingsYaml();
        return hasPersistedLogin(yaml) ? yaml : null;
      }, 6000) : null;
      log(!remember ? 'stay signed in is off; no session was kept' : result.session ? 'session available for next launch' : 'no remembered login was written');
      check();
      if (visibleLogin) await windows.closeClient();
      else {
        if (hide || closeClient) await windows.conceal();
        if (releaseAfterLaunch) await windows.park();
      }
      result.gameStarted = true;
      signedInStatus('Game opened');
      return result;
    } catch (err) {
      reportGuard();
      if (nativeFormUsed && !nativeAuthenticationComplete && !nativeAttentionPending && !signal?.aborted) {
        try { await authState(); }
        catch { log('could not recover the native sign-in verification window'); }
      }
      const pendingNativeAttention = nativeAttentionPending && !signal?.aborted;
      if (hide && !pendingNativeAttention) await windows.conceal().catch((guardError) => log(`window guard: ${guardError.message}`));
      if (pendingNativeAttention) {
        err.needsAttention = true;
        err.nativeClient = true;
      }
      err.sessionRejected = result.sessionRejected;
      throw err;
    }
  };
}

module.exports = { createSignInFlow };
