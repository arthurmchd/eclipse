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
const LOCAL_CRESTS = new Set(LOL_TIERS.filter((t) => t.id !== 'UNRANKED').map((t) => t.id));
export const lolCrest = (tierId) =>
  LOCAL_CRESTS.has(tierId) ? `assets/rank-${tierId.toLowerCase()}.png` : `${CD}/ranked-mini-crests/unranked.svg`;
export const valIcon = (tier, size = 'large') => `${VAL_TIERS}/${tier}/${size}icon.png`;
export const valGroupIcon = (group) => valIcon(group.id === 'UNRATED' ? 0 : group.tiers[group.tiers.length - 1], 'small');
export const profileIcon = (id) =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;

const ARMOR = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default';
const LEVEL_BORDERS = 'https://media.valorant-api.com/levelborders';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAL_LEVEL_BORDERS = [
  [1, 'ebc736cd-4b6a-137b-e2b0-1486e31312c9'], [20, '5156a90d-4d65-58d0-f6a8-48a0c003878a'], [40, '9c4afb15-40d7-3557-062a-4bb198cb9958'],
  [60, 'e6238102-425c-a647-6685-e6af7f8982d9'], [80, '49413ac2-4ed5-6953-5791-db838ccb58f3'], [100, 'e05371e3-4ec4-a53e-168a-c49346a75c19'],
  [120, '7e7feff1-44c2-301e-767d-d9b2b1cd9051'], [140, '53d4ed03-4b29-5913-aeda-80a41afcef3a'], [160, '6f610ab6-4a21-63fd-ac19-4a9204bc2721'],
  [180, '547ac9dd-495d-f11d-d921-3fbd14604ae0'], [200, 'bd1082ab-462c-3fb8-e049-28a9750acf0f'], [220, '37a36996-41f3-6e26-c00b-46bf7c037482'],
  [240, '5d0d6c6c-4f0a-dc65-e506-b786cc27dbe1'], [260, '3635b061-4bf9-b937-55fe-44a4dd0ed3dc'], [280, 'ae5eda0d-476b-a159-959c-df93374f4a69'],
  [300, '3d90bc3a-4626-71d6-a17c-93ae14d05fb0'], [320, '674bbd9e-4a4f-208a-75fa-1d9dd7d7008f'], [340, 'd84cf377-4c21-1cdf-0260-4e8ebd9825f5'],
  [360, '6c1fb61e-46e5-2908-5048-d4866cb64c3d'], [380, 'af1852a5-4e66-02a6-2ae3-ab8c885efb80'], [400, 'cbd1914e-43f8-7ae5-38c4-228bcbe58756'],
  [420, 'c8a4abff-4ace-f0a3-c9f3-db936791a697'], [440, '086dd1ab-4889-793a-4b33-0a99e311fa25'], [460, '08ab72f1-4fce-ddb5-5fd5-22abd3bc9d49'],
  [480, '6694d7f7-4ab9-8545-5921-35a9ea8cec24'],
];

export function lolBorder(border) {
  if (border?.kind === 'level' && Number.isInteger(border.theme) && border.theme >= 1 && border.theme <= 21) return { kind: 'level', src: `${CD}/uikit/themed-borders/theme-${border.theme}-border.png` };
  if (border?.kind === 'ranked' && LOCAL_CRESTS.has(border.tier)) return { kind: 'ranked', src: `${ARMOR}/${border.tier.toLowerCase()}.png` };
  return null;
}

export const levelTheme = (level) => level < 30 ? 1 : level < 50 ? 2 : Math.min(21, 3 + Math.floor((level - 50) / 25));
export const lolLevelBorder = (level) => Number.isInteger(level) && level >= 1 ? lolBorder({ kind: 'level', theme: levelTheme(level) }) : null;

export function valBorder(border, level) {
  const byLevel = Number.isInteger(level) && level >= 1 ? VAL_LEVEL_BORDERS.filter(([start]) => start <= level).at(-1)?.[1] : null;
  const id = border === 'level' ? byLevel : typeof border === 'string' && UUID.test(border) ? border.toLowerCase() : null;
  return id ? { kind: 'val', src: `${LEVEL_BORDERS}/${id}/smallplayercardappearance.png`, badge: `${LEVEL_BORDERS}/${id}/levelnumberappearance.png` } : null;
}

const PLAYER_CARDS = 'https://media.valorant-api.com/playercards';
const DEFAULT_CARD = '9fb348bc-41a0-91ad-8a3e-818035c4e561';

const cardId = (card) => (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(String(card || ''))?.[0] || DEFAULT_CARD).toLowerCase();
export const valCardArt = (card) => `${PLAYER_CARDS}/${cardId(card)}/smallart.png`;
export const valLargeArt = (card) => `${PLAYER_CARDS}/${cardId(card)}/largeart.png`;

const GAME_DATA = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets';
const BANNERS = `${GAME_DATA}/regalia/bannerskins`;

export const lolSplash = (path) => typeof path === 'string' && /^characters\/[a-z0-9_]{1,40}\/skins\/[a-z0-9_]{1,40}\/images\/[a-z0-9_]{1,80}\.jpg$/.test(path) ? `${GAME_DATA}/${path.replace(/_splash_centered_(\d+)\.jpg$/, '_splash_tile_$1.jpg')}` : null;
export const tftCompanion = (name) => typeof name === 'string' && /^[a-z0-9_]{1,120}$/.test(name) ? `${GAME_DATA}/loadouts/companions/${name}.png` : null;

export function lolBanner(saved) {
  const name = typeof saved === 'string' ? saved.toLowerCase() : '';
  return `${BANNERS}/${/^[a-z0-9_]{1,80}$/.test(name) ? name : 'default'}.png`;
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
