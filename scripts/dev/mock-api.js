(() => {
  const REGIONS = {
    br1: { label: 'BR', val: 'br' }, na1: { label: 'NA', val: 'na' }, la1: { label: 'LAN', val: 'latam' },
    la2: { label: 'LAS', val: 'latam' }, euw1: { label: 'EUW', val: 'eu' }, eun1: { label: 'EUNE', val: 'eu' },
    tr1: { label: 'TR', val: 'eu' }, kr: { label: 'KR', val: 'kr' }, jp1: { label: 'JP', val: 'ap' },
  };
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const e = (tier, division, lp, wins, losses, hotStreak = false, cutoffs = null) => ({ tier, division, lp, wins, losses, hotStreak, ...(cutoffs ? { cutoffs } : {}) });
  const lol = (level, iconId, solo, flex, banner) => ({ level, iconId, solo, flex, ...(banner ? { banner } : {}), updatedAt: iso(4 * 60000) });
  const card = (id) => ({ card: `https://media.valorant-api.com/playercards/${id}/smallart.png` });
  const val = (tier, tierName, rr, extra = {}) => ({ tier, tierName, rr, level: 120, updatedAt: iso(4 * 60000), ...extra });

  let accounts = [
    { id: '1', gameName: 'Piltover Queen', tagLine: 'NA1', region: 'na1', username: 'duoqueen', note: '', lastPlayed: iso(2 * 3600e3), hasPassword: true, lastSeason: { lol: 'Challenger 1302 LP' },
      stats: { lol: lol(301, 4568, e('CHALLENGER', '', 1124, 412, 340, true, { challenger: 1050, grandmaster: 520 }), e('MASTER', '', 88, 40, 31, false, { challenger: 610, grandmaster: 240 })), tft: { ranked: e('DIAMOND', 'I', 75, 60, 50) }, val: val(24, 'Immortal 1', 61, { peak: { tier: 25, name: 'Immortal 2', season: 'e9a3' }, lastSeason: { tier: 23, name: 'Ascendant 3', season: 'e9a3' }, lastChange: 18, ...card('cec2424b-483e-da2e-4369-f0a8822f96b5') }) } },
    { id: '2', gameName: 'Lux Main', tagLine: 'EUW', region: 'euw1', username: 'gm_lux', note: '', lastPlayed: iso(26 * 3600e3), hasPassword: true, lastSeason: { lol: 'Master 210 LP' },
      stats: { lol: lol(520, 5367, e('GRANDMASTER', '', 512, 290, 251, false, { challenger: 1180, grandmaster: 470 }), null, 'hextech_banner'), tft: { ranked: null }, val: val(21, 'Ascendant 1', 12, { lastChange: -15, ...card('70cecca0-4b4b-9ad4-1652-bebe785ef8e8') }) } },
    { id: '3', gameName: 'Arcane Scholar', tagLine: 'EUNE', region: 'eun1', username: 'scholarly', note: 'TFT main', lastPlayed: iso(3 * 86400e3), hasPassword: true, lastSeason: { lol: 'Diamond I', tft: 'Grandmaster' },
      stats: { lol: lol(380, 6006, e('MASTER', '', 210, 150, 131, false, { challenger: 990, grandmaster: 205 }), null, 'arcanefracturedjinxbanner'), tft: { ranked: e('GRANDMASTER', '', 640, 120, 98) }, val: val(0, 'Unrated', 0) } },
    { id: '4', gameName: 'Hextech Fox', tagLine: 'EUW', region: 'euw1', username: 'mainacc01', note: 'main', lastPlayed: iso(40 * 60000), hasPassword: true, lastSeason: { lol: 'Diamond IV 12 LP' },
      stats: { lol: lol(412, 4895, e('DIAMOND', 'II', 57, 98, 87), e('EMERALD', 'I', 20, 12, 9)), tft: { ranked: e('PLATINUM', 'III', 40, 20, 22) }, val: val(18, 'Diamond 1', 45, { lastChange: 21, ...card('e9c8d760-4d06-4037-4882-6bab3610d9ea') }) } },
    { id: '5', gameName: 'Kebab Enjoyer', tagLine: 'TR1', region: 'tr1', username: 'smurfy_tr', note: 'smurf', lastPlayed: iso(9 * 86400e3), hasPassword: true, lastSeason: { lol: 'Platinum I' },
      ban: { game: 'lol', permanent: false, until: new Date(now + 6 * 86400e3 + 13 * 3600e3).toISOString() },
      stats: { lol: lol(187, 29, e('EMERALD', 'IV', 23, 70, 72), null, 'spirit_blossom_banner'), tft: { ranked: null }, val: val(9, 'Silver 1', 30, card('50ee5414-45cc-85f6-2ec8-cb96d86f6039')) } },
    { id: '6', gameName: 'Tidal Wave', tagLine: 'BR1', region: 'br1', username: 'tidalwave', note: 'duo with Leo', lastPlayed: iso(5 * 3600e3), hasPassword: true, lastSeason: { lol: 'Gold I' }, pinned: true,
      stats: { lol: lol(143, 1386, e('PLATINUM', 'II', 48, 55, 49), null), tft: { ranked: e('GOLD', 'II', 10, 15, 18) }, val: val(15, 'Platinum 1', 77, { peak: { tier: 17, name: 'Platinum 3', season: 'e8a2' }, lastChange: 23, ...card('910ace70-4d3b-3c53-2c55-5f9fa179caa8') }) } },
    { id: '7', gameName: 'Golden Boy', tagLine: 'KR1', region: 'kr', username: 'goldenboy', note: '', lastPlayed: null, hasPassword: true, lastSeason: {},
      stats: { lol: lol(98, 23, e('GOLD', 'III', 64, 33, 30), null), tft: { ranked: null }, val: val(12, 'Gold 1', 50, card('55f584f9-4684-895d-88e0-a8ada2002d8a')) } },
    { id: '8', gameName: 'Silver Lining', tagLine: 'LAS', region: 'la2', username: 'silverline', note: '', lastPlayed: iso(14 * 86400e3), hasPassword: true, lastSeason: {},
      stats: { lol: lol(76, 3, e('SILVER', 'I', 91, 20, 24), null, 'worlds2026_banner'), tft: { ranked: e('SILVER', 'IV', 0, 3, 5) }, val: val(6, 'Bronze 1', 15, { lastChange: -8, ...card('2f7fd4ed-4b6b-b3fc-0658-18a58f61581b') }), errors: {} } },
    { id: '9', gameName: 'Rusty Iron', tagLine: 'BR1', region: 'br1', username: 'rusty_iron', note: 'alt for practice', lastPlayed: iso(30 * 86400e3), hasPassword: false, lastSeason: {},
      stats: { lol: lol(31, 7, e('IRON', 'II', 15, 5, 11), null), tft: { ranked: null }, errors: { val: 'No VALORANT profile for Rusty Iron#BR1 on BR' } } },
    { id: '10', gameName: 'Fresh Start', tagLine: 'NA1', region: 'na1', username: 'freshstart', note: '', lastPlayed: null, hasPassword: true, lastSeason: {},
      stats: { lol: lol(30, 1, null, null), tft: { ranked: null }, val: val(27, 'Radiant', 412, card('f31491e7-4642-ea8b-87fa-ed8fd73e44cf')) } },
  ];

  let settings = { refreshMinutes: 30, minimizeOnLaunch: true, hideRiotClient: true, closeRiotClient: true, streamerMode: false, staySignedIn: true, riotClientPath: '', language: 'pt', riotApiKeyMasked: 'RGAPI-12…ab34', henrikApiKeyMasked: '' };
  let lastRefresh = iso(7 * 60000);
  let activeSignIn = null;
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));
  const on = (ch) => (cb) => ((listeners[ch] ||= []).push(cb), () => (listeners[ch] = listeners[ch].filter((x) => x !== cb)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextRefresh = () => new Date(now + 22 * 60000 + 59000).toISOString();

  window.api = {
    init: async () => ({ accounts, settings, regions: REGIONS, valRegions: ['br', 'na', 'latam', 'eu', 'kr', 'ap'], lastRefresh, nextRefresh: nextRefresh(), version: '1.0.0', clientFound: true }),
    saveAccount: async (input) => {
      const { password, ...rest } = input;
      let acc = accounts.find((a) => a.id === input.id);
      if (acc) Object.assign(acc, rest, { hasPassword: acc.hasPassword || Boolean(password) });
      else accounts.push((acc = { ...rest, id: String(Date.now()), stats: {}, hasPassword: Boolean(password), lastPlayed: null }));
      return acc;
    },
    deleteAccount: async (id) => { accounts = accounts.filter((a) => a.id !== id); },
    patchAccount: async (id, fields) => Object.assign(accounts.find((a) => a.id === id), fields),
    forgetSession: async (id) => Object.assign(accounts.find((a) => a.id === id), { hasSession: false }),
    copy: async () => true,
    refresh: async () => {
      for (let i = 0; i < accounts.length; i++) { emit('refresh-progress', { done: i, total: accounts.length }); await wait(150); }
      lastRefresh = new Date().toISOString();
      emit('refresh-progress', { done: accounts.length, total: accounts.length });
      return { nextRefresh: nextRefresh() };
    },
    runningGames: async () => ({ lol: false, val: false, client: false }),
    signIn: async (id, game = 'lol') => {
      if (activeSignIn) return { ok: false, error: 'A sign-in is already in progress' };
      const attempt = activeSignIn = { cancelled: false };
      const operation = (status) => emit('sign-in-operation', { id: 'mock-operation', accountId: id, game, status, needsAttention: false, signedIn: false });
      operation('running');
      const name = { riot: 'Riot Client', lol: 'League of Legends', tft: 'Teamfight Tactics', val: 'VALORANT' }[game];
      try {
        for (const t of ['Closing Riot Client…', 'Preparing background sign-in…', 'Signing in in the background…', game === 'riot' ? 'Opening Riot Client…' : `Starting ${name}…`]) {
          if (attempt.cancelled) return { ok: false, cancelled: true, error: 'Sign-in cancelled' };
          emit('sign-in-status', { id, text: t, needsAttention: false });
          await wait(900);
        }
        return attempt.cancelled ? { ok: false, cancelled: true, error: 'Sign-in cancelled' } : game === 'riot' ? { ok: true, clientOpened: true } : { ok: true, gameStarted: true };
      } finally {
        activeSignIn = null;
        operation(attempt.cancelled ? 'cancelled' : 'succeeded');
      }
    },
    showRiotClient: async () => ({ ok: true }),
    minimizeRiot: async () => ({ ok: true }),
    closeRiot: async () => ({ ok: true }),
    cancelSignIn: async () => {
      if (activeSignIn) activeSignIn.cancelled = true;
      return { ok: true };
    },
    saveSettings: async (input) => ({ ...(settings = { ...settings, ...input }), nextRefresh: nextRefresh(), clientFound: true }),
    pickClientPath: async () => null,
    openDataFolder: async () => {},
    onAccountUpdated: on('account-updated'),
    onRefreshProgress: on('refresh-progress'),
    onNextRefresh: on('next-refresh'),
    onSignInStatus: on('sign-in-status'),
    onSignInOperation: on('sign-in-operation'),
  };
})();
