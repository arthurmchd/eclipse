const POLL_MS = 60000;
const RESAVE_MS = 10 * 60000;
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const GAMES = { league: 'League client', valorant: 'Riot Client' };

function keepCutoffs(next, previous) {
  if (next && previous?.cutoffs && next.tier === previous.tier && APEX.includes(next.tier)) return { ...next, cutoffs: previous.cutoffs };
  return next;
}

function mergeReading(stats, reading, at) {
  const before = stats && typeof stats === 'object' ? stats : {};
  const next = { ...before };
  const errors = { ...(before.errors || {}) };
  if (reading.lol) {
    const lol = before.lol || {};
    next.lol = {
      ...lol,
      level: reading.lol.level ?? lol.level ?? null,
      iconId: reading.lol.iconId ?? lol.iconId ?? null,
      solo: keepCutoffs(reading.lol.solo, lol.solo),
      flex: keepCutoffs(reading.lol.flex, lol.flex),
      updatedAt: at,
    };
    delete errors.lol;
  }
  if (reading.tft) {
    next.tft = { ...(before.tft || {}), ranked: reading.tft.ranked, doubleUp: reading.tft.doubleUp, updatedAt: at };
    delete errors.tft;
  }
  if (reading.val) {
    const val = before.val || {};
    const sameTier = val.tier === reading.val.tier;
    next.val = {
      ...val,
      tier: reading.val.tier,
      tierName: reading.val.tierName,
      rr: sameTier ? val.rr ?? null : null,
      lastChange: sameTier ? val.lastChange ?? null : null,
      level: reading.val.level ?? val.level ?? null,
      card: reading.val.card || val.card || null,
      updatedAt: at,
    };
    delete errors.val;
  }
  delete errors.all;
  next.errors = errors;
  return next;
}

function withoutTimes(stats) {
  return JSON.stringify(stats || {}, (key, value) => (key === 'updatedAt' ? undefined : value));
}

function oldestTime(stats, reading) {
  const blocks = ['lol', 'tft', 'val'].filter((game) => reading[game]).map((game) => Date.parse(stats?.[game]?.updatedAt));
  return blocks.some((time) => !Number.isFinite(time)) ? -Infinity : Math.min(...blocks);
}

function createRankWatcher({ riot, store, busy = () => false, log = () => {}, onUpdated = () => {}, setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout, pollMs = POLL_MS, resaveMs = RESAVE_MS, now = Date.now }) {
  let timer = null, stopped = true, running = null, lastNote = null;
  const note = (line) => { if (line !== lastNote) { lastNote = line; log(line); } };

  function owner(riotId) {
    const found = store.data.accounts.filter((account) => riot.sameRiotId(riotId, account));
    return found.length === 1 ? found[0] : null;
  }

  function apply(reading, game) {
    if (stopped) return false;
    if (!reading) { note(`game ranks: could not read the ranks from the ${GAMES[game]}`); return false; }
    const account = owner(reading.riotId);
    if (!account) { note(`game ranks: the ${GAMES[game]} is signed in to an account that is not saved in Eclipse`); return false; }
    const stats = mergeReading(account.stats, reading, new Date(now()).toISOString());
    const changed = withoutTimes(stats) !== withoutTimes(account.stats);
    if (!changed && now() - oldestTime(account.stats, reading) < resaveMs) return false;
    const updated = store.updateAccountFields(account.id, { stats });
    if (updated) onUpdated(updated);
    note(`game ranks: updated a saved account from the ${GAMES[game]}`);
    return true;
  }

  function check() {
    if (running) return running;
    running = (async () => {
      if (busy()) return false;
      const processes = await riot.look().processes();
      let updated = false;
      if (processes?.lol && !busy()) updated = apply(await riot.gameRanks.league(), 'league') || updated;
      if (processes?.val && !busy()) updated = apply(await riot.gameRanks.valorant(), 'valorant') || updated;
      return updated;
    })()
      .catch(() => { note('game ranks: could not check the running games'); return false; })
      .finally(() => { running = null; });
    return running;
  }

  function schedule() {
    cancel(timer);
    timer = stopped ? null : later(() => { check().finally(schedule); }, pollMs);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      check().finally(schedule);
    },
    stop() {
      stopped = true;
      cancel(timer);
      timer = null;
    },
    check: () => (stopped ? Promise.resolve(false) : check()),
  };
}

module.exports = { createRankWatcher, mergeReading };
