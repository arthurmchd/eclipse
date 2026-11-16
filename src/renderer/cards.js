import { GAME_QUEUES, LAYOUTS, layoutOf, accountView } from './cardView.js';
import { SORTS, CARD_COLORS, sortOf, gamesOf, tagsOf, allTags, parseTags, tierOptions, visibleAccounts, canReorder, moveId, usage, parseBatch } from './cardList.js';
import { VAL_GROUPS } from './ranks.js';
import { textFor, translatePage } from './cardsText.js';

const api = window.api;
const $ = selector => document.querySelector(selector);
const state = { accounts: [], selectedId: null, game: 'lol', stats: 'lol', operation: null, regions: {}, settings: {}, editing: null, submitting: false, lastRefresh: null, refreshing: false, seenAccount: null, filters: { query: '', region: '', tier: '', tag: '' }, addMode: 'single' };
const games = { riot: 'Riot Client', lol: 'League of Legends', val: 'VALORANT' };
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
  const tags = allTags(state.accounts).filter(tag => state.accounts.some(account => tagsOf(account).some(item => item.toLowerCase() === tag.toLowerCase())));
  state.filters.tag = fillSelect($('#filter-tag'), [['', text.allTags], ...tags.map(tag => [tag, tag])], state.filters.tag);
  $('#filter-tag').hidden = !tags.length && !state.filters.tag;
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
  if (!shown.some(account => account.id === state.selectedId)) state.selectedId = (shown.find(account => account.hasPassword) || shown[0])?.id || null;
  const selected = state.accounts.find(account => account.id === state.selectedId);
  $('#count').textContent = shown.length === state.accounts.length ? text.accounts(state.accounts.length) : text.accountsShown(shown.length, state.accounts.length);
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
  for (const button of document.querySelectorAll('#layout [data-layout]')) button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  const cards = $('#cards');
  cards.dataset.view = layout;
  cards.dataset.game = state.stats;
  cards.classList.toggle('can-reorder', reorderable() && !busy());
  const now = Date.now();
  const body = shown.map((account, index) => {
    const view = { ...accountView(account, state.stats, text), pinned: account.pinned === true, tags: tagsOf(account), note: account.note || '', usage: usage(account, text, now), color: hex(account.color) ? account.color : '' };
    const playing = state.operation?.accountId === view.id && busy();
    return `<article class="account ${layout === 'list' ? 'list-card' : 'plate-card'} ${view.id === state.selectedId ? 'is-selected' : ''} ${playing ? 'is-playing' : ''} ${view.color ? 'has-color' : ''}" data-id="${esc(view.id)}" data-tier="${esc(view.accent)}" data-color="${esc(view.color)}">
      <input class="account-radio" type="radio" name="account" id="account-${index}" data-account="${esc(view.id)}" ${view.id === state.selectedId ? 'checked' : ''} ${busy() ? 'disabled' : ''}>
      <label class="account-content" for="account-${index}" ${view.note ? `title="${esc(view.note)}"` : ''}>${layout === 'list' ? row(view, text) : plate(view, text)}</label>
      <button class="pin" data-action="pin" aria-pressed="${view.pinned}" aria-label="${esc(text.pinNamed(view.name, view.pinned))}" title="${esc(view.pinned ? text.unpin : text.pin)}" ${busy() ? 'disabled' : ''}>${view.pinned ? '★' : '☆'}</button>
      <button class="edit" data-action="edit" aria-label="${esc(text.editNamed(view.name))}" title="${esc(text.editAccount)}" ${busy() ? 'disabled' : ''}>···</button>
    </article>`;
  }).join('');
  const filtered = `<div class="empty"><h2>${esc(text.noMatchTitle)}</h2><p>${esc(text.noMatchText)}</p><button type="button" data-action="clear-filters">${esc(text.clearFilters)}</button></div>`;
  const empty = `<div class="empty"><h2>${esc(text.emptyTitle)}</h2><p>${esc(text.emptyText)}</p></div>`;
  cards.innerHTML = shown.length ? (layout === 'list' ? listHead(text) : '') + body : state.accounts.length ? filtered : empty;
  for (const card of cards.querySelectorAll('[data-tier]')) {
    if (hex(card.dataset.tier)) card.style.setProperty('--tier', card.dataset.tier);
    if (hex(card.dataset.color)) card.style.setProperty('--card-color', card.dataset.color);
  }
  if (focused) Array.from(document.querySelectorAll('[data-account]')).find(element => element.dataset.account === focused)?.focus({ preventScroll: true });
}

function avatar(view, className) {
  return view.avatar ? `<img class="${className}" src="${esc(view.avatar)}" alt="" loading="lazy">` : `<span class="${className}"></span>`;
}

function who(view) {
  return `<span class="who"><strong>${esc(view.name)}</strong><span class="tag">#${esc(view.tag)}</span></span>`;
}

function chips(view, limit) {
  if (!view.tags.length) return '';
  const shown = view.tags.slice(0, limit);
  const more = view.tags.length - shown.length;
  return `<span class="chips">${shown.map(tag => `<span class="chip">${esc(tag)}</span>`).join('')}${more > 0 ? `<span class="chip more">+${more}</span>` : ''}</span>`;
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
      <span class="usage">${esc(view.usage)}</span>${chips(view, 3)}${view.note ? `<span class="note">${esc(view.note)}</span>` : ''}
      <img class="crest" src="${esc(main.crest)}" alt="" loading="lazy">
      <span class="main"><small class="queue-name">${esc(main.name)}</small><strong class="tier${main.ranked ? '' : ' none'}">${esc(main.tier)}</strong><span class="points">${esc(main.points)}</span></span>
      ${main.played ? `<span class="played">${esc(main.played)}</span>` : ''}${climb(main)}${rr(main)}${others}
    </span>`;
}

function listHead(text) {
  const columns = state.stats === 'val' ? [text.listAccount, text.queues.competitive, text.listProgress] : [text.listAccount, text.queues.solo, text.queues.flex, text.listWins];
  return `<div class="list-head" aria-hidden="true"><span class="row">${columns.map(name => `<span>${esc(name)}</span>`).join('')}</span><span></span><span></span></div>`;
}

function row(view, text) {
  const queues = [view.main, ...view.others].map(queue => `<span class="queue-cell"><img src="${esc(queue.crest)}" alt="" loading="lazy"><span><strong>${esc(queue.tier)}</strong><small>${esc([queue.ranked ? queue.points : text.noGames, queue.played].filter(Boolean).join(' · '))}</small></span></span>`).join('');
  const details = [view.level === null ? '' : `${text.level} ${view.level}`, view.usage].filter(Boolean).join(' · ');
  const head = `<span class="who-cell">${avatar(view, 'portrait')}<span><span class="who-line">${who(view)}${chips(view, 2)}</span><small>${esc(details)}</small></span></span>`;
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

function gamesChoice(account) {
  const chosen = gamesOf(account);
  return chosen.length === 1 ? chosen[0] : 'all';
}

function chosenGames(form) {
  const value = form.querySelector('input[name=games]:checked')?.value;
  return value === 'lol' || value === 'val' ? [value] : ['lol', 'val'];
}

function renderTagSuggestions() {
  const form = $('#account-form');
  const current = parseTags(form.elements.tags.value).map(tag => tag.toLowerCase());
  $('#tag-suggestions').innerHTML = allTags(state.accounts).slice(0, 12).map(tag => `<button type="button" class="chip-button" data-tag="${esc(tag)}" aria-pressed="${current.includes(tag.toLowerCase())}">${esc(tag)}</button>`).join('');
}

function renderColors(value) {
  const text = t();
  const box = $('#color-choices');
  box.innerHTML = ['', ...CARD_COLORS].map(color => `<label class="swatch ${color ? '' : 'none'}" title="${esc(color || text.noColor)}"><input type="radio" name="color" value="${esc(color)}" ${color === value ? 'checked' : ''} aria-label="${esc(color || text.noColor)}"><span data-swatch="${esc(color)}"></span></label>`).join('');
  for (const swatch of box.querySelectorAll('[data-swatch]')) if (hex(swatch.dataset.swatch)) swatch.style.setProperty('--swatch', swatch.dataset.swatch);
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
  form.elements.tags.value = tagsOf(account).join(', ');
  form.elements.note.value = account?.note || '';
  const choice = gamesChoice(account);
  for (const input of form.querySelectorAll('input[name=games]')) input.checked = input.value === choice;
  renderColors(hex(account?.color) ? account.color : '');
  renderTagSuggestions();
  $('#account-title').textContent = account ? t().editAccount : t().addAccount;
  $('#delete-account').hidden = !account;
  $('#add-mode').hidden = Boolean(account);
  if (state.seenAccount) $('#use-seen').textContent = t().useSeen(`${state.seenAccount.gameName}#${state.seenAccount.tagLine}`);
  setAddMode('single');
  $('#account-dialog').showModal();
}

function clearFilters() {
  state.filters = { query: '', region: '', tier: '', tag: '' };
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

$('#cards').addEventListener('change', event => {
  if (!event.target.matches('[data-account]') || busy()) return;
  state.selectedId = event.target.dataset.account;
  render();
});
$('#cards').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy()) return;
  if (button.dataset.action === 'clear-filters') return clearFilters();
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

$('#add-mode').addEventListener('click', event => { const button = event.target.closest('[data-mode]'); if (button) setAddMode(button.dataset.mode); });
$('#use-seen').addEventListener('click', () => {
  if (!state.seenAccount) return;
  const form = $('#account-form');
  form.elements.riotId.value = `${state.seenAccount.gameName}#${state.seenAccount.tagLine}`;
  form.elements.username.focus();
});
$('#tag-suggestions').addEventListener('click', event => {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  const form = $('#account-form');
  const tags = parseTags(form.elements.tags.value);
  const tag = button.dataset.tag;
  const kept = tags.filter(item => item.toLowerCase() !== tag.toLowerCase());
  form.elements.tags.value = (kept.length === tags.length ? [...tags, tag] : kept).join(', ');
  renderTagSuggestions();
});
$('#account-form').elements.tags.addEventListener('input', renderTagSuggestions);

function shared(form) {
  const color = form.querySelector('input[name=color]:checked')?.value || '';
  return { region: form.elements.region.value, games: chosenGames(form), tags: parseTags(form.elements.tags.value), color: hex(color) ? color.toLowerCase() : null };
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
    const input = { gameName: form.elements.riotId.value.trim().slice(0, split), tagLine: form.elements.riotId.value.trim().slice(split + 1), username: form.elements.username.value.trim(), valRegion: previous?.valRegion || '', note: form.elements.note.value.trim(), lastSeason: previous?.lastSeason || {}, ban: previous?.ban || null, ...shared(form) };
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
    const input = { refreshMinutes: Number(form.elements.refreshMinutes.value), staySignedIn: form.elements.staySignedIn.checked, language: form.elements.language.value === 'en' ? 'en' : 'pt' };
    for (const key of ['riotApiKey', 'henrikApiKey']) if (form.elements[key].value.trim()) input[key] = form.elements[key].value.trim();
    const saved = await api.saveSettings(input); state.settings = { ...state.settings, ...saved }; $('#settings-dialog').close(); render(); await api.refresh(); await reload();
  } catch { form.querySelector('.form-error').textContent = t().saveSettingsFailed; }
  finally { for (const key of ['riotApiKey', 'henrikApiKey']) form.elements[key].value = ''; submit.disabled = false; }
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
$('#filter-tag').addEventListener('change', event => { state.filters.tag = event.target.value; render(); });
$('#sort').addEventListener('change', event => { if (SORTS.includes(event.target.value) && !busy()) saveView('cardSort', event.target.value); });
$('#add-account').addEventListener('click', () => { if (!busy()) editAccount(); });
$('#settings').addEventListener('click', () => { const form = $('#settings-form'); form.reset(); form.querySelector('.form-error').textContent = ''; form.elements.refreshMinutes.value = state.settings.refreshMinutes ?? 30; form.elements.staySignedIn.checked = state.settings.staySignedIn !== false; form.elements.language.value = state.settings.language === 'en' ? 'en' : 'pt'; $('#settings-dialog').showModal(); });
$('#refresh').addEventListener('click', () => { if (state.refreshing) return; state.refreshing = true; notice(); render(); api.refresh().catch(() => { state.refreshing = false; notice(t().refreshFailed); render(); }); });
$('#games').addEventListener('click', event => {
  const button = event.target.closest('[data-game]');
  if (!button || busy() || !games[button.dataset.game]) return;
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
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
api.onAccountUpdated(account => { const index = state.accounts.findIndex(item => item.id === account.id); if (index >= 0) state.accounts[index] = account; else state.accounts.push(account); notice(); render(); });
api.onSignInOperation(operation => { state.operation = operation; render(); });
api.onRefreshProgress(progress => { state.refreshing = progress.done < progress.total; if (state.refreshing) return render(); reload().catch(() => render()); });
setInterval(() => { $('#updated').textContent = updatedText(); }, 30000);
reload().catch(() => { render(); notice(t().loadFailed); });
