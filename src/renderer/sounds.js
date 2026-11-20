export const SOUND_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-uikit/global/default/';

export const SOUNDS = Object.freeze({
  hoverCard: 'sfx-uikit-grid-hover.ogg',
  pickCard: 'sfx-uikit-grid-click.ogg',
  hoverPlay: 'sfx-uikit-button-gold-hover.ogg',
  play: 'sfx-uikit-button-gold-click.ogg',
  hoverButton: 'sfx-uikit-button-generic-hover.ogg',
  click: 'sfx-uikit-click-generic.ogg',
  select: 'sfx-uikit-dropdown-click.ogg',
  check: 'sfx-uikit-checkbox-click.ogg',
});

const HOVERS = [['#play', 'hoverPlay'], ['.plate-card, .list-card', 'hoverCard'], ['#games button, .view-bar button', 'hoverButton']];

export function hoverSound(target) {
  for (const [selector, name] of HOVERS) {
    const host = target?.closest?.(selector);
    if (host) return host.disabled ? null : { host, name };
  }
  return null;
}

export function clickSound(target) {
  const element = target?.closest?.('#play, .account-content, button');
  if (!element || element.disabled) return null;
  if (element.matches('#play')) return element.classList.contains('is-cancel') ? 'click' : 'play';
  if (element.matches('.account-content')) return 'pickCard';
  return 'click';
}

export function changeSound(target) {
  if (target?.matches?.('select')) return 'select';
  if (target?.matches?.('input[type=checkbox]')) return 'check';
  return null;
}

export function createSounds(make = src => new Audio(src)) {
  const cache = new Map();
  let enabled = false;
  return {
    setEnabled(value) { enabled = value === true; },
    get enabled() { return enabled; },
    play(name) {
      if (!enabled || !Object.hasOwn(SOUNDS, name)) return false;
      let audio = cache.get(name);
      if (!audio) {
        audio = make(SOUND_BASE + SOUNDS[name]);
        audio.volume = 0.4;
        cache.set(name, audio);
      }
      audio.currentTime = 0;
      const playing = audio.play();
      if (playing && typeof playing.catch === 'function') playing.catch(() => {});
      return true;
    },
  };
}
