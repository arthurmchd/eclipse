const { LANGUAGES } = require('./language');

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const CHANNELS = new Set(['account-updated', 'refresh-progress', 'next-refresh', 'sign-in-status', 'sign-in-operation']);
const ACCOUNT_FIELDS = ['id', 'createdAt', 'gameName', 'tagLine', 'region', 'valRegion', 'username', 'note', 'lastSeason', 'ban', 'pinned', 'stats', 'lastPlayed', 'lastGame', 'hasPassword', 'hasSession'];

function failure(message = 'Invalid account command', status = 400) {
  return Object.assign(new Error(message), { status });
}

function object(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => !['__proto__', 'constructor', 'prototype'].includes(key)));
}

function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw failure();
}

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || (required && !value.trim())) throw failure();
  return value;
}

function copyPublic(value, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === 'string') return value.slice(0, 8192);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => copyPublic(item, depth + 1));
  if (!object(value)) return null;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!['hasPassword', 'hasSession'].includes(key) && !/ApiKeyMasked$/.test(key) && /password|token|secret|cookie|authorization|api.?key|ssid|^session$|^__|^constructor$|^prototype$/i.test(key)) continue;
    result[key] = copyPublic(item, depth + 1);
  }
  return result;
}

function publicAccount(value) {
  if (!value) return null;
  return copyPublic(Object.fromEntries(ACCOUNT_FIELDS.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])));
}

function createManagerEvents({ limit = 256, maxBytes = 768 * 1024 } = {}) {
  let cursor = 0, bytes = 0;
  const history = [];
  return {
    publish(channel, payload) {
      if (!CHANNELS.has(channel)) return;
      const event = { id: ++cursor, channel, payload: channel === 'account-updated' ? publicAccount(payload) : copyPublic(payload) };
      const size = Buffer.byteLength(JSON.stringify(event));
      if (size > maxBytes) { history.length = 0; bytes = 0; return; }
      history.push({ event, size });
      bytes += size;
      while (history.length > limit || bytes > maxBytes) bytes -= history.shift().size;
    },
    read(after = 0) {
      if (!Number.isSafeInteger(after) || after < 0) throw failure('Invalid event cursor');
      return {
        cursor, reset: after > cursor || after < (history[0]?.event.id ?? cursor + 1) - 1,
        events: history.filter(({ event }) => event.id > after).map(({ event }) => JSON.parse(JSON.stringify(event))),
      };
    },
    cursor: () => cursor,
  };
}

function createManagerService({ store, launchService, riotClient, shell, refreshAll, scheduleRefresh, initContext, settingsChanged = () => {}, events = createManagerEvents() } = {}) {
  function account(id, editable = false) {
    if (typeof id !== 'string' || !ID.test(id)) throw failure('Invalid account identifier');
    const value = store.getAccount(id);
    if (!value) throw failure('Account not found', 404);
    if (editable && launchService.activeAccountId() === id) throw failure('Wait for sign-in to finish before changing this account', 409);
    return value;
  }

  function ban(value) {
    if (value == null) return null;
    keys(value, ['game', 'permanent', 'until']);
    if (!['all', 'lol', 'val'].includes(value.game) || typeof value.permanent !== 'boolean'
      || (!value.permanent && (typeof value.until !== 'string' || !Number.isFinite(Date.parse(value.until))))) throw failure();
    return { game: value.game, permanent: value.permanent, until: value.permanent ? null : value.until };
  }

  function seasons(value) {
    keys(value, ['lol', 'tft', 'val']);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, text(item, 128)]));
  }

  function startRefresh(ids) {
    Promise.resolve().then(() => refreshAll(ids)).catch(() => {});
  }

  const handlers = {
    init() {
      return { ...initContext(), accounts: store.listAccounts().map(publicAccount), settings: store.publicSettings(), operation: copyPublic(launchService.getState()), eventCursor: events.cursor() };
    },
    events(after = 0) { return events.read(after); },
    operation() { return copyPublic(launchService.getState()); },
    saveAccount(input) {
      keys(input, ['id', 'gameName', 'tagLine', 'region', 'valRegion', 'username', 'password', 'note', 'lastSeason', 'ban']);
      if (input.id) account(input.id, true);
      const context = initContext();
      if (!Object.hasOwn(context.regions, input.region) || (input.valRegion && !context.valRegions.includes(input.valRegion))) throw failure('Select a supported region');
      const clean = {
        gameName: text(input.gameName, 64, true), tagLine: text(input.tagLine, 16, true),
        username: text(input.username, 256, true), region: input.region, valRegion: input.valRegion || '',
        note: text(input.note ?? '', 500), lastSeason: seasons(input.lastSeason || {}), ban: ban(input.ban),
      };
      if (input.id) clean.id = input.id;
      if (input.password !== undefined) clean.password = text(input.password, 256);
      if (!input.id && !clean.password) throw failure('Add a password for the new account');
      const saved = publicAccount(store.upsertAccount(clean));
      startRefresh([saved.id]);
      return saved;
    },
    deleteAccount(id) { account(id, true); store.deleteAccount(id); return true; },
    refresh(ids) {
      if (ids != null) {
        if (!Array.isArray(ids) || ids.length > 128) throw failure('Invalid refresh selection');
        ids.forEach((id) => account(id));
      }
      startRefresh(ids || undefined);
      return { started: true, nextRefresh: initContext().nextRefresh };
    },
    runningGames() { return riotClient.runningGames(); },
    signIn(id, game) {
      account(id);
      if (!['lol', 'tft', 'val', 'riot'].includes(game)) throw failure('Select a supported game');
      return launchService.startFromManager(id, game);
    },
    cancelSignIn() { return launchService.cancel(); },
    saveSettings(input) {
      keys(input, ['refreshMinutes', 'staySignedIn', 'riotClientPath', 'language', 'riotApiKey', 'riotTftApiKey', 'henrikApiKey']);
      const clean = {};
      for (const [key, value] of Object.entries(input)) {
        if (key === 'refreshMinutes') {
          if (!Number.isFinite(value) || value < 0 || value > 10080) throw failure('Invalid refresh interval');
          clean[key] = value;
        } else if (key === 'staySignedIn') {
          if (typeof value !== 'boolean') throw failure('Invalid setting');
          clean[key] = value;
        } else if (key === 'language') {
          if (!LANGUAGES.includes(value)) throw failure('Invalid setting');
          clean[key] = value;
        } else clean[key] = text(value, key === 'riotClientPath' ? 2048 : 4096);
      }
      const settings = store.updateSettings(clean);
      scheduleRefresh();
      try { settingsChanged(settings); } catch {}
      return { ...settings, nextRefresh: initContext().nextRefresh };
    },
    async openExternal(url) {
      text(url, 2048, true);
      let parsed;
      try { parsed = new URL(url); } catch { throw failure('Invalid link'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw failure('Only HTTPS links are allowed');
      await shell.openExternal(parsed.href);
      return true;
    },
  };
  const counts = { init: [0, 0], events: [0, 1], operation: [0, 0], saveAccount: [1, 1], deleteAccount: [1, 1], refresh: [0, 1], runningGames: [0, 0], signIn: [2, 2], cancelSignIn: [0, 0], saveSettings: [1, 1], openExternal: [1, 1] };
  return {
    events,
    async dispatch(method, args = []) {
      if (typeof method !== 'string' || !Object.hasOwn(handlers, method) || !Array.isArray(args) || args.length < counts[method][0] || args.length > counts[method][1]) throw failure('Unknown account command');
      return handlers[method](...args);
    },
  };
}

module.exports = { createManagerService, createManagerEvents };
