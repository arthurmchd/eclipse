use super::riot_overlay::{round, Rect, Size};

pub const COMMAND: &str = "overlay_toggle";
pub const TOGGLE_AREA: (f64, f64, f64, f64) = (200.0 / 1536.0, 418.0 / 864.0, 344.0 / 1536.0, 450.0 / 864.0);

pub fn toggle_rect(size: Size) -> Rect {
    let (left, top, right, bottom) = TOGGLE_AREA;
    let x = round(size.width as f64 * left);
    let y = round(size.height as f64 * top);
    Rect::new(x, y, (round(size.width as f64 * right) - x).max(1), (round(size.height as f64 * bottom) - y).max(1))
}

pub fn language_script(language: &str) -> &'static str {
    if language == "en" {
        "window.__eclipseToggle && window.__eclipseToggle.language('en')"
    } else {
        "window.__eclipseToggle && window.__eclipseToggle.language('pt')"
    }
}

pub fn hidden_script(hidden: bool) -> &'static str {
    if hidden {
        "window.__eclipseToggle && window.__eclipseToggle.hidden(true)"
    } else {
        "window.__eclipseToggle && window.__eclipseToggle.hidden(false)"
    }
}

pub const INIT_SCRIPT: &str = r#"(() => {
  const listeners = { language: new Set(), hidden: new Set() };
  const current = { language: null, hidden: null };
  const deliver = (name, value) => {
    current[name] = value;
    for (const callback of listeners[name]) { try { callback(value); } catch {} }
  };
  const listen = (name) => (callback) => {
    if (typeof callback !== 'function') return;
    listeners[name].add(callback);
    if (current[name] !== null) { try { callback(current[name]); } catch {} }
  };
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  Object.defineProperty(window, '__eclipseToggle', { value: Object.freeze({
    language: (value) => deliver('language', value === 'en' ? 'en' : 'pt'),
    hidden: (value) => deliver('hidden', value === true),
  }) });
  Object.defineProperty(window, 'toggle', { value: Object.freeze({
    setHidden: (hidden) => invoke('overlay_toggle', { hidden: hidden === true }),
    onLanguage: listen('language'),
    onHidden: listen('hidden'),
  }) });
})();
"#;
