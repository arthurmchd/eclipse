import { rankOf, lolCrest, profileIcon, lolBanner, valCardArt } from './ranks.js';
import { textFor, translatePage } from './cardsText.js';

const api = window.api;
const $ = selector => document.querySelector(selector);
const state = { accounts: [], selectedId: null, game: 'lol', stats: 'lol', operation: null, regions: {}, settings: {}, editing: null, submitting: false, lastRefresh: null, refreshing: false };
const games = { riot: 'Riot Client', lol: 'League of Legends', val: 'VALORANT' };
const queues = { lol: ['solo', 'flex'], val: ['competitive'] };
const t = () => textFor(state.settings.language);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => Number.isFinite(value) ? String(value) : '—';
const busy = () => state.submitting || state.operation?.status === 'running';
let translated = null;
function updatedText() {
  const text = t();
  if (state.refreshing) return text.updating;
  const time = Date.parse(state.lastRefresh);
  if (!Number.isFinite(time)) return text.neverUpdated;
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return text.updatedNow;
  if (minutes < 60) return text.updatedMinutes(minutes);
  if (minutes < 1440) return text.updatedHours(Math.floor(minutes / 60));
  return text.updatedDays(Math.floor(minutes / 1440));
}

function notice(text = '') { $('#notice').textContent = text; $('#notice').hidden = !text; }
function render() {
  const text = t();
  if (translated !== text) { translatePage(document, text); translated = text; }
  const focused = document.activeElement?.dataset.account;
  if (!state.accounts.some(account => account.id === state.selectedId)) state.selectedId = (state.accounts.find(account => account.hasPassword) || state.accounts[0])?.id || null;
  const selected = state.accounts.find(account => account.id === state.selectedId);
  $('#count').textContent = text.accounts(state.accounts.length);
  $('#updated').textContent = updatedText();
  const running = state.operation?.status === 'running';
  $('#status').hidden = !running || !state.operation.needsAttention;
  $('#status-text').textContent = text.attention;
  for (const element of document.querySelectorAll('nav button, .footer-tools button')) element.disabled = busy();
  $('#play').disabled = running ? false : busy() || !selected?.hasPassword;
  $('#play').classList.toggle('is-cancel', running);
  $('#play').innerHTML = running ? esc(text.cancel) : busy() ? esc(text.signingIn) : `${esc(state.game === 'riot' ? text.enter : text.play)} <span aria-hidden="true">→</span>`;
  $('#selected-name').textContent = selected ? `${selected.gameName} #${selected.tagLine}` : text.selectAccount;
  $('#selected-game').textContent = selected && !selected.hasPassword ? text.addPassword : `${games[state.game]}${selected ? ' · ' + (state.regions[selected.region]?.label || selected.region) : ''}`;
  $('#selected-name').title = $('#selected-name').textContent;
  $('#selected-game').title = $('#selected-game').textContent;
  document.body.dataset.theme = state.game;
  for (const button of document.querySelectorAll('[data-game]')) button.setAttribute('aria-pressed', String(button.dataset.game === state.game));
  $('#cards').innerHTML = state.accounts.length ? state.accounts.map((account, index) => {
    const ranks = queues[state.stats].map(queue => ({ name: text.queues[queue], rank: rankOf(account, state.stats, queue) }));
    const playing = state.operation?.accountId === account.id && busy();
    return `<article class="account ${state.stats}-card ${account.id === state.selectedId ? 'is-selected' : ''} ${playing ? 'is-playing' : ''}" data-id="${esc(account.id)}">
      <input class="account-radio" type="radio" name="account" id="account-${index}" data-account="${esc(account.id)}" ${account.id === state.selectedId ? 'checked' : ''} ${busy() ? 'disabled' : ''}>
      <label class="account-content" for="account-${index}">${state.stats === 'val' ? valFace(account, ranks, text) : lolFace(account, ranks, text)}</label>
      <button class="edit" data-action="edit" aria-label="${esc(text.editNamed(account.gameName))}" title="${esc(text.editAccount)}" ${busy() ? 'disabled' : ''}>···</button>
    </article>`;
  }).join('') : `<div class="empty"><h2>${esc(text.emptyTitle)}</h2><p>${esc(text.emptyText)}</p></div>`;
  if (focused) Array.from(document.querySelectorAll('[data-account]')).find(element => element.dataset.account === focused)?.focus({ preventScroll: true });
}

function lolFace(account, ranks, text) {
  const lol = account.stats?.lol;
  const level = ranks[0].rank.level;
  const icon = Number.isInteger(lol?.iconId) && lol.iconId >= 0 ? `<img class="icon" src="${esc(profileIcon(lol.iconId))}" alt="" loading="lazy">` : '<span class="icon"></span>';
  const badge = Number.isFinite(level) ? `<span class="level"><span class="sr-only">${esc(text.level)} </span>${number(level)}</span>` : '';
  return `<span class="face"><span class="account-head"><span class="name"><strong>${esc(account.gameName)}</strong><span class="tag">#${esc(account.tagLine)}</span></span></span>
      <span class="queues">${ranks.map(rank => queueBlock(rank, text)).join('')}</span></span>
      <span class="crest"><img class="banner" src="${esc(lolBanner(lol))}" width="580" height="1480" alt="" loading="lazy">${icon}${badge}</span>`;
}

function valFace(account, ranks, text) {
  const level = ranks[0].rank.level;
  const badge = Number.isFinite(level) ? `<span class="level">${esc(text.level)} ${number(level)}</span>` : '';
  return `<span class="account-head"><span class="name"><strong>${esc(account.gameName)}</strong><span class="tag">#${esc(account.tagLine)}</span></span>${badge}</span>
      <span class="art"><img src="${esc(valCardArt(account.stats?.val?.card))}" alt="" loading="lazy"></span>
      <span class="queues">${ranks.map(rank => queueBlock(rank, text)).join('')}</span>`;
}

function queueBlock({ name, rank }, text) {
  const lol = state.stats === 'lol';
  const unranked = rank.label === 'Unranked' || rank.label === 'Unrated';
  const label = unranked ? text.unranked : lol ? rank.label.replace(/^\S+/, text.tiers[rank.group] || rank.group) : rank.label.replace(/^\S+/, word => text.valTiers[word.toUpperCase()] || word);
  const played = Number.isFinite(rank.wins) && Number.isFinite(rank.losses) ? text.record(rank.wins, rank.losses) : '';
  const record = [rank.winrate == null ? '' : `${number(rank.winrate)}%`, played].filter(Boolean).join(' · ');
  const detail = lol ? `<span class="record">${esc(record || '—')}</span>${climbLine(rank.climb, text)}` : rrLine(rank, unranked, text);
  return `<span class="queue"><small class="queue-name">${esc(name)}</small><span class="rank"><img src="${esc(lol ? lolCrest(rank.group) : rank.emblem)}" alt="" loading="lazy"><span><strong>${esc(label)}</strong><small>${esc(unranked ? text.noGames : rank.sub.replace(/ LP$/, ` ${text.leaguePoints}`))}</small></span></span>${detail}</span>`;
}

function rrLine(rank, unranked, text) {
  if (unranked) return '';
  const change = rank.lastChange;
  const moved = Number.isFinite(change) && change !== 0 ? `<span class="change ${change > 0 ? 'up' : 'down'}" title="${esc(text.lastMatch(change))}">${change > 0 ? '+' : '−'}${Math.abs(change)}</span>` : '';
  return `<span class="rr"><progress max="100" value="${Math.round(Math.max(0, Math.min(1, rank.progress || 0)) * 100)}" aria-hidden="true"></progress>${moved}</span>`;
}

function climbLine(climb, text) {
  if (!climb) return '';
  const tier = text.tiers[climb.tier] || climb.tier;
  const label = climb.holding ? (climb.gap > 0 ? text.cutoffBelow(climb.gap) : text.cutoffAbove(-climb.gap)) : climb.gap > 0 ? text.climbMissing(climb.gap) : text.climbReached;
  return `<span class="climb" title="${esc(text.cutoffTitle(tier, climb.cutoff))}"><img src="${esc(lolCrest(climb.tier))}" alt="${esc(tier)}" loading="lazy"><span>${esc(label)}</span></span>`;
}

async function reload() {
  const data = await api.init();
  Object.assign(state, { accounts: data.accounts || [], regions: data.regions || {}, settings: data.settings || {}, operation: data.operation, lastRefresh: data.lastRefresh || null });
  render();
}

function confirmAction(title, text) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

function editAccount(account = null) {
  state.editing = account;
  const form = $('#account-form');
  form.reset(); form.querySelector('.form-error').textContent = '';
  form.elements.riotId.value = account ? `${account.gameName}#${account.tagLine}` : '';
  form.elements.username.value = account?.username || '';
  form.elements.password.required = !account;
  form.elements.region.innerHTML = Object.entries(state.regions).map(([id, region]) => `<option value="${esc(id)}">${esc(region.label)}</option>`).join('');
  form.elements.region.value = account?.region || 'br1';
  $('#account-title').textContent = account ? t().editAccount : t().addAccount;
  $('#delete-account').hidden = !account;
  $('#account-dialog').showModal();
}

$('#cards').addEventListener('change', event => {
  if (!event.target.matches('[data-account]') || busy()) return;
  state.selectedId = event.target.dataset.account;
  render();
});
$('#cards').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy()) return;
  const account = state.accounts.find(item => item.id === button.closest('[data-id]').dataset.id);
  if (!account) return;
  if (button.dataset.action === 'edit') editAccount(account);
});
$('#delete-account').addEventListener('click', async () => {
  const account = state.editing;
  if (!account || busy()) return;
  if (!await confirmAction(t().removeTitle, t().removeText(account.gameName))) return;
  try { await api.deleteAccount(account.id); $('#account-dialog').close(); await reload(); }
  catch { $('#account-form .form-error').textContent = t().removeFailed; }
});
$('#play').addEventListener('click', async () => {
  if (state.operation?.status === 'running') return api.cancelSignIn().catch(() => notice(t().cancelFailed));
  const account = state.accounts.find(item => item.id === state.selectedId);
  if (busy() || !account?.hasPassword) return;
  const game = state.game;
  try {
    state.submitting = true; render(); notice();
    const running = await api.runningGames();
    if ((running.lol || running.val) && !await confirmAction(t().switchTitle, t().switchText)) return;
    const result = await api.signIn(account.id, game);
    if (!result.ok && !result.cancelled) notice(result.error || t().signInFailed);
    await reload();
  } catch { notice(t().actionFailed); }
  finally { state.submitting = false; render(); }
});

$('#account-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector('[type=submit]');
  const split = form.elements.riotId.value.trim().lastIndexOf('#');
  if (split < 1) { form.querySelector('.form-error').textContent = t().riotIdInvalid; return; }
  submit.disabled = true;
  try {
    const previous = state.editing;
    const input = { gameName: form.elements.riotId.value.trim().slice(0, split), tagLine: form.elements.riotId.value.trim().slice(split + 1), username: form.elements.username.value.trim(), region: form.elements.region.value, valRegion: previous?.valRegion || '', note: previous?.note || '', lastSeason: previous?.lastSeason || {}, ban: previous?.ban || null };
    if (previous) input.id = previous.id;
    if (form.elements.password.value) input.password = form.elements.password.value;
    await api.saveAccount(input);
    $('#account-dialog').close(); await reload();
  } catch { form.querySelector('.form-error').textContent = t().saveAccountFailed; }
  finally { form.elements.password.value = ''; submit.disabled = false; }
});

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const input = { refreshMinutes: Number(form.elements.refreshMinutes.value), staySignedIn: form.elements.staySignedIn.checked, language: form.elements.language.value === 'en' ? 'en' : 'pt' };
    for (const key of ['riotApiKey', 'henrikApiKey']) if (form.elements[key].value.trim()) input[key] = form.elements[key].value.trim();
    const saved = await api.saveSettings(input); state.settings = { ...state.settings, ...saved }; $('#settings-dialog').close(); render(); await api.refresh(); await reload();
  } catch { form.querySelector('.form-error').textContent = t().saveSettingsFailed; }
  finally { for (const key of ['riotApiKey', 'henrikApiKey']) form.elements[key].value = ''; submit.disabled = false; }
});

$('#add-account').addEventListener('click', () => { if (!busy()) editAccount(); });
$('#settings').addEventListener('click', () => { const form = $('#settings-form'); form.reset(); form.querySelector('.form-error').textContent = ''; form.elements.refreshMinutes.value = state.settings.refreshMinutes ?? 30; form.elements.staySignedIn.checked = state.settings.staySignedIn !== false; form.elements.language.value = state.settings.language === 'en' ? 'en' : 'pt'; $('#settings-dialog').showModal(); });
$('#refresh').addEventListener('click', () => { if (state.refreshing) return; state.refreshing = true; notice(); render(); api.refresh().catch(() => { state.refreshing = false; notice(t().refreshFailed); render(); }); });
$('#games').addEventListener('click', event => { const button = event.target.closest('[data-game]'); if (!button || busy() || !games[button.dataset.game]) return; state.game = button.dataset.game; if (queues[state.game]) state.stats = state.game; render(); });
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => { for (const input of dialog.querySelectorAll('input[type=password]')) input.value = ''; });
$('#riot-minimize').addEventListener('click', () => { api.minimizeRiot().catch(() => {}); });
$('#riot-close').addEventListener('click', () => { api.closeRiot().catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
api.onAccountUpdated(account => { const index = state.accounts.findIndex(item => item.id === account.id); if (index >= 0) state.accounts[index] = account; else state.accounts.push(account); notice(); render(); });
api.onSignInOperation(operation => { state.operation = operation; render(); });
api.onRefreshProgress(progress => { state.refreshing = progress.done < progress.total; if (state.refreshing) return render(); reload().catch(() => render()); });
setInterval(() => { $('#updated').textContent = updatedText(); }, 30000);
reload().catch(() => { render(); notice(t().loadFailed); });
