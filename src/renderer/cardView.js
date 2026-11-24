import { rankOf, lolCrest, profileIcon, valCardArt, valLargeArt, lolBanner, lolSplash, tftCompanion, lolBorder, lolLevelBorder, valBorder } from './ranks.js';

export const GAME_QUEUES = { lol: ['solo', 'flex'], tft: ['ranked', 'doubleUp'], val: ['competitive'] };
export const GAME_NAMES = { lol: 'League of Legends', val: 'VALORANT', tft: 'Teamfight Tactics', '2xko': '2XKO', lor: 'Legends of Runeterra', riot: 'Riot Client' };
export const GAME_SHORT = { lol: 'League', val: 'VALORANT', tft: 'TFT' };
export const LAYOUTS = ['plates', 'list'];

export const layoutOf = settings => settings?.cardLayout === 'list' ? 'list' : 'plates';
export const PAGE_THEMES = ['light', 'dark'];
export const pageThemeOf = settings => settings?.pageTheme === 'dark' ? 'dark' : 'light';
export const otherPageTheme = theme => theme === 'dark' ? 'light' : 'dark';

function climbView(climb, text) {
  if (!climb) return null;
  const tier = text.tiers[climb.tier] || climb.tier;
  const label = climb.holding ? (climb.gap > 0 ? text.cutoffBelow(climb.gap) : text.cutoffAbove(-climb.gap)) : climb.gap > 0 ? text.climbMissing(climb.gap) : text.climbReached;
  return { tier, crest: lolCrest(climb.tier), label, title: text.cutoffTitle(tier, climb.cutoff) };
}

export function queueView(account, game, queue, text) {
  const rank = rankOf(account, game, queue);
  const lol = game !== 'val';
  const ranked = rank.label !== 'Unranked' && rank.label !== 'Unrated';
  const tier = !ranked ? text.unranked : lol ? rank.label.replace(/^\S+/, text.tiers[rank.group] || rank.group) : rank.label.replace(/^\S+/, word => text.valTiers[word.toUpperCase()] || word);
  const games = Number.isFinite(rank.wins) && Number.isFinite(rank.losses) ? rank.wins + rank.losses : 0;
  const change = Number.isFinite(rank.lastChange) && rank.lastChange !== 0 ? rank.lastChange : null;
  return {
    name: text.queues[queue],
    ranked,
    tier,
    points: ranked ? rank.sub.replace(/ LP$/, ` ${text.leaguePoints}`) : text.noGames,
    crest: lol ? lolCrest(rank.group) : rank.emblem,
    color: rank.color,
    level: Number.isFinite(rank.level) ? rank.level : null,
    winrate: games ? rank.winrate : null,
    games,
    wins: games ? rank.wins : 0,
    record: games ? text.record(rank.wins, rank.losses) : '',
    played: games ? `${rank.winrate}% · ${text.games(games)}` : '',
    climb: game === 'lol' ? climbView(rank.climb, text) : null,
    progress: lol ? null : ranked ? Math.round(Math.max(0, Math.min(1, rank.progress || 0)) * 100) : 0,
    change,
    changeTitle: change === null ? '' : text.lastMatch(change),
  };
}

export function queueLabel(game, stats, queue, text) {
  const name = text.queues[queue];
  if (game === stats) return { label: name, title: '', column: name };
  return { label: text.rankFrom(GAME_SHORT[stats]), title: `${name} · ${GAME_NAMES[stats]}`, column: `${name} · ${GAME_SHORT[stats]}` };
}

export function accountView(account, game, text) {
  const queues = GAME_QUEUES[game].map(queue => queueView(account, game, queue, text));
  const [main, ...others] = queues;
  const lol = account.stats?.lol;
  const avatar = game === 'val' ? valCardArt(account.stats?.val?.card) : Number.isInteger(lol?.iconId) && lol.iconId >= 0 ? profileIcon(lol.iconId) : '';
  const level = main.level ?? (game === 'tft' && Number.isFinite(lol?.level) ? lol.level : null);
  const border = game === 'val' ? valBorder(account.stats?.val?.border, account.stats?.val?.level) : lolBorder(lol?.border) || lolLevelBorder(level);
  const banner = game === 'val' ? null : lolBanner(lol?.banner);
  const art = game === 'val' ? valLargeArt(account.stats?.val?.card) : null;
  const splash = game === 'lol' ? lolSplash(lol?.splash) : null;
  const board = game === 'tft' ? tftCompanion(lol?.companion) || avatar || null : null;
  return { id: account.id, name: account.gameName, tag: account.tagLine, level, avatar, accent: main.color, main, others, border, banner, art, splash, board };
}

export const RIOT_GAMES = ['lol', 'val', 'tft'];
export const RIOT_ACCENT = '#d13639';
const GAME_ICONS = { lol: 'assets/game-lol.svg', val: 'assets/game-val.png', tft: 'assets/game-tft.svg' };

export function riotView(account, games, region, text) {
  const lol = account.stats?.lol;
  const card = account.stats?.val?.card;
  const avatar = Number.isInteger(lol?.iconId) && lol.iconId >= 0 ? profileIcon(lol.iconId) : card ? valCardArt(card) : '';
  const ranks = RIOT_GAMES.map(game => {
    const queue = queueView(account, game, GAME_QUEUES[game][0], text);
    return { game, gameName: GAME_NAMES[game], short: GAME_SHORT[game], icon: GAME_ICONS[game], shown: games.includes(game), ranked: queue.ranked, tier: queue.tier, crest: queue.crest, points: queue.ranked ? queue.points : '' };
  });
  return { id: account.id, name: account.gameName, tag: account.tagLine, region: region || '', avatar, accent: RIOT_ACCENT, ranks };
}

export function selectionView(account, game, regions, text) {
  if (!account) return { name: text.selectAccount, detail: '' };
  const name = `${account.gameName} #${account.tagLine}`;
  if (!account.hasPassword) return { name, detail: text.addPassword };
  const region = regions?.[account.region]?.label || account.region || '';
  const first = GAME_QUEUES[game] ? queueView(account, game, GAME_QUEUES[game][0], text).tier : game === 'riot' ? text.riotOnlyShort : GAME_NAMES[game] || '';
  return { name, detail: [first, region].filter(Boolean).join(' · ') };
}

export const startupChange = (current, checked) => (typeof current === 'boolean' && checked !== current ? checked : undefined);
