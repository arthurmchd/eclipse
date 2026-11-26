use serde_json::{json, Value};

use crate::riot::sign_in_flow::{GAMES, STEPS};

pub const DETAIL_LIMIT: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverSteps {
    pub step: &'static str,
    pub game: &'static str,
    pub signed_in: bool,
    pub detail: String,
}

impl CoverSteps {
    pub fn from_operation(operation: &Value) -> Option<Self> {
        if operation.get("status").and_then(Value::as_str) != Some("running") {
            return None;
        }
        let pick = |key: &str, list: &[&'static str], fallback: &'static str| {
            operation.get(key).and_then(Value::as_str).and_then(|value| list.iter().copied().find(|item| *item == value)).unwrap_or(fallback)
        };
        let detail: String = operation.get("text").and_then(Value::as_str).unwrap_or_default().chars().filter(|c| !c.is_control()).take(DETAIL_LIMIT).collect();
        Some(Self {
            step: pick("step", &STEPS, STEPS[0]),
            game: pick("game", &GAMES, GAMES[0]),
            signed_in: operation.get("signedIn") == Some(&Value::Bool(true)),
            detail,
        })
    }

    pub fn script(&self) -> String {
        let payload = json!({ "step": self.step, "game": self.game, "signedIn": self.signed_in, "detail": self.detail });
        format!("window.__eclipseCover && window.__eclipseCover.steps({payload})")
    }
}

pub fn language_script(language: &str) -> &'static str {
    if language == "en" {
        "window.__eclipseCover && window.__eclipseCover.language('en')"
    } else {
        "window.__eclipseCover && window.__eclipseCover.language('pt')"
    }
}

pub const INIT_SCRIPT: &str = r#"(() => {
  const listeners = { language: new Set(), steps: new Set() };
  const current = { language: null, steps: null };
  const deliver = (name, value) => {
    current[name] = value;
    for (const callback of listeners[name]) { try { callback(value); } catch {} }
  };
  const listen = (name) => (callback) => {
    if (typeof callback !== 'function') return;
    listeners[name].add(callback);
    if (current[name] !== null) { try { callback(current[name]); } catch {} }
  };
  const text = (value) => typeof value === 'string' ? value : '';
  Object.defineProperty(window, '__eclipseCover', { value: Object.freeze({
    language: (value) => deliver('language', value === 'en' ? 'en' : 'pt'),
    steps: (value) => deliver('steps', Object.freeze({ step: text(value && value.step), game: text(value && value.game), signedIn: !!(value && value.signedIn), detail: text(value && value.detail) })),
  }) });
  Object.defineProperty(window, 'cover', { value: Object.freeze({
    onLanguage: listen('language'),
    onSteps: listen('steps'),
  }) });
})();
"#;
