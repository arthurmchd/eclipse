use std::sync::{Arc, Mutex, Weak};

use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::{json, Map, Value};

use super::opgg;
use super::store::{ApiKeys, Store};
use super::timers::Timers;

pub const MIN_DELAY_MS: i64 = 5000;
pub const STARTUP_GRACE_MS: i64 = 1000;
pub const FOLLOW_UP_MS: u64 = 8000;
pub const FAILED: &str = "Rank update could not finish";

pub trait RefreshStore: Send + Sync {
    fn accounts(&self) -> Vec<Map<String, Value>>;
    fn keys(&self) -> ApiKeys;
    fn refresh_minutes(&self) -> f64;
    fn last_refresh(&self) -> Option<String>;
    fn update(&self, id: &str, fields: Map<String, Value>) -> Result<Option<Map<String, Value>>, String>;
    fn finished(&self, at: &str) -> Result<(), String>;
    fn log(&self, line: &str);
}

impl RefreshStore for Mutex<Store> {
    fn accounts(&self) -> Vec<Map<String, Value>> {
        self.lock().unwrap().list_accounts()
    }

    fn keys(&self) -> ApiKeys {
        self.lock().unwrap().get_keys()
    }

    fn refresh_minutes(&self) -> f64 {
        self.lock().unwrap().data.settings.get("refreshMinutes").and_then(Value::as_f64).filter(|minutes| minutes.is_finite()).unwrap_or(0.0)
    }

    fn last_refresh(&self) -> Option<String> {
        self.lock().unwrap().data.last_refresh.clone()
    }

    fn update(&self, id: &str, fields: Map<String, Value>) -> Result<Option<Map<String, Value>>, String> {
        self.lock().unwrap().update_account_fields(id, fields)
    }

    fn finished(&self, at: &str) -> Result<(), String> {
        let mut store = self.lock().unwrap();
        store.data.last_refresh = Some(at.to_string());
        store.save()
    }

    fn log(&self, line: &str) {
        self.lock().unwrap().log(line);
    }
}

pub type AccountRefresh = Box<dyn Fn(&Map<String, Value>, &ApiKeys) -> Map<String, Value> + Send + Sync>;
pub type Publish = Box<dyn Fn(&str, &Value) + Send + Sync>;

pub struct RefreshHooks {
    pub refresh_account: AccountRefresh,
    pub check_game: Box<dyn Fn() -> bool + Send + Sync>,
    pub publish: Publish,
    pub now: Box<dyn Fn() -> i64 + Send + Sync>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Selection {
    All,
    Some(Vec<String>),
}

impl Selection {
    fn of(ids: Option<Vec<String>>) -> Self {
        match ids {
            None => Self::All,
            Some(ids) => {
                let mut unique: Vec<String> = Vec::new();
                for id in ids {
                    if !unique.contains(&id) {
                        unique.push(id);
                    }
                }
                Self::Some(unique)
            }
        }
    }

    fn ids(self) -> Option<Vec<String>> {
        match self {
            Self::All => None,
            Self::Some(ids) => Some(ids),
        }
    }
}

#[derive(Default)]
struct State {
    running: bool,
    running_all: bool,
    queued: Option<Selection>,
    queued_manual: bool,
    follow_up: bool,
    timer: Option<u64>,
    quitting: bool,
}

struct Inner {
    store: Arc<dyn RefreshStore>,
    timers: Arc<dyn Timers>,
    hooks: RefreshHooks,
    state: Mutex<State>,
}

pub fn iso(millis: i64) -> String {
    Utc.timestamp_millis_opt(millis).single().unwrap_or_else(Utc::now).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn millis(text: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(text).ok().map(|time| time.timestamp_millis())
}

impl Inner {
    fn next_refresh_ms(&self) -> Option<i64> {
        let minutes = self.store.refresh_minutes();
        if minutes <= 0.0 {
            return None;
        }
        let last = self.store.last_refresh().as_deref().and_then(millis).unwrap_or(0);
        Some((self.hooks.now)().max(last + (minutes * 60_000.0) as i64))
    }

    fn progress(&self, done: usize, total: usize) {
        (self.hooks.publish)("refresh-progress", &json!({ "done": done, "total": total }));
    }

    fn quitting(&self) -> bool {
        self.state.lock().unwrap().quitting
    }

    fn run(&self, ids: Option<&[String]>) -> Vec<String> {
        let targets: Vec<Map<String, Value>> = self
            .store
            .accounts()
            .into_iter()
            .filter(|account| ids.is_none_or(|ids| account.get("id").and_then(Value::as_str).is_some_and(|id| ids.iter().any(|wanted| wanted == id))))
            .collect();
        let total = targets.len();
        self.progress(0, total);
        let keys = self.store.keys();
        let remote = !keys.riot.is_empty() || !keys.tft.is_empty() || !keys.henrik.is_empty();
        if !remote {
            (self.hooks.check_game)();
        }
        let mut done = 0;
        let mut failed = false;
        let mut from_opgg = Vec::new();
        for account in &targets {
            if self.quitting() {
                break;
            }
            let fields = (self.hooks.refresh_account)(account, &keys);
            let id = account.get("id").and_then(Value::as_str).unwrap_or_default();
            let opgg = fields.get("stats").and_then(|stats| stats.pointer("/lol/source")).and_then(Value::as_str) == Some(opgg::SOURCE);
            match self.store.update(id, fields) {
                Ok(Some(updated)) => {
                    if opgg {
                        from_opgg.push(id.to_string());
                    }
                    (self.hooks.publish)("account-updated", &Value::Object(updated));
                }
                Ok(None) => {}
                Err(_) => {
                    failed = true;
                    break;
                }
            }
            done += 1;
            self.progress(done, total);
        }
        if !failed && ids.is_none() && !self.quitting() && self.store.finished(&iso((self.hooks.now)())).is_err() {
            failed = true;
        }
        if failed {
            self.store.log(FAILED);
        }
        self.progress(total, total);
        from_opgg
    }

    fn request(self: &Arc<Self>, ids: Option<Vec<String>>, manual: bool) {
        let mut state = self.state.lock().unwrap();
        if state.quitting {
            return;
        }
        if !state.running {
            state.running = true;
            state.running_all = ids.is_none();
            state.follow_up = manual;
            drop(state);
            let weak = Arc::downgrade(self);
            self.timers.later(0, Box::new(move || {
                if let Some(inner) = weak.upgrade() {
                    inner.work(ids);
                }
            }));
            return;
        }
        if ids.is_none() && state.running_all {
            state.follow_up |= manual;
            return;
        }
        state.queued_manual |= manual;
        let incoming = Selection::of(ids);
        state.queued = Some(match (state.queued.take(), incoming) {
            (None, incoming) => incoming,
            (Some(_), Selection::All) | (Some(Selection::All), _) => Selection::All,
            (Some(Selection::Some(mut queued)), Selection::Some(more)) => {
                for id in more {
                    if !queued.contains(&id) {
                        queued.push(id);
                    }
                }
                Selection::Some(queued)
            }
        });
    }

    fn work(self: &Arc<Self>, ids: Option<Vec<String>>) {
        let from_opgg = self.run(ids.as_deref());
        let (queued, queued_manual, follow_up) = {
            let mut state = self.state.lock().unwrap();
            state.running = false;
            state.running_all = false;
            (state.queued.take(), std::mem::take(&mut state.queued_manual), std::mem::take(&mut state.follow_up))
        };
        self.schedule();
        if follow_up && !from_opgg.is_empty() {
            let weak = Arc::downgrade(self);
            self.timers.later(FOLLOW_UP_MS, Box::new(move || {
                if let Some(inner) = weak.upgrade() {
                    inner.request(Some(from_opgg), false);
                }
            }));
        }
        if let Some(selection) = queued {
            self.request(selection.ids(), queued_manual);
        }
    }

    fn schedule(self: &Arc<Self>) {
        let mut state = self.state.lock().unwrap();
        if let Some(timer) = state.timer.take() {
            self.timers.cancel(timer);
        }
        if state.quitting {
            return;
        }
        let next = self.next_refresh_ms();
        (self.hooks.publish)("next-refresh", &next.map(iso).map(Value::String).unwrap_or(Value::Null));
        if let Some(next) = next {
            let delay = (next - (self.hooks.now)()).max(MIN_DELAY_MS) as u64;
            let weak: Weak<Inner> = Arc::downgrade(self);
            state.timer = Some(self.timers.later(delay, Box::new(move || {
                if let Some(inner) = weak.upgrade() {
                    inner.request(None, false);
                }
            })));
        }
    }
}

pub struct Refresher {
    inner: Arc<Inner>,
}

impl Refresher {
    pub fn new(store: Arc<dyn RefreshStore>, timers: Arc<dyn Timers>, hooks: RefreshHooks) -> Self {
        Self { inner: Arc::new(Inner { store, timers, hooks, state: Mutex::new(State::default()) }) }
    }

    pub fn start(&self) {
        let due = self.inner.next_refresh_ms().is_some_and(|next| next <= (self.inner.hooks.now)() + STARTUP_GRACE_MS);
        if due && !self.inner.store.accounts().is_empty() {
            self.inner.request(None, false);
        } else {
            self.inner.schedule();
        }
    }

    pub fn request(&self, ids: Option<Vec<String>>) {
        self.inner.request(ids, true);
    }

    pub fn schedule(&self) {
        self.inner.schedule();
    }

    pub fn next_refresh(&self) -> Value {
        self.inner.next_refresh_ms().map(iso).map(Value::String).unwrap_or(Value::Null)
    }

    pub fn last_refresh(&self) -> Value {
        self.inner.store.last_refresh().map(Value::String).unwrap_or(Value::Null)
    }

    pub fn stop(&self) {
        let mut state = self.inner.state.lock().unwrap();
        state.quitting = true;
        if let Some(timer) = state.timer.take() {
            self.inner.timers.cancel(timer);
        }
    }
}
