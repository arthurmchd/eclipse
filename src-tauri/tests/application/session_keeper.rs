use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::DateTime;
use eclipse::application::riot_wakeup::{OnChange, Watch};
use eclipse::application::session_keeper::{KeeperHooks, KeeperRiot, KeeperTiming, SessionKeeper, KEPT_SINCE_MS};
use eclipse::application::store::ServiceStore;
use eclipse::riot::riot_state::{Look, RiotProbe};
use eclipse::riot::{AccountState, RiotError, RiotId, RiotResult, RunningGames};
use serde_json::{json, Value};

use super::{FakeStore, ManualTimers};

const DELAY: u64 = 1000;
const POLL: u64 = 4000;

fn remembered(subject: &str, riot_id: &str, version: &str) -> String {
    format!("login:{subject}|{riot_id}|{version}")
}

fn login(subject: &str) -> String {
    remembered(subject, "", "v1")
}

fn parts(text: Option<&str>) -> Vec<String> {
    text.and_then(|text| text.strip_prefix("login:")).map(|rest| rest.split('|').map(str::to_string).collect()).unwrap_or_default()
}

type Hook = Box<dyn Fn(&Riot) + Send>;
type AuthorizationHook = Box<dyn Fn(&Riot) -> AccountState + Send>;

struct Scene {
    yaml: Option<String>,
    processes: RunningGames,
    authorization: Option<AccountState>,
    authorized: bool,
    start_error: bool,
    started: bool,
    processes_fail: bool,
}

struct Closer(Arc<AtomicBool>);

impl Drop for Closer {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

struct Riot {
    scene: Mutex<Scene>,
    events: Arc<Mutex<Vec<Value>>>,
    busy: Arc<AtomicBool>,
    on_change: Mutex<Option<OnChange>>,
    closed: Arc<AtomicBool>,
    on_processes: Mutex<Option<Hook>>,
    on_authorization: Mutex<Option<AuthorizationHook>>,
}

impl Riot {
    fn push(&self, event: Value) {
        self.events.lock().unwrap().push(event);
    }

    fn set_yaml(&self, yaml: &str) {
        self.scene.lock().unwrap().yaml = Some(yaml.to_string());
    }
}

impl RiotProbe for Riot {
    fn running_games(&self) -> RiotResult<RunningGames> {
        self.push(json!("processes?"));
        let hook = self.on_processes.lock().unwrap().take();
        if let Some(hook) = hook {
            hook(self);
            let mut slot = self.on_processes.lock().unwrap();
            if slot.is_none() {
                *slot = Some(hook);
            }
        }
        let scene = self.scene.lock().unwrap();
        if scene.processes_fail {
            return Err(RiotError::new("tasklist failed"));
        }
        Ok(scene.processes)
    }

    fn authorization(&self) -> RiotResult<AccountState> {
        self.push(json!("authorization?"));
        if let Some(hook) = self.on_authorization.lock().unwrap().as_ref() {
            return Ok(hook(self));
        }
        let scene = self.scene.lock().unwrap();
        Ok(scene.authorization.unwrap_or(if scene.authorized { AccountState::Yes } else { AccountState::No }))
    }
}

impl KeeperRiot for Riot {
    fn look(&self) -> Look<'_> {
        Look::new(self)
    }

    fn read_settings_yaml(&self) -> Option<String> {
        self.push(json!("read"));
        self.scene.lock().unwrap().yaml.clone()
    }

    fn write_settings_yaml(&self, text: &str, expected: &str) -> RiotResult<bool> {
        self.push(json!("read"));
        let mut scene = self.scene.lock().unwrap();
        if scene.yaml.as_deref() != Some(expected) {
            return Ok(false);
        }
        self.push(json!(["write", text]));
        scene.yaml = Some(text.to_string());
        Ok(true)
    }

    fn has_persisted_login(&self, yaml: Option<&str>) -> bool {
        yaml.is_some_and(|yaml| yaml.starts_with("login:"))
    }

    fn strip_persisted_login(&self, _yaml: &str) -> String {
        "stripped".into()
    }

    fn persisted_subject(&self, yaml: Option<&str>) -> Option<String> {
        parts(yaml).into_iter().next().filter(|subject| !subject.is_empty())
    }

    fn persisted_riot_id(&self, yaml: Option<&str>) -> Option<RiotId> {
        let riot_id = parts(yaml).get(1).cloned().unwrap_or_default();
        let mut pieces = riot_id.split('#');
        let game_name = pieces.next().unwrap_or_default();
        (!game_name.is_empty()).then(|| RiotId::new(game_name, pieces.next().unwrap_or_default()))
    }

    fn same_riot_id(&self, a: &RiotId, b: &RiotId) -> bool {
        !a.game_name.is_empty() && a == b
    }

    fn watch_settings(&self, on_change: OnChange) -> Option<Watch> {
        *self.on_change.lock().unwrap() = Some(on_change);
        Some(Box::new(Closer(self.closed.clone())))
    }

    fn quit_client(&self) {
        self.push(json!("quit"));
    }

    fn start_client(&self, client_path: &str) -> RiotResult<bool> {
        self.push(json!(["start", client_path]));
        let scene = self.scene.lock().unwrap();
        if scene.start_error {
            return Err(RiotError::new("C:\\private\\path missing"));
        }
        Ok(scene.started)
    }
}

struct Options {
    yaml: String,
    stay_signed_in: Option<bool>,
    sessions: Vec<(&'static str, String)>,
    poll_ms: u64,
    processes: Option<RunningGames>,
    authorized: bool,
    saved_at: Vec<(&'static str, f64)>,
}

impl Default for Options {
    fn default() -> Self {
        Self { yaml: login("sub-a"), stay_signed_in: None, sessions: vec![("a", login("sub-a")), ("b", login("sub-b"))], poll_ms: 0, processes: None, authorized: true, saved_at: Vec::new() }
    }
}

fn client(change: impl FnOnce(&mut RunningGames)) -> Option<RunningGames> {
    let mut processes = RunningGames { client: true, ..RunningGames::default() };
    change(&mut processes);
    Some(processes)
}

struct Fixture {
    keeper: SessionKeeper,
    riot: Arc<Riot>,
    store: Arc<FakeStore>,
    timers: Arc<ManualTimers>,
    logs: Arc<Mutex<Vec<String>>>,
    busy: Arc<AtomicBool>,
}

fn fixture(options: Options) -> Fixture {
    let accounts = [("a", "Alpha"), ("b", "Beta"), ("c", "Gamma"), ("d", "Twin"), ("e", "Twin")].map(|(id, name)| json!({ "id": id, "gameName": name, "tagLine": "BR1" }));
    let store = FakeStore::new(accounts.to_vec());
    for (id, yaml) in &options.sessions {
        store.session(id, yaml);
    }
    for (id, at) in &options.saved_at {
        store.saved_at.lock().unwrap().insert(id.to_string(), *at);
    }
    if let Some(stay) = options.stay_signed_in {
        store.set("staySignedIn", json!(stay));
    }
    let busy = Arc::new(AtomicBool::new(false));
    let riot = Arc::new(Riot {
        scene: Mutex::new(Scene {
            yaml: Some(options.yaml),
            processes: options.processes.unwrap_or_default(),
            authorization: None,
            authorized: options.authorized,
            start_error: false,
            started: true,
            processes_fail: false,
        }),
        events: store.calls.clone(),
        busy: busy.clone(),
        on_change: Mutex::new(None),
        closed: Arc::new(AtomicBool::new(false)),
        on_processes: Mutex::new(None),
        on_authorization: Mutex::new(None),
    });
    let timers = ManualTimers::new();
    let logs = Arc::new(Mutex::new(Vec::new()));
    let hooks = KeeperHooks {
        busy: Box::new({
            let busy = busy.clone();
            move || busy.load(Ordering::SeqCst)
        }),
        log: Box::new({
            let logs = logs.clone();
            move |line| logs.lock().unwrap().push(line.to_string())
        }),
        on_saved: Box::new({
            let events = store.calls.clone();
            move |id| events.lock().unwrap().push(json!(["saved", id]))
        }),
    };
    let timing = KeeperTiming { delay_ms: DELAY, poll_ms: options.poll_ms, ..KeeperTiming::default() };
    let keeper = SessionKeeper::new(riot.clone(), store.clone(), timers.clone(), hooks, timing);
    Fixture { keeper, riot, store, timers, logs, busy }
}

impl Fixture {
    fn flush(&self) {
        self.timers.run_all(DELAY, 20);
    }

    fn tick(&self) {
        let timer = self.timers.take(|timer| timer.ms == POLL && !timer.cancelled).expect("a client poll is scheduled");
        ManualTimers::run(timer);
    }

    fn change(&self) {
        let guard = self.riot.on_change.lock().unwrap();
        guard.as_ref().unwrap()();
    }

    fn events(&self) -> Vec<Value> {
        self.store.calls()
    }

    fn named(&self, name: &str) -> Vec<Value> {
        self.events().into_iter().filter(|event| event[0] == name).collect()
    }

    fn saved(&self) -> Vec<(String, String)> {
        self.named("save-session").iter().map(|event| (event[1].as_str().unwrap().to_string(), event[2].as_str().unwrap().to_string())).collect()
    }

    fn saved_hooks(&self) -> Vec<Value> {
        self.named("saved").iter().map(|event| event[1].clone()).collect()
    }

    fn writes(&self) -> Vec<Value> {
        self.named("write").iter().map(|event| event[1].clone()).collect()
    }

    fn forgets(&self) -> Vec<Value> {
        self.named("forget-session").iter().map(|event| event[1].clone()).collect()
    }

    fn starts(&self) -> Vec<Value> {
        self.named("start").iter().map(|event| event[1].clone()).collect()
    }

    fn count(&self, word: &str) -> usize {
        self.events().iter().filter(|event| *event == word).count()
    }

    fn yaml(&self) -> Option<String> {
        self.riot.scene.lock().unwrap().yaml.clone()
    }

    fn scene(&self, change: impl FnOnce(&mut Scene)) {
        change(&mut self.riot.scene.lock().unwrap());
    }

    fn processes(&self, processes: Option<RunningGames>) {
        self.scene(|scene| scene.processes = processes.unwrap_or_default());
    }

    fn logs(&self) -> Vec<String> {
        self.logs.lock().unwrap().clone()
    }

    fn last_log(&self) -> String {
        self.logs().last().cloned().unwrap_or_default()
    }

    fn set_busy(&self, value: bool) {
        self.busy.store(value, Ordering::SeqCst);
    }

    fn stay(&self, value: bool) {
        self.store.set("staySignedIn", json!(value));
    }

    fn sign_out_in_riot(&self) {
        self.scene(|scene| {
            scene.yaml = Some("tdid only".into());
            scene.authorized = false;
        });
        self.change();
    }
}

fn saved(id: &str, yaml: &str) -> (String, String) {
    (id.to_string(), yaml.to_string())
}

#[test]
fn the_cutoff_for_old_sessions_matches_the_electron_version() {
    assert_eq!(KEPT_SINCE_MS as i64, DateTime::parse_from_rfc3339("2026-11-06T13:00:00Z").unwrap().timestamp_millis());
}

#[test]
fn when_riot_has_quit_its_newest_login_goes_to_the_account_with_the_same_subject_and_is_cleared_from_riot() {
    let f = fixture(Options { yaml: remembered("sub-b", "", "v2"), ..Options::default() });
    f.keeper.start();
    f.flush();
    assert_eq!(f.saved(), [saved("b", &remembered("sub-b", "", "v2"))]);
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
    assert_eq!(f.saved_hooks(), [json!("b")]);
    assert_eq!(f.writes(), [json!("stripped")]);
    let words: Vec<Value> = f.events().into_iter().filter(Value::is_string).collect();
    assert_eq!(words, [json!("read"), json!("processes?"), json!("read")]);
    assert_eq!(f.logs(), ["kept the Riot session for its account and cleared the remembered login"]);
}

#[test]
fn an_unchanged_session_is_not_written_again_before_riot_is_cleared() {
    let f = fixture(Options::default());
    f.keeper.start();
    f.flush();
    assert!(f.saved().is_empty());
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
}

#[test]
fn a_remembered_login_of_an_account_outside_eclipse_is_cleared_without_being_kept_but_never_while_riot_holds_it() {
    let f = fixture(Options { yaml: login("sub-unknown"), ..Options::default() });
    f.keeper.start();
    f.flush();
    assert!(f.saved().is_empty());
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
    assert_eq!(f.logs(), ["cleared a remembered Riot login that is not from an account in Eclipse"]);
    let held = fixture(Options { yaml: login("sub-unknown"), processes: client(|_| {}), ..Options::default() });
    held.keeper.start();
    held.flush();
    assert_eq!(held.yaml(), Some(login("sub-unknown")));
    assert!(held.logs().is_empty());
}

#[test]
fn an_account_without_a_saved_session_owns_the_remembered_login_only_when_its_riot_id_is_the_only_match() {
    let f = fixture(Options { yaml: remembered("sub-new", "Gamma#BR1", "v1"), ..Options::default() });
    f.keeper.start();
    f.flush();
    assert_eq!(f.saved(), [saved("c", &remembered("sub-new", "Gamma#BR1", "v1"))]);
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
    let twins = fixture(Options { yaml: remembered("sub-new", "Twin#BR1", "v1"), ..Options::default() });
    twins.keeper.start();
    twins.flush();
    assert!(twins.saved().is_empty());
    assert_eq!(twins.yaml().as_deref(), Some("stripped"));
    assert!(twins.logs()[0].contains("not from an account in Eclipse"));
}

#[test]
fn the_saved_session_subject_wins_over_a_riot_id_that_points_to_another_account() {
    let f = fixture(Options { yaml: remembered("sub-a", "Gamma#BR1", "v2"), ..Options::default() });
    f.keeper.start();
    f.flush();
    assert_eq!(f.saved(), [saved("a", &remembered("sub-a", "Gamma#BR1", "v2"))]);
}

#[test]
fn a_riot_settings_file_without_a_remembered_login_is_never_rewritten() {
    let f = fixture(Options { yaml: "tdid only".into(), ..Options::default() });
    f.keeper.start();
    f.flush();
    assert!(f.events().iter().all(Value::is_string));
    assert!(f.logs().is_empty());
}

#[test]
fn while_riot_holds_the_account_every_renewed_session_is_kept_and_the_file_stays_until_the_polling_sees_riot_let_go() {
    let f = fixture(Options { yaml: remembered("sub-a", "", "v2"), poll_ms: POLL, processes: client(|_| {}), ..Options::default() });
    f.keeper.start();
    f.flush();
    assert_eq!(f.saved(), [saved("a", &remembered("sub-a", "", "v2"))]);
    assert_eq!(f.yaml(), Some(remembered("sub-a", "", "v2")));
    f.riot.set_yaml(&remembered("sub-a", "", "v3"));
    f.change();
    f.flush();
    assert_eq!(f.saved(), [saved("a", &remembered("sub-a", "", "v2")), saved("a", &remembered("sub-a", "", "v3"))]);
    assert_eq!(f.yaml(), Some(remembered("sub-a", "", "v3")));
    f.scene(|scene| scene.authorized = false);
    f.tick();
    f.flush();
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
    assert_eq!(f.logs(), ["kept the Riot session for its account and cleared the remembered login"]);
    f.tick();
    assert!(!f.timers.pending_with(DELAY));
}

#[test]
fn a_file_that_riot_rewrites_during_the_check_is_never_overwritten_and_the_newer_login_is_kept_next() {
    let f = fixture(Options { yaml: remembered("sub-a", "", "v2"), processes: client(|_| {}), ..Options::default() });
    *f.riot.on_authorization.lock().unwrap() = Some(Box::new(|riot| {
        riot.set_yaml(&remembered("sub-a", "", "v3"));
        AccountState::No
    }));
    f.keeper.start();
    f.flush();
    assert_eq!(f.yaml(), Some(remembered("sub-a", "", "v3")));
    assert!(f.writes().is_empty());
    *f.riot.on_authorization.lock().unwrap() = None;
    f.scene(|scene| scene.authorized = false);
    f.change();
    f.flush();
    assert_eq!(f.saved(), [saved("a", &remembered("sub-a", "", "v2")), saved("a", &remembered("sub-a", "", "v3"))]);
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
}

#[test]
fn a_sign_in_in_progress_keeps_the_keeper_away_from_the_riot_settings() {
    let f = fixture(Options { yaml: remembered("sub-a", "", "v2"), ..Options::default() });
    f.set_busy(true);
    f.keeper.start();
    f.change();
    f.flush();
    assert!(f.events().is_empty());
    f.set_busy(false);
    f.keeper.check();
    f.flush();
    assert_eq!(f.saved(), [saved("a", &remembered("sub-a", "", "v2"))]);
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
}

#[test]
fn a_sign_in_that_starts_while_riot_is_being_checked_is_left_alone() {
    let f = fixture(Options::default());
    *f.riot.on_processes.lock().unwrap() = Some(Box::new(|riot| riot.busy.store(true, Ordering::SeqCst)));
    f.keeper.start();
    f.flush();
    assert!(f.writes().is_empty());
    assert_eq!(f.yaml(), Some(login("sub-a")));
    assert!(f.saved().is_empty());
}

#[test]
fn stay_signed_in_off_disables_the_keeper_entirely() {
    let f = fixture(Options { stay_signed_in: Some(false), poll_ms: POLL, processes: client(|_| {}), ..Options::default() });
    f.keeper.start();
    f.change();
    f.flush();
    f.tick();
    f.tick();
    assert!(f.events().is_empty());
    assert_eq!(f.keeper.keep(&remembered("sub-a", "", "v9")), Ok(None));
}

#[test]
fn a_change_during_a_check_runs_one_more_check_afterwards() {
    let f = fixture(Options { yaml: remembered("sub-a", "", "v2"), ..Options::default() });
    let timers = f.timers.clone();
    let done = AtomicBool::new(false);
    *f.riot.on_processes.lock().unwrap() = Some(Box::new(move |riot| {
        if done.swap(true, Ordering::SeqCst) {
            return;
        }
        riot.on_change.lock().unwrap().as_ref().unwrap()();
        timers.run_all(DELAY, 1);
        riot.set_yaml(&remembered("sub-a", "", "v3"));
    }));
    f.keeper.start();
    f.flush();
    assert_eq!(f.saved(), [saved("a", &remembered("sub-a", "", "v2")), saved("a", &remembered("sub-a", "", "v3"))]);
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
}

#[test]
fn stopping_closes_the_watcher_and_cancels_pending_work() {
    let f = fixture(Options { poll_ms: POLL, ..Options::default() });
    f.keeper.start();
    f.keeper.stop();
    f.flush();
    assert!(f.riot.closed.load(Ordering::SeqCst));
    assert!(f.timers.all_cancelled());
    assert!(f.events().is_empty());
    f.keeper.check();
    assert_eq!(f.timers.pending(), 0);
}

#[test]
fn a_storage_failure_is_logged_without_crashing_and_without_clearing_riot() {
    let f = fixture(Options { yaml: remembered("sub-a", "", "v2"), ..Options::default() });
    *f.store.failure.lock().unwrap() = "C:/secret/path".into();
    f.store.fail("save_session");
    f.keeper.start();
    f.flush();
    assert_eq!(f.yaml(), Some(remembered("sub-a", "", "v2")));
    assert_eq!(f.logs(), ["could not keep the Riot session"]);
    f.keeper.check();
    f.flush();
    assert_eq!(f.logs(), ["could not keep the Riot session"]);
}

#[test]
fn the_leaving_session_of_a_closing_riot_is_kept_for_its_owner_even_during_a_sign_in() {
    let f = fixture(Options::default());
    f.set_busy(true);
    assert_eq!(f.keeper.keep(&remembered("sub-b", "", "v2")), Ok(Some("b".into())));
    assert_eq!(f.saved(), [saved("b", &remembered("sub-b", "", "v2"))]);
    assert_eq!(f.keeper.keep(&login("sub-unknown")), Ok(None));
    assert_eq!(f.keeper.keep("tdid only"), Ok(None));
    assert_eq!(f.saved_hooks(), [json!("b")]);
    f.store.fail("save_session");
    assert_eq!(f.keeper.keep(&remembered("sub-b", "", "v3")), Err("storage unavailable".into()));
}

#[test]
fn after_a_game_closes_a_signed_in_riot_is_asked_to_quit_normally_even_with_its_window_open_and_the_session_is_kept() {
    let f = fixture(Options { poll_ms: POLL, processes: client(|processes| processes.lol = true), ..Options::default() });
    f.keeper.start();
    f.tick();
    f.processes(client(|processes| processes.client_window = true));
    f.tick();
    assert_eq!(f.count("quit"), 0);
    f.tick();
    assert_eq!(f.count("quit"), 1);
    assert!(f.last_log().contains("after the game"));
    assert!(f.timers.pending_with(DELAY));
    f.processes(client(|processes| processes.client_window = true));
    f.tick();
    f.tick();
    assert_eq!(f.count("quit"), 1);
}

#[test]
fn a_signed_in_riot_left_without_a_window_and_without_a_game_is_asked_to_quit_and_one_with_its_window_open_stays() {
    let f = fixture(Options { yaml: "tdid only".into(), poll_ms: POLL, processes: client(|processes| processes.client_window = true), ..Options::default() });
    f.keeper.start();
    for _ in 0..4 {
        f.tick();
    }
    assert_eq!(f.count("quit"), 0);
    assert_eq!(f.count("authorization?"), 0);
    f.processes(client(|_| {}));
    f.tick();
    f.tick();
    assert_eq!(f.count("quit"), 1);
    assert!(f.last_log().contains("without a window"));
}

fn closed_after_game(yaml: Option<&str>) -> Fixture {
    let f = fixture(Options { yaml: yaml.map(str::to_string).unwrap_or_else(|| login("sub-a")), poll_ms: POLL, processes: client(|processes| processes.lol = true), ..Options::default() });
    f.keeper.start();
    f.tick();
    f.processes(client(|processes| processes.client_window = true));
    f.tick();
    f.tick();
    assert_eq!(f.count("quit"), 1);
    f
}

#[test]
fn a_riot_closed_after_the_game_with_its_window_open_is_reopened_signed_out_only_after_it_quit_and_its_login_was_cleared() {
    let f = closed_after_game(None);
    f.store.set("riotClientPath", json!("C:\\Riot\\RiotClientServices.exe"));
    f.tick();
    assert!(f.starts().is_empty());
    f.processes(None);
    f.riot.set_yaml(&remembered("sub-a", "", "v2"));
    f.tick();
    assert!(f.starts().is_empty());
    f.flush();
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
    assert_eq!(f.saved().last().cloned(), Some(saved("a", &remembered("sub-a", "", "v2"))));
    f.tick();
    assert_eq!(f.starts(), [json!("C:\\Riot\\RiotClientServices.exe")]);
    let events = f.events();
    let last_write = events.iter().rposition(|event| event[0] == "write").unwrap();
    let start = events.iter().position(|event| event[0] == "start").unwrap();
    assert!(last_write < start);
    assert_eq!(f.last_log(), "reopened the Riot at the sign-in screen after closing it");
    for _ in 0..6 {
        f.tick();
    }
    assert_eq!(f.starts().len(), 1);
}

#[test]
fn a_riot_closed_without_its_window_one_that_never_quits_or_one_the_user_opens_again_is_never_reopened() {
    let hidden = fixture(Options { yaml: "tdid only".into(), poll_ms: POLL, processes: client(|_| {}), ..Options::default() });
    hidden.keeper.start();
    hidden.tick();
    hidden.tick();
    assert_eq!(hidden.count("quit"), 1);
    hidden.processes(None);
    for _ in 0..6 {
        hidden.tick();
    }
    assert!(hidden.starts().is_empty());
    let stuck = closed_after_game(Some("tdid only"));
    for _ in 0..5 {
        stuck.tick();
    }
    assert_eq!(stuck.logs().iter().filter(|line| *line == "gave up reopening the Riot after closing it").count(), 1);
    stuck.processes(None);
    for _ in 0..3 {
        stuck.tick();
    }
    assert!(stuck.starts().is_empty());
    let reopened = closed_after_game(Some("tdid only"));
    reopened.processes(None);
    reopened.scene(|scene| scene.started = false);
    reopened.tick();
    assert_eq!(reopened.starts().len(), 1);
    assert!(!reopened.logs().iter().any(|line| line.contains("reopen")));
}

#[test]
fn a_sign_in_a_game_or_stay_signed_in_turned_off_cancels_the_reopen() {
    let signing_in = closed_after_game(Some("tdid only"));
    signing_in.set_busy(true);
    signing_in.tick();
    signing_in.set_busy(false);
    signing_in.processes(None);
    let playing = closed_after_game(Some("tdid only"));
    playing.processes(client(|processes| processes.lol = true));
    playing.tick();
    playing.processes(None);
    let disabled = closed_after_game(Some("tdid only"));
    disabled.stay(false);
    disabled.tick();
    disabled.stay(true);
    disabled.processes(None);
    let busy_during_check = closed_after_game(Some("tdid only"));
    busy_during_check.processes(None);
    *busy_during_check.riot.on_processes.lock().unwrap() = Some(Box::new(|riot| riot.busy.store(true, Ordering::SeqCst)));
    busy_during_check.tick();
    *busy_during_check.riot.on_processes.lock().unwrap() = None;
    busy_during_check.set_busy(false);
    for f in [&signing_in, &playing, &disabled, &busy_during_check] {
        for _ in 0..3 {
            f.tick();
        }
        assert!(f.starts().is_empty());
    }
}

#[test]
fn a_failed_reopen_is_logged_without_details_and_never_retried() {
    let f = closed_after_game(Some("tdid only"));
    f.processes(None);
    f.scene(|scene| scene.start_error = true);
    f.tick();
    f.tick();
    assert_eq!(f.starts().len(), 1);
    assert_eq!(f.last_log(), "could not reopen the Riot after closing it");
    assert!(!f.logs().iter().any(|line| line.contains("private")));
}

fn held_by_riot(poll_ms: u64, processes: Option<RunningGames>) -> Fixture {
    let f = fixture(Options { yaml: remembered("sub-a", "", "v2"), poll_ms, processes: processes.or_else(|| client(|_| {})), ..Options::default() });
    f.keeper.start();
    f.flush();
    assert_eq!(f.saved(), [saved("a", &remembered("sub-a", "", "v2"))]);
    assert_eq!(f.yaml(), Some(remembered("sub-a", "", "v2")));
    f
}

fn session(f: &Fixture, id: &str) -> Option<String> {
    f.store.load_session(id)
}

#[test]
fn an_account_signed_out_in_riot_loses_its_saved_session_at_once_and_riot_is_left_alone() {
    let f = held_by_riot(0, None);
    f.sign_out_in_riot();
    f.flush();
    assert_eq!(session(&f, "a"), None);
    assert_eq!(session(&f, "b"), Some(login("sub-b")));
    let tail: Vec<Value> = f.events().into_iter().filter(Value::is_array).collect();
    assert_eq!(tail[tail.len() - 2..], [json!(["forget-session", "a"]), json!(["saved", "a"])]);
    assert_eq!(f.last_log(), "forgot the saved session of an account signed out in Riot");
    assert_eq!(f.count("quit"), 0);
    assert!(f.writes().is_empty());
    f.change();
    f.flush();
    assert_eq!(f.forgets().len(), 1);
}

#[test]
fn a_riot_that_only_lets_go_of_the_account_after_a_game_keeps_the_session_even_when_the_cleared_file_is_rewritten_later() {
    let f = held_by_riot(0, None);
    f.scene(|scene| scene.authorized = false);
    f.keeper.check();
    f.flush();
    assert_eq!(f.yaml().as_deref(), Some("stripped"));
    f.riot.set_yaml("tdid only");
    f.change();
    f.flush();
    assert_eq!(session(&f, "a"), Some(remembered("sub-a", "", "v2")));
    assert!(f.forgets().is_empty());
}

#[test]
fn a_sign_in_a_switch_a_closed_riot_another_account_a_changed_session_or_stay_signed_in_off_never_forget_a_session() {
    let signing_in = held_by_riot(0, None);
    signing_in.set_busy(true);
    signing_in.sign_out_in_riot();
    signing_in.flush();
    signing_in.set_busy(false);
    signing_in.keeper.check();
    signing_in.flush();
    let switching = held_by_riot(0, None);
    switching.keeper.keep(&remembered("sub-b", "", "v2")).unwrap();
    switching.sign_out_in_riot();
    switching.flush();
    let closed = held_by_riot(0, None);
    closed.processes(None);
    closed.sign_out_in_riot();
    closed.flush();
    let other = held_by_riot(0, None);
    other.riot.set_yaml("tdid only");
    other.change();
    other.flush();
    other.scene(|scene| scene.authorized = false);
    other.keeper.check();
    other.flush();
    let changed = held_by_riot(0, None);
    changed.store.session("a", &remembered("sub-a", "", "v3"));
    changed.sign_out_in_riot();
    changed.flush();
    let disabled = held_by_riot(0, None);
    disabled.stay(false);
    disabled.sign_out_in_riot();
    disabled.flush();
    disabled.stay(true);
    disabled.keeper.check();
    disabled.flush();
    let raced = held_by_riot(0, None);
    *raced.riot.on_authorization.lock().unwrap() = Some(Box::new(|riot| {
        riot.set_yaml(&remembered("sub-c", "Gamma#BR1", "v1"));
        AccountState::No
    }));
    raced.sign_out_in_riot();
    raced.flush();
    for f in [&signing_in, &switching, &closed, &other, &changed, &disabled, &raced] {
        assert!(f.forgets().is_empty());
        assert!(session(f, "a").is_some());
    }
}

#[test]
fn an_unknown_riot_state_waits_and_the_polling_confirms_a_sign_out_the_file_watcher_missed_also_after_a_game() {
    let unsure = held_by_riot(POLL, client(|processes| processes.client_window = true));
    unsure.scene(|scene| scene.authorization = Some(AccountState::Unknown));
    unsure.sign_out_in_riot();
    unsure.flush();
    assert!(session(&unsure, "a").is_some());
    unsure.scene(|scene| scene.authorization = None);
    unsure.tick();
    assert_eq!(unsure.forgets(), [json!("a")]);
    let missed = held_by_riot(POLL, client(|_| {}));
    missed.scene(|scene| {
        scene.yaml = Some("tdid only".into());
        scene.authorized = false;
    });
    missed.tick();
    assert_eq!(missed.forgets(), [json!("a")]);
    let league = held_by_riot(POLL, client(|processes| processes.lol = true));
    league.tick();
    league.processes(client(|processes| processes.client_window = true));
    league.sign_out_in_riot();
    league.flush();
    assert_eq!(league.forgets(), [json!("a")]);
    let gone = held_by_riot(POLL, None);
    gone.processes(None);
    gone.tick();
    gone.processes(client(|_| {}));
    gone.sign_out_in_riot();
    gone.flush();
    assert!(gone.forgets().is_empty());
}

#[test]
fn riot_on_the_sign_in_screen_a_sign_in_in_progress_or_a_game_starting_again_never_makes_the_keeper_quit_riot() {
    let signed_out = fixture(Options { poll_ms: POLL, authorized: false, processes: client(|_| {}), ..Options::default() });
    signed_out.keeper.start();
    for _ in 0..3 {
        signed_out.tick();
    }
    assert_eq!(signed_out.count("quit"), 0);
    let signing_in = fixture(Options { poll_ms: POLL, processes: client(|_| {}), ..Options::default() });
    signing_in.keeper.start();
    signing_in.tick();
    signing_in.set_busy(true);
    signing_in.tick();
    signing_in.tick();
    signing_in.set_busy(false);
    signing_in.tick();
    assert_eq!(signing_in.count("quit"), 0);
    let playing = fixture(Options { poll_ms: POLL, processes: client(|_| {}), ..Options::default() });
    playing.keeper.start();
    playing.tick();
    playing.processes(client(|processes| processes.val = true));
    playing.tick();
    assert_eq!(playing.count("quit"), 0);
    let gone = fixture(Options { poll_ms: POLL, ..Options::default() });
    gone.keeper.start();
    for _ in 0..3 {
        gone.tick();
    }
    assert_eq!(gone.count("authorization?"), 0);
}

#[test]
fn a_failed_process_check_never_stops_the_client_polling() {
    let f = fixture(Options { poll_ms: POLL, ..Options::default() });
    f.scene(|scene| scene.processes_fail = true);
    f.keeper.start();
    f.tick();
    f.tick();
    assert_eq!(f.count("quit"), 0);
}

#[test]
fn sessions_saved_before_cards_mode_kept_sessions_are_forgotten_at_start_once_and_their_cards_are_refreshed() {
    let f = fixture(Options {
        yaml: "tdid only".into(),
        sessions: vec![("a", login("sub-a")), ("b", login("sub-b")), ("c", login("sub-c"))],
        saved_at: vec![("a", KEPT_SINCE_MS - 86_400_000.0), ("c", KEPT_SINCE_MS)],
        ..Options::default()
    });
    f.keeper.start();
    let arrays: Vec<Value> = f.events().into_iter().filter(Value::is_array).collect();
    assert_eq!(arrays, [json!(["forget-session", "a"]), json!(["saved", "a"])]);
    assert!(!f.store.has_session("a"));
    assert!(f.store.has_session("b"));
    assert!(f.store.has_session("c"));
    assert_eq!(f.logs(), ["forgot 1 saved session(s) from before cards mode kept sessions"]);
    f.keeper.start();
    assert_eq!(f.forgets().len(), 1);
    let failing = fixture(Options { yaml: "tdid only".into(), saved_at: vec![("a", 1.0), ("b", 1.0)], ..Options::default() });
    *failing.store.failure.lock().unwrap() = "C:/secret/path".into();
    failing.store.fail("forget_session:a");
    failing.keeper.start();
    assert!(failing.store.has_session("a"));
    assert!(!failing.store.has_session("b"));
    assert_eq!(failing.logs(), ["forgot 1 saved session(s) from before cards mode kept sessions"]);
}
