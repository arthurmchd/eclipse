import { GAME_QUEUES, GAME_NAMES, LAYOUTS, layoutOf, accountView, selectionView, queueLabel } from './cardView.js';
import { SORTS, ACCOUNT_GAMES, sortOf, gamesOf, toggleGame, tierOptions, visibleAccounts, canReorder, moveId, usage, parseBatch, countLabel, startsSearch, toggleSelection, keptSelection } from './cardList.js';
import { VAL_GROUPS } from './ranks.js';
import { textFor, translatePage } from './cardsText.js';
import { createSounds, hoverSound, clickSound, changeSound } from './sounds.js';

const api = window.api;
const $ = selector => document.querySelector(selector);
const sounds = createSounds();
let entered = '';
let hovered = null;
const state = { accounts: [], selectedId: null, game: 'lol', stats: 'lol', operation: null, regions: {}, settings: {}, editing: null, submitting: false, lastRefresh: null, refreshing: false, seenAccount: null, filters: { query: '', region: '', tier: '' }, addMode: 'single' };
const drag = { id: null, pointer: null, startX: 0, startY: 0, active: false, target: null, after: false, ended: false };
const t = () => textFor(state.settings.language);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const busy = () => state.submitting || state.operation?.status === 'running';
const hex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const reorderable = () => canReorder({ ...state.filters, sort: sortOf(state.settings) });
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

function tierLabel(id, text) {
  if (id === 'UNRANKED' || id === 'UNRATED') return text.unranked;
  if (state.stats === 'lol') return text.tiers[id] || id;
  return text.valTiers[id] || VAL_GROUPS.find(group => group.id === id)?.name || id;
}

function fillSelect(select, options, value) {
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    select.innerHTML = options.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
    select.dataset.key = key;
  }
  select.value = options.some(([id]) => id === value) ? value : options[0][0];
  return select.value;
}

function renderToolbar(text) {
  const regionIds = [...new Set(state.accounts.map(account => account.region).filter(Boolean))].sort((a, b) => (state.regions[a]?.label || a).localeCompare(state.regions[b]?.label || b));
  state.filters.region = fillSelect($('#filter-region'), [['', text.allRegions], ...regionIds.map(id => [id, state.regions[id]?.label || id])], state.filters.region);
  $('#filter-region').hidden = regionIds.length < 2 && !state.filters.region;
  state.filters.tier = fillSelect($('#filter-tier'), [['', text.allTiers], ...tierOptions(state.stats).map(id => [id, tierLabel(id, text)])], state.filters.tier);
  for (const [id, value] of [['#filter-region', state.filters.region], ['#filter-tier', state.filters.tier]]) $(id).classList.toggle('is-active', Boolean(value));
  const sort = fillSelect($('#sort'), SORTS.map(id => [id, text.sorts[id]]), sortOf(state.settings));
  $('#sort').title = sort === 'manual' ? text.dragHint : text.sortLabel;
  $('#toolbar').hidden = !state.accounts.length;
  for (const element of document.querySelectorAll('#toolbar select, #toolbar input')) element.disabled = busy();
}

function render() {
  if (drag.active) return;
  const text = t();
  if (translated !== text) { translatePage(document, text); translated = text; }
  renderToolbar(text);
  const focused = document.activeElement?.dataset.account;
  const layout = layoutOf(state.settings);
  const shown = visibleAccounts(state.accounts, { game: state.game, stats: state.stats, ...state.filters, sort: sortOf(state.settings) });
  state.selectedId = keptSelection(state.selectedId, shown);
  const selected = state.accounts.find(account => account.id === state.selectedId);
  $('#count').textContent = countLabel({ shown: shown.length, total: state.accounts.length, inGame: visibleAccounts(state.accounts, { game: state.game, stats: state.stats }).length }, text);
  $('#updated').textContent = updatedText();
  const running = state.operation?.status === 'running';
  $('#status').hidden = !running || !state.operation.needsAttention;
  $('#status-text').textContent = text.attention;
  for (const element of document.querySelectorAll('#games button, .view-bar button')) element.disabled = busy();
  $('#play').disabled = running ? false : busy() || !selected?.hasPassword;
  $('#play').classList.toggle('is-cancel', running);
  $('#play').innerHTML = running ? esc(text.cancel) : busy() ? esc(text.signingIn) : `${esc(state.game === 'riot' ? text.enter : text.play)} <span aria-hidden="true">→</span>`;
  sounds.setEnabled(state.settings.uiSounds !== false);
  $('#selected-label').hidden = !selected;
  const chosen = selectionView(selected, state.game, state.regions, text);
  $('#selected-name').textContent = chosen.name;
  $('#selected-detail').textContent = chosen.detail;
  $('#selected-name').title = chosen.name;
  $('#selected-detail').title = chosen.detail;
  document.body.dataset.theme = state.game;
  for (const button of document.querySelectorAll('[data-game]')) button.setAttribute('aria-pressed', String(button.dataset.game === state.game));
  for (const button of document.querySelectorAll('#layout [data-layout]')) button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  const cards = $('#cards');
  cards.dataset.view = layout;
  cards.dataset.game = state.stats;
  cards.classList.toggle('can-reorder', reorderable() && !busy());
  const now = Date.now();
  const body = shown.map((account, index) => {
    const view = { ...accountView(account, state.stats, text), pinned: account.pinned === true, usage: usage(account, text, now), recent: usage(account, text, now, false) };
    const playing = state.operation?.accountId === view.id && busy();
    return `<article class="account ${layout === 'list' ? 'list-card' : 'plate-card'} ${view.id === state.selectedId ? 'is-selected' : ''} ${playing ? 'is-playing' : ''}" data-id="${esc(view.id)}" data-tier="${esc(view.accent)}">
      <input class="account-radio" type="radio" name="account" id="account-${index}" data-account="${esc(view.id)}" ${view.id === state.selectedId ? 'checked' : ''} ${busy() ? 'disabled' : ''}>
      <label class="account-content" for="account-${index}" title="${esc(text.playHint)}">${layout === 'list' ? row(view, text) : plate(view, text)}</label>
      <button class="pin" data-action="pin" aria-pressed="${view.pinned}" aria-label="${esc(text.pinNamed(view.name, view.pinned))}" title="${esc(view.pinned ? text.unpin : text.pin)}" ${busy() ? 'disabled' : ''}>${view.pinned ? '★' : '☆'}</button>
      <button class="edit" data-action="edit" aria-label="${esc(text.editNamed(view.name))}" title="${esc(text.editAccount)}" ${busy() ? 'disabled' : ''}>···</button>
    </article>`;
  }).join('');
  const filtered = `<div class="empty"><h2>${esc(text.noMatchTitle)}</h2><p>${esc(text.noMatchText)}</p><button type="button" data-action="clear-filters">${esc(text.clearFilters)}</button></div>`;
  const empty = `<div class="empty"><h2>${esc(text.emptyTitle)}</h2><p>${esc(text.emptyText)}</p><button type="button" class="primary" data-action="add">${esc(text.addAccount)}</button></div>`;
  cards.innerHTML = shown.length ? (layout === 'list' ? listHead(text) : '') + body : state.accounts.length ? filtered : empty;
  for (const card of cards.querySelectorAll('[data-tier]')) if (hex(card.dataset.tier)) card.style.setProperty('--tier', card.dataset.tier);
  for (const badge of cards.querySelectorAll('[data-badge]')) if (badge.dataset.badge.startsWith('https://media.valorant-api.com/levelborders/')) badge.style.setProperty('--badge', `url("${badge.dataset.badge}")`);
  const scene = shown.length ? `${state.game}|${layout}` : '';
  if (scene && scene !== entered) cards.querySelectorAll('.account').forEach((card, index) => { card.style.setProperty('--i', String(Math.min(index, 12))); card.classList.add('enter'); });
  entered = scene;
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
  const label = queueLabel(state.game, state.stats, GAME_QUEUES[state.stats][0], text);
  const crest = main.ranked ? `<img class="crest" src="${esc(main.crest)}" alt="" loading="lazy">` : '';
  const points = main.ranked ? ` · <span class="points">${esc(main.points)}</span>` : '';
  return `<span class="plate">
      <span class="avatar${view.border ? ` has-border border-${view.border.kind}` : ''}"${view.border?.badge ? ` data-badge="${esc(view.border.badge)}"` : ''}>${avatar(view, 'portrait')}${view.border ? `<img class="frame" src="${esc(view.border.src)}" alt="" loading="lazy">` : ''}${level}</span>
      <strong class="name">${esc(view.name)}</strong>
      <span class="usage" title="${esc(view.usage)}">#${esc(view.tag)} · ${esc(view.recent)}</span>
      <span class="rank${main.ranked ? '' : ' none'}">${crest}<strong class="tier">${esc(main.tier)}</strong><span class="rank-line"><small class="queue-name"${label.title ? ` title="${esc(label.title)}"` : ''}>${esc(label.label)}</small>${points}</span></span>
      ${main.played ? `<span class="played">${esc(main.played)}</span>` : ''}${climb(main)}${rr(main)}
    </span>`;
}

function listHead(text) {
  const columns = [text.listAccount, ...GAME_QUEUES[state.stats].map(queue => queueLabel(state.game, state.stats, queue, text).column), state.stats === 'val' ? text.listProgress : text.listWins];
  return `<div class="list-head" aria-hidden="true"><span class="row">${columns.map(name => `<span>${esc(name)}</span>`).join('')}</span><span></span><span></span></div>`;
}

function row(view, text) {
  const queues = [view.main, ...view.others].map(queue => `<span class="queue-cell${queue.ranked ? '' : ' none'}"><img src="${esc(queue.crest)}" alt="" loading="lazy"><span><strong>${esc(queue.tier)}</strong><small>${esc([queue.ranked ? queue.points : text.noGames, queue.played].filter(Boolean).join(' · '))}</small></span></span>`).join('');
  const details = [view.level === null ? '' : `${text.level} ${view.level}`, view.usage].filter(Boolean).join(' · ');
  const head = `<span class="who-cell">${avatar(view, 'portrait')}<span><span class="who-line">${who(view)}</span><small>${esc(details)}</small></span></span>`;
  if (state.stats === 'val') return `<span class="row">${head}${queues}<span class="progress-cell">${rr(view.main) || '—'}</span></span>`;
  const { main } = view;
  const tone = main.winrate === null ? '' : main.winrate >= 55 ? 'high' : main.winrate < 50 ? 'low' : '';
  const wins = main.games ? `<span><strong class="wr ${tone}">${main.winrate}%</strong> · ${esc(main.record)}</span><progress max="${main.games}" value="${main.wins}" aria-hidden="true"></progress>` : '<span>—</span>';
  return `<span class="row">${head}${queues}<span class="win-cell">${wins}</span></span>`;
}

async function reload() {
  const data = await api.init();
  Object.assign(state, { accounts: data.accounts || [], regions: data.regions || {}, settings: data.settings || {}, operation: data.operation, lastRefresh: data.lastRefresh || null, seenAccount: data.seenAccount || null });
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

function setGames(form, games) {
  for (const input of form.querySelectorAll('input[name=games]')) input.checked = games.includes(input.value);
  form.elements.gamesAll.checked = ACCOUNT_GAMES.every((game) => games.includes(game));
}

function chosenGames(form) {
  const games = [...form.querySelectorAll('input[name=games]:checked')].map((input) => input.value);
  return games.length ? games : ACCOUNT_GAMES.slice();
}

function setAddMode(mode) {
  state.addMode = mode === 'batch' && !state.editing ? 'batch' : 'single';
  const form = $('#account-form');
  const batch = state.addMode === 'batch';
  for (const button of document.querySelectorAll('#add-mode [data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === state.addMode));
  for (const field of form.querySelectorAll('.single-field')) field.hidden = batch;
  for (const field of form.querySelectorAll('.batch-field')) field.hidden = !batch;
  form.elements.riotId.required = !batch;
  form.elements.username.required = !batch;
  form.elements.password.required = !batch && !state.editing;
  $('#use-seen').hidden = batch || Boolean(state.editing) || !state.seenAccount;
  form.querySelector('.form-error').textContent = '';
}

function editAccount(account = null) {
  state.editing = account;
  const form = $('#account-form');
  form.reset(); form.querySelector('.form-error').textContent = '';
  form.elements.riotId.value = account ? `${account.gameName}#${account.tagLine}` : '';
  form.elements.username.value = account?.username || '';
  form.elements.region.innerHTML = Object.entries(state.regions).map(([id, region]) => `<option value="${esc(id)}">${esc(region.label)}</option>`).join('');
  form.elements.region.value = account?.region || 'br1';
  setGames(form, gamesOf(account));
  $('#account-title').textContent = account ? t().editAccount : t().addAccount;
  $('#delete-account').hidden = !account;
  $('#add-mode').hidden = Boolean(account);
  if (state.seenAccount) $('#use-seen-text').textContent = t().useSeen(`${state.seenAccount.gameName}#${state.seenAccount.tagLine}`);
  setAddMode('single');
  $('#account-dialog').showModal();
}

function clearFilters() {
  state.filters = { query: '', region: '', tier: '' };
  $('#search').value = '';
  render();
}

async function saveOrder(next) {
  const previous = state.accounts;
  if (next.join() === previous.map(account => account.id).join()) return render();
  state.accounts = next.map(id => previous.find(account => account.id === id));
  render();
  try { await api.reorderAccounts(next); }
  catch { state.accounts = previous; notice(t().reorderFailed); render(); }
}

function clearDropMarks() {
  for (const card of document.querySelectorAll('.drop-before, .drop-after')) card.classList.remove('drop-before', 'drop-after');
}

function endDrag(event, cancelled) {
  if (!drag.id || event.pointerId !== drag.pointer) return;
  const { id, active, target, after } = drag;
  Object.assign(drag, { id: null, pointer: null, active: false, target: null });
  if (!active) return;
  drag.ended = true;
  setTimeout(() => { drag.ended = false; }, 0);
  document.body.classList.remove('is-reordering');
  clearDropMarks();
  if (cancelled || !target || busy()) return render();
  const ids = state.accounts.map(account => account.id);
  saveOrder(moveId(ids, id, ids.indexOf(target) + (after ? 1 : 0)));
}

$('#cards').addEventListener('pointerdown', event => {
  if (event.button !== 0 || busy() || !reorderable() || event.target.closest('button')) return;
  const card = event.target.closest('.account');
  if (!card) return;
  Object.assign(drag, { id: card.dataset.id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, target: null });
});
$('#cards').addEventListener('pointermove', event => {
  if (!drag.id || event.pointerId !== drag.pointer) return;
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.active = true;
    $('#cards').setPointerCapture(event.pointerId);
    document.body.classList.add('is-reordering');
    document.querySelector(`#cards .account[data-id="${CSS.escape(drag.id)}"]`)?.classList.add('is-dragging');
  }
  clearDropMarks();
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('#cards .account');
  if (!over || over.dataset.id === drag.id) { drag.target = null; return; }
  const box = over.getBoundingClientRect();
  drag.after = layoutOf(state.settings) === 'list' ? event.clientY > box.top + box.height / 2 : event.clientX > box.left + box.width / 2;
  drag.target = over.dataset.id;
  over.classList.add(drag.after ? 'drop-after' : 'drop-before');
});
$('#cards').addEventListener('pointerup', event => endDrag(event, false));
$('#cards').addEventListener('pointercancel', event => endDrag(event, true));
$('#cards').addEventListener('lostpointercapture', event => { if (drag.active) endDrag(event, true); });
$('#cards').addEventListener('click', event => { if (drag.ended) { event.preventDefault(); event.stopPropagation(); } }, true);
$('#cards').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.altKey && event.target.matches('[data-account]')) {
    event.preventDefault();
    return playAccount(event.target.dataset.account);
  }
  if (event.key === ' ' && event.target.matches('[data-account]') && event.target.dataset.account === state.selectedId && !busy()) {
    event.preventDefault();
    state.selectedId = toggleSelection(state.selectedId, event.target.dataset.account);
    return render();
  }
  if (!event.altKey || !event.target.matches('[data-account]') || busy() || !reorderable()) return;
  const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const id = event.target.dataset.account;
  const shown = visibleAccounts(state.accounts, { game: state.game, stats: state.stats, ...state.filters, sort: 'manual' }).map(account => account.id);
  const neighbour = shown[shown.indexOf(id) + step];
  if (!neighbour) return;
  const ids = state.accounts.map(account => account.id);
  saveOrder(moveId(ids, id, ids.indexOf(neighbour) + (step > 0 ? 1 : 0)));
});

$('#cards').addEventListener('click', event => {
  const label = event.target.closest('.account-content');
  const id = label?.closest('.account')?.dataset.id;
  if (!id || busy()) return;
  if (event.detail === 2) {
    event.preventDefault();
    return playAccount(id);
  }
  if (event.detail > 2) return event.preventDefault();
  if (id !== state.selectedId) return;
  event.preventDefault();
  state.selectedId = toggleSelection(state.selectedId, id);
  render();
});
$('#cards').addEventListener('change', event => {
  if (!event.target.matches('[data-account]') || busy()) return;
  state.selectedId = event.target.dataset.account;
  render();
});
$('#cards').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy()) return;
  if (button.dataset.action === 'clear-filters') return clearFilters();
  if (button.dataset.action === 'add') return editAccount();
  const account = state.accounts.find(item => item.id === button.closest('[data-id]')?.dataset.id);
  if (!account) return;
  if (button.dataset.action === 'edit') editAccount(account);
  if (button.dataset.action === 'pin') {
    try {
      const saved = await api.pinAccount(account.id, account.pinned !== true);
      if (saved?.id) state.accounts = state.accounts.map(item => item.id === saved.id ? saved : item);
      render();
    } catch { notice(t().pinFailed); }
  }
});
$('#delete-account').addEventListener('click', async () => {
  const account = state.editing;
  if (!account || busy()) return;
  if (!await confirmAction(t().removeTitle, t().removeText(account.gameName))) return;
  try { await api.deleteAccount(account.id); $('#account-dialog').close(); await reload(); }
  catch { $('#account-form .form-error').textContent = t().removeFailed; }
});
function playAccount(id) {
  if (busy() || !state.accounts.some(account => account.id === id)) return;
  state.selectedId = id;
  render();
  play();
}

$('#play').addEventListener('click', () => {
  if (state.operation?.status === 'running') return api.cancelSignIn().catch(() => notice(t().cancelFailed));
  play();
});

async function play() {
  const account = state.accounts.find(item => item.id === state.selectedId);
  if (busy() || !account?.hasPassword) return;
  const game = state.game;
  try {
    state.submitting = true; render(); notice();
    const running = await api.runningGames();
    if (['lol', 'val', 'tft', '2xko', 'lor'].some(game => running?.[game]) && !await confirmAction(t().switchTitle, t().switchText)) return;
    const result = await api.signIn(account.id, game);
    if (!result.ok && !result.cancelled) notice(result.error || t().signInFailed);
    await reload();
  } catch { notice(t().actionFailed); }
  finally { state.submitting = false; render(); }
}

$('#game-picks').addEventListener('change', event => {
  const form = $('#account-form');
  const before = [...form.querySelectorAll('input[name=games]')].filter(input => input === event.target ? !input.checked : input.checked).map(input => input.value);
  setGames(form, toggleGame(before, event.target.name === 'games' ? event.target.value : 'all'));
});
$('#add-mode').addEventListener('click', event => { const button = event.target.closest('[data-mode]'); if (button) setAddMode(button.dataset.mode); });
$('#use-seen').addEventListener('click', () => {
  if (!state.seenAccount) return;
  const form = $('#account-form');
  form.elements.riotId.value = `${state.seenAccount.gameName}#${state.seenAccount.tagLine}`;
  form.elements.username.focus();
});

function shared(form) {
  return { region: form.elements.region.value, games: chosenGames(form) };
}

async function addBatch(form) {
  const text = t();
  const { accounts, errors, tooMany } = parseBatch(form.elements.batch.value, shared(form));
  if (errors.length) throw new Error(text.batchInvalid(errors));
  if (!accounts.length) throw new Error(text.batchEmpty);
  if (tooMany) throw new Error(text.batchTooMany);
  try { await api.addAccounts(accounts); }
  catch { throw new Error(text.batchFailed); }
  return text.batchAdded(accounts.length);
}

$('#account-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    if (state.addMode === 'batch') {
      const message = await addBatch(form);
      $('#account-dialog').close(); await reload(); notice(message);
      return;
    }
    const split = form.elements.riotId.value.trim().lastIndexOf('#');
    if (split < 1) throw new Error(t().riotIdInvalid);
    const previous = state.editing;
    const input = { gameName: form.elements.riotId.value.trim().slice(0, split), tagLine: form.elements.riotId.value.trim().slice(split + 1), username: form.elements.username.value.trim(), valRegion: previous?.valRegion || '', note: previous?.note || '', lastSeason: previous?.lastSeason || {}, ban: previous?.ban || null, ...shared(form) };
    if (previous) input.id = previous.id;
    if (form.elements.password.value) input.password = form.elements.password.value;
    try { await api.saveAccount(input); }
    catch { throw new Error(t().saveAccountFailed); }
    $('#account-dialog').close(); await reload();
  } catch (error) { form.querySelector('.form-error').textContent = error.message || t().saveAccountFailed; }
  finally { form.elements.password.value = ''; submit.disabled = false; }
});

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const input = { refreshMinutes: Number(form.elements.refreshMinutes.value), staySignedIn: form.elements.staySignedIn.checked, uiSounds: form.elements.uiSounds.checked, language: form.elements.language.value === 'en' ? 'en' : 'pt' };
    const saved = await api.saveSettings(input); state.settings = { ...state.settings, ...saved }; $('#settings-dialog').close(); render(); await api.refresh(); await reload();
  } catch { form.querySelector('.form-error').textContent = t().saveSettingsFailed; }
  finally { submit.disabled = false; }
});

async function saveView(key, value) {
  const previous = state.settings[key];
  state.settings = { ...state.settings, [key]: value };
  render();
  try { const saved = await api.saveSettings({ [key]: value }); state.settings = { ...state.settings, [key]: saved[key] }; render(); }
  catch { state.settings = { ...state.settings, [key]: previous }; notice(t().saveSettingsFailed); render(); }
}

$('#search').addEventListener('input', event => { state.filters.query = event.target.value; render(); });
$('#search').addEventListener('keydown', event => { if (event.key === 'Escape' && event.target.value) { event.preventDefault(); event.stopPropagation(); clearFilters(); } });
$('#filter-region').addEventListener('change', event => { state.filters.region = event.target.value; render(); });
$('#filter-tier').addEventListener('change', event => { state.filters.tier = event.target.value; render(); });
$('#sort').addEventListener('change', event => { if (SORTS.includes(event.target.value) && !busy()) saveView('cardSort', event.target.value); });
$('#add-account').addEventListener('click', () => { if (!busy()) editAccount(); });
$('#settings').addEventListener('click', () => { const form = $('#settings-form'); form.reset(); form.querySelector('.form-error').textContent = ''; form.elements.refreshMinutes.value = state.settings.refreshMinutes ?? 30; form.elements.staySignedIn.checked = state.settings.staySignedIn !== false; form.elements.uiSounds.checked = state.settings.uiSounds !== false; form.elements.language.value = state.settings.language === 'en' ? 'en' : 'pt'; $('#settings-dialog').showModal(); });
$('#refresh').addEventListener('click', () => { if (state.refreshing) return; state.refreshing = true; notice(); render(); api.refresh().catch(() => { state.refreshing = false; notice(t().refreshFailed); render(); }); });
$('#games').addEventListener('click', event => {
  const button = event.target.closest('[data-game]');
  if (!button || busy() || !GAME_NAMES[button.dataset.game]) return;
  state.game = button.dataset.game;
  if (GAME_QUEUES[state.game] && state.stats !== state.game) { state.stats = state.game; state.filters.tier = ''; }
  render();
});
$('#layout').addEventListener('click', event => {
  const layout = event.target.closest('[data-layout]')?.dataset.layout;
  if (!LAYOUTS.includes(layout) || busy() || layout === layoutOf(state.settings)) return;
  saveView('cardLayout', layout);
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => { for (const input of dialog.querySelectorAll('input[type=password], textarea[name=batch]')) input.value = ''; });
$('#riot-minimize').addEventListener('click', () => { api.minimizeRiot().catch(() => {}); });
$('#riot-close').addEventListener('click', () => { api.closeRiot().catch(() => {}); });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || $('#toolbar').hidden || document.querySelector('dialog[open]')) return;
  if (startsSearch(event, Boolean(event.target.closest?.('input:not([type=radio]):not([type=checkbox]), select, textarea')))) $('#search').focus();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
api.onAccountUpdated(account => { const index = state.accounts.findIndex(item => item.id === account.id); if (index >= 0) state.accounts[index] = account; else state.accounts.push(account); notice(); render(); });
api.onSignInOperation(operation => { state.operation = operation; render(); });
api.onRefreshProgress(progress => { state.refreshing = progress.done < progress.total; if (state.refreshing) return render(); reload().catch(() => render()); });
setInterval(() => { $('#updated').textContent = updatedText(); }, 30000);
reload().catch(() => { render(); notice(t().loadFailed); });

document.addEventListener('mouseover', event => {
  const sound = hoverSound(event.target);
  const key = sound ? sound.host.dataset?.id || sound.host : null;
  if (sound && key !== hovered) sounds.play(sound.name);
  hovered = key;
});
document.addEventListener('click', event => { const name = clickSound(event.target); if (name) sounds.play(name); }, true);
document.addEventListener('change', event => { const name = changeSound(event.target); if (name) sounds.play(name); }, true);
