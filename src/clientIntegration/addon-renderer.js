// RAM_LOGIN_INTEGRATION_V1 — appended to the Riot Client renderer entry point.
;(() => {
  'use strict';
  const marker = Symbol.for('riot-account-manager.renderer.v1');
  if (globalThis[marker]) return;
  globalThis[marker] = true;
  const HOST_ID = 'ram-login-account-panel-v1';
  let host, root, list, status, signInButton, cancelButton, refreshButton, gameSelect, body, toggle;
  let timer = null, observer = null, scanTimer = null, refreshing = false, pending = false, destroyed = false;
  let accounts = [], operation = null, selectedId = '', lastAccounts = '', collapsed = window.innerWidth < 850;

  function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function button(text, handler, className) {
    const item = element('button', text, className);
    item.type = 'button';
    item.addEventListener('click', handler);
    return item;
  }
  function errorText(value) {
    if (value === 'Open Riot Account Manager to connect') return 'Abra o Riot Account Manager para conectar.';
    return typeof value === 'string' && value ? value.slice(0, 512) : 'Não foi possível conectar ao gerenciador.';
  }
  function showStatus(text, error = false) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function updateControls() {
    const busy = pending || operation?.status === 'running';
    signInButton.disabled = busy || !accounts.some((account) => account.id === selectedId && account.hasPassword);
    gameSelect.disabled = busy;
    cancelButton.hidden = !busy;
    cancelButton.disabled = pending;
    for (const item of list.querySelectorAll('button[data-account-id]')) {
      item.disabled = busy || !accounts.find((account) => account.id === item.dataset.accountId)?.hasPassword;
      item.setAttribute('aria-selected', String(item.dataset.accountId === selectedId));
    }
  }
  function renderAccounts() {
    const signature = JSON.stringify(accounts);
    if (signature !== lastAccounts) {
      lastAccounts = signature;
      list.replaceChildren();
      if (!accounts.some((account) => account.id === selectedId && account.hasPassword)) selectedId = accounts.find((account) => account.hasPassword)?.id || '';
      if (!accounts.length) list.append(element('p', 'Adicione suas contas no gerenciador para entrar por aqui.', 'empty'));
      for (const account of accounts) {
        const item = button('', () => { selectedId = account.id; updateControls(); }, 'account');
        item.dataset.accountId = account.id;
        item.setAttribute('role', 'option');
        item.append(element('strong', `${account.gameName}#${account.tagLine}`));
        item.append(element('small', account.hasPassword ? (account.hasSession ? 'Sessão salva' : 'Login automático') : 'Adicione a senha no gerenciador'));
        list.append(item);
      }
    }
    updateControls();
  }
  async function call(method, ...args) {
    const api = window.riotAccountManager;
    if (!api || typeof api[method] !== 'function') throw new Error('Abra o Riot Account Manager para conectar.');
    const result = await api[method](...args);
    if (!result?.ok) throw new Error(errorText(result?.error));
    return result;
  }
  async function refresh() {
    if (refreshing || destroyed || !host || host.hidden) return;
    refreshing = true;
    refreshButton.disabled = true;
    try {
      const value = await call('state');
      if (destroyed) return;
      accounts = Array.isArray(value.accounts) ? value.accounts : [];
      operation = value.operation || null;
      renderAccounts();
      if (operation?.status === 'running') {
        showStatus(operation.needsAttention ? `${operation.text || 'A Riot precisa de sua atenção.'} Conclua a verificação no cliente.` : operation.text || 'Entrando na conta…');
      } else if (operation?.status === 'failed') showStatus(operation.error || operation.text || 'Não foi possível entrar na conta.', true);
      else if (operation?.status === 'succeeded') showStatus('Jogo aberto na conta selecionada.');
      else if (operation?.status === 'cancelled') showStatus('Login cancelado.');
      else showStatus('Escolha uma conta para entrar e abrir o jogo.');
    } catch (error) {
      if (destroyed) return;
      accounts = []; operation = null;
      renderAccounts();
      showStatus(errorText(error.message), true);
    } finally {
      refreshing = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  }
  async function signIn() {
    if (pending || operation?.status === 'running' || !selectedId) return;
    pending = true;
    updateControls();
    showStatus('Solicitando login…');
    try {
      await call('signIn', selectedId, gameSelect.value);
      operation = { status: 'running', text: 'Entrando em segundo plano…', accountId: selectedId };
      showStatus(operation.text);
    } catch (error) { showStatus(errorText(error.message), true); }
    finally { pending = false; updateControls(); }
  }
  async function cancel() {
    if (pending) return;
    pending = true;
    updateControls();
    try { await call('cancel'); showStatus('Cancelando login…'); }
    catch (error) { showStatus(errorText(error.message), true); }
    finally { pending = false; updateControls(); }
  }
  async function openManager() {
    try { await call('openManager'); }
    catch (error) { showStatus(errorText(error.message), true); }
  }
  function mount() {
    if (host || destroyed) return;
    host = element('aside');
    host.id = HOST_ID;
    host.setAttribute('aria-label', 'Contas salvas do Riot Account Manager');
    host.hidden = true;
    // Inline host rules also keep the panel out of the League/Riot layout flow.
    host.style.cssText = 'position:fixed;right:24px;top:76px;width:min(310px,calc(100vw - 32px));max-height:calc(100vh - 112px);z-index:2147483000;pointer-events:auto;';
    root = host.attachShadow({ mode: 'closed' });
    const style = element('style');
    style.textContent = `
      :host{color:#ece8e1;font:14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;color-scheme:dark;}
      *{box-sizing:border-box;}[hidden]{display:none!important;}button,select{font:inherit;}button{cursor:pointer;}button:disabled,select:disabled{opacity:.45;cursor:default;}
      .panel{background:rgba(20,23,28,.97);border:1px solid #535057;border-radius:12px;box-shadow:0 12px 40px #0008;overflow:hidden;}
      .head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;gap:12px;}.head strong{font-size:14px;letter-spacing:.03em;}.toggle{color:#aaa6a0;border:0;background:none;padding:4px 0;font-size:12px;}
      .body{display:grid;gap:12px;padding:0 16px 16px;max-height:calc(100vh - 180px);overflow:auto;}.intro,.status{font-size:12px;color:#aaa6a0;margin:0;overflow-wrap:anywhere;}.status{min-height:34px;color:#dad5ce;}.status.error{color:#ffb3a8;}
      .list{display:grid;gap:8px;max-height:260px;overflow:auto;}.account{display:grid;text-align:left;padding:11px 12px;border:1px solid #47454c;border-radius:7px;background:#25282e;color:#f0ebe5;gap:3px;}.account strong{font-size:13px;overflow-wrap:anywhere;}.account small{color:#aaa6a0;font-size:11px;}.account[aria-selected=true]{border-color:#dc554e;background:#3d292b;}.account:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid #ed766e;outline-offset:2px;}
      .empty{color:#aaa6a0;font-size:12px;margin:0;}.game{display:grid;gap:5px;font-size:12px;color:#bfb9b1;}.game select{width:100%;border:1px solid #47454c;border-radius:5px;background:#25282e;color:#ece8e1;padding:8px;}
      .actions{display:flex;gap:8px;}.primary{flex:1;border:0;border-radius:5px;background:#d7433e;color:white;padding:10px 12px;font-weight:650;}.secondary{border:1px solid #535057;border-radius:5px;background:transparent;color:#ece8e1;padding:8px 10px;font-size:12px;}.foot{display:flex;justify-content:space-between;gap:8px;}.foot button{border:0;background:none;color:#bfb9b1;padding:2px 0;font-size:11px;text-decoration:underline;}
      @media(max-width:850px){.body{max-height:calc(100vh - 160px);}.list{max-height:180px;}}
    `;
    root.append(style);
    const panel = element('section', undefined, 'panel');
    const head = element('header', undefined, 'head');
    head.append(element('strong', 'MINHAS CONTAS'));
    toggle = button(collapsed ? 'Expandir' : 'Recolher', () => {
      collapsed = !collapsed;
      body.hidden = collapsed;
      toggle.textContent = collapsed ? 'Expandir' : 'Recolher';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    }, 'toggle');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    head.append(toggle); panel.append(head);
    body = element('div', undefined, 'body'); body.hidden = collapsed;
    body.append(element('p', 'Entre com uma conta salva no gerenciador.', 'intro'));
    list = element('div', undefined, 'list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Contas salvas'); body.append(list);
    const gameLabel = element('label', undefined, 'game'); gameLabel.append(element('span', 'Abrir jogo'));
    gameSelect = element('select');
    for (const [value, label] of [['lol', 'League of Legends'], ['tft', 'Teamfight Tactics'], ['val', 'VALORANT']]) {
      const option = element('option', label); option.value = value; gameSelect.append(option);
    }
    gameLabel.append(gameSelect); body.append(gameLabel);
    status = element('p', 'Conectando ao gerenciador…', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); body.append(status);
    const actions = element('div', undefined, 'actions');
    signInButton = button('Entrar e jogar', signIn, 'primary'); signInButton.disabled = true;
    cancelButton = button('Cancelar', cancel, 'secondary'); cancelButton.hidden = true;
    actions.append(signInButton, cancelButton); body.append(actions);
    const foot = element('div', undefined, 'foot');
    foot.append(button('Gerenciar contas', openManager));
    refreshButton = button('Atualizar estado', refresh); foot.append(refreshButton); body.append(foot);
    panel.append(body); root.append(panel); document.body.append(host);
  }
  function loginVisible() {
    // These selectors match the installed v141 LoginForm, excluding account
    // creation/password-change forms that can also render a password input.
    for (const input of document.querySelectorAll('[data-testid="login-form"] input[name="password"],.login-form input[type="password"],[data-testid="login-form"] input[autocomplete="current-password"]')) {
      const rect = input.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      let hidden = false;
      for (let current = input; current; current = current.parentElement) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) { hidden = true; break; }
      }
      if (!hidden) return true;
    }
    return false;
  }
  function scan() {
    scanTimer = null;
    if (destroyed || !document.body) return;
    mount();
    const visible = loginVisible();
    if (host.hidden !== !visible) host.hidden = !visible;
    if (visible && !timer) { refresh(); timer = window.setInterval(refresh, 1000); }
    if (!visible && timer) { window.clearInterval(timer); timer = null; }
  }
  function scheduleScan() {
    if (!scanTimer && !destroyed) scanTimer = window.setTimeout(scan, 100);
  }
  function start() {
    if (destroyed) return;
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden', 'aria-hidden'] });
    window.addEventListener('resize', scheduleScan);
    scan();
  }
  window.addEventListener('beforeunload', () => {
    destroyed = true;
    if (timer) window.clearInterval(timer);
    if (scanTimer) window.clearTimeout(scanTimer);
    observer?.disconnect();
    window.removeEventListener('resize', scheduleScan);
  }, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
