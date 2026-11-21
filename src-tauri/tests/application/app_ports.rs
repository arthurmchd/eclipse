use std::sync::{Arc, Mutex};

use eclipse::application::app_ports::{running_games_json, save_leaving_session, AppPorts, Leaving, KEPT_OWNER, KEPT_PREVIOUS, OPEN_FAILED, UNCONFIRMED};
use eclipse::application::manager_service::ManagerPorts;
use eclipse::application::rank_api::{regions_json, VAL_REGIONS};
use eclipse::application::refresher::{RefreshHooks, Refresher};
use eclipse::application::sign_in_service::{SignInObservers, SignInRunner, SignInService};
use eclipse::riot::sign_in_flow::{Closed, SignInOutcome, SignInRequest};
use eclipse::riot::{RiotError, RiotId, RiotResult, RunningGames};
use serde_json::{json, Map, Value};

use super::{temporary_store, FakeStore, ManualTimers};

struct Refusing;

impl SignInRunner for Refusing {
    fn sign_in(&self, _request: &SignInRequest) -> RiotResult<SignInOutcome> {
        Err(RiotError::new("synthetic"))
    }
}

fn ports(changed: Arc<Mutex<Vec<Value>>>, opened: Arc<Mutex<Vec<String>>>) -> (AppPorts, Arc<ManualTimers>, tempfile::TempDir) {
    let timers = ManualTimers::new();
    let sign_in = Arc::new(SignInService::new(FakeStore::new(vec![]), Arc::new(Refusing), timers.clone(), SignInObservers::default()));
    let (dir, store) = temporary_store();
    let hooks = RefreshHooks { refresh_account: Box::new(|_, _| Map::new()), check_game: Box::new(|| true), publish: Box::new(|_, _| {}), now: Box::new(|| 0) };
    let refresher = Arc::new(Refresher::new(Arc::new(Mutex::new(store)), timers.clone(), hooks));
    let ports = AppPorts {
        sign_in,
        refresher,
        running_games: Box::new(|| Ok(RunningGames { lol: true, lor: true, client: true, ..RunningGames::default() })),
        open_external: Box::new(move |url| {
            opened.lock().unwrap().push(url.to_string());
            if url.contains("fail") {
                Err("C:\\Users\\synthetic\\private path".into())
            } else {
                Ok(())
            }
        }),
        settings_changed: Box::new(move |settings| changed.lock().unwrap().push(Value::Object(settings.clone()))),
        seen_account: Box::new(|| Some(RiotId::new("Seen", "BR1"))),
        startup: Box::new(|turn| Some(turn.unwrap_or(false))),
        version: "1.0.0".into(),
    };
    (ports, timers, dir)
}

#[test]
fn the_cards_get_regions_version_and_refresh_times_from_the_app() {
    let (ports, _timers, _dir) = ports(Arc::default(), Arc::default());
    let context = ports.init_context();
    assert_eq!(context.keys().collect::<Vec<_>>(), ["regions", "valRegions", "version", "lastRefresh", "nextRefresh", "seenAccount"]);
    assert_eq!(context["seenAccount"], json!({ "gameName": "Seen", "tagLine": "BR1" }));
    assert_eq!(context["regions"], regions_json());
    assert_eq!(context["valRegions"], json!(VAL_REGIONS));
    assert_eq!(context["version"], json!("1.0.0"));
    assert_eq!(context["lastRefresh"], Value::Null);
    assert_eq!(context["nextRefresh"], json!("1970-01-01T00:30:00.000Z"));
    assert_eq!(ports.operation(), Value::Null);
    assert_eq!(ports.active_account_id(), None);
    assert_eq!(ports.start_with_windows(None), Some(false));
    assert_eq!(ports.start_with_windows(Some(true)), Some(true));
}

#[test]
fn running_games_links_and_settings_go_to_their_own_handlers_without_leaking_details() {
    let changed: Arc<Mutex<Vec<Value>>> = Arc::default();
    let opened: Arc<Mutex<Vec<String>>> = Arc::default();
    let (ports, timers, _dir) = ports(changed.clone(), opened.clone());
    assert_eq!(ports.running_games().unwrap(), json!({ "lol": true, "val": false, "tft": false, "2xko": false, "lor": true, "client": true, "clientWindow": false }));
    assert_eq!(running_games_json(RunningGames::default()), json!({ "lol": false, "val": false, "tft": false, "2xko": false, "lor": false, "client": false, "clientWindow": false }));
    assert!(ports.open_external("https://developer.riotgames.com").is_ok());
    let failure = ports.open_external("https://fail.invalid").unwrap_err();
    assert_eq!(failure.message, OPEN_FAILED);
    assert_eq!(*opened.lock().unwrap(), ["https://developer.riotgames.com", "https://fail.invalid"]);
    ports.settings_changed(json!({ "language": "en" }).as_object().unwrap());
    assert_eq!(*changed.lock().unwrap(), [json!({ "language": "en" })]);
    ports.refresh_all(None);
    assert_eq!(timers.delays(), [0]);
}

#[test]
fn a_sign_in_the_service_refuses_comes_back_as_a_conflict() {
    let (ports, _timers, _dir) = ports(Arc::default(), Arc::default());
    let failure = ports.start_sign_in("missing", "lol").unwrap_err();
    assert_eq!(failure.status, 409);
    assert!(!failure.message.is_empty());
    assert_eq!(ports.cancel_sign_in(), ports.cancel_sign_in());
}

const REMEMBERED: &str = "riot-login:\n  persist:\n    session:\n      cookies:\n        - name: \"ssid\"\n";

fn leaving(store: &FakeStore, current: Option<&str>, owner: Result<Option<String>, String>, closed: &Closed) -> (Result<(), String>, Vec<Value>, Vec<String>, Vec<String>) {
    let published: Mutex<Vec<Value>> = Mutex::default();
    let lines: Mutex<Vec<String>> = Mutex::default();
    let kept: Mutex<Vec<String>> = Mutex::default();
    let keep = |yaml: &str| {
        kept.lock().unwrap().push(yaml.to_string());
        owner.clone()
    };
    let publish = |account: Map<String, Value>| published.lock().unwrap().push(Value::Object(account));
    let log = |line: &str| lines.lock().unwrap().push(line.to_string());
    let result = save_leaving_session(closed, Leaving { keep: &keep, store, current: current.map(str::to_string), publish: &publish, log: &log });
    (result, published.into_inner().unwrap(), lines.into_inner().unwrap(), kept.into_inner().unwrap())
}

fn closed(riot_id: Option<RiotId>, yaml: Option<&str>) -> Closed {
    Closed { signed_in: true, riot_id, yaml: yaml.map(str::to_string) }
}

#[test]
fn the_session_left_by_riot_goes_to_the_account_it_belongs_to_and_never_to_an_unconfirmed_one() {
    let store = FakeStore::new(vec![json!({ "id": "a", "gameName": "Synthetic", "tagLine": "BR1", "username": "hidden" })]);
    let mine = Some(RiotId::new("synthetic", "br1"));
    let (result, published, lines, kept) = leaving(&store, Some("a"), Ok(Some("a".into())), &closed(mine.clone(), Some(REMEMBERED)));
    assert_eq!((result, published, lines, kept), (Ok(()), vec![], vec![KEPT_OWNER.to_string()], vec![REMEMBERED.to_string()]));
    assert!(store.calls().is_empty());
    let (result, published, lines, _) = leaving(&store, Some("a"), Ok(None), &closed(mine.clone(), Some(REMEMBERED)));
    assert_eq!(result, Ok(()));
    assert_eq!(published, [json!({ "id": "a", "gameName": "Synthetic", "tagLine": "BR1" })]);
    assert_eq!(lines, [KEPT_PREVIOUS]);
    assert_eq!(store.calls(), [json!(["save-session", "a", REMEMBERED])]);
    for riot_id in [None, Some(RiotId::new("Other", "BR1"))] {
        let (result, published, lines, _) = leaving(&store, Some("a"), Ok(None), &closed(riot_id, Some(REMEMBERED)));
        assert_eq!((result, published.len(), lines), (Ok(()), 0, vec![UNCONFIRMED.to_string()]));
    }
    for (current, yaml) in [(None, Some(REMEMBERED)), (Some("missing"), Some(REMEMBERED)), (Some("a"), Some("riot-login: {}\n")), (Some("a"), None)] {
        let (result, published, lines, _) = leaving(&store, current, Ok(None), &closed(mine.clone(), yaml));
        assert_eq!((result, published.len(), lines.len()), (Ok(()), 0, 0));
    }
    assert_eq!(store.calls().len(), 1);
    let (result, _, lines, _) = leaving(&store, Some("a"), Err("synthetic keep failure".into()), &closed(mine.clone(), Some(REMEMBERED)));
    assert_eq!(result, Err("synthetic keep failure".into()));
    assert!(lines.is_empty());
    store.fail("save_session");
    let (result, published, _, _) = leaving(&store, Some("a"), Ok(None), &closed(mine, Some(REMEMBERED)));
    assert!(result.is_err());
    assert!(published.is_empty());
}
