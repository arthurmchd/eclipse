export const ORDER = ['prepare', 'sign_in', 'verify', 'launch'];
export const GAMES = {
  lol: 'League of Legends',
  tft: 'Teamfight Tactics',
  val: 'VALORANT',
  '2xko': '2XKO',
  lor: 'Legends of Runeterra',
  riot: 'Riot Client',
};
export const TEXT = {
  pt: {
    title: 'Entrando na conta',
    prepare: 'Preparar a Riot',
    sign_in: 'Entrar na conta',
    verify: 'Conferir a conta',
    launch: (game) => game === 'riot' ? 'Abrir a Riot' : `Abrir o ${GAMES[game]}`,
    finished: { prepare: 'Riot pronta', sign_in: 'Conta conectada', verify: 'Riot ID conferido', launch: (game) => game === 'riot' ? 'Riot aberta' : 'Jogo aberto' },
  },
  en: {
    title: 'Signing in',
    prepare: 'Prepare Riot',
    sign_in: 'Sign in to the account',
    verify: 'Check the account',
    launch: (game) => game === 'riot' ? 'Open Riot' : `Open ${GAMES[game]}`,
    finished: { prepare: 'Riot ready', sign_in: 'Signed in', verify: 'Riot ID checked', launch: (game) => game === 'riot' ? 'Riot opened' : 'Game opened' },
  },
};

const pick = (entry, game) => typeof entry === 'function' ? entry(game) : entry;

export const coverView = (steps, language) => {
  const text = TEXT[language] || TEXT.pt;
  const game = Object.hasOwn(GAMES, steps?.game) ? steps.game : 'lol';
  const reached = steps?.step === 'done' ? ORDER.length : Math.max(0, ORDER.indexOf(steps?.step));
  const detail = typeof steps?.detail === 'string' ? steps.detail : '';
  return {
    title: text.title,
    game: GAMES[game],
    rows: ORDER.map((name, index) => {
      const state = index < reached ? 'done' : index === reached ? 'current' : 'next';
      const shown = state === 'done' ? pick(text.finished[name], game) : state === 'current' ? detail : '';
      return { state, number: String(index + 1), label: pick(text[name], game), detail: shown };
    }),
  };
};

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const start = (bridge) => {
  const view = { language: 'pt', steps: null };
  const $ = (id) => document.getElementById(id);
  const logo = $('riot-logo');
  const drop = () => { logo.hidden = true; };
  logo.addEventListener('error', drop);
  if (logo.complete && logo.naturalWidth === 0) drop();
  const render = () => {
    document.documentElement.lang = view.language === 'en' ? 'en' : 'pt-BR';
    $('waiting').hidden = !!view.steps;
    $('steps').hidden = !view.steps;
    if (!view.steps) return;
    const shown = coverView(view.steps, view.language);
    $('title').textContent = shown.title;
    $('game').textContent = shown.game;
    $('list').replaceChildren(...shown.rows.map((row) => {
      const item = element('li', row.state);
      const rail = element('span', 'rail');
      rail.append(element('span', 'mark', row.number), element('span', 'line'));
      const body = element('span', 'body');
      body.append(element('span', 'label', row.label));
      if (row.detail) body.append(element('span', 'detail', row.detail));
      item.append(rail, body);
      return item;
    }));
  };
  bridge.onLanguage((language) => {
    view.language = language;
    render();
  });
  bridge.onSteps((steps) => {
    view.steps = steps;
    render();
  });
  render();
};

if (typeof window !== 'undefined' && window.cover) start(window.cover);
