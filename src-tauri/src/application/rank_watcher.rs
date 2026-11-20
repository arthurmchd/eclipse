use std::sync::{Arc, Mutex};

use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::{Map, Value};

use super::store::{account_id, account_riot_id, ServiceStore};
use super::timers::Timers;
use crate::riot::game_ranks::Reading;
use crate::riot::riot_client::RiotClient;
use crate::riot::riot_state::Look;
use crate::riot::{same_riot_id, RiotId};

pub const POLL_MS: u64 = 60_000;
pub const RESAVE_MS: i64 = 10 * 60_000;
const APEX: [&str; 3] = ["MASTER", "GRANDMASTER", "CHALLENGER"];

pub trait RankRiot: Send + Sync {
    fn look(&self) -> Look<'_>;
    fn league(&self) -> Option<Reading>;
    fn valorant(&self) -> Option<Reading>;
    fn same_riot_id(&self, a: &RiotId, b: &RiotId) -> bool {
        same_riot_id(Some(a), Some(b))
    }
}

impl RankRiot for RiotClient {
    fn look(&self) -> Look<'_> {
        RiotClient::look(self)
    }

    fn league(&self) -> Option<Reading> {
        self.game_ranks().league()
    }

    fn valorant(&self) -> Option<Reading> {
        self.game_ranks().valorant()
    }
}

fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| !value.is_null())
}

fn truthy(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::String(text) => !text.is_empty(),
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        _ => true,
    })
}

fn object(value: Option<&Value>) -> Map<String, Value> {
    value.and_then(Value::as_object).cloned().unwrap_or_default()
}

fn keep_from_key(next: Option<&Value>, previous: Option<&Value>) -> Value {
    let Some(next) = present(next) else {
        return next.cloned().unwrap_or(Value::Null);
    };
    let Some(previous) = present(previous) else {
        return next.clone();
    };
    let Some(fresh) = next.as_object() else {
        return next.clone();
    };
    let mut kept = fresh.clone();
    let tier = fresh.get("tier");
    let apex = tier.and_then(Value::as_str).is_some_and(|tier| APEX.contains(&tier));
    if let Some(cutoffs) = truthy(previous.get("cutoffs")) {
        if apex && tier == previous.get("tier") {
            kept.insert("cutoffs".into(), cutoffs.clone());
        }
    }
    if previous.get("hotStreak") == Some(&Value::Bool(true)) && fresh.get("wins") == previous.get("wins") && fresh.get("losses") == previous.get("losses") {
        kept.insert("hotStreak".into(), Value::Bool(true));
    }
    Value::Object(kept)
}

fn first_present(values: [Option<&Value>; 2]) -> Value {
    values.into_iter().find_map(present).cloned().unwrap_or(Value::Null)
}

pub fn merge_reading(stats: Option<&Value>, reading: &Reading, at: &str) -> Value {
    let before = object(stats);
    let mut next = before.clone();
    let mut errors = object(before.get("errors"));
    if let Some(lol) = &reading.lol {
        let old = object(before.get("lol"));
        let mut merged = old.clone();
        merged.insert("level".into(), first_present([lol.get("level"), old.get("level")]));
        merged.insert("iconId".into(), first_present([lol.get("iconId"), old.get("iconId")]));
        merged.insert("solo".into(), keep_from_key(lol.get("solo"), old.get("solo")));
        merged.insert("flex".into(), keep_from_key(lol.get("flex"), old.get("flex")));
        if let Some(border) = lol.get("border") {
            merged.insert("border".into(), border.clone());
        }
        merged.insert("updatedAt".into(), Value::String(at.into()));
        merged.remove("source");
        next.insert("lol".into(), Value::Object(merged));
        errors.remove("lol");
    }
    if let Some(tft) = &reading.tft {
        let old = object(before.get("tft"));
        let mut merged = old.clone();
        merged.insert("ranked".into(), keep_from_key(tft.get("ranked"), old.get("ranked")));
        merged.insert("doubleUp".into(), keep_from_key(tft.get("doubleUp"), old.get("doubleUp")));
        merged.insert("updatedAt".into(), Value::String(at.into()));
        next.insert("tft".into(), Value::Object(merged));
        errors.remove("tft");
    }
    if let Some(val) = &reading.val {
        let old = object(before.get("val"));
        let same_tier = old.get("tier") == val.get("tier");
        let mut merged = old.clone();
        merged.insert("tier".into(), val.get("tier").cloned().unwrap_or(Value::Null));
        merged.insert("tierName".into(), val.get("tierName").cloned().unwrap_or(Value::Null));
        merged.insert("rr".into(), if same_tier { first_present([old.get("rr"), None]) } else { Value::Null });
        merged.insert("lastChange".into(), if same_tier { first_present([old.get("lastChange"), None]) } else { Value::Null });
        merged.insert("level".into(), first_present([val.get("level"), old.get("level")]));
        merged.insert("card".into(), truthy(val.get("card")).or_else(|| truthy(old.get("card"))).cloned().unwrap_or(Value::Null));
        if let Some(border) = val.get("border") {
            merged.insert("border".into(), border.clone());
        }
        merged.insert("updatedAt".into(), Value::String(at.into()));
        next.insert("val".into(), Value::Object(merged));
        errors.remove("val");
    }
    errors.remove("all");
    next.insert("errors".into(), Value::Object(errors));
    Value::Object(next)
}

fn without_times(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(map.iter().filter(|(key, _)| *key != "updatedAt").map(|(key, item)| (key.clone(), without_times(item))).collect()),
        Value::Array(items) => Value::Array(items.iter().map(without_times).collect()),
        other => other.clone(),
    }
}

fn oldest_time(stats: Option<&Value>, reading: &Reading) -> Option<i64> {
    let mut oldest: Option<i64> = None;
    for (game, read) in [("lol", reading.lol.is_some()), ("tft", reading.tft.is_some()), ("val", reading.val.is_some())] {
        if !read {
            continue;
        }
        let time = stats.and_then(|stats| stats.get(game)).and_then(|block| block.get("updatedAt")).and_then(Value::as_str).and_then(|text| DateTime::parse_from_rfc3339(text).ok())?;
        let millis = time.timestamp_millis();
        oldest = Some(oldest.map_or(millis, |current| current.min(millis)));
    }
    oldest
}

fn iso(millis: i64) -> String {
    Utc.timestamp_millis_opt(millis).single().unwrap_or_else(Utc::now).to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone, Copy)]
enum Source {
    League,
    Valorant,
}

impl Source {
    fn name(self) -> &'static str {
        match self {
            Source::League => "League client",
            Source::Valorant => "Riot Client",
        }
    }
}

#[derive(Default)]
struct State {
    timer: Option<u64>,
    stopped: bool,
    last_note: Option<String>,
    last_result: bool,
}

type AccountObserver = Box<dyn Fn(&Map<String, Value>) + Send + Sync>;

pub struct RankHooks {
    pub busy: Box<dyn Fn() -> bool + Send + Sync>,
    pub log: Box<dyn Fn(&str) + Send + Sync>,
    pub on_updated: AccountObserver,
    pub on_unsaved: Box<dyn Fn(&RiotId) + Send + Sync>,
    pub now: Box<dyn Fn() -> i64 + Send + Sync>,
}

impl Default for RankHooks {
    fn default() -> Self {
        Self { busy: Box::new(|| false), log: Box::new(|_| {}), on_updated: Box::new(|_| {}), on_unsaved: Box::new(|_| {}), now: Box::new(|| Utc::now().timestamp_millis()) }
    }
}

struct Inner {
    riot: Arc<dyn RankRiot>,
    store: Arc<dyn ServiceStore>,
    timers: Arc<dyn Timers>,
    hooks: RankHooks,
    poll_ms: u64,
    resave_ms: i64,
    checking: Mutex<()>,
    state: Mutex<State>,
}

pub struct RankWatcher {
    inner: Arc<Inner>,
}

impl RankWatcher {
    pub fn new(riot: Arc<dyn RankRiot>, store: Arc<dyn ServiceStore>, timers: Arc<dyn Timers>, hooks: RankHooks, poll_ms: u64, resave_ms: i64) -> Self {
        let state = State { stopped: true, ..State::default() };
        Self { inner: Arc::new(Inner { riot, store, timers, hooks, poll_ms, resave_ms, checking: Mutex::new(()), state: Mutex::new(state) }) }
    }

    pub fn start(&self) {
        let mut state = self.inner.state.lock().unwrap();
        if !state.stopped {
            return;
        }
        state.stopped = false;
        let task = self.inner.clone();
        state.timer = Some(self.inner.timers.later(
            0,
            Box::new(move || {
                task.check();
                schedule(&task);
            }),
        ));
    }

    pub fn stop(&self) {
        let mut state = self.inner.state.lock().unwrap();
        state.stopped = true;
        if let Some(timer) = state.timer.take() {
            self.inner.timers.cancel(timer);
        }
    }

    pub fn check(&self) -> bool {
        if self.inner.stopped() {
            return false;
        }
        self.inner.check()
    }
}

fn schedule(inner: &Arc<Inner>) {
    let mut state = inner.state.lock().unwrap();
    if let Some(timer) = state.timer.take() {
        inner.timers.cancel(timer);
    }
    if state.stopped {
        return;
    }
    let task = inner.clone();
    state.timer = Some(inner.timers.later(
        inner.poll_ms,
        Box::new(move || {
            task.check();
            schedule(&task);
        }),
    ));
}

impl Inner {
    fn stopped(&self) -> bool {
        self.state.lock().unwrap().stopped
    }

    fn note(&self, line: &str) {
        let mut state = self.state.lock().unwrap();
        if state.last_note.as_deref() == Some(line) {
            return;
        }
        state.last_note = Some(line.to_string());
        drop(state);
        (self.hooks.log)(line);
    }

    fn owner(&self, riot_id: &RiotId) -> Option<Map<String, Value>> {
        let found: Vec<Map<String, Value>> = self.store.accounts().into_iter().filter(|account| self.riot.same_riot_id(riot_id, &account_riot_id(account))).collect();
        (found.len() == 1).then(|| found.into_iter().next().unwrap())
    }

    fn apply(&self, reading: Option<Reading>, source: Source) -> bool {
        if self.stopped() {
            return false;
        }
        let Some(reading) = reading else {
            self.note(&format!("game ranks: could not read the ranks from the {}", source.name()));
            return false;
        };
        let Some(account) = self.owner(&reading.riot_id) else {
            (self.hooks.on_unsaved)(&reading.riot_id);
            self.note(&format!("game ranks: the {} is signed in to an account that is not saved in Eclipse", source.name()));
            return false;
        };
        let now = (self.hooks.now)();
        let before = account.get("stats");
        let stats = merge_reading(before, &reading, &iso(now));
        let changed = without_times(&stats) != without_times(before.unwrap_or(&Value::Object(Map::new())));
        let fresh = oldest_time(before, &reading).is_some_and(|oldest| now - oldest < self.resave_ms);
        if !changed && fresh {
            return false;
        }
        let mut fields = Map::new();
        fields.insert("stats".into(), stats);
        match self.store.update_account_fields(&account_id(&account), fields) {
            Ok(Some(updated)) => (self.hooks.on_updated)(&updated),
            Ok(None) => {}
            Err(_) => {
                self.note("game ranks: could not check the running games");
                return false;
            }
        }
        self.note(&format!("game ranks: updated a saved account from the {}", source.name()));
        true
    }

    fn run(&self) -> bool {
        if (self.hooks.busy)() {
            return false;
        }
        let processes = match self.riot.look().processes() {
            Ok(processes) => processes,
            Err(_) => {
                self.note("game ranks: could not check the running games");
                return false;
            }
        };
        let mut updated = false;
        if processes.lol && !(self.hooks.busy)() {
            updated = self.apply(self.riot.league(), Source::League) || updated;
        }
        if processes.val && !(self.hooks.busy)() {
            updated = self.apply(self.riot.valorant(), Source::Valorant) || updated;
        }
        updated
    }

    fn check(&self) -> bool {
        match self.checking.try_lock() {
            Ok(_guard) => {
                let result = self.run();
                self.state.lock().unwrap().last_result = result;
                result
            }
            Err(_) => {
                drop(self.checking.lock());
                self.state.lock().unwrap().last_result
            }
        }
    }
}
