const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images';
const VAL_TIERS = 'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04';

export const LOL_TIERS = [
  { id: 'CHALLENGER', name: 'Challenger', color: '#f4d58d' },
  { id: 'GRANDMASTER', name: 'Grandmaster', color: '#e8505b' },
  { id: 'MASTER', name: 'Master', color: '#c06bf0' },
  { id: 'DIAMOND', name: 'Diamond', color: '#7b8ff7' },
  { id: 'EMERALD', name: 'Emerald', color: '#33cc80' },
  { id: 'PLATINUM', name: 'Platinum', color: '#4fc1bb' },
  { id: 'GOLD', name: 'Gold', color: '#e8b04f' },
  { id: 'SILVER', name: 'Silver', color: '#a9bcc6' },
  { id: 'BRONZE', name: 'Bronze', color: '#c0835a' },
  { id: 'IRON', name: 'Iron', color: '#8f817a' },
  { id: 'UNRANKED', name: 'Unranked', color: '#5d6875' },
];

export const VAL_GROUPS = [
  { id: 'RADIANT', name: 'Radiant', tiers: [27], color: '#fff2a8' },
  { id: 'IMMORTAL', name: 'Immortal', tiers: [24, 25, 26], color: '#f0587f' },
  { id: 'ASCENDANT', name: 'Ascendant', tiers: [21, 22, 23], color: '#4fe0a3' },
  { id: 'DIAMOND', name: 'Diamond', tiers: [18, 19, 20], color: '#c08fe0' },
  { id: 'PLATINUM', name: 'Platinum', tiers: [15, 16, 17], color: '#5ab8c8' },
  { id: 'GOLD', name: 'Gold', tiers: [12, 13, 14], color: '#eccf56' },
  { id: 'SILVER', name: 'Silver', tiers: [9, 10, 11], color: '#c3cbcb' },
  { id: 'BRONZE', name: 'Bronze', tiers: [6, 7, 8], color: '#b8915f' },
  { id: 'IRON', name: 'Iron', tiers: [3, 4, 5], color: '#8f928e' },
  { id: 'UNRATED', name: 'Unrated', tiers: [0, 1, 2], color: '#5d6875' },
];

export const QUEUES = {
  lol: [{ id: 'solo', label: 'Ranked Solo / Duo' }, { id: 'flex', label: 'Ranked Flex' }],
  tft: [{ id: 'ranked', label: 'Ranked' }, { id: 'doubleUp', label: 'Double Up' }],
  val: [{ id: 'competitive', label: 'Competitive' }],
};

const DIVISIONS = { IV: 0, III: 1, II: 2, I: 3 };
const lolTier = (id) => LOL_TIERS.find((t) => t.id === id) || LOL_TIERS[LOL_TIERS.length - 1];
const valGroup = (tier) => VAL_GROUPS.find((g) => g.tiers.includes(tier)) || VAL_GROUPS[VAL_GROUPS.length - 1];

export const lolEmblem = (tierId) =>
  tierId === 'UNRANKED' ? `${CD}/ranked-mini-crests/unranked.svg` : `${CD}/ranked-emblem/emblem-${tierId.toLowerCase()}.png`;
export const lolCrest = (tierId) => `${CD}/ranked-mini-crests/${tierId.toLowerCase()}.svg`;
export const valIcon = (tier, size = 'large') => `${VAL_TIERS}/${tier}/${size}icon.png`;
export const valGroupIcon = (group) => valIcon(group.id === 'UNRATED' ? 0 : group.tiers[group.tiers.length - 1], 'small');
export const profileIcon = (id) =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;

const PLAYER_CARDS = 'https://media.valorant-api.com/playercards';
const DEFAULT_CARD = '9fb348bc-41a0-91ad-8a3e-818035c4e561';

export function valCardArt(card) {
  const id = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(String(card || ''))?.[0] || DEFAULT_CARD;
  return `${PLAYER_CARDS}/${id.toLowerCase()}/smallart.png`;
}

const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export function climbOf(entry) {
  const cutoffs = entry?.cutoffs;
  if (!cutoffs || !Number.isFinite(entry.lp)) return null;
  const tier = entry.tier === 'MASTER' ? 'GRANDMASTER' : ['GRANDMASTER', 'CHALLENGER'].includes(entry.tier) ? 'CHALLENGER' : null;
  const cutoff = tier ? cutoffs[tier.toLowerCase()] : null;
  if (!Number.isFinite(cutoff)) return null;
  return { tier, cutoff, gap: cutoff - entry.lp, holding: entry.tier === 'CHALLENGER' };
}

export function rankOf(acc, game, queue) {
  if (game === 'val') {
    const v = acc.stats?.val;
    const tier = v?.tier ?? 0;
    const g = valGroup(tier);
    const ranked = tier >= 3;
    return {
      group: g.id,
      color: g.color,
      emblem: valIcon(ranked ? tier : 0),
      emblemKind: 'val',
      label: ranked ? title(v.tierName) : 'Unrated',
      sub: ranked ? (Number.isFinite(v.rr) ? `${v.rr} RR` : '') : v ? 'No competitive games this act' : '',
      progress: ranked && Number.isFinite(v.rr) ? Math.min(1, v.rr / (tier === 27 ? 1000 : 100)) : 0,
      score: ranked ? tier * 1000 + (Number.isFinite(v.rr) ? v.rr : 0) : -1,
      level: v?.level ?? null,
      wins: null,
      losses: null,
      extra: v?.peak && v.peak.tier >= 3 ? `Peak ${title(v.peak.name)}${v.peak.season ? ` (${v.peak.season})` : ''}` : '',
      lastSeason: v?.lastSeason ? `${title(v.lastSeason.name)}${v.lastSeason.season ? ` · ${v.lastSeason.season}` : ''}` : acc.lastSeason?.val || '',
      lastChange: v?.lastChange ?? null,
      updatedAt: v?.updatedAt || null,
      error: acc.stats?.errors?.val || acc.stats?.errors?.all || null,
    };
  }

  const block = game === 'tft' ? acc.stats?.tft : acc.stats?.lol;
  const e = block?.[queue] || null;
  const t = lolTier(e?.tier || 'UNRANKED');
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(t.id);
  const tierIdx = LOL_TIERS.length - 1 - LOL_TIERS.indexOf(t);
  const games = e ? e.wins + e.losses : 0;
  return {
    group: t.id,
    color: t.color,
    emblem: lolEmblem(t.id),
    emblemKind: t.id === 'UNRANKED' ? 'crest' : 'lol',
    label: e ? `${t.name}${e.division ? ` ${e.division}` : ''}` : 'Unranked',
    sub: e ? `${e.lp} LP` : block ? 'No ranked games this split' : '',
    progress: e ? Math.min(1, apex ? e.lp / 1500 : e.lp / 100) : 0,
    score: e ? tierIdx * 1000 + (apex ? 0 : DIVISIONS[e.division] * 100) + e.lp : -1,
    level: acc.stats?.lol?.level ?? null,
    wins: e ? e.wins : null,
    losses: e ? e.losses : null,
    winrate: games ? Math.round((e.wins / games) * 100) : null,
    hotStreak: e?.hotStreak || false,
    climb: climbOf(e),
    extra: '',
    lastSeason: acc.lastSeason?.[game] || '',
    updatedAt: block?.updatedAt || null,
    error: acc.stats?.errors?.[game] || acc.stats?.errors?.all || null,
  };
}

export function distributionGroups(game) {
  if (game === 'val') return VAL_GROUPS.map((g) => ({ id: g.id, name: g.name, color: g.color, icon: valGroupIcon(g) }));
  return LOL_TIERS.map((t) => ({ id: t.id, name: t.name, color: t.color, icon: lolCrest(t.id) }));
}
