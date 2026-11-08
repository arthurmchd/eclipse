const fs = require('fs');
const path = require('path');
const { parseBackendLockfile } = require('../integration/backend');

const INSTALLS_FILE = 'C:/ProgramData/Riot Games/RiotClientInstalls.json';
const LEAGUE_FOLDER = /league of legends|teamfight tactics/i;
const LOL_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVISIONS = ['I', 'II', 'III', 'IV'];
const VAL_GROUPS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRIVATE = 64 * 1024;

const count = (value) => (Number.isInteger(value) && value >= 0 && value < 1000000 ? value : null);
const name = (value, max) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max && !/[\x00-\x1f\x7f]/.test(text) ? text : null;
};

function leagueFolders({ readFile = fs.readFileSync, installsFile = INSTALLS_FILE } = {}) {
  try {
    const installs = JSON.parse(readFile(installsFile, 'utf8'));
    const folders = installs && typeof installs.associated_client === 'object' ? Object.keys(installs.associated_client || {}) : [];
    return folders.filter((folder) => LEAGUE_FOLDER.test(folder) && path.isAbsolute(folder));
  } catch {
    return [];
  }
}

function readLeagueLockfile({ readFile = fs.readFileSync, installsFile = INSTALLS_FILE } = {}) {
  for (const folder of leagueFolders({ readFile, installsFile })) {
    try { return parseBackendLockfile(readFile(path.join(folder, 'lockfile'), 'utf8')); } catch {}
  }
  throw new Error('The League client is not running');
}

function leagueEntry(entry) {
  const tier = typeof entry?.tier === 'string' ? entry.tier.toUpperCase() : '';
  if (!LOL_TIERS.includes(tier)) return null;
  const division = APEX.includes(tier) ? '' : DIVISIONS.includes(entry.division) ? entry.division : null;
  const lp = count(entry.leaguePoints), wins = count(entry.wins), losses = count(entry.losses);
  if (division === null || lp === null || wins === null || losses === null) return null;
  return { tier, division, lp, wins, losses, hotStreak: entry.hotStreak === true };
}

function parseLeague(summoner, ranked) {
  const gameName = name(summoner?.gameName, 64), tagLine = name(summoner?.tagLine, 16);
  if (!gameName || !tagLine) return null;
  let queues = null;
  if (Array.isArray(ranked?.queues)) queues = ranked.queues;
  else if (ranked?.queueMap && typeof ranked.queueMap === 'object') queues = Object.entries(ranked.queueMap).map(([queueType, entry]) => ({ ...entry, queueType }));
  if (!queues) return null;
  const queue = (type) => leagueEntry(queues.find((entry) => entry?.queueType === type));
  return {
    riotId: { gameName, tagLine },
    lol: { level: count(summoner.summonerLevel), iconId: count(summoner.profileIconId), solo: queue('RANKED_SOLO_5x5'), flex: queue('RANKED_FLEX_SR') },
    tft: { ranked: queue('RANKED_TFT'), doubleUp: queue('RANKED_TFT_DOUBLE_UP') },
  };
}

function valTierName(tier) {
  if (tier === 27) return 'Radiant';
  if (tier >= 3 && tier <= 26) return `${VAL_GROUPS[Math.floor((tier - 3) / 3)]} ${((tier - 3) % 3) + 1}`;
  return 'Unrated';
}

function parseValorant(session, presences) {
  const puuid = name(session?.puuid, 100), gameName = name(session?.game_name, 64), tagLine = name(session?.game_tag, 16);
  if (!puuid || !gameName || !tagLine) return null;
  const list = Array.isArray(presences?.presences) ? presences.presences : [];
  const own = list.find((presence) => presence?.puuid === puuid && presence.product === 'valorant' && typeof presence.private === 'string');
  if (!own || !own.private || own.private.length > MAX_PRIVATE) return null;
  let data;
  try { data = JSON.parse(Buffer.from(own.private, 'base64').toString('utf8')); } catch { return null; }
  const player = data?.playerPresenceData && typeof data.playerPresenceData === 'object' ? data.playerPresenceData : data;
  const tier = player?.competitiveTier;
  if (!Number.isInteger(tier) || tier < 0 || tier > 27) return null;
  const card = typeof player.playerCardId === 'string' && UUID.test(player.playerCardId)
    ? `https://media.valorant-api.com/playercards/${player.playerCardId.toLowerCase()}/smallart.png`
    : null;
  return { riotId: { gameName, tagLine }, val: { tier, tierName: valTierName(tier), level: count(player.accountLevel), card } };
}

function createGameRanks({ leagueApi, riotApi }) {
  async function json(api, route) {
    const response = await api('GET', route).catch(() => null);
    return response?.status === 200 && response.json && typeof response.json === 'object' ? response.json : null;
  }

  async function league() {
    const summoner = await json(leagueApi, '/lol-summoner/v1/current-summoner');
    if (!summoner) return null;
    const ranked = await json(leagueApi, '/lol-ranked/v1/current-ranked-stats');
    return ranked ? parseLeague(summoner, ranked) : null;
  }

  async function valorant() {
    const session = await json(riotApi, '/chat/v1/session');
    if (!session) return null;
    const presences = await json(riotApi, '/chat/v4/presences');
    return presences ? parseValorant(session, presences) : null;
  }

  return { league, valorant };
}

module.exports = { createGameRanks, leagueFolders, readLeagueLockfile, parseLeague, parseValorant, valTierName };
