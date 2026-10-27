import { QUEUES, rankOf, distributionGroups, profileIcon, lolEmblem, valIcon } from './ranks.js';

const api = window.api;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const GAME_NAMES = { lol: 'League of Legends', tft: 'Teamfight Tactics', val: 'VALORANT' };

const ICONS = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1.5h8.5V12H12V3H5zM2.5 4.5h8v10h-8z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  key: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 8h6.5M12 8v2.5M14 8v2" stroke="currentColor" stroke-width="1.5"/></svg>',
  dots: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>',
  bolt: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1 3 9h4l-1 6 6.5-8h-4z" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 6v4M8 11.5v1" stroke="currentColor" stroke-width="1.6"/></svg>',
  spinner: '<span class="spinner" aria-hidden="true"></span>',
};

const state = {
  accounts: [],
  settings: {},
  regions: {},
  valRegions: [],
  nextRefresh: null,
  refreshing: null,
  signingIn: null,
  clientFound: true,
  game: 'lol',
  queue: { lol: 'solo', tft: 'ranked', val: 'competitive' },
  view: 'grid',
  sort: 'rank',
  region: 'all',
  hideBanned: false,
  search: '',
  tierFilter: null,
};

const PREF_KEYS = ['game', 'queue', 'view', 'sort', 'region', 'hideBanned'];
function loadPrefs() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem('ram-prefs') || '{}'));
  } catch {}
}
function savePrefs() {
  try {
    localStorage.setItem('ram-prefs', JSON.stringify(Object.fromEntries(PREF_KEYS.map((k) => [k, state[k]]))));
  } catch {}
}

function banInfo(acc, game) {
  const b = acc.ban;
  if (!b) return null;
  const scope = game === 'val' ? 'val' : 'lol';
  if (b.game !== 'all' && b.game !== scope) return null;
  if (b.permanent) return { text: 'Permanent ban', permanent: true };
  const left = Date.parse(b.until) - Date.now();
  if (!(left > 0)) return null;
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return { text: `Banned · ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`}` };
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const regionLabel = (acc) => state.regions[acc.region]?.label || acc.region.toUpperCase();
const queueOf = (game) => state.queue[game] || QUEUES[game][0].id;

function visibleAccounts() {
  const q = state.search.trim().toLowerCase();
  const game = state.game;
  const list = state.accounts
    .map((acc) => ({ acc, rank: rankOf(acc, game, queueOf(game)), ban: banInfo(acc, game) }))
    .filter(({ acc, rank, ban }) => {
      if (state.region !== 'all' && acc.region !== state.region) return false;
      if (state.hideBanned && ban) return false;
      if (state.tierFilter && rank.group !== state.tierFilter) return false;
      if (!q) return true;
      return [acc.gameName, `#${acc.tagLine}`, acc.username, acc.note, regionLabel(acc)].some((f) => f && f.toLowerCase().includes(q));
    });

  const byName = (a, b) => a.acc.gameName.localeCompare(b.acc.gameName, undefined, { sensitivity: 'base' });
  const sorters = {
    rank: (a, b) => b.rank.score - a.rank.score || byName(a, b),
    name: byName,
    level: (a, b) => (b.rank.level ?? -1) - (a.rank.level ?? -1) || byName(a, b),
    played: (a, b) => (Date.parse(b.acc.lastPlayed || 0) || 0) - (Date.parse(a.acc.lastPlayed || 0) || 0) || byName(a, b),
    winrate: (a, b) => (b.rank.winrate ?? -1) - (a.rank.winrate ?? -1) || byName(a, b),
  };
  list.sort((a, b) => (a.acc.pinned === b.acc.pinned ? 0 : a.acc.pinned ? -1 : 1) || (a.ban ? 1 : 0) - (b.ban ? 1 : 0) || sorters[state.sort](a, b));
  return list;
}

function render() {
  document.body.dataset.game = state.game;
  document.body.dataset.view = state.view;
  document.body.classList.toggle('streamer', Boolean(state.settings.streamerMode));
  $$('.game-tabs [data-game]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.game === state.game)));
  $$('.view-toggle [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('#sort').value = state.sort;
  $('#filter-region').value = state.region;
  $('#hide-banned').checked = state.hideBanned;
  renderQueueSwitch();
  renderDistribution();
  renderBanner();
  renderAccounts();
}

function renderQueueSwitch() {
  const queues = QUEUES[state.game];
  const current = queueOf(state.game);
  $('#queue-switch').innerHTML = queues
    .map((q) => `<button data-queue="${q.id}" class="${q.id === current ? 'active' : ''}">${esc(q.label)}</button>`)
    .join('<span class="sep">/</span>');
}

function renderDistribution() {
  const counts = {};
  for (const acc of state.accounts) {
    const g = rankOf(acc, state.game, queueOf(state.game)).group;
    counts[g] = (counts[g] || 0) + 1;
  }
  $('#distribution').innerHTML = distributionGroups(state.game)
    .map(
      (g) => `
      <li>
        <button data-tier="${g.id}" class="${state.tierFilter === g.id ? 'active' : ''} ${counts[g.id] ? '' : 'empty'}" style="--tier:${g.color}">
          <img src="${g.icon}" alt="" loading="lazy">
          <span>${g.name}</span>
          <b>${counts[g.id] || 0}</b>
        </button>
      </li>`,
    )
    .join('');
}

function renderBanner() {
  const banner = $('#setup-banner');
  const nativeWarning = state.nativeIntegration?.requested && !state.nativeIntegration.active;
  const msgs = [];
  const s = state.settings;
  if (!state.clientFound) msgs.push('Riot Client not found. Set its location in <a data-open="settings">Settings</a> to sign in.');
  if (nativeWarning) msgs.push(esc(state.nativeIntegration.reason || 'The experimental Riot login panel is not active. The regular account manager remains available.'));
  if (state.game === 'val' ? !s.henrikApiKeyMasked : !s.riotApiKeyMasked) {
    msgs.push(
      state.game === 'val'
        ? 'Add a HenrikDev API key in <a data-open="settings">Settings</a> to show VALORANT ranks.'
        : 'Add a Riot API key in <a data-open="settings">Settings</a> to show ranks automatically.',
    );
  }
  banner.hidden = !msgs.length || !state.accounts.length;
  banner.innerHTML = msgs.map((m) => `<p>${ICONS.warn}<span>${m}</span></p>`).join('');
}

function cardHtml({ acc, rank, ban }) {
  const signing = state.signingIn?.id === acc.id;
  const busy = Boolean(state.signingIn);
  const wl =
    rank.wins != null
      ? `<span>${rank.wins}W ${rank.losses}L</span><b class="${rank.winrate >= 50 ? 'pos' : 'neg'}">${rank.winrate}%</b>`
      : rank.lastChange != null
        ? `<span>Last game</span><b class="${rank.lastChange >= 0 ? 'pos' : 'neg'}">${rank.lastChange >= 0 ? '+' : ''}${rank.lastChange} RR</b>`
        : '';
  const status = signing
    ? `<span class="signing">${ICONS.spinner}${esc(state.signingIn.text)}</span>`
    : rank.error
      ? `<span class="err" title="${esc(rank.error)}">${ICONS.warn}${esc(rank.error)}</span>`
      : `<span>${acc.lastPlayed ? `Played ${ago(acc.lastPlayed)}` : 'Never played from here'}</span>${rank.updatedAt ? `<span title="Rank updated ${esc(new Date(rank.updatedAt).toLocaleString())}">Rank ${ago(rank.updatedAt)}</span>` : ''}`;
  const avatar =
    state.game === 'val'
      ? acc.stats?.val?.card
        ? `<img class="avatar" src="${esc(acc.stats.val.card)}" alt="">`
        : ''
      : acc.stats?.lol?.iconId != null
        ? `<img class="avatar" src="${profileIcon(acc.stats.lol.iconId)}" alt="">`
        : '';

  return `
  <article class="card ${ban ? 'is-banned' : ''} ${signing ? 'is-signing' : ''} ${acc.pinned ? 'is-pinned' : ''}" data-id="${acc.id}" style="--tier:${rank.color}">
    <div class="card-glow" aria-hidden="true"></div>
    <header class="card-head">
      ${avatar}
      <div class="card-name" title="${esc(acc.gameName)}#${esc(acc.tagLine)}">
        <span class="name">${esc(acc.gameName) || '<i>No Riot ID</i>'}</span><span class="tag">#${esc(acc.tagLine)}</span>
      </div>
      ${acc.pinned ? '<span class="pin" title="Pinned">★</span>' : ''}
      <button class="icon-btn" data-action="menu" title="More">${ICONS.dots}</button>
    </header>
    <div class="chips">
      <span class="chip chip-region">${esc(regionLabel(acc))}</span>
      ${rank.level != null ? `<span class="chip">Lv <b>${rank.level}</b></span>` : ''}
      ${ban ? `<span class="chip chip-ban">${ICONS.warn}${esc(ban.text)}</span>` : ''}
      ${rank.hotStreak ? '<span class="chip chip-hot" title="Hot streak">▲ Streak</span>' : ''}
      ${acc.hasSession ? `<span class="chip chip-quick" title="Saved sign-in: switches without typing">${ICONS.bolt}</span>` : ''}
      <span class="username" title="Sign-in username">${esc(acc.username)}</span>
    </div>
    <div class="rank">
      <div class="emblem emblem-${rank.emblemKind}"><img src="${rank.emblem}" alt="${esc(rank.label)}" loading="lazy" draggable="false"></div>
      <div class="rank-info">
        <div class="tier">${esc(rank.label)}</div>
        <div class="lp">${esc(rank.sub)}</div>
        <div class="bar"><i style="width:${(rank.progress * 100).toFixed(1)}%"></i></div>
        <div class="wl">${wl}</div>
      </div>
    </div>
    <dl class="meta">
      <div><dt>Last season</dt><dd>${esc(rank.lastSeason) || '<span class="dim">—</span>'}</dd></div>
      ${rank.extra ? `<div><dt>Peak</dt><dd>${esc(rank.extra.replace(/^Peak /, ''))}</dd></div>` : ''}
    </dl>
    ${acc.note ? `<p class="note">${esc(acc.note)}</p>` : '<p class="note"></p>'}
    <footer class="card-foot">
      <button class="btn btn-play" data-action="play" ${busy ? 'disabled' : ''} title="Sign in and start ${GAME_NAMES[state.game]}">
        ${signing ? ICONS.spinner : ICONS.play}<span>${signing ? 'Signing in' : 'Play'}</span>
      </button>
      <button class="icon-btn" data-action="copy-user" title="Copy username">${ICONS.copy}</button>
      <button class="icon-btn" data-action="copy-pass" title="Copy password (clears in 20 s)" ${acc.hasPassword ? '' : 'disabled'}>${ICONS.key}</button>
    </footer>
    <div class="card-status">${status}</div>
  </article>`;
}

function rowHtml({ acc, rank, ban }) {
  const signing = state.signingIn?.id === acc.id;
  return `
  <article class="row ${ban ? 'is-banned' : ''} ${signing ? 'is-signing' : ''}" data-id="${acc.id}" style="--tier:${rank.color}">
    <div class="emblem emblem-${rank.emblemKind} emblem-sm"><img src="${rank.emblem}" alt="" loading="lazy" draggable="false"></div>
    <div class="row-name">
      <div><span class="name">${esc(acc.gameName)}</span><span class="tag">#${esc(acc.tagLine)}</span>${acc.pinned ? ' <span class="pin">★</span>' : ''}</div>
      <div class="sub"><span class="username">${esc(acc.username)}</span>${acc.note ? ` · ${esc(acc.note)}` : ''}</div>
    </div>
    <span class="chip chip-region">${esc(regionLabel(acc))}</span>
    <div class="row-rank">
      <div><span class="tier">${esc(rank.label)}</span> <span class="lp">${esc(rank.sub)}</span></div>
      <div class="bar"><i style="width:${(rank.progress * 100).toFixed(1)}%"></i></div>
    </div>
    <div class="row-wl">${rank.wins != null ? `${rank.wins}W ${rank.losses}L <b class="${rank.winrate >= 50 ? 'pos' : 'neg'}">${rank.winrate}%</b>` : rank.level != null ? `Lv ${rank.level}` : ''}</div>
    <div class="row-status">${ban ? `<span class="chip chip-ban">${ICONS.warn}${esc(ban.text)}</span>` : rank.error ? `<span class="err" title="${esc(rank.error)}">${ICONS.warn}</span>` : esc(acc.lastPlayed ? ago(acc.lastPlayed) : '')}</div>
    <div class="row-actions">
      <button class="btn btn-play btn-sm" data-action="play" ${state.signingIn ? 'disabled' : ''}>${signing ? ICONS.spinner : ICONS.play}<span>Play</span></button>
      <button class="icon-btn" data-action="copy-user" title="Copy username">${ICONS.copy}</button>
      <button class="icon-btn" data-action="copy-pass" title="Copy password" ${acc.hasPassword ? '' : 'disabled'}>${ICONS.key}</button>
      <button class="icon-btn" data-action="menu" title="More">${ICONS.dots}</button>
    </div>
  </article>`;
}

function renderAccounts() {
  renderLaunchStatus();
  const list = visibleAccounts();
  const el = $('#accounts');
  if (!state.accounts.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-emblems">
          <img src="${lolEmblem('CHALLENGER')}" alt="">
          <img src="${valIcon(27)}" alt="">
        </div>
        <h2>No accounts yet</h2>
        <p>Add your Riot accounts to switch between them with one click.</p>
        <button class="btn btn-primary" data-open="add">Add your first account</button>
      </div>`;
  } else if (!list.length) {
    el.innerHTML = '<div class="empty-state small"><p>No account matches these filters.</p></div>';
  } else {
    el.innerHTML = list.map(state.view === 'grid' ? cardHtml : rowHtml).join('');
  }
  $('#account-count').textContent = `${list.length} of ${state.accounts.length} accounts`;
}

function renderCountdown() {
  const label = $('#refresh-label');
  const out = $('#refresh-countdown');
  if (state.refreshing) {
    label.textContent = 'Updating ranks';
    out.textContent = `${state.refreshing.done}/${state.refreshing.total}`;
    return;
  }
  if (!state.nextRefresh) {
    label.textContent = 'Auto update off';
    out.textContent = 'Refresh';
    return;
  }
  const s = Math.max(0, Math.round((Date.parse(state.nextRefresh) - Date.now()) / 1000));
  label.textContent = 'Next rank update';
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  out.textContent = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function toast(text, kind = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `<span>${esc(text)}</span>`;
  $('#toasts').append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  if (ms) setTimeout(close, ms);
  return { el, close, set: (t, k) => ((el.querySelector('span').textContent = t), k && (el.className = `toast toast-${k} show`)) };
}

function confirmDialog(titleText, text, okLabel = 'Continue') {
  const dlg = $('#confirm-modal');
  $('#confirm-title').textContent = titleText;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function openAccountModal(acc) {
  const form = $('#account-form');
  form.reset();
  const f = form.elements;
  $('#account-modal-title').textContent = acc ? 'Edit account' : 'Add account';
  $('#delete-account').hidden = !acc;
  form.dataset.id = acc?.id || '';
  f.gameName.value = acc?.gameName || '';
  f.tagLine.value = acc?.tagLine || '';
  f.region.value = acc?.region || state.accounts[state.accounts.length - 1]?.region || 'br1';
  f.valRegion.value = acc?.valRegion || '';
  f.username.value = acc?.username || '';
  f.password.value = '';
  f.password.type = 'password';
  f.password.required = !acc?.hasPassword;
  f.password.placeholder = acc?.hasPassword ? '•••••••• (unchanged)' : '';
  f.note.value = acc?.note || '';
  f.ls_lol.value = acc?.lastSeason?.lol || '';
  f.ls_tft.value = acc?.lastSeason?.tft || '';
  f.ls_val.value = acc?.lastSeason?.val || '';
  const ban = acc?.ban;
  f.banType.value = ban ? (ban.permanent ? 'permanent' : 'until') : 'none';
  f.banGame.value = ban?.game || 'lol';
  f.banUntil.value = toLocalInput(ban?.until);
  syncBanFields();
  updateValRegionLabel();
  $('#account-modal').showModal();
  (acc ? f.username : f.gameName).focus();
}

function syncBanFields() {
  const f = $('#account-form').elements;
  const type = f.banType.value;
  f.banGame.disabled = type === 'none';
  f.banUntil.disabled = type !== 'until';
  f.banUntil.required = type === 'until';
}

function updateValRegionLabel() {
  const f = $('#account-form').elements;
  const auto = state.regions[f.region.value]?.val || 'na';
  f.valRegion.options[0].textContent = `Auto (${auto.toUpperCase()})`;
}

async function submitAccount(e) {
  e.preventDefault();
  const form = $('#account-form');
  const f = form.elements;
  const type = f.banType.value;
  const input = {
    id: form.dataset.id || undefined,
    gameName: f.gameName.value,
    tagLine: f.tagLine.value,
    region: f.region.value,
    valRegion: f.valRegion.value,
    username: f.username.value,
    password: f.password.value || undefined,
    note: f.note.value.trim(),
    lastSeason: { lol: f.ls_lol.value.trim(), tft: f.ls_tft.value.trim(), val: f.ls_val.value.trim() },
    ban:
      type === 'none'
        ? null
        : { game: f.banGame.value, permanent: type === 'permanent', until: type === 'until' ? new Date(f.banUntil.value).toISOString() : null },
  };
  try {
    const saved = await api.saveAccount(input);
    upsertLocal(saved);
    $('#account-modal').close();
    toast(input.id ? 'Account updated' : 'Account added', 'ok', 2500);
  } catch (err) {
    toast(err.message || String(err), 'error', 6000);
  }
}

function openSettings() {
  const f = $('#settings-form').elements;
  const s = state.settings;
  f.riotApiKey.value = '';
  f.riotApiKey.placeholder = s.riotApiKeyMasked || 'RGAPI-…';
  f.riotTftApiKey.value = '';
  f.riotTftApiKey.placeholder = s.riotTftApiKeyMasked || 'RGAPI-… (optional)';
  f.henrikApiKey.value = '';
  f.henrikApiKey.placeholder = s.henrikApiKeyMasked || 'HDEV-…';
  f.refreshMinutes.value = String(s.refreshMinutes ?? 30);
  f.minimizeOnLaunch.checked = Boolean(s.minimizeOnLaunch);
  f.hideRiotClient.checked = Boolean(s.hideRiotClient);
  f.closeRiotClient.checked = Boolean(s.closeRiotClient);
  f.streamerMode.checked = Boolean(s.streamerMode);
  f.riotClientPath.value = s.riotClientPath || '';
  $('#client-status').textContent = state.clientFound ? '· found' : '· not found';
  $('#client-status').className = state.clientFound ? 'pos' : 'neg';
  $('#settings-modal').showModal();
}

async function submitSettings(e) {
  e.preventDefault();
  const f = $('#settings-form').elements;
  const input = {
    refreshMinutes: Number(f.refreshMinutes.value),
    minimizeOnLaunch: f.minimizeOnLaunch.checked,
    hideRiotClient: f.hideRiotClient.checked,
    closeRiotClient: f.closeRiotClient.checked,
    streamerMode: f.streamerMode.checked,
    riotClientPath: f.riotClientPath.value.trim(),
  };
  if (f.riotApiKey.value.trim()) input.riotApiKey = f.riotApiKey.value;
  if (f.riotTftApiKey.value.trim()) input.riotTftApiKey = f.riotTftApiKey.value;
  if (f.henrikApiKey.value.trim()) input.henrikApiKey = f.henrikApiKey.value;
  const keysChanged = Boolean(input.riotApiKey || input.riotTftApiKey || input.henrikApiKey);
  const res = await api.saveSettings(input);
  state.settings = res;
  state.nextRefresh = res.nextRefresh;
  state.clientFound = res.clientFound;
  $('#settings-modal').close();
  render();
  toast('Settings saved', 'ok', 2000);
  if (keysChanged && state.accounts.length) refreshRanks();
}

function upsertLocal(acc) {
  const i = state.accounts.findIndex((a) => a.id === acc.id);
  if (i >= 0) state.accounts[i] = acc;
  else state.accounts.push(acc);
  render();
}

async function refreshRanks(ids) {
  if (state.refreshing && !ids) return;
  try {
    const r = await api.refresh(ids);
    if (r?.nextRefresh !== undefined) state.nextRefresh = r.nextRefresh;
    const errs = state.accounts.map((a) => rankOf(a, state.game, queueOf(state.game)).error).filter(Boolean);
    if (!ids && errs.length) toast(errs[0], 'error', 6000);
  } catch (err) {
    toast(err.message || String(err), 'error');
  }
}

function renderLaunchStatus() {
  const active = state.signingIn;
  const panel = $('#launch-status');
  panel.hidden = !active;
  panel.classList.toggle('needs-attention', Boolean(active?.needsAttention));
  $('#launch-status-text').textContent = active?.cancelling ? 'Cancelling…' : active?.text || '';
  $('#launch-show-client').disabled = !active?.needsAttention || Boolean(active?.cancelling);
  $('#launch-cancel').disabled = Boolean(active?.cancelling);
  $('#launch-cancel').textContent = active?.cancelling ? 'Cancelling…' : 'Cancel';
  $('#show-riot-client').disabled = Boolean(active && (!active.needsAttention || active.cancelling));
}

async function showRiotClient() {
  if (state.signingIn && (!state.signingIn.needsAttention || state.signingIn.cancelling)) return;
  try {
    const res = await api.showRiotClient();
    if (!res?.ok) throw new Error(res?.error || 'Could not show the Riot Client');
  } catch (err) {
    toast(err.message || String(err), 'error', 6000);
  }
}

async function cancelSignIn() {
  const active = state.signingIn;
  if (!active || active.cancelling) return;
  active.cancelling = true;
  renderLaunchStatus();
  try {
    const res = await api.cancelSignIn();
    if (!res?.ok) throw new Error(res?.error || 'Could not cancel sign-in');
  } catch (err) {
    if (state.signingIn === active) active.cancelling = false;
    renderLaunchStatus();
    toast(err.message || String(err), 'error', 6000);
  }
}

let preparingLaunch = false;
async function play(acc) {
  if (preparingLaunch || state.signingIn) return;
  preparingLaunch = true;
  const game = state.game;
  let t;
  let off = () => {};
  let succeeded = false;
  try {
    const ban = banInfo(acc, game);
    if (ban && !(await confirmDialog('Account is banned', `${acc.gameName} is marked “${ban.text}”. Sign in anyway?`, 'Sign in'))) return;

    const running = await api.runningGames();
    if (running.lol || running.val) {
      const which = [running.lol && 'League of Legends', running.val && 'VALORANT'].filter(Boolean).join(' and ');
      const ok = await confirmDialog(
        `${which} is running`,
        `To switch to ${acc.gameName}, ${which} and the Riot Client will be closed. If you are in a match you will leave it.`,
        'Close and switch',
      );
      if (!ok) return;
    }

    state.signingIn = { id: acc.id, text: 'Starting…', needsAttention: false, cancelling: false };
    renderAccounts();
    t = toast(`Signing in to ${acc.gameName}…`, 'info', 0);
    off = api.onSignInStatus(({ id, text, needsAttention = false }) => {
      if (id !== acc.id || !state.signingIn) return;
      Object.assign(state.signingIn, { text, needsAttention });
      t.set(text);
      renderAccounts();
    });
    const res = await api.signIn(acc.id, game);
    succeeded = Boolean(res?.ok && res.gameStarted);
    if (succeeded) {
      t.set(`${GAME_NAMES[game]} is starting on ${acc.gameName}`, 'ok');
    } else if (res?.ok) {
      t.set(`The game did not start. Open Settings → Show Riot Client to check updates or finish sign-in.`, 'error');
    } else {
      t.set(res?.error || 'Sign-in did not finish', res?.cancelled ? 'info' : 'error');
    }
  } catch (err) {
    const message = err.message || String(err);
    if (t) t.set(message, 'error');
    else toast(message, 'error', 6000);
  } finally {
    off();
    preparingLaunch = false;
    state.signingIn = null;
    if (t) setTimeout(t.close, succeeded ? 4000 : 8000);
    renderAccounts();
  }
}

async function copy(acc, what) {
  await api.copy(acc.id, what);
  toast(what === 'password' ? 'Password copied, clipboard clears in 20 s' : `${what === 'riotId' ? 'Riot ID' : 'Username'} copied`, 'ok', 2000);
}

function openMenu(acc, anchor) {
  const menu = $('#card-menu');
  const banned = Boolean(acc.ban);
  menu.innerHTML = `
    <button data-menu="edit">Edit account</button>
    <button data-menu="riotId">Copy Riot ID</button>
    <button data-menu="refresh">Refresh rank</button>
    <button data-menu="pin">${acc.pinned ? 'Unpin' : 'Pin to top'}</button>
    ${acc.hasSession ? '<button data-menu="forget">Forget saved sign-in</button>' : ''}
    ${banned ? '<button data-menu="unban">Clear ban</button>' : ''}
    <hr>
    <button data-menu="delete" class="danger">Delete</button>`;
  menu.dataset.id = acc.id;
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.min(window.innerWidth - w - 8, r.right - w)}px`;
  menu.style.top = `${r.bottom + h + 8 > window.innerHeight ? r.top - h - 4 : r.bottom + 4}px`;
}

async function deleteAccount(acc) {
  const ok = await confirmDialog('Delete account', `Remove ${acc.gameName}#${acc.tagLine} and its saved password from this app?`, 'Delete');
  if (!ok) return false;
  await api.deleteAccount(acc.id);
  state.accounts = state.accounts.filter((a) => a.id !== acc.id);
  render();
  return true;
}

async function onMenu(action, acc) {
  $('#card-menu').hidden = true;
  if (action === 'edit') openAccountModal(acc);
  if (action === 'riotId') copy(acc, 'riotId');
  if (action === 'refresh') refreshRanks([acc.id]);
  if (action === 'pin') upsertLocal(await api.patchAccount(acc.id, { pinned: !acc.pinned }));
  if (action === 'unban') upsertLocal(await api.patchAccount(acc.id, { ban: null }));
  if (action === 'forget') {
    upsertLocal(await api.forgetSession(acc.id));
    toast('Saved sign-in removed. Next time the password is typed again', 'ok', 3000);
  }
  if (action === 'delete') deleteAccount(acc);
}

function bind() {
  $('.game-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-game]');
    if (!b) return;
    state.game = b.dataset.game;
    state.tierFilter = null;
    savePrefs();
    render();
  });

  $('#queue-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-queue]');
    if (!b) return;
    state.queue = { ...state.queue, [state.game]: b.dataset.queue };
    savePrefs();
    render();
  });

  $('#distribution').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tier]');
    if (!b) return;
    state.tierFilter = state.tierFilter === b.dataset.tier ? null : b.dataset.tier;
    render();
  });

  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderAccounts();
  });
  $('#filter-region').addEventListener('change', (e) => {
    state.region = e.target.value;
    savePrefs();
    renderAccounts();
  });
  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    savePrefs();
    renderAccounts();
  });
  $('#hide-banned').addEventListener('change', (e) => {
    state.hideBanned = e.target.checked;
    savePrefs();
    renderAccounts();
  });
  $('.view-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    savePrefs();
    render();
  });

  $('#accounts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action], [data-open]');
    if (!b) return;
    if (b.dataset.open === 'add') return openAccountModal();
    const acc = state.accounts.find((a) => a.id === b.closest('[data-id]')?.dataset.id);
    if (!acc) return;
    const a = b.dataset.action;
    if (a === 'play') play(acc);
    if (a === 'copy-user') copy(acc, 'username');
    if (a === 'copy-pass') copy(acc, 'password');
    if (a === 'menu') {
      e.stopPropagation();
      openMenu(acc, b);
    }
  });
  $('#accounts').addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    const acc = state.accounts.find((a) => a.id === e.target.closest('[data-id]')?.dataset.id);
    if (acc) openAccountModal(acc);
  });

  $('#card-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    const acc = state.accounts.find((a) => a.id === $('#card-menu').dataset.id);
    if (b && acc) onMenu(b.dataset.menu, acc);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#card-menu')) $('#card-menu').hidden = true;
  });

  $('#setup-banner').addEventListener('click', (e) => {
    if (e.target.closest('[data-open="settings"]')) openSettings();
  });

  $('#add-account').addEventListener('click', () => openAccountModal());
  $('#open-settings').addEventListener('click', openSettings);
  $('#launch-show-client').addEventListener('click', showRiotClient);
  $('#show-riot-client').addEventListener('click', showRiotClient);
  $('#launch-cancel').addEventListener('click', cancelSignIn);
  $('#open-data').addEventListener('click', () => api.openDataFolder());
  $('#refresh-now').addEventListener('click', () => {
    if (!state.accounts.length) return;
    refreshRanks();
  });

  const form = $('#account-form');
  form.addEventListener('submit', submitAccount);
  form.elements.banType.addEventListener('change', syncBanFields);
  form.elements.region.addEventListener('change', updateValRegionLabel);
  form.elements.gameName.addEventListener('input', (e) => {
    const v = e.target.value;
    if (v.includes('#')) {
      const [name, tag] = v.split('#');
      e.target.value = name.trim();
      form.elements.tagLine.value = tag.trim();
      form.elements.tagLine.focus();
    }
  });
  $('#toggle-password').addEventListener('click', () => {
    const p = form.elements.password;
    p.type = p.type === 'password' ? 'text' : 'password';
  });
  $('#delete-account').addEventListener('click', async () => {
    const acc = state.accounts.find((a) => a.id === form.dataset.id);
    $('#account-modal').close();
    if (acc && !(await deleteAccount(acc))) openAccountModal(acc);
  });

  $('#settings-form').addEventListener('submit', submitSettings);
  $('#pick-client').addEventListener('click', async () => {
    const p = await api.pickClientPath();
    if (p) $('#settings-form').elements.riotClientPath.value = p;
  });

  $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#search').focus();
      $('#search').select();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openAccountModal();
    } else if (e.ctrlKey && ['1', '2', '3'].includes(e.key)) {
      state.game = ['lol', 'tft', 'val'][Number(e.key) - 1];
      state.tierFilter = null;
      savePrefs();
      render();
    } else if (e.key === 'F5') {
      refreshRanks();
    }
  });

  api.onAccountUpdated((acc) => {
    const i = state.accounts.findIndex((a) => a.id === acc.id);
    if (i >= 0) state.accounts[i] = acc;
    else return;
    renderDistribution();
    renderAccounts();
  });
  api.onSignInOperation?.((operation) => {
    state.signingIn = operation?.status === 'running'
      ? { id: operation.accountId, text: operation.text, needsAttention: operation.needsAttention, cancelling: false }
      : null;
    renderAccounts();
  });
  api.onRefreshProgress((p) => {
    state.refreshing = p.done < p.total ? p : null;
    document.body.classList.toggle('is-refreshing', Boolean(state.refreshing));
    renderCountdown();
  });
  api.onNextRefresh((iso) => {
    state.nextRefresh = iso;
    renderCountdown();
  });
}

function fillSelects() {
  const opts = Object.entries(state.regions).map(([id, r]) => `<option value="${id}">${r.label}</option>`).join('');
  $('#filter-region').innerHTML = `<option value="all">All regions</option>${opts}`;
  $('#account-form').elements.region.innerHTML = opts;
  $('#account-form').elements.valRegion.innerHTML =
    '<option value="">Auto</option>' + state.valRegions.map((r) => `<option value="${r}">${r.toUpperCase()}</option>`).join('');
}

async function loadData() {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await api.init();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  $('#accounts').innerHTML = `
    <div class="empty-state">
      <h2>Could not load your accounts</h2>
      <p>Your saved accounts are kept in the data folder and were not deleted.<br>${esc(lastError?.message || lastError)}</p>
      <button class="btn btn-primary" id="retry-load">Try again</button>
    </div>`;
  $('#retry-load').addEventListener('click', () => location.reload());
  throw lastError;
}

async function main() {
  loadPrefs();
  const data = await loadData();
  if (data.operation?.status === 'running') state.signingIn = { id: data.operation.accountId, text: data.operation.text, needsAttention: data.operation.needsAttention, cancelling: false };
  Object.assign(state, {
    accounts: data.accounts,
    settings: data.settings,
    regions: data.regions,
    valRegions: data.valRegions,
    nextRefresh: data.nextRefresh,
    clientFound: data.clientFound,
    nativeIntegration: data.nativeIntegration,
  });
  if (!QUEUES[state.game]) state.game = 'lol';
  $('#version').textContent = `v${data.version}`;
  fillSelects();
  bind();
  render();
  renderCountdown();
  setInterval(renderCountdown, 1000);
  setInterval(() => !state.signingIn && renderAccounts(), 60000);
}

main();
