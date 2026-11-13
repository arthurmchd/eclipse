use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use chrono::DateTime;
use eclipse::application::rank_watcher::{merge_reading, RankHooks, RankRiot, RankWatcher, POLL_MS, RESAVE_MS};
use eclipse::riot::game_ranks::Reading;
use eclipse::riot::riot_state::{Look, RiotProbe};
use eclipse::riot::{RiotError, RiotId, RiotResult, RunningGames};
use serde_json::{json, Value};

use super::{FakeStore, ManualTimers};

const AT: &str = "2026-11-08T12:00:00.000Z";

fn entry(tier: &str, lp: i64, extra: Value) -> Value {
    let division = if ["MASTER", "GRANDMASTER", "CHALLENGER"].contains(&tier) { "" } else { "II" };
    let mut value = json!({ "tier": tier, "division": division, "lp": lp, "wins": 10, "losses": 9, "hotStreak": false });
    for (key, item) in extra.as_object().cloned().unwrap_or_default() {
        value[key] = item;
    }
    value
}

fn league_reading() -> Reading {
    Reading {
        riot_id: RiotId::new("synthetic", "br1"),
        lol: Some(json!({ "level": 300, "iconId": 7, "solo": entry("GOLD", 50, json!({})), "flex": null })),
        tft: Some(json!({ "ranked": entry("SILVER", 20, json!({})), "doubleUp": null })),
        val: None,
    }
}

fn val_reading() -> Reading {
    Reading { riot_id: RiotId::new("Synthetic", "BR1"), lol: None, tft: None, val: Some(json!({ "tier": 16, "tierName": "Platinum 2", "level": 90, "card": null })) }
}

type Read = Box<dyn Fn(&Riot) -> Option<Reading> + Send + Sync>;

struct Riot {
    processes: Mutex<Option<RunningGames>>,
    calls: Mutex<Vec<&'static str>>,
    league: Mutex<Read>,
    valorant: Mutex<Option<Reading>>,
    watcher: Mutex<Option<Arc<RankWatcher>>>,
}

impl RiotProbe for Riot {
    fn running_games(&self) -> RiotResult<RunningGames> {
        self.calls.lock().unwrap().push("processes");
        self.processes.lock().unwrap().ok_or_else(|| RiotError::new("tasklist failed"))
    }
}

impl RankRiot for Riot {
    fn look(&self) -> Look<'_> {
        Look::new(self)
    }

    fn league(&self) -> Option<Reading> {
        self.calls.lock().unwrap().push("league");
        let read = self.league.lock().unwrap();
        read(self)
    }

    fn valorant(&self) -> Option<Reading> {
        self.calls.lock().unwrap().push("valorant");
        self.valorant.lock().unwrap().clone()
    }
}

struct Fixture {
    watcher: Arc<RankWatcher>,
    riot: Arc<Riot>,
    store: Arc<FakeStore>,
    timers: Arc<ManualTimers>,
    updates: Arc<Mutex<Vec<Value>>>,
    lines: Arc<Mutex<Vec<String>>>,
    busy: Arc<AtomicBool>,
    clock: Arc<AtomicI64>,
}

fn lol_open() -> Option<RunningGames> {
    Some(RunningGames { client: true, lol: true, ..RunningGames::default() })
}

fn fixture(accounts: Option<Vec<Value>>, processes: Option<RunningGames>) -> Fixture {
    let store = FakeStore::new(accounts.unwrap_or_else(|| vec![json!({ "id": "a", "gameName": "Synthetic", "tagLine": "BR1", "stats": {} }), json!({ "id": "b", "gameName": "Other", "tagLine": "BR1" })]));
    let riot = Arc::new(Riot { processes: Mutex::new(processes), calls: Mutex::new(Vec::new()), league: Mutex::new(Box::new(|_| Some(league_reading()))), valorant: Mutex::new(None), watcher: Mutex::new(None) });
    let timers = ManualTimers::new();
    let updates = Arc::new(Mutex::new(Vec::new()));
    let lines = Arc::new(Mutex::new(Vec::new()));
    let busy = Arc::new(AtomicBool::new(false));
    let clock = Arc::new(AtomicI64::new(DateTime::parse_from_rfc3339(AT).unwrap().timestamp_millis()));
    let hooks = RankHooks {
        busy: Box::new({
            let busy = busy.clone();
            move || busy.load(Ordering::SeqCst)
        }),
        log: Box::new({
            let lines = lines.clone();
            move |line| lines.lock().unwrap().push(line.to_string())
        }),
        on_updated: Box::new({
            let updates = updates.clone();
            move |account| updates.lock().unwrap().push(account["id"].clone())
        }),
        now: Box::new({
            let clock = clock.clone();
            move || clock.load(Ordering::SeqCst)
        }),
    };
    let watcher = Arc::new(RankWatcher::new(riot.clone(), store.clone(), timers.clone(), hooks, POLL_MS, RESAVE_MS));
    *riot.watcher.lock().unwrap() = Some(watcher.clone());
    Fixture { watcher, riot, store, timers, updates, lines, busy, clock }
}

impl Fixture {
    fn start(&self) {
        self.watcher.start();
        self.timers.next(Some(0));
    }

    fn calls(&self) -> Vec<&'static str> {
        self.riot.calls.lock().unwrap().clone()
    }

    fn saves(&self) -> usize {
        self.store.names().iter().filter(|name| *name == "update").count()
    }

    fn stats(&self) -> Value {
        self.store.accounts.lock().unwrap()[0]["stats"].clone()
    }

    fn lines(&self) -> Vec<String> {
        self.lines.lock().unwrap().clone()
    }

    fn advance(&self, ms: i64) {
        self.clock.fetch_add(ms, Ordering::SeqCst);
    }
}

#[test]
fn an_open_league_client_updates_the_saved_account_with_the_same_riot_id_lol_and_tft_and_tells_the_cards() {
    let f = fixture(None, lol_open());
    f.start();
    assert_eq!(f.calls(), ["processes", "league"]);
    assert_eq!(f.saves(), 1);
    let stats = f.stats();
    assert_eq!(stats["lol"], json!({ "level": 300, "iconId": 7, "solo": entry("GOLD", 50, json!({})), "flex": null, "updatedAt": AT }));
    assert_eq!(stats["tft"], json!({ "ranked": entry("SILVER", 20, json!({})), "doubleUp": null, "updatedAt": AT }));
    assert_eq!(stats["errors"], json!({}));
    assert_eq!(*f.updates.lock().unwrap(), [json!("a")]);
    assert_eq!(f.lines(), ["game ranks: updated a saved account from the League client"]);
    assert_eq!(f.timers.delays(), [60_000]);
}

#[test]
fn the_polling_keeps_going_until_stopped() {
    let f = fixture(None, lol_open());
    f.start();
    f.timers.next(Some(60_000));
    assert_eq!(f.calls().iter().filter(|call| **call == "processes").count(), 2);
    assert_eq!(f.timers.delays(), [60_000]);
    f.watcher.stop();
    assert_eq!(f.timers.pending(), 0);
}

#[test]
fn the_same_ranks_are_written_again_only_after_ten_minutes_and_a_change_is_written_at_once() {
    let f = fixture(None, lol_open());
    f.start();
    f.advance(60_000);
    assert!(!f.watcher.check());
    f.advance(9 * 60_000);
    assert!(f.watcher.check());
    assert_eq!(f.saves(), 2);
    f.store.accounts.lock().unwrap()[0].get_mut("stats").unwrap()["lol"]["solo"]["lp"] = json!(10);
    f.advance(60_000);
    assert!(f.watcher.check());
    assert_eq!(f.stats()["lol"]["solo"]["lp"], 50);
}

#[test]
fn an_account_that_is_not_saved_or_saved_twice_is_never_touched() {
    let twice = vec![json!({ "id": "a", "gameName": "Synthetic", "tagLine": "BR1" }), json!({ "id": "b", "gameName": "SYNTHETIC", "tagLine": "br1" })];
    for accounts in [vec![json!({ "id": "b", "gameName": "Other", "tagLine": "BR1" })], twice] {
        let f = fixture(Some(accounts), lol_open());
        f.start();
        assert_eq!(f.saves(), 0);
        assert_eq!(f.lines(), ["game ranks: the League client is signed in to an account that is not saved in Eclipse"]);
    }
}

#[test]
fn nothing_is_read_without_a_game_open_or_during_a_sign_in_and_an_unreadable_game_keeps_the_ranks() {
    let closed = fixture(None, Some(RunningGames { client: true, ..RunningGames::default() }));
    closed.start();
    assert_eq!(closed.calls(), ["processes"]);

    let signing_in = fixture(None, lol_open());
    signing_in.busy.store(true, Ordering::SeqCst);
    signing_in.start();
    assert!(signing_in.calls().is_empty());

    let unreadable = fixture(None, lol_open());
    *unreadable.riot.league.lock().unwrap() = Box::new(|_| None);
    unreadable.start();
    assert_eq!(unreadable.saves(), 0);
    assert_eq!(unreadable.lines(), ["game ranks: could not read the ranks from the League client"]);
    unreadable.watcher.check();
    assert_eq!(unreadable.lines().len(), 1);

    let broken = fixture(None, None);
    broken.start();
    assert_eq!(broken.lines(), ["game ranks: could not check the running games"]);
}

#[test]
fn valorant_is_read_from_the_riot_client_only_with_valorant_open() {
    let f = fixture(None, Some(RunningGames { client: true, val: true, ..RunningGames::default() }));
    *f.riot.valorant.lock().unwrap() = Some(val_reading());
    f.start();
    assert_eq!(f.calls(), ["processes", "valorant"]);
    assert_eq!(f.stats()["val"]["tierName"], "Platinum 2");
    assert_eq!(f.lines(), ["game ranks: updated a saved account from the Riot Client"]);
}

#[test]
fn stopping_ends_the_polling_and_a_reading_that_arrives_after_it_is_not_written() {
    let f = fixture(None, lol_open());
    *f.riot.league.lock().unwrap() = Box::new(|riot| {
        riot.watcher.lock().unwrap().as_ref().unwrap().stop();
        Some(league_reading())
    });
    f.start();
    assert_eq!(f.saves(), 0);
    assert_eq!(f.timers.pending(), 0);
    assert!(!f.watcher.check());
}

#[test]
fn a_store_failure_is_noted_without_reporting_an_update() {
    let f = fixture(None, lol_open());
    f.store.fail("update_account_fields");
    f.start();
    assert!(f.updates.lock().unwrap().is_empty());
    assert_eq!(f.lines(), ["game ranks: could not check the running games"]);
}

#[test]
fn a_reading_keeps_what_only_a_key_gives_while_the_rank_is_the_same() {
    let cutoffs = json!({ "challenger": 900, "grandmaster": 400 });
    let before = json!({
        "lol": { "level": 1, "iconId": 2, "banner": "kept", "solo": entry("MASTER", 100, json!({ "cutoffs": cutoffs })), "flex": entry("MASTER", 50, json!({ "cutoffs": cutoffs })), "updatedAt": "old" },
        "val": { "tier": 16, "tierName": "Platinum 2", "rr": 45, "lastChange": 12, "peak": { "tier": 20 }, "lastSeason": { "tier": 15 }, "region": "br", "level": 80, "card": "old-card", "updatedAt": "old" },
        "errors": { "lol": "No Riot API key (Settings)", "val": "No HenrikDev API key (Settings)", "tft": "kept" },
    });
    let read = Reading {
        riot_id: RiotId::new("x", "y"),
        lol: Some(json!({ "level": null, "iconId": 9, "solo": entry("MASTER", 130, json!({})), "flex": entry("DIAMOND", 10, json!({})) })),
        tft: None,
        val: Some(json!({ "tier": 16, "tierName": "Platinum 2", "level": 81, "card": null })),
    };
    let next = merge_reading(Some(&before), &read, AT);
    assert_eq!(next["lol"], json!({ "level": 1, "iconId": 9, "banner": "kept", "solo": entry("MASTER", 130, json!({ "cutoffs": cutoffs })), "flex": entry("DIAMOND", 10, json!({})), "updatedAt": AT }));
    assert_eq!(next["val"], json!({ "tier": 16, "tierName": "Platinum 2", "rr": 45, "lastChange": 12, "peak": { "tier": 20 }, "lastSeason": { "tier": 15 }, "region": "br", "level": 81, "card": "old-card", "updatedAt": AT }));
    assert_eq!(next["errors"], json!({ "tft": "kept" }));
    let moved = Reading { val: Some(json!({ "tier": 17, "tierName": "Platinum 3", "level": null, "card": "new-card" })), lol: None, ..read.clone() };
    let moved = merge_reading(Some(&before), &moved, AT)["val"].clone();
    assert_eq!([&moved["rr"], &moved["lastChange"], &moved["level"], &moved["card"], &moved["peak"]], [&json!(null), &json!(null), &json!(80), &json!("new-card"), &json!({ "tier": 20 })]);
    let empty = Reading { riot_id: RiotId::new("x", "y"), lol: None, tft: Some(json!({ "ranked": null, "doubleUp": null })), val: None };
    assert_eq!(merge_reading(None, &empty, AT), json!({ "tft": { "ranked": null, "doubleUp": null, "updatedAt": AT }, "errors": {} }));
}

#[test]
fn the_league_client_never_sends_a_hot_streak_so_the_one_from_a_key_stays_until_the_queue_has_a_new_game() {
    let hot = json!({ "hotStreak": true });
    let before = json!({ "lol": { "solo": entry("GOLD", 40, hot.clone()), "flex": entry("GOLD", 40, hot.clone()) }, "tft": { "ranked": entry("SILVER", 20, hot), "doubleUp": null } });
    let read = Reading {
        riot_id: RiotId::new("x", "y"),
        lol: Some(json!({ "level": 1, "iconId": 2, "solo": entry("GOLD", 40, json!({})), "flex": entry("GOLD", 60, json!({ "wins": 11 })) })),
        tft: Some(json!({ "ranked": entry("SILVER", 20, json!({})), "doubleUp": entry("IRON", 0, json!({})) })),
        val: None,
    };
    let next = merge_reading(Some(&before), &read, AT);
    let streaks = [&next["lol"]["solo"]["hotStreak"], &next["lol"]["flex"]["hotStreak"], &next["tft"]["ranked"]["hotStreak"], &next["tft"]["doubleUp"]["hotStreak"]];
    assert_eq!(streaks, [&json!(true), &json!(false), &json!(true), &json!(false)]);
    assert_eq!(merge_reading(Some(&next), &read, AT)["lol"]["solo"]["hotStreak"], true);
}
