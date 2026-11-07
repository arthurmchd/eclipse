const AUTOMATIC_CHECK_GRACE_MS = 12000;
const GAME_OPEN_TIMEOUT_MS = 180000;
const GAME_UPDATE_TIMEOUT_MS = 1200000;
const RELAUNCH_INTERVAL_MS = 15000;
const outdated = (launch) => launch?.status === 424 && launch.errorCode === 'launch_failed_product_not_up_to_date';
const unfinishedLogin = (state) => state?.type === 'multifactor' || state?.type === 'error';

function createSignInFlow(io) {
  const {
    detectClientPath, closeEverything, readSettingsYaml, writeSettingsYaml,
    hasPersistedLogin, stripPersistedLogin, sameRiotId, sessionState, readAuthenticationState,
    isAuthorized, activeRiotId, localApi, launchProduct, requestLaunch,
    typeCredentials, authenticate, windows, runningGames, openVisibleInterface, closeGames,
    authorization = async () => ((await isAuthorized()) ? 'yes' : 'unknown'),
    now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = io;

  return async function signIn({ account, session, hasSavedSession, game, clientPath, remember = true, status = () => {}, log = () => {}, onClosed = () => {}, onRejected = () => {}, signal }) {
    if (!['lol', 'tft', 'val', 'riot'].includes(game)) throw new Error('Select a supported game');
    const exe = detectClientPath(clientPath);
    if (!exe) throw new Error('Riot Client not found. Set its path in Settings');
    const check = () => {
      if (signal?.aborted) throw new Error('Sign-in cancelled');
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
    const result = { riotId: null, gameStarted: false, clientOpened: false, session: null, usedSavedSession: false, reusedCurrentSession: false, sessionRejected: false };
    let manualAttention = false;
    let attentionText = '';
    let nativeFormUsed = false;
    let nativeAuthenticationComplete = false;
    let nativeAttentionPending = false;
    let nativeAttentionRevealed = false;
    let automaticCheckUntil = 0;
    let restoredYaml = null;
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
        await authenticationAttention('Riot needs your 2FA code. Enter it in the Riot window');
      } else if (state?.error === 'captcha_not_allowed' || /captcha|challenge/i.test(state?.type || '')) {
        if (now() < automaticCheckUntil) return state;
        await authenticationAttention('Riot needs a security check. Complete it in the Riot window');
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
          await authenticationAttention('Sign-in is taking longer. Check the Riot window in case it needs you', false);
        }
        return false;
      }, timeoutMs, 700);
    }
    async function keepSession() {
      result.session = remember ? await wait(async () => {
        const yaml = readSettingsYaml();
        return hasPersistedLogin(yaml) && yaml !== restoredYaml ? yaml : null;
      }, 6000) : null;
      log(!remember ? 'stay signed in is off; no session was kept' : result.session ? 'session available for next launch' : restoredYaml ? 'Riot has not renewed the restored session yet' : 'no remembered login was written');
      check();
    }
    function isHumanStep(state) {
      return state?.type === 'multifactor' || state?.error === 'captcha_not_allowed' || /captcha|challenge/i.test(state?.type || '');
    }

    try {
      check();
      await windows.reveal();
      check();
      let signedIn = false;
      let restoring = false;
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
        }
        check();
      }

      let interfaceOpen = false;
      const leaveSignedInAccount = async () => {
        const closed = await closeEverything(log);
        check();
        await onClosed(closed);
        check();
        if (hasPersistedLogin(closed.yaml)) await writeSettingsYaml(stripPersistedLogin(closed.yaml));
        log('closed the other signed-in account without signing it out');
      };
      const startServices = async () => {
        status('Starting Riot services in the background…', { needsAttention: false });
        check();
        await launchProduct(exe);
        const initial = await wait(sessionState, 45000);
        if (!initial) throw new Error('The Riot Client did not start. Open it to see what happened');
      };
      const openVisibleForm = async () => {
        if (!await sessionState()) {
          await launchProduct(exe, null, true);
          if (!await wait(sessionState, 45000)) throw new Error('The Riot Client did not start');
        }
        await openVisibleInterface(exe, signal, log);
        interfaceOpen = true;
      };
      const prepareVisibleLogin = async (gamesOpen) => {
        status('Preparando o login no Riot Client…', { needsAttention: false });
        if (!signedIn && await isAuthorized()) await leaveSignedInAccount();
        else if (gamesOpen) await closeGames();
        await openVisibleForm();
        if (signedIn) return;
        let current = await authorization();
        check();
        if (current === 'yes') {
          await leaveSignedInAccount();
          await openVisibleForm();
          current = await authorization();
          check();
          if (current === 'yes') throw new Error('Could not sign out the previous account');
        }
        if (current === 'no' && unfinishedLogin(await sessionState())) {
          check();
          await localApi('DELETE', '/rso-auth/v1/session');
          log('cleared an unfinished Riot sign-in');
        }
      };
      const backgroundRestore = remember && hasSavedSession === true && !signedIn;
      if (!backgroundRestore) await prepareVisibleLogin(running.lol || running.val);
      else {
        status('Closing Riot Client in the background…', { needsAttention: false });
        const closed = await closeEverything(log);
        check();
        await onClosed(closed);
        check();
        const saved = typeof session === 'function' ? await session() : session;
        check();
        restoring = hasPersistedLogin(saved);
        if (restoring) {
          await writeSettingsYaml(saved);
          restoredYaml = saved;
          log('restored the saved session');
        } else if (hasPersistedLogin(closed.yaml)) {
          await writeSettingsYaml(stripPersistedLogin(closed.yaml));
          log('cleared the previous remembered login');
        }
        await startServices();
      }

      if (restoring) {
        status('Signing in with the saved session…', { needsAttention: false });
        signedIn = Boolean(await wait(isAuthorized, 15000));
        if (signedIn) {
          const id = await wait(activeRiotId, 8000);
          if (!sameRiotId(id, account)) {
            result.sessionRejected = true;
            log('saved session identity did not match the selected account');
            await onRejected();
            check();
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
      if (backgroundRestore && !signedIn) await prepareVisibleLogin(false);

      if (!signedIn) {
        status('Signing in in the background…', { needsAttention: false });
        let direct = { supported: false };
        if (typeof authenticate === 'function') {
          direct = await authenticate(account, signal, { remember });
          check();
          if (direct?.supported !== true && direct?.supported !== false) throw new Error('The Riot background sign-in service returned an invalid response');
        }
        if (!direct.supported || direct.requiresNativeForm === true) {
          check();
          nativeFormUsed = true;
          status('Entrando na conta…', { needsAttention: false, nativeClient: true });
          const lines = await typeCredentials({
            action: 'type', username: account.username, password: account.password, remember,
          }, signal, log);
          automaticCheckUntil = now() + AUTOMATIC_CHECK_GRACE_MS;
          log(`credentials entered (${lines.filter((line) => line.startsWith('remember:')).join(', ') || 'remember state unavailable'})`);
        } else {
          log('sign-in requested through the Riot background service');
          if (direct.needsAttention) attention(direct.reason === 'multifactor'
            ? 'Riot needs your 2FA code. Enter it in the Riot window'
            : 'Riot needs a security check. Complete it in the Riot window');
        }
        check();
        if (!(await awaitAuthorization(180000))) throw new Error(nativeAttentionPending
          ? 'Sign-in timed out waiting for your attention. Complete the pending step in Riot Client, then try Play again'
          : 'Sign-in timed out. Open the Riot Client to see what happened');
      }

      if (isHumanStep(await authState())) {
        if (!(await awaitAuthorization(180000))) throw new Error('Riot security check timed out. Open the Riot Client to continue');
      }

      nativeAuthenticationComplete = true;
      nativeAttentionPending = false;
      manualAttention = false;
      const signedInStatus = (text) => status(text, { needsAttention: false, signedIn: true });
      signedInStatus('Signed in. Preparing the game…');
      result.riotId = await wait(activeRiotId, 8000);
      if (!result.riotId) throw new Error('Could not verify the signed-in account');
      if (!sameRiotId(result.riotId, account)) throw new Error('The signed-in Riot ID does not match the selected account. Check the Riot ID saved in this app');
      if (game === 'riot') {
        check();
        await keepSession();
        if (!interfaceOpen) await openVisibleInterface(exe, signal, log);
        await windows.reveal();
        result.clientOpened = true;
        signedInStatus('Riot Client opened');
        return result;
      }
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
            attention('The game is taking longer to open or is updating. Check the Riot Client');
          }
          await pause(1000);
        }
        if (!ready && outdated(launch)) throw new Error('The game update did not finish in time. Open Riot Client to check the update');
      }
      if (!ready) throw new Error('The game did not open. Open the Riot Client to check updates or the installation');
      check();
      await keepSession();
      await windows.closeClient();
      result.gameStarted = true;
      signedInStatus('Game opened');
      return result;
    } catch (err) {
      if (nativeFormUsed && !nativeAuthenticationComplete && !nativeAttentionPending && !signal?.aborted) {
        try { await authState(); }
        catch { log('could not recover the native sign-in verification window'); }
      }
      if (nativeAttentionPending && !signal?.aborted) {
        err.needsAttention = true;
        err.nativeClient = true;
      }
      err.sessionRejected = result.sessionRejected;
      throw err;
    }
  };
}

module.exports = { createSignInFlow };
