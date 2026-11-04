import { rankOf, lolCrest } from './ranks.js';

const api = window.api;
const $ = selector => document.querySelector(selector);
const state = { accounts: [], selectedId: null, game: 'lol', operation: null, regions: {}, settings: {}, editing: null, submitting: false, lastRefresh: null, refreshing: false };
const games = { lol: 'League of Legends', val: 'VALORANT' };
const queues = { lol: [['solo', 'Solo/Duo'], ['flex', 'Flex']], val: [['competitive', 'Competitivo']] };
const tiers = { CHALLENGER: 'Desafiante', GRANDMASTER: 'Grão-Mestre', MASTER: 'Mestre', DIAMOND: 'Diamante', EMERALD: 'Esmeralda', PLATINUM: 'Platina', GOLD: 'Ouro', SILVER: 'Prata', BRONZE: 'Bronze', IRON: 'Ferro' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => Number.isFinite(value) ? String(value) : '—';
const busy = () => state.submitting || state.operation?.status === 'running';
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
function updatedText() {
  if (state.refreshing) return 'atualizando…';
  const time = Date.parse(state.lastRefresh);
  if (!Number.isFinite(time)) return 'nunca atualizado';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'atualizado agora';
  if (minutes < 60) return `atualizado há ${minutes} min`;
  if (minutes < 1440) return `atualizado há ${Math.floor(minutes / 60)} h`;
  return `atualizado há ${plural(Math.floor(minutes / 1440), 'dia', 'dias')}`;
}

function notice(text = '') { $('#notice').textContent = text; $('#notice').hidden = !text; }
function render() {
  const focused = document.activeElement?.dataset.account;
  if (!state.accounts.some(account => account.id === state.selectedId)) state.selectedId = (state.accounts.find(account => account.hasPassword) || state.accounts[0])?.id || null;
  const selected = state.accounts.find(account => account.id === state.selectedId);
  $('#count').textContent = plural(state.accounts.length, 'conta', 'contas');
  $('#updated').textContent = updatedText();
  const running = state.operation?.status === 'running';
  $('#status').hidden = !running || !state.operation.needsAttention;
  $('#status-text').textContent = 'Conclua a verificação na tela da Riot para continuar.';
  for (const element of document.querySelectorAll('nav button, .footer-tools button')) element.disabled = busy();
  $('#play').disabled = running ? false : busy() || !selected?.hasPassword;
  $('#play').classList.toggle('is-cancel', running);
  $('#play').innerHTML = running ? 'Cancelar' : busy() ? 'Entrando…' : 'Jogar <span aria-hidden="true">→</span>';
  $('#selected-name').textContent = selected ? `${selected.gameName} #${selected.tagLine}` : 'Selecione uma conta';
  $('#selected-game').textContent = selected && !selected.hasPassword ? 'Adicione a senha em Editar conta para jogar.' : `${games[state.game]}${selected ? ' · ' + (state.regions[selected.region]?.label || selected.region) : ''}`;
  document.body.dataset.theme = state.game;
  for (const button of document.querySelectorAll('[data-game]')) button.setAttribute('aria-pressed', String(button.dataset.game === state.game));
  const add = `<button class="add-card" data-action="add" ${busy() ? 'disabled' : ''}><span aria-hidden="true">+</span> Adicionar conta</button>`;
  $('#cards').innerHTML = (state.accounts.length ? state.accounts.map(account => {
    const ranks = queues[state.game].map(([queue, name]) => ({ name, rank: rankOf(account, state.game, queue) }));
    const level = ranks[0].rank.level;
    const playing = state.operation?.accountId === account.id && busy();
    const index = state.accounts.indexOf(account);
    return `<article class="account ${account.id === state.selectedId ? 'is-selected' : ''} ${playing ? 'is-playing' : ''}" data-id="${esc(account.id)}">
      <input class="account-radio" type="radio" name="account" id="account-${index}" data-account="${esc(account.id)}" ${account.id === state.selectedId ? 'checked' : ''} ${busy() ? 'disabled' : ''}>
      <label class="account-content" for="account-${index}"><span class="account-head"><span class="name"><strong>${esc(account.gameName)}</strong><span class="tag">#${esc(account.tagLine)} · Nível ${number(level)}</span></span></span>
      <span class="queues">${ranks.map(queueBlock).join('')}</span></label>
      <button class="edit" data-action="edit" aria-label="Editar ${esc(account.gameName)}" title="Editar conta" ${busy() ? 'disabled' : ''}>···</button>
    </article>`;
  }).join('') : '<div class="empty"><h2>Suas contas ficam aqui</h2><p>Adicione a primeira para entrar com um clique.</p></div>') + add;
  if (focused) Array.from(document.querySelectorAll('[data-account]')).find(element => element.dataset.account === focused)?.focus({ preventScroll: true });
}

function queueBlock({ name, rank }) {
  const unranked = rank.label === 'Unranked' || rank.label === 'Unrated';
  const label = unranked ? 'Sem classificação' : state.game === 'lol' ? rank.label.replace(/^\S+/, tiers[rank.group] || rank.group) : rank.label;
  const played = Number.isFinite(rank.wins) && Number.isFinite(rank.losses) ? `${rank.wins}V ${rank.losses}D` : '';
  const record = [rank.winrate == null ? '' : `${number(rank.winrate)}%`, played].filter(Boolean).join(' · ');
  return `<span class="queue"><small class="queue-name">${esc(name)}</small><span class="rank"><img src="${esc(state.game === 'lol' ? lolCrest(rank.group) : rank.emblem)}" alt="" loading="lazy"><span><strong>${esc(label)}</strong><small>${esc(unranked ? 'Sem partidas' : rank.sub.replace(' LP', ' PdL'))}</small></span></span><span class="record">${esc(record || '—')}</span></span>`;
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
  $('#account-title').textContent = account ? 'Editar conta' : 'Adicionar conta';
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
  if (button.dataset.action === 'add') return editAccount();
  const account = state.accounts.find(item => item.id === button.closest('[data-id]').dataset.id);
  if (!account) return;
  if (button.dataset.action === 'edit') editAccount(account);
});
$('#delete-account').addEventListener('click', async () => {
  const account = state.editing;
  if (!account || busy()) return;
  if (!await confirmAction('Remover conta?', `Remover ${account.gameName} desta lista?`)) return;
  try { await api.deleteAccount(account.id); $('#account-dialog').close(); await reload(); }
  catch { $('#account-form .form-error').textContent = 'Não foi possível remover a conta.'; }
});
$('#play').addEventListener('click', async () => {
  if (state.operation?.status === 'running') return api.cancelSignIn().catch(() => notice('Não foi possível cancelar.'));
  const account = state.accounts.find(item => item.id === state.selectedId);
  if (busy() || !account?.hasPassword) return;
  const game = state.game;
  try {
    state.submitting = true; render(); notice();
    const running = await api.runningGames();
    if ((running.lol || running.val) && !await confirmAction('Trocar de conta?', 'O jogo aberto será encerrado para entrar nesta conta.')) return;
    const result = await api.signIn(account.id, game);
    if (!result.ok && !result.cancelled) notice(result.error || 'Não foi possível entrar na conta.');
    await reload();
  } catch { notice('Não foi possível concluir a ação. Tente novamente.'); }
  finally { state.submitting = false; render(); }
});

$('#account-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector('[type=submit]');
  const split = form.elements.riotId.value.trim().lastIndexOf('#');
  if (split < 1) { form.querySelector('.form-error').textContent = 'Informe o nome com a tag: Nome#BR1.'; return; }
  submit.disabled = true;
  try {
    const previous = state.editing;
    const input = { gameName: form.elements.riotId.value.trim().slice(0, split), tagLine: form.elements.riotId.value.trim().slice(split + 1), username: form.elements.username.value.trim(), region: form.elements.region.value, valRegion: previous?.valRegion || '', note: previous?.note || '', lastSeason: previous?.lastSeason || {}, ban: previous?.ban || null };
    if (previous) input.id = previous.id;
    if (form.elements.password.value) input.password = form.elements.password.value;
    await api.saveAccount(input);
    $('#account-dialog').close(); await reload();
  } catch { form.querySelector('.form-error').textContent = 'Não foi possível salvar. Confira os dados da conta.'; }
  finally { form.elements.password.value = ''; submit.disabled = false; }
});

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const input = { refreshMinutes: Number(form.elements.refreshMinutes.value), staySignedIn: form.elements.staySignedIn.checked };
    for (const key of ['riotApiKey', 'henrikApiKey']) if (form.elements[key].value.trim()) input[key] = form.elements[key].value.trim();
    await api.saveSettings(input); $('#settings-dialog').close(); await api.refresh(); await reload();
  } catch { form.querySelector('.form-error').textContent = 'Não foi possível salvar as configurações.'; }
  finally { for (const key of ['riotApiKey', 'henrikApiKey']) form.elements[key].value = ''; submit.disabled = false; }
});

$('#settings').addEventListener('click', () => { const form = $('#settings-form'); form.reset(); form.querySelector('.form-error').textContent = ''; form.elements.refreshMinutes.value = state.settings.refreshMinutes ?? 30; form.elements.staySignedIn.checked = state.settings.staySignedIn !== false; $('#settings-dialog').showModal(); });
$('#refresh').addEventListener('click', () => { if (state.refreshing) return; state.refreshing = true; notice(); render(); api.refresh().catch(() => { state.refreshing = false; notice('Não foi possível atualizar.'); render(); }); });
$('#games').addEventListener('click', event => { const button = event.target.closest('[data-game]'); if (!button || busy() || !games[button.dataset.game]) return; state.game = button.dataset.game; render(); });
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => { for (const input of dialog.querySelectorAll('input[type=password]')) input.value = ''; });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
api.onAccountUpdated(account => { const index = state.accounts.findIndex(item => item.id === account.id); if (index >= 0) state.accounts[index] = account; else state.accounts.push(account); notice(); render(); });
api.onSignInOperation(operation => { state.operation = operation; render(); });
api.onRefreshProgress(progress => { state.refreshing = progress.done < progress.total; if (state.refreshing) return render(); reload().catch(() => render()); });
setInterval(() => { $('#updated').textContent = updatedText(); }, 30000);
reload().catch(() => notice('Não foi possível carregar as contas. Reinicie o gerenciador.'));
