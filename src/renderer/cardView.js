import { rankOf, lolCrest, profileIcon, valCardArt } from './ranks.js';

export const GAME_QUEUES = { lol: ['solo', 'flex'], val: ['competitive'] };
export const LAYOUTS = ['plates', 'list'];

export const layoutOf = settings => settings?.cardLayout === 'list' ? 'list' : 'plates';

function climbView(climb, text) {
  if (!climb) return null;
  const tier = text.tiers[climb.tier] || climb.tier;
  const label = climb.holding ? (climb.gap > 0 ? text.cutoffBelow(climb.gap) : text.cutoffAbove(-climb.gap)) : climb.gap > 0 ? text.climbMissing(climb.gap) : text.climbReached;
  return { tier, crest: lolCrest(climb.tier), label, title: text.cutoffTitle(tier, climb.cutoff) };
}

export function queueView(account, game, queue, text) {
  const rank = rankOf(account, game, queue);
  const lol = game === 'lol';
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
    climb: lol ? climbView(rank.climb, text) : null,
    progress: !lol && ranked ? Math.round(Math.max(0, Math.min(1, rank.progress || 0)) * 100) : null,
    change,
    changeTitle: change === null ? '' : text.lastMatch(change),
  };
}

export function accountView(account, game, text) {
  const queues = GAME_QUEUES[game].map(queue => queueView(account, game, queue, text));
  const [main, ...others] = queues;
  const lol = account.stats?.lol;
  const avatar = game === 'val' ? valCardArt(account.stats?.val?.card) : Number.isInteger(lol?.iconId) && lol.iconId >= 0 ? profileIcon(lol.iconId) : '';
  return { id: account.id, name: account.gameName, tag: account.tagLine, level: main.level, avatar, accent: main.color, main, others };
}
