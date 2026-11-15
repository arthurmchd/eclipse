import { GAME_QUEUES, LAYOUTS, layoutOf, accountView } from './cardView.js';
import { textFor, translatePage } from './cardsText.js';

const api = window.api;
const $ = selector => document.querySelector(selector);
const state = { accounts: [], selectedId: null, game: 'lol', stats: 'lol', operation: null, regions: {}, settings: {}, editing: null, submitting: false, lastRefresh: null, refreshing: false };
const games = { riot: 'Riot Client', lol: 'League of Legends', val: 'VALORANT' };
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
  const layout = layoutOf(state.settings);
  for (const button of document.querySelectorAll('#layout [data-layout]')) button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  const cards = $('#cards');
  cards.dataset.view = layout;
  cards.dataset.game = state.stats;
  const views = state.accounts.map(account => accountView(account, state.stats, text));
  const body = views.map((view, index) => {
    const playing = state.operation?.accountId === view.id && busy();
    return `<article class="account ${layout === 'list' ? 'list-card' : 'plate-card'} ${view.id === state.selectedId ? 'is-selected' : ''} ${playing ? 'is-playing' : ''}" data-id="${esc(view.id)}" data-tier="${esc(view.accent)}">
      <input class="account-radio" type="radio" name="account" id="account-${index}" data-account="${esc(view.id)}" ${view.id === state.selectedId ? 'checked' : ''} ${busy() ? 'disabled' : ''}>
      <label class="account-content" for="account-${index}">${layout === 'list' ? row(view, text) : plate(view, text)}</label>
      <button class="edit" data-action="edit" aria-label="${esc(text.editNamed(view.name))}" title="${esc(text.editAccount)}" ${busy() ? 'disabled' : ''}>···</button>
    </article>`;
  }).join('');
  cards.innerHTML = views.length ? (layout === 'list' ? listHead(text) : '') + body : `<div class="empty"><h2>${esc(text.emptyTitle)}</h2><p>${esc(text.emptyText)}</p></div>`;
  for (const card of cards.querySelectorAll('[data-tier]')) if (/^#[0-9a-f]{6}$/i.test(card.dataset.tier)) card.style.setProperty('--tier', card.dataset.tier);
  if (focused) Array.from(document.querySelectorAll('[data-account]')).find(element => element.dataset.account === focused)?.focus({ preventScroll: true });
}

function avatar(view, className) {
  return view.avatar ? `<img class="${className}" src="${esc(view.avatar)}" alt="" loading="lazy">` : `<span class="${className}"></span>`;
}

function who(view) {
  return `<span class="who"><strong>${esc(view.name)}</strong><span class="tag">#${esc(view.tag)}</span></span>`;
}

function rr(queue) {
  if (queue.progress === null) return '';
  const change = queue.change === null ? '' : `<span class="change ${queue.change > 0 ? 'up' : 'down'}" title="${esc(queue.changeTitle)}">${queue.change > 0 ? '+' : '−'}${Math.abs(queue.change)}</span>`;
  return `<span class="rr"><progress max="100" value="${queue.progress}" aria-hidden="true"></progress>${change}</span>`;
}

function climb(queue) {
  const value = queue.climb;
  return value ? `<span class="climb" title="${esc(value.title)}"><img src="${esc(value.crest)}" alt="${esc(value.tier)}" loading="lazy"><span>${esc(value.label)}</span></span>` : '';
}

function plate(view, text) {
  const { main } = view;
  const level = view.level === null ? '' : `<span class="level"><span class="sr-only">${esc(text.level)} </span>${view.level}</span>`;
  const others = view.others.map(queue => `<span class="other">${esc(queue.name)} · <strong>${esc(queue.tier)}</strong>${queue.ranked ? ` ${esc(queue.points)}` : ''}</span>`).join('');
  return `<span class="plate">
      <span class="avatar">${avatar(view, 'portrait')}${level}</span>
      ${who(view)}
      <img class="crest" src="${esc(main.crest)}" alt="" loading="lazy">
      <span class="main"><small class="queue-name">${esc(main.name)}</small><strong class="tier${main.ranked ? '' : ' none'}">${esc(main.tier)}</strong><span class="points">${esc(main.points)}</span></span>
      ${main.played ? `<span class="played">${esc(main.played)}</span>` : ''}${climb(main)}${rr(main)}${others}
    </span>`;
}

function listHead(text) {
  const columns = state.stats === 'val' ? [text.listAccount, text.queues.competitive, text.listProgress] : [text.listAccount, text.queues.solo, text.queues.flex, text.listWins];
  return `<div class="list-head" aria-hidden="true"><span class="row">${columns.map(name => `<span>${esc(name)}</span>`).join('')}</span><span></span></div>`;
}

function row(view, text) {
  const queues = [view.main, ...view.others].map(queue => `<span class="queue-cell"><img src="${esc(queue.crest)}" alt="" loading="lazy"><span><strong>${esc(queue.tier)}</strong><small>${esc([queue.ranked ? queue.points : text.noGames, queue.played].filter(Boolean).join(' · '))}</small></span></span>`).join('');
  const level = view.level === null ? '' : `<small>${esc(text.level)} ${view.level}</small>`;
  const head = `<span class="who-cell">${avatar(view, 'portrait')}<span>${who(view)}${level}</span></span>`;
  if (state.stats === 'val') return `<span class="row">${head}${queues}<span class="progress-cell">${rr(view.main) || '—'}</span></span>`;
  const { main } = view;
  const tone = main.winrate === null ? '' : main.winrate >= 55 ? 'high' : main.winrate < 50 ? 'low' : '';
  const wins = main.games ? `<span><strong class="wr ${tone}">${main.winrate}%</strong> · ${esc(main.record)}</span><progress max="${main.games}" value="${main.wins}" aria-hidden="true"></progress>` : '<span>—</span><progress class="empty" max="1" value="0" aria-hidden="true"></progress>';
  return `<span class="row">${head}${queues}<span class="win-cell">${wins}</span></span>`;
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
$('#games').addEventListener('click', event => { const button = event.target.closest('[data-game]'); if (!button || busy() || !games[button.dataset.game]) return; state.game = button.dataset.game; if (GAME_QUEUES[state.game]) state.stats = state.game; render(); });
$('#layout').addEventListener('click', async event => {
  const button = event.target.closest('[data-layout]');
  const layout = button?.dataset.layout;
  if (!LAYOUTS.includes(layout) || busy() || layout === layoutOf(state.settings)) return;
  const previous = state.settings.cardLayout;
  state.settings = { ...state.settings, cardLayout: layout };
  render();
  try { const saved = await api.saveSettings({ cardLayout: layout }); state.settings = { ...state.settings, cardLayout: saved.cardLayout }; render(); }
  catch { state.settings = { ...state.settings, cardLayout: previous }; notice(t().saveSettingsFailed); render(); }
});
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
