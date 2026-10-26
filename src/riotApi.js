// Rank lookups.
// LoL and TFT: official Riot API (key from developer.riotgames.com).
// VALORANT: HenrikDev API (unofficial; key from api.henrikdev.xyz), because the
// official VALORANT ranked endpoints are only open to approved production apps.
const crypto = require('crypto');

// platform id -> label, account-v1 routing, VALORANT region
const REGIONS = {
  br1: { label: 'BR', routing: 'americas', val: 'br' },
  na1: { label: 'NA', routing: 'americas', val: 'na' },
  la1: { label: 'LAN', routing: 'americas', val: 'latam' },
  la2: { label: 'LAS', routing: 'americas', val: 'latam' },
  euw1: { label: 'EUW', routing: 'europe', val: 'eu' },
  eun1: { label: 'EUNE', routing: 'europe', val: 'eu' },
  tr1: { label: 'TR', routing: 'europe', val: 'eu' },
  ru: { label: 'RU', routing: 'europe', val: 'eu' },
  me1: { label: 'ME', routing: 'europe', val: 'eu' },
  kr: { label: 'KR', routing: 'asia', val: 'kr' },
  jp1: { label: 'JP', routing: 'asia', val: 'ap' },
  oc1: { label: 'OCE', routing: 'asia', val: 'ap' },
  sg2: { label: 'SG', routing: 'asia', val: 'ap' },
  tw2: { label: 'TW', routing: 'asia', val: 'ap' },
  vn2: { label: 'VN', routing: 'asia', val: 'ap' },
};

const VAL_REGIONS = ['br', 'na', 'latam', 'eu', 'kr', 'ap'];

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Requests go out one at a time with a small gap; the Riot dev key allows
// 20 requests/second and 100 every 2 minutes.
let queue = Promise.resolve();
function throttled(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 80)));
  return run;
}

async function getJson(url, headers, attempt = 0) {
  return throttled(async () => {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after') || 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return { retry: true };
    }
    if (res.status === 404) return { notFound: true };
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = body?.status?.message || body?.errors?.[0]?.message || body?.message || msg;
      } catch {}
      throw new ApiError(res.status, msg);
    }
    return { data: await res.json() };
  }).then((r) => (r.retry ? getJson(url, headers, attempt + 1) : r));
}

function riotKeyError(err) {
  if (err.status === 401 || err.status === 403) return 'Riot API key is invalid or expired (dev keys expire every 24h)';
  return err.message;
}

// ---- League of Legends + TFT --------------------------------------------

function mapEntry(e) {
  if (!e) return null;
  return {
    tier: e.tier,
    division: ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(e.tier) ? '' : e.rank,
    lp: e.leaguePoints,
    wins: e.wins,
    losses: e.losses,
    hotStreak: Boolean(e.hotStreak),
  };
}

// PUUIDs are encrypted per API key, so each key needs its own lookup; the
// cache maps a short hash of the key to the Riot ID and PUUID it resolved.
async function resolvePuuid(acc, key, cache) {
  const region = REGIONS[acc.region];
  const riotId = `${acc.gameName}#${acc.tagLine}`;
  const keyHash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  const hit = cache[keyHash];
  if (hit && hit.riotId === riotId) return { puuid: hit.puuid, resolvedId: null, keyHash };
  const r = await getJson(
    `https://${region.routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(acc.gameName)}/${encodeURIComponent(acc.tagLine)}`,
    { 'X-Riot-Token': key },
  );
  if (r.notFound) throw new ApiError(404, `Riot ID ${riotId} not found`);
  const resolvedId = { gameName: r.data.gameName, tagLine: r.data.tagLine };
  cache[keyHash] = { riotId: `${resolvedId.gameName}#${resolvedId.tagLine}`, puuid: r.data.puuid };
  return { puuid: r.data.puuid, resolvedId, keyHash };
}

async function fetchLol(acc, key, cache) {
  const region = REGIONS[acc.region];
  if (!region) throw new Error(`Unknown region ${acc.region}`);
  const headers = { 'X-Riot-Token': key };
  const { puuid, resolvedId } = await resolvePuuid(acc, key, cache);
  const base = `https://${acc.region}.api.riotgames.com`;
  const [summoner, league] = await Promise.all([
    getJson(`${base}/lol/summoner/v4/summoners/by-puuid/${puuid}`, headers),
    getJson(`${base}/lol/league/v4/entries/by-puuid/${puuid}`, headers),
  ]);
  if (summoner.notFound) throw new ApiError(404, `No League profile on ${region.label}`);
  const entries = league.data || [];
  return {
    resolvedId,
    lol: {
      level: summoner.data.summonerLevel,
      iconId: summoner.data.profileIconId,
      solo: mapEntry(entries.find((e) => e.queueType === 'RANKED_SOLO_5x5')),
      flex: mapEntry(entries.find((e) => e.queueType === 'RANKED_FLEX_SR')),
      updatedAt: new Date().toISOString(),
    },
  };
}

async function fetchTft(acc, key, cache) {
  const region = REGIONS[acc.region];
  if (!region) throw new Error(`Unknown region ${acc.region}`);
  const { puuid } = await resolvePuuid(acc, key, cache);
  const r = await getJson(`https://${acc.region}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}`, { 'X-Riot-Token': key });
  const entries = r.data || [];
  return {
    ranked: mapEntry(entries.find((e) => e.queueType === 'RANKED_TFT')),
    doubleUp: mapEntry(entries.find((e) => e.queueType === 'RANKED_TFT_DOUBLE_UP')),
    updatedAt: new Date().toISOString(),
  };
}

// ---- VALORANT (HenrikDev) -------------------------------------------------

async function fetchValorant(acc, key) {
  const region = acc.valRegion || REGIONS[acc.region]?.val || 'na';
  const headers = { Authorization: key };
  const name = encodeURIComponent(acc.gameName);
  const tag = encodeURIComponent(acc.tagLine);
  const host = 'https://api.henrikdev.xyz/valorant';

  const [mmr, account] = await Promise.all([
    getJson(`${host}/v3/mmr/${region}/pc/${name}/${tag}`, headers),
    getJson(`${host}/v1/account/${name}/${tag}`, headers).catch(() => ({})),
  ]);
  if (mmr.notFound) throw new ApiError(404, `No VALORANT profile for ${acc.gameName}#${acc.tagLine} on ${region.toUpperCase()}`);

  const d = mmr.data?.data || {};
  const current = d.current || {};
  // `seasonal` lists past acts oldest first; the last entry with games is the latest finished act.
  const seasonal = (d.seasonal || []).filter((s) => s.end_tier && s.end_tier.id > 0);
  const last = seasonal.length ? seasonal[seasonal.length - 1] : null;
  const card = account.data?.data?.card;
  return {
    tier: current.tier?.id ?? 0,
    tierName: current.tier?.name || 'Unrated',
    rr: current.rr ?? 0,
    lastChange: current.last_change ?? null,
    peak: d.peak?.tier ? { tier: d.peak.tier.id, name: d.peak.tier.name, season: d.peak.season?.short || '' } : null,
    lastSeason: last ? { tier: last.end_tier.id, name: last.end_tier.name, season: last.season?.short || '' } : null,
    level: account.data?.data?.account_level ?? null,
    card: typeof card === 'string' ? `https://media.valorant-api.com/playercards/${card}/smallart.png` : card?.small || null,
    region,
    updatedAt: new Date().toISOString(),
  };
}

// ---- public -----------------------------------------------------------------

// Returns { fields to merge into the account, errors per game }.
async function refreshAccount(acc, keys) {
  const stats = { ...(acc.stats || {}) };
  const errors = {};
  const fields = {};

  if (!acc.gameName || !acc.tagLine) {
    errors.all = 'Add the Riot ID (Name#TAG) to fetch ranks';
    return { fields: { stats: { ...stats, errors } }, errors };
  }

  // Older versions stored a single { key, riotId, puuid } entry.
  const cache = acc.puuidCache && !acc.puuidCache.puuid ? { ...acc.puuidCache } : {};

  if (keys.riot) {
    try {
      const r = await fetchLol(acc, keys.riot, cache);
      stats.lol = r.lol;
      // Keep the Riot ID's capitalisation in sync with Riot.
      if (r.resolvedId) Object.assign(fields, r.resolvedId);
    } catch (err) {
      errors.lol = riotKeyError(err);
    }
  } else {
    errors.lol = 'No Riot API key (Settings)';
  }

  // Personal keys are issued per game, so TFT can have its own key; without
  // one the main key is tried (development keys cover both games).
  const tftKey = keys.tft || keys.riot;
  if (tftKey) {
    try {
      stats.tft = await fetchTft(acc, tftKey, cache);
    } catch (err) {
      errors.tft =
        // Only blame TFT access when the same key worked for League.
        !keys.tft && !errors.lol && (err.status === 401 || err.status === 403)
          ? 'This Riot key has no TFT access. Add a TFT key in Settings'
          : riotKeyError(err);
    }
  } else {
    errors.tft = 'No Riot API key (Settings)';
  }
  fields.puuidCache = cache;

  if (keys.henrik) {
    try {
      stats.val = await fetchValorant(acc, keys.henrik);
    } catch (err) {
      errors.val = err.status === 401 || err.status === 403 ? 'HenrikDev API key is invalid' : err.message;
    }
  } else {
    errors.val = 'No HenrikDev API key (Settings)';
  }

  stats.errors = errors;
  fields.stats = stats;
  return { fields, errors };
}

module.exports = { REGIONS, VAL_REGIONS, refreshAccount };
