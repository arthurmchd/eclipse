import { GAME_QUEUES } from './cardView.js';
import { rankOf, LOL_TIERS, VAL_GROUPS } from './ranks.js';

export const SORTS = ['manual', 'rank', 'name', 'recent'];
export const ACCOUNT_GAMES = ['lol', 'val', 'tft', '2xko', 'lor'];
export const BATCH_LIMIT = 50;

export const sortOf = (settings) => SORTS.includes(settings?.cardSort) ? settings.cardSort : 'manual';
export const gamesOf = (account) => {
  const games = Array.isArray(account?.games) ? ACCOUNT_GAMES.filter((game) => account.games.includes(game)) : [];
  return games.length ? games : ACCOUNT_GAMES;
};

export function toggleGame(games, game) {
  if (!ACCOUNT_GAMES.includes(game)) return ACCOUNT_GAMES.slice();
  const current = ACCOUNT_GAMES.filter((item) => games.includes(item));
  if (!current.length || current.length === ACCOUNT_GAMES.length) return [game];
  const next = current.includes(game) ? current.filter((item) => item !== game) : [...current, game];
  return next.length ? ACCOUNT_GAMES.filter((item) => next.includes(item)) : current;
}

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function tierOptions(game) {
  return game === 'val' ? VAL_GROUPS.map((group) => group.id) : LOL_TIERS.map((tier) => tier.id);
}

export function tierOf(account, game) {
  return rankOf(account, game, GAME_QUEUES[game][0]).group;
}

export function matches(account, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold([account.gameName, `#${account.tagLine}`, account.username].join(' '));
  return words.every((word) => haystack.includes(word));
}

const time = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

export function visibleAccounts(accounts, { game = 'lol', stats = 'lol', query = '', region = '', tier = '', sort = 'manual' } = {}) {
  const order = new Map(accounts.map((account, index) => [account.id, index]));
  const list = accounts.filter((account) =>
    (!ACCOUNT_GAMES.includes(game) || gamesOf(account).includes(game))
    && matches(account, query)
    && (!region || account.region === region)
    && (!tier || tierOf(account, stats) === tier));
  const score = (account) => rankOf(account, stats, GAME_QUEUES[stats][0]).score;
  const compare = {
    manual: () => 0,
    rank: (a, b) => score(b) - score(a),
    name: (a, b) => String(a.gameName).localeCompare(String(b.gameName), undefined, { sensitivity: 'base' }) || String(a.tagLine).localeCompare(String(b.tagLine)),
    recent: (a, b) => time(b.lastPlayed) - time(a.lastPlayed),
  }[SORTS.includes(sort) ? sort : 'manual'];
  return list.sort((a, b) => (Number(b.pinned === true) - Number(a.pinned === true)) || compare(a, b) || order.get(a.id) - order.get(b.id));
}

export const toggleSelection = (selectedId, id) => selectedId === id ? null : id;

export const keptSelection = (selectedId, shown) => shown.some(account => account.id === selectedId) ? selectedId : null;

export function canReorder({ query = '', region = '', tier = '', sort = 'manual' } = {}) {
  return sort === 'manual' && !query.trim() && !region && !tier;
}

export function moveId(ids, id, target) {
  const from = ids.indexOf(id);
  if (from < 0 || target < 0 || target > ids.length) return ids.slice();
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(target > from ? target - 1 : target, 0, id);
  return next;
}

export function usage(account, text, now = Date.now(), withCount = true) {
  const parts = [];
  const played = Date.parse(account.lastPlayed);
  if (Number.isFinite(played)) {
    const minutes = Math.max(0, Math.floor((now - played) / 60000));
    parts.push(minutes < 60 ? text.playedMinutes(Math.max(1, minutes)) : minutes < 1440 ? text.playedHours(Math.floor(minutes / 60)) : text.playedDays(Math.floor(minutes / 1440)));
  } else parts.push(text.neverPlayed);
  const count = Number.isSafeInteger(account.signInCount) && account.signInCount > 0 ? account.signInCount : 0;
  if (count && withCount) parts.push(text.signIns(count));
  return parts.join(' · ');
}

export function countLabel({ shown, total, inGame }, text) {
  const base = shown === total ? text.accounts(total) : text.accountsShown(shown, total);
  const outside = total - inGame;
  return outside > 0 ? `${base} · ${text.otherGames(outside)}` : base;
}

export function startsSearch(event, typing) {
  return typeof event.key === 'string' && event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey && !typing;
}

export function parseBatch(value, defaults = {}) {
  const accounts = [], errors = [];
  String(value ?? '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const first = line.indexOf(';'), second = first < 0 ? -1 : line.indexOf(';', first + 1);
    const riotId = first < 0 ? '' : line.slice(0, first).trim();
    const username = second < 0 ? '' : line.slice(first + 1, second).trim();
    const password = second < 0 ? '' : line.slice(second + 1);
    const split = riotId.lastIndexOf('#');
    if (split < 1 || split === riotId.length - 1 || !username || !password) return errors.push(index + 1);
    accounts.push({ gameName: riotId.slice(0, split).trim(), tagLine: riotId.slice(split + 1).trim(), username, password, ...defaults });
  });
  return { accounts, errors, tooMany: accounts.length > BATCH_LIMIT };
}
