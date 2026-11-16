import { GAME_QUEUES } from './cardView.js';
import { rankOf, LOL_TIERS, VAL_GROUPS } from './ranks.js';

export const SORTS = ['manual', 'rank', 'name', 'recent'];
export const ACCOUNT_GAMES = ['lol', 'val'];
export const SUGGESTED_TAGS = ['Main', 'Smurf', 'Duo'];
export const MAX_TAGS = 8;
export const CARD_COLORS = ['#e8505b', '#e8b04f', '#33cc80', '#4fc1bb', '#7b8ff7', '#c06bf0', '#f0587f', '#a9bcc6'];
export const BATCH_LIMIT = 50;

export const sortOf = (settings) => SORTS.includes(settings?.cardSort) ? settings.cardSort : 'manual';
export const gamesOf = (account) => {
  const games = Array.isArray(account?.games) ? ACCOUNT_GAMES.filter((game) => account.games.includes(game)) : [];
  return games.length ? games : ACCOUNT_GAMES;
};
export const tagsOf = (account) => Array.isArray(account?.tags) ? account.tags.filter((tag) => typeof tag === 'string' && tag) : [];

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function tierOptions(game) {
  return game === 'val' ? VAL_GROUPS.map((group) => group.id) : LOL_TIERS.map((tier) => tier.id);
}

export function tierOf(account, game) {
  return rankOf(account, game, GAME_QUEUES[game][0]).group;
}

export function allTags(accounts) {
  const seen = new Map();
  for (const tag of [...SUGGESTED_TAGS, ...accounts.flatMap(tagsOf)]) if (!seen.has(fold(tag))) seen.set(fold(tag), tag);
  return [...seen.values()];
}

export function parseTags(value) {
  const seen = new Map();
  for (const raw of String(value ?? '').split(',')) {
    const tag = raw.trim().slice(0, 24);
    if (tag && !seen.has(fold(tag))) seen.set(fold(tag), tag);
  }
  return [...seen.values()].slice(0, MAX_TAGS);
}

export function matches(account, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold([account.gameName, `#${account.tagLine}`, account.username, account.note, ...tagsOf(account)].join(' '));
  return words.every((word) => haystack.includes(word));
}

const time = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

export function visibleAccounts(accounts, { game = 'lol', stats = 'lol', query = '', region = '', tier = '', tag = '', sort = 'manual' } = {}) {
  const order = new Map(accounts.map((account, index) => [account.id, index]));
  const list = accounts.filter((account) =>
    (game === 'riot' || gamesOf(account).includes(game))
    && matches(account, query)
    && (!region || account.region === region)
    && (!tier || tierOf(account, stats) === tier)
    && (!tag || tagsOf(account).some((item) => fold(item) === fold(tag))));
  const score = (account) => rankOf(account, stats, GAME_QUEUES[stats][0]).score;
  const compare = {
    manual: () => 0,
    rank: (a, b) => score(b) - score(a),
    name: (a, b) => String(a.gameName).localeCompare(String(b.gameName), undefined, { sensitivity: 'base' }) || String(a.tagLine).localeCompare(String(b.tagLine)),
    recent: (a, b) => time(b.lastPlayed) - time(a.lastPlayed),
  }[SORTS.includes(sort) ? sort : 'manual'];
  return list.sort((a, b) => (Number(b.pinned === true) - Number(a.pinned === true)) || compare(a, b) || order.get(a.id) - order.get(b.id));
}

export function canReorder({ query = '', region = '', tier = '', tag = '', sort = 'manual' } = {}) {
  return sort === 'manual' && !query.trim() && !region && !tier && !tag;
}

export function moveId(ids, id, target) {
  const from = ids.indexOf(id);
  if (from < 0 || target < 0 || target > ids.length) return ids.slice();
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(target > from ? target - 1 : target, 0, id);
  return next;
}

export function usage(account, text, now = Date.now()) {
  const parts = [];
  const played = Date.parse(account.lastPlayed);
  if (Number.isFinite(played)) {
    const minutes = Math.max(0, Math.floor((now - played) / 60000));
    parts.push(minutes < 60 ? text.playedMinutes(Math.max(1, minutes)) : minutes < 1440 ? text.playedHours(Math.floor(minutes / 60)) : text.playedDays(Math.floor(minutes / 1440)));
  } else parts.push(text.neverPlayed);
  const count = Number.isSafeInteger(account.signInCount) && account.signInCount > 0 ? account.signInCount : 0;
  if (count) parts.push(text.signIns(count));
  return parts.join(' · ');
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
