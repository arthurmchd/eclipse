use std::sync::{Arc, Mutex};

use eclipse::application::refresher::{iso, RefreshHooks, RefreshStore, Refresher, FAILED, MIN_DELAY_MS};
use eclipse::application::store::ApiKeys;
use serde_json::{json, Map, Value};

use super::ManualTimers;

const NOW: i64 = 1_793_970_000_000;

struct Store {
    accounts: Vec<Map<String, Value>>,
    keys: ApiKeys,
    minutes: Mutex<f64>,
    last: Mutex<Option<String>>,
    failing: Mutex<Vec<String>>,
    logs: Mutex<Vec<String>>,
}

impl RefreshStore for Store {
    fn accounts(&self) -> Vec<Map<String, Value>> {
        self.accounts.clone()
    }

    fn keys(&self) -> ApiKeys {
        self.keys.clone()
    }

    fn refresh_minutes(&self) -> f64 {
        *self.minutes.lock().unwrap()
    }

    fn last_refresh(&self) -> Option<String> {
        self.last.lock().unwrap().clone()
    }

    fn update(&self, id: &str, fields: Map<String, Value>) -> Result<Option<Map<String, Value>>, String> {
        if self.failing.lock().unwrap().iter().any(|failing| failing == id) {
            return Err("synthetic store failure".into());
        }
        let mut account = Map::new();
        account.insert("id".into(), json!(id));
        account.extend(fields);
        Ok(Some(account))
    }

    fn finished(&self, at: &str) -> Result<(), String> {
        *self.last.lock().unwrap() = Some(at.to_string());
        Ok(())
    }

    fn log(&self, line: &str) {
        self.logs.lock().unwrap().push(line.to_string());
    }
}

struct Setup {
    refresher: Refresher,
    store: Arc<Store>,
    timers: Arc<ManualTimers>,
    refreshed: Arc<Mutex<Vec<String>>>,
    checks: Arc<Mutex<usize>>,
    events: Arc<Mutex<Vec<(String, Value)>>>,
}

fn setup(ids: &[&str], keys: ApiKeys) -> Setup {
    let accounts = ids.iter().map(|id| json!({ "id": id }).as_object().unwrap().clone()).collect();
    let store = Arc::new(Store { accounts, keys, minutes: Mutex::new(0.0), last: Mutex::new(None), failing: Mutex::default(), logs: Mutex::default() });
    let timers = ManualTimers::new();
    let refreshed: Arc<Mutex<Vec<String>>> = Arc::default();
    let checks: Arc<Mutex<usize>> = Arc::default();
    let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
    let (seen, checked, published) = (refreshed.clone(), checks.clone(), events.clone());
    let hooks = RefreshHooks {
        refresh_account: Box::new(move |account, _keys| {
            seen.lock().unwrap().push(account["id"].as_str().unwrap().to_string());
            json!({ "rank": "GOLD" }).as_object().unwrap().clone()
        }),
        check_game: Box::new(move || {
            *checked.lock().unwrap() += 1;
            true
        }),
        publish: Box::new(move |channel, payload| published.lock().unwrap().push((channel.to_string(), payload.clone()))),
        now: Box::new(|| NOW),
    };
    let refresher = Refresher::new(store.clone(), timers.clone(), hooks);
    Setup { refresher, store, timers, refreshed, checks, events }
}

fn keyed() -> ApiKeys {
    ApiKeys { riot: "synthetic-key".into(), tft: String::new(), henrik: String::new() }
}

fn ids(list: &[&str]) -> Option<Vec<String>> {
    Some(list.iter().map(|id| id.to_string()).collect())
}

impl Setup {
    fn drain(&self) {
        self.timers.run_all(0, 20);
    }

    fn refreshed(&self) -> Vec<String> {
        std::mem::take(&mut *self.refreshed.lock().unwrap())
    }

    fn channel(&self, name: &str) -> Vec<Value> {
        self.events.lock().unwrap().iter().filter(|(channel, _)| channel == name).map(|(_, payload)| payload.clone()).collect()
    }
}

#[test]
fn accounts_asked_for_during_a_rank_update_are_refreshed_right_after_it_in_one_extra_pass() {
    let setup = setup(&["a", "b", "c"], keyed());
    setup.refresher.request(ids(&["a"]));
    setup.refresher.request(ids(&["b"]));
    setup.refresher.request(ids(&["c", "b"]));
    setup.drain();
    assert_eq!(setup.refreshed(), ["a", "b", "c"]);
    for _ in 0..3 {
        setup.refresher.request(None);
    }
    setup.drain();
    assert_eq!(setup.refreshed(), ["a", "b", "c"]);
    setup.refresher.request(ids(&["a"]));
    setup.refresher.request(ids(&["b"]));
    setup.refresher.request(None);
    setup.drain();
    assert_eq!(setup.refreshed(), ["a", "a", "b", "c"]);
    setup.store.failing.lock().unwrap().push("a".into());
    setup.refresher.request(ids(&["a"]));
    setup.refresher.request(ids(&["b"]));
    setup.drain();
    assert_eq!(setup.refreshed(), ["a", "b"]);
    assert_eq!(*setup.store.logs.lock().unwrap(), [FAILED]);
}

#[test]
fn a_full_update_reports_progress_publishes_each_account_and_marks_the_update_but_a_partial_one_does_not() {
    let setup = setup(&["a", "b"], keyed());
    setup.refresher.request(ids(&["b"]));
    setup.drain();
    assert_eq!(*setup.store.last.lock().unwrap(), None);
    assert_eq!(setup.channel("refresh-progress"), [json!({ "done": 0, "total": 1 }), json!({ "done": 1, "total": 1 }), json!({ "done": 1, "total": 1 })]);
    assert_eq!(setup.channel("account-updated"), [json!({ "id": "b", "rank": "GOLD" })]);
    setup.events.lock().unwrap().clear();
    setup.refresher.request(None);
    setup.drain();
    assert_eq!(*setup.store.last.lock().unwrap(), Some(iso(NOW)));
    assert_eq!(setup.channel("refresh-progress").last().unwrap(), &json!({ "done": 2, "total": 2 }));
    assert_eq!(setup.channel("account-updated").len(), 2);
    assert_eq!(setup.channel("next-refresh"), [Value::Null]);
    assert_eq!(setup.refresher.last_refresh(), json!(iso(NOW)));
}

#[test]
fn without_any_api_key_a_rank_update_only_reads_the_open_game_and_still_marks_the_update() {
    let setup = setup(&["a", "b"], ApiKeys::default());
    setup.refresher.request(None);
    setup.drain();
    assert!(setup.refreshed().is_empty());
    assert_eq!(*setup.checks.lock().unwrap(), 1);
    assert_eq!(*setup.store.last.lock().unwrap(), Some(iso(NOW)));
    let henrik = self::setup(&["a"], ApiKeys { henrik: "synthetic-key".into(), ..ApiKeys::default() });
    henrik.refresher.request(None);
    henrik.drain();
    assert_eq!(henrik.refreshed(), ["a"]);
    assert_eq!(*henrik.checks.lock().unwrap(), 0);
}

#[test]
fn the_next_update_follows_the_interval_from_the_last_one_and_never_comes_sooner_than_five_seconds() {
    let setup = setup(&["a"], keyed());
    setup.refresher.schedule();
    assert_eq!(setup.refresher.next_refresh(), Value::Null);
    assert!(setup.timers.delays().is_empty());
    *setup.store.minutes.lock().unwrap() = 30.0;
    *setup.store.last.lock().unwrap() = Some(iso(NOW - 10 * 60_000));
    setup.refresher.schedule();
    assert_eq!(setup.refresher.next_refresh(), json!(iso(NOW + 20 * 60_000)));
    assert_eq!(setup.channel("next-refresh").last().unwrap(), &json!(iso(NOW + 20 * 60_000)));
    assert_eq!(setup.timers.delays(), [20 * 60_000]);
    *setup.store.last.lock().unwrap() = Some(iso(NOW - 90 * 60_000));
    setup.refresher.schedule();
    assert_eq!(setup.refresher.next_refresh(), json!(iso(NOW)));
    assert_eq!(setup.timers.delays(), [MIN_DELAY_MS as u64]);
    setup.timers.next(Some(MIN_DELAY_MS as u64));
    setup.drain();
    assert_eq!(setup.refreshed(), ["a"]);
    *setup.store.last.lock().unwrap() = Some("not a date".into());
    assert_eq!(setup.refresher.next_refresh(), json!(iso(NOW)));
}

#[test]
fn startup_updates_at_once_only_when_an_update_is_due_and_there_are_accounts_and_stopping_ends_everything() {
    let due = setup(&["a"], keyed());
    *due.store.minutes.lock().unwrap() = 30.0;
    due.refresher.start();
    assert_eq!(due.timers.delays(), [0]);
    due.drain();
    assert_eq!(due.refreshed(), ["a"]);
    assert_eq!(due.timers.delays(), [30 * 60_000]);
    due.refresher.stop();
    assert!(due.timers.delays().is_empty());
    due.refresher.request(None);
    due.refresher.schedule();
    assert!(due.timers.delays().is_empty());
    let empty = setup(&[], keyed());
    *empty.store.minutes.lock().unwrap() = 30.0;
    empty.refresher.start();
    assert_eq!(empty.timers.delays(), [MIN_DELAY_MS as u64]);
    let recent = setup(&["a"], keyed());
    *recent.store.minutes.lock().unwrap() = 30.0;
    *recent.store.last.lock().unwrap() = Some(iso(NOW - 60_000));
    recent.refresher.start();
    assert_eq!(recent.timers.delays(), [29 * 60_000]);
}

#[test]
fn an_update_running_when_eclipse_quits_stops_before_the_next_account_and_leaves_the_last_update_alone() {
    let setup = setup(&["a", "b"], keyed());
    setup.refresher.request(None);
    setup.refresher.stop();
    setup.drain();
    assert!(setup.refreshed().is_empty());
    assert_eq!(*setup.store.last.lock().unwrap(), None);
    assert_eq!(setup.channel("refresh-progress").last().unwrap(), &json!({ "done": 2, "total": 2 }));
}
