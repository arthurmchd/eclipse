const crypto = require('crypto');

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
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const APEX_LISTS = ['challengerleagues', 'grandmasterleagues', 'masterleagues'];
const APEX_QUEUES = { solo: 'RANKED_SOLO_5x5', flex: 'RANKED_FLEX_SR' };
const APEX_TTL = 10 * 60000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function riotKeyError(err) {
  if (err.status === 401 || err.status === 403) return 'Riot API key is invalid or expired (dev keys expire every 24h)';
  return err.message;
}

function mapEntry(e) {
  if (!e) return null;
  return {
    tier: e.tier,
    division: APEX.includes(e.tier) ? '' : e.rank,
    lp: e.leaguePoints,
    wins: e.wins,
    losses: e.losses,
    hotStreak: Boolean(e.hotStreak),
  };
}

function riotIdOf(value) {
  return `${value.gameName}#${value.tagLine}`;
}

function ladderCutoffs([challenger = [], grandmaster = [], master = []]) {
  const ladder = [...challenger, ...grandmaster, ...master].map((e) => e?.leaguePoints).filter(Number.isFinite).sort((a, b) => b - a);
  const at = (count) => (ladder.length >= count ? ladder[count - 1] : null);
  return {
    challenger: challenger.length ? at(challenger.length) : null,
    grandmaster: grandmaster.length ? at(challenger.length + grandmaster.length) : null,
  };
}

const RETRY_DEFAULT = 5000;
const RETRY_LIMIT = 60000;

function retryDelay(value, now) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return RETRY_DEFAULT;
  const delay = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  if (!Number.isFinite(delay)) return RETRY_DEFAULT;
  return delay > RETRY_LIMIT ? null : Math.max(0, delay);
}

function createRankApi({ fetch: request = (url, init) => fetch(url, init), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 15000 } = {}) {
  let queue = Promise.resolve();
  const apex = new Map();

  function throttled(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {}).then(() => wait(80));
    return run;
  }

  async function within(work) {
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError(0, 'The rank service took too long to answer'));
      }, timeoutMs);
    });
    try { return await Promise.race([work(controller.signal), expired]); }
    finally { clearTimeout(timer); }
  }

  async function getJson(url, headers, attempt = 0) {
    return throttled(async () => {
      const answer = await within(async (signal) => {
        const res = await request(url, { headers, signal });
        if (res.status === 429 && attempt < 3) {
          const delay = retryDelay(res.headers.get('retry-after'), now());
          if (delay !== null) return { retryAfter: delay };
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
      });
      if (answer.retryAfter === undefined) return answer;
      await wait(answer.retryAfter);
      return { retry: true };
    }).then((r) => (r.retry ? getJson(url, headers, attempt + 1) : r));
  }

  async function resolvePuuid(acc, key, cache, context) {
    const region = REGIONS[acc.region];
    const riotId = riotIdOf(acc);
    const keyHash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
    const headers = { 'X-Riot-Token': key };
    const accounts = `https://${region.routing}.api.riotgames.com/riot/account/v1/accounts`;
    const remember = (data, puuid) => {
      const resolvedId = { gameName: data.gameName, tagLine: data.tagLine };
      cache[keyHash] = { riotId: riotIdOf(resolvedId), puuid };
      return { puuid, resolvedId };
    };
    const hit = cache[keyHash];
    if (hit?.puuid && hit.riotId === riotId) {
      if (context.checked) return { puuid: hit.puuid, resolvedId: null };
      context.checked = true;
      const current = await getJson(`${accounts}/by-puuid/${encodeURIComponent(hit.puuid)}`, headers).catch(() => ({}));
      if (!current.notFound) {
        const data = current.data;
        return typeof data?.gameName === 'string' && data.gameName && typeof data.tagLine === 'string' && data.tagLine
          ? remember(data, hit.puuid)
          : { puuid: hit.puuid, resolvedId: null };
      }
    }
    const r = await getJson(`${accounts}/by-riot-id/${encodeURIComponent(acc.gameName)}/${encodeURIComponent(acc.tagLine)}`, headers);
    if (r.notFound) throw new ApiError(404, `Riot ID ${riotId} not found`);
    context.checked = true;
    return remember(r.data, r.data.puuid);
  }

  function apexCutoffs(platform, queueType, key) {
    const id = `${platform}:${queueType}`;
    const cached = apex.get(id);
    if (cached && now() - cached.at < APEX_TTL) return cached.value;
    const headers = { 'X-Riot-Token': key };
    const value = Promise.all(APEX_LISTS.map((list) => getJson(`https://${platform}.api.riotgames.com/lol/league/v4/${list}/by-queue/${queueType}`, headers)))
      .then((lists) => {
        const cutoffs = ladderCutoffs(lists.map((list) => (Array.isArray(list.data?.entries) ? list.data.entries : [])));
        return Number.isFinite(cutoffs.challenger) || Number.isFinite(cutoffs.grandmaster) ? cutoffs : null;
      })
      .catch(() => {
        if (apex.get(id)?.value === value) apex.delete(id);
        return null;
      });
    apex.set(id, { at: now(), value });
    return value;
  }

  async function fetchLol(acc, key, puuidFor) {
    const region = REGIONS[acc.region];
    if (!region) throw new Error(`Unknown region ${acc.region}`);
    const headers = { 'X-Riot-Token': key };
    const puuid = await puuidFor(key);
    const base = `https://${acc.region}.api.riotgames.com`;
    const [summoner, league] = await Promise.all([
      getJson(`${base}/lol/summoner/v4/summoners/by-puuid/${puuid}`, headers),
      getJson(`${base}/lol/league/v4/entries/by-puuid/${puuid}`, headers),
    ]);
    if (summoner.notFound) throw new ApiError(404, `No League profile on ${region.label}`);
    const entries = league.data || [];
    const ranked = {};
    for (const [queueId, queueType] of Object.entries(APEX_QUEUES)) {
      const entry = mapEntry(entries.find((e) => e.queueType === queueType));
      if (entry && APEX.includes(entry.tier)) {
        const cutoffs = await apexCutoffs(acc.region, queueType, key);
        if (cutoffs) entry.cutoffs = cutoffs;
      }
      ranked[queueId] = entry;
    }
    return {
      level: summoner.data.summonerLevel,
      iconId: summoner.data.profileIconId,
      solo: ranked.solo,
      flex: ranked.flex,
      updatedAt: new Date(now()).toISOString(),
    };
  }

  async function fetchTft(acc, key, puuidFor) {
    if (!REGIONS[acc.region]) throw new Error(`Unknown region ${acc.region}`);
    const puuid = await puuidFor(key);
    const r = await getJson(`https://${acc.region}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}`, { 'X-Riot-Token': key });
    const entries = r.data || [];
    return {
      ranked: mapEntry(entries.find((e) => e.queueType === 'RANKED_TFT')),
      doubleUp: mapEntry(entries.find((e) => e.queueType === 'RANKED_TFT_DOUBLE_UP')),
      updatedAt: new Date(now()).toISOString(),
    };
  }

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
      updatedAt: new Date(now()).toISOString(),
    };
  }
  async function refreshAccount(acc, keys) {
    const stats = { ...(acc.stats || {}) };
    const errors = {};
    const fields = {};

    if (!acc.gameName || !acc.tagLine) {
      errors.all = 'Add the Riot ID (Name#TAG) to fetch ranks';
      return { fields: { stats: { ...stats, errors } }, errors };
    }

    const cache = acc.puuidCache && !acc.puuidCache.puuid ? { ...acc.puuidCache } : {};
    const context = { checked: false };
    const name = { gameName: acc.gameName, tagLine: acc.tagLine };
    const puuidFor = async (key) => {
      const { puuid, resolvedId } = await resolvePuuid({ ...acc, ...name }, key, cache, context);
      if (resolvedId) Object.assign(name, resolvedId);
      return puuid;
    };

    if (keys.riot) {
      try {
        stats.lol = await fetchLol(acc, keys.riot, puuidFor);
      } catch (err) {
        errors.lol = riotKeyError(err);
      }
    } else {
      errors.lol = 'No Riot API key (Settings)';
    }

    const tftKey = keys.tft || keys.riot;
    if (tftKey) {
      try {
        stats.tft = await fetchTft(acc, tftKey, puuidFor);
      } catch (err) {
        errors.tft =
          !keys.tft && !errors.lol && (err.status === 401 || err.status === 403)
            ? 'This Riot key has no TFT access. Add a TFT key in Settings'
            : riotKeyError(err);
      }
    } else {
      errors.tft = 'No Riot API key (Settings)';
    }
    fields.puuidCache = cache;
    if (name.gameName !== acc.gameName || name.tagLine !== acc.tagLine) Object.assign(fields, name);

    if (keys.henrik) {
      try {
        stats.val = await fetchValorant({ ...acc, ...name }, keys.henrik);
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

  return { refreshAccount };
}

const defaultApi = createRankApi();

module.exports = { REGIONS, VAL_REGIONS, createRankApi, ladderCutoffs, refreshAccount: defaultApi.refreshAccount };
