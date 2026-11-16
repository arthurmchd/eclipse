use std::sync::{Arc, Mutex};

use eclipse::application::manager_service::{Failure, ManagerEvents, ManagerPorts, ManagerService};
use eclipse::application::store::{AccountInput, Store};
use serde_json::{json, Map, Value};
use tempfile::TempDir;

use super::temporary_store;

#[derive(Default)]
struct Ports {
    calls: Mutex<Vec<Value>>,
    active: Mutex<Option<String>>,
    failing_settings: bool,
}

impl Ports {
    fn record(&self, call: Value) {
        self.calls.lock().unwrap().push(call);
    }

    fn calls(&self) -> Vec<Value> {
        self.calls.lock().unwrap().clone()
    }

    fn names(&self) -> Vec<String> {
        self.calls().iter().map(|call| call[0].as_str().unwrap().to_string()).collect()
    }
}

impl ManagerPorts for Ports {
    fn active_account_id(&self) -> Option<String> {
        self.active.lock().unwrap().clone()
    }

    fn operation(&self) -> Value {
        json!({ "id": "operation-1", "status": "running", "password": "fixture-plaintext" })
    }

    fn start_sign_in(&self, id: &str, game: &str) -> Result<Value, Failure> {
        self.record(json!(["sign-in", id, game]));
        Ok(json!({ "ok": true, "operationId": "operation-1" }))
    }

    fn cancel_sign_in(&self) -> Value {
        self.record(json!(["cancel"]));
        json!({ "ok": true })
    }

    fn running_games(&self) -> Result<Value, Failure> {
        Ok(json!({ "lol": false, "val": true }))
    }

    fn open_external(&self, url: &str) -> Result<(), Failure> {
        self.record(json!(["url", url]));
        Ok(())
    }

    fn refresh_all(&self, ids: Option<Vec<String>>) {
        self.record(json!(["refresh", ids]));
    }

    fn schedule_refresh(&self) {
        self.record(json!(["schedule"]));
    }

    fn init_context(&self) -> Map<String, Value> {
        json!({ "regions": { "br1": {} }, "valRegions": ["br"], "nextRefresh": "2026-10-27T12:00:00.000Z" }).as_object().unwrap().clone()
    }

    fn settings_changed(&self, settings: &Map<String, Value>) {
        if self.failing_settings {
            panic!("tray unavailable");
        }
        self.record(json!(["changed", settings["language"]]));
    }
}

struct Fixture {
    _dir: TempDir,
    store: Arc<Mutex<Store>>,
    ports: Arc<Ports>,
    service: ManagerService,
    account: String,
}

fn fixture_with(ports: Ports) -> Fixture {
    let (dir, mut store) = temporary_store();
    let saved = store
        .upsert_account(AccountInput {
            game_name: "Example".into(),
            tag_line: "BR1".into(),
            region: "br1".into(),
            username: "fixture-user".into(),
            password: Some("fixture-password".into()),
            ..AccountInput::default()
        })
        .unwrap();
    let account = saved["id"].as_str().unwrap().to_string();
    store.update_account_fields(&account, json!({ "stats": { "lol": { "rank": "GOLD", "token": "fixture-token" } } }).as_object().unwrap().clone()).unwrap();
    store.save_session(&account, "fixture-session").unwrap();
    let store = Arc::new(Mutex::new(store));
    let ports = Arc::new(ports);
    let service = ManagerService::new(store.clone(), ports.clone(), Arc::new(ManagerEvents::default()));
    Fixture { _dir: dir, store, ports, service, account }
}

fn fixture() -> Fixture {
    fixture_with(Ports::default())
}

fn status(result: Result<Value, Failure>) -> u16 {
    result.unwrap_err().status
}

#[test]
fn initialization_and_operations_retain_account_metadata_without_saved_credentials() {
    let f = fixture();
    let data = f.service.dispatch("init", &[]).unwrap();
    assert_eq!(data["accounts"][0]["username"], "fixture-user");
    assert_eq!(data["accounts"][0]["hasPassword"], true);
    assert_eq!(data["accounts"][0]["hasSession"], true);
    assert_eq!(data["accounts"][0]["stats"]["lol"]["rank"], "GOLD");
    assert_eq!(data["regions"], json!({ "br1": {} }));
    assert_eq!(data["eventCursor"], 0);
    let exposed = json!([data, f.service.dispatch("operation", &[]).unwrap()]).to_string();
    for value in ["fixture-password", "test-encrypted:", "fixture-token", "fixture-plaintext", "fixture-session"] {
        assert!(!exposed.contains(value), "{value}");
    }
}

#[test]
fn the_account_form_creates_edits_and_deletes_accounts() {
    let f = fixture();
    let input = json!({ "gameName": "New", "tagLine": "BR1", "region": "br1", "valRegion": "br", "username": "new-fixture-user", "password": "new-fixture-password", "note": "demo", "lastSeason": { "lol": "Gold", "tft": "", "val": "" }, "ban": null });
    let saved = f.service.dispatch("saveAccount", &[input.clone()]).unwrap();
    let id = saved["id"].as_str().unwrap().to_string();
    assert!(saved.get("password").is_none());
    assert_eq!(f.store.lock().unwrap().get_password(&id).unwrap(), "new-fixture-password");
    assert_eq!(f.ports.calls().last().unwrap(), &json!(["refresh", [id]]));
    let mut edit = input.clone();
    edit["id"] = json!(id);
    edit["gameName"] = json!("Edited");
    edit.as_object_mut().unwrap().remove("password");
    let edited = f.service.dispatch("saveAccount", &[edit]).unwrap();
    assert_eq!(edited["gameName"], "Edited");
    assert_eq!(f.store.lock().unwrap().get_password(&id).unwrap(), "new-fixture-password");
    assert_eq!(f.service.dispatch("deleteAccount", &[json!(id)]).unwrap(), true);
    assert!(f.store.lock().unwrap().get_account(&id).is_none());
}

#[test]
fn management_commands_reject_unknown_fields_invalid_values_and_active_credential_edits() {
    let f = fixture();
    let input = json!({ "gameName": "New", "tagLine": "BR1", "username": "demo", "region": "br1", "password": "demo" });
    let with = |key: &str, value: Value| {
        let mut changed = input.clone();
        changed[key] = value;
        changed
    };
    let mut without_password = input.clone();
    without_password.as_object_mut().unwrap().remove("password");
    let mut requests = vec![
        ("saveAccount", vec![with("region", json!("unknown"))]),
        ("saveAccount", vec![with("valRegion", json!("xx"))]),
        ("saveAccount", vec![without_password]),
        ("saveAccount", vec![with("session", json!("disallowed"))]),
        ("saveAccount", vec![with("ban", json!({ "game": "val", "permanent": false, "until": "invalid" }))]),
        ("saveAccount", vec![with("gameName", json!("a\u{0001}b"))]),
        ("saveAccount", vec![with("gameName", json!("   "))]),
        ("saveAccount", vec![with("tagLine", json!("x".repeat(17)))]),
        ("saveAccount", vec![with("lastSeason", json!({ "other": "" }))]),
        ("saveAccount", vec![json!({ "__proto__": {}, "gameName": "New" })]),
        ("saveAccount", vec![json!("not an object")]),
        ("deleteAccount", vec![json!("../account-1")]),
        ("saveSettings", vec![json!({ "refreshMinutes": -1 })]),
        ("saveSettings", vec![json!({ "refreshMinutes": 10081 })]),
        ("saveSettings", vec![json!({ "unexpected": true })]),
        ("saveSettings", vec![json!({ "staySignedIn": "no" })]),
        ("patchAccount", vec![json!("account-1"), json!({ "pinned": true })]),
        ("forgetSession", vec![json!("account-1")]),
        ("copy", vec![json!("account-1"), json!("password")]),
        ("showRiotClient", vec![]),
        ("pickClientPath", vec![]),
        ("openDataFolder", vec![]),
        ("closeManager", vec![]),
        ("constructor", vec![]),
        ("init", vec![json!("extra")]),
    ];
    for key in ["streamerMode", "hideRiotClient", "closeRiotClient", "minimizeOnLaunch"] {
        requests.push(("saveSettings", vec![json!({ key: true })]));
    }
    for (method, args) in requests {
        assert_eq!(status(f.service.dispatch(method, &args)), 400, "{method} {args:?}");
    }
    *f.ports.active.lock().unwrap() = Some(f.account.clone());
    let mut own = input.clone();
    own["id"] = json!(f.account);
    assert_eq!(status(f.service.dispatch("deleteAccount", &[json!(f.account)])), 409);
    assert_eq!(status(f.service.dispatch("saveAccount", &[own])), 409);
    assert!(f.ports.calls().is_empty());
}

#[test]
fn a_ban_is_kept_only_in_its_known_shape() {
    let f = fixture();
    let input = json!({ "gameName": "New", "tagLine": "BR1", "username": "demo", "region": "br1", "password": "demo", "ban": { "game": "val", "permanent": false, "until": "2026-12-01T00:00:00.000Z" } });
    let saved = f.service.dispatch("saveAccount", &[input.clone()]).unwrap();
    assert_eq!(saved["ban"], json!({ "game": "val", "permanent": false, "until": "2026-12-01T00:00:00.000Z" }));
    let mut permanent = input.clone();
    permanent["ban"] = json!({ "game": "all", "permanent": true, "until": "ignored" });
    let saved = f.service.dispatch("saveAccount", &[permanent]).unwrap();
    assert_eq!(saved["ban"], json!({ "game": "all", "permanent": true, "until": null }));
}

#[test]
fn settings_return_masked_keys_and_restart_the_refresh_schedule() {
    let f = fixture();
    let settings = f.service.dispatch("saveSettings", &[json!({ "refreshMinutes": 15, "staySignedIn": false, "riotApiKey": "fixture-key-0123456789" })]).unwrap();
    assert_eq!(settings["staySignedIn"], false);
    assert_eq!(settings["refreshMinutes"], 15);
    assert_eq!(settings["nextRefresh"], "2026-10-27T12:00:00.000Z");
    assert_eq!(settings["riotApiKeyMasked"], "fixture-…6789");
    assert!(settings.get("riotApiKey").is_none());
    assert!(!settings.to_string().contains("fixture-key-0123456789"));
    assert_eq!(f.ports.names(), vec!["schedule", "changed"]);
}

#[test]
fn launch_acknowledges_immediately_and_exposes_cancel_and_game_status() {
    let f = fixture();
    let id = json!(f.account);
    assert_eq!(f.service.dispatch("signIn", &[id.clone(), json!("tft")]).unwrap(), json!({ "ok": true, "operationId": "operation-1" }));
    assert_eq!(f.ports.calls()[0], json!(["sign-in", f.account, "tft"]));
    assert_eq!(f.service.dispatch("runningGames", &[]).unwrap(), json!({ "lol": false, "val": true }));
    assert_eq!(f.service.dispatch("cancelSignIn", &[]).unwrap(), json!({ "ok": true }));
    f.service.dispatch("signIn", &[id.clone(), json!("riot")]).unwrap();
    assert_eq!(f.ports.calls().last().unwrap(), &json!(["sign-in", f.account, "riot"]));
    assert_eq!(status(f.service.dispatch("signIn", &[id, json!("other")])), 400);
}

#[test]
fn rank_refresh_returns_before_work_and_validates_the_selected_ids() {
    let f = fixture();
    let result = f.service.dispatch("refresh", &[json!([f.account])]).unwrap();
    assert_eq!(result["started"], true);
    assert_eq!(f.ports.calls(), vec![json!(["refresh", [f.account]])]);
    f.service.dispatch("refresh", &[]).unwrap();
    assert_eq!(f.ports.calls().last().unwrap(), &json!(["refresh", null]));
    assert_eq!(status(f.service.dispatch("refresh", &[json!(["unknown"])])), 404);
    assert_eq!(status(f.service.dispatch("refresh", &[json!(vec![f.account.clone(); 129])])), 400);
    assert_eq!(status(f.service.dispatch("refresh", &[json!("not a list")])), 400);
}

#[test]
fn external_navigation_permits_https_only_without_url_credentials() {
    let f = fixture();
    f.service.dispatch("openExternal", &[json!("https://example.com/help")]).unwrap();
    assert_eq!(f.ports.calls(), vec![json!(["url", "https://example.com/help"])]);
    for url in ["file:///C:/private", "javascript:alert(1)", "http://example.com/", "https://user:pass@example.com", "not a url", ""] {
        assert_eq!(status(f.service.dispatch("openExternal", &[json!(url)])), 400, "{url}");
    }
}

#[test]
fn event_history_strips_secrets_keeps_snapshots_and_signals_overflow_resynchronization() {
    let events = ManagerEvents::new(2, 768 * 1024);
    let account = json!({ "id": "account-1", "gameName": "Original", "password": "private", "hasPassword": true, "hasSession": true, "stats": { "authorization": "private", "rank": "SILVER" }, "puuidCache": "private-extra" });
    events.publish("account-updated", &account);
    let snapshot = events.read(&json!(0)).unwrap();
    assert_eq!(snapshot["events"][0]["payload"]["gameName"], "Original");
    assert_eq!(snapshot["events"][0]["payload"]["hasPassword"], true);
    assert!(!snapshot.to_string().contains("private"));
    events.publish("refresh-progress", &json!({ "done": 1, "total": 2 }));
    events.publish("next-refresh", &Value::Null);
    events.publish("unknown", &json!({}));
    assert_eq!(events.cursor(), 3);
    assert_eq!(events.read(&json!(0)).unwrap()["reset"], true);
    assert_eq!(events.read(&json!(1)).unwrap()["reset"], false);
    assert_eq!(events.read(&json!(10)).unwrap()["reset"], true);
    assert_eq!(events.read(&json!(1)).unwrap()["events"].as_array().unwrap().len(), 2);
    for cursor in [json!(-1), json!(1.5), json!("1"), Value::Null] {
        assert_eq!(events.read(&cursor).unwrap_err().status, 400);
    }
    let bounded = ManagerEvents::new(256, 100);
    bounded.publish("sign-in-status", &json!({ "text": "x".repeat(200) }));
    assert_eq!(bounded.read(&json!(0)).unwrap(), json!({ "cursor": 1, "reset": true, "events": [] }));
}

#[test]
fn objects_with_prototype_keys_are_dropped_from_events() {
    let events = ManagerEvents::default();
    events.publish("sign-in-status", &json!({ "text": "ok", "nested": { "constructor": 1 } }));
    assert_eq!(events.read(&json!(0)).unwrap()["events"][0]["payload"], json!({ "text": "ok", "nested": null }));
}

#[test]
fn the_card_layout_is_saved_only_as_plates_or_list() {
    let f = fixture();
    for layout in [json!("grid"), json!("LIST"), json!(""), json!(1), Value::Null, json!(true)] {
        let failure = f.service.dispatch("saveSettings", &[json!({ "cardLayout": layout })]).unwrap_err();
        assert_eq!(failure.message, "Invalid setting");
    }
    assert!(f.ports.calls().is_empty());
    assert_eq!(f.service.dispatch("saveSettings", &[json!({ "cardLayout": "list" })]).unwrap()["cardLayout"], "list");
    assert_eq!(f.service.dispatch("saveSettings", &[json!({ "cardLayout": "plates" })]).unwrap()["cardLayout"], "plates");
}

#[test]
fn language_is_saved_only_as_pt_or_en_and_announces_the_settings_change() {
    let f = fixture();
    for language in [json!("fr"), json!("EN"), json!(""), json!(1), Value::Null, json!(true)] {
        let failure = f.service.dispatch("saveSettings", &[json!({ "language": language })]).unwrap_err();
        assert_eq!(failure.message, "Invalid setting");
    }
    assert!(f.ports.calls().is_empty());
    assert_eq!(f.service.dispatch("saveSettings", &[json!({ "language": "en" })]).unwrap()["language"], "en");
    assert_eq!(f.service.dispatch("saveSettings", &[json!({ "language": "pt", "refreshMinutes": 5 })]).unwrap()["language"], "pt");
    let changed: Vec<Value> = f.ports.calls().into_iter().filter(|call| call[0] == "changed").map(|call| call[1].clone()).collect();
    assert_eq!(changed, vec![json!("en"), json!("pt")]);
    let failing = fixture_with(Ports { failing_settings: true, ..Ports::default() });
    assert_eq!(failing.service.dispatch("saveSettings", &[json!({ "language": "en" })]).unwrap()["language"], "en");
}
