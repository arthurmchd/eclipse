use std::sync::{Arc, Mutex};

use eclipse::integration::manager::manager_host::{bridge_script, trusted, Caller, ManagerHost, COMMAND, FAILED, INVALID, UNTRUSTED};
use serde_json::{json, Value};

type Calls = Arc<Mutex<Vec<(String, Vec<Value>)>>>;

fn host(answer: Result<Value, String>) -> (ManagerHost, Calls, Arc<Mutex<Vec<String>>>) {
    let calls: Calls = Arc::default();
    let actions: Arc<Mutex<Vec<String>>> = Arc::default();
    let (recorded, done) = (calls.clone(), actions.clone());
    let host = ManagerHost::new(
        Box::new(move |method, args| {
            recorded.lock().unwrap().push((method.to_string(), args.to_vec()));
            answer.clone()
        }),
        Box::new(move |action| {
            done.lock().unwrap().push(action.to_string());
            action == "minimize"
        }),
    );
    (host, calls, actions)
}

const CARDS: Caller = Caller { label: "cards", url: Some("http://eclipse.localhost/src/renderer/cards.html") };

#[test]
fn commands_are_only_taken_from_the_cards_webview_at_the_exact_cards_page() {
    let (host, calls, actions) = host(Ok(json!({ "saved": true })));
    assert!(trusted(&CARDS));
    let input = json!([{ "gameName": "Example", "password": "synthetic-only" }]);
    assert_eq!(host.invoke(&CARDS, "saveAccount", &input), Ok(json!({ "saved": true })));
    for caller in [
        Caller { label: "toggle", url: CARDS.url },
        Caller { label: "cover", url: CARDS.url },
        Caller { label: "cards", url: Some("http://eclipse.localhost/src/integration/overlay/toggle.html") },
        Caller { label: "cards", url: Some("http://127.0.0.1:1234/index.html") },
        Caller { label: "cards", url: Some("https://eclipse.localhost/src/renderer/cards.html") },
        Caller { label: "cards", url: None },
    ] {
        assert_eq!(host.invoke(&caller, "init", &json!([])), Err(UNTRUSTED.to_string()));
        assert_eq!(host.invoke(&caller, "windowAction", &json!(["minimize"])), Err(UNTRUSTED.to_string()));
    }
    assert_eq!(*calls.lock().unwrap(), [("saveAccount".to_string(), input.as_array().unwrap().clone())]);
    assert!(actions.lock().unwrap().is_empty());
}

#[test]
fn invalid_commands_and_oversized_payloads_never_reach_the_credential_service() {
    let (host, calls, _) = host(Ok(json!(true)));
    for method in ["readPassword", "closeManager", "copy", "patchAccount", "forgetSession", "showRiotClient", "pickClientPath", "openDataFolder", "setModal"] {
        assert_eq!(host.invoke(&CARDS, method, &json!([])), Err(INVALID.to_string()));
    }
    assert_eq!(host.invoke(&CARDS, "init", &json!({})), Err(INVALID.to_string()));
    assert_eq!(host.invoke(&CARDS, "init", &json!([1, 2, 3, 4, 5])), Err(INVALID.to_string()));
    assert_eq!(host.invoke(&CARDS, "saveAccount", &json!([{ "note": "x".repeat(33000) }])), Err(FAILED.to_string()));
    assert!(calls.lock().unwrap().is_empty());
    assert_eq!(host.invoke(&CARDS, "init", &json!([1, 2, 3, 4])), Ok(json!(true)));
}

#[test]
fn the_cards_ask_for_riot_window_actions_locally_and_only_from_a_fixed_list() {
    let (host, calls, actions) = host(Ok(json!(true)));
    assert_eq!(host.invoke(&CARDS, "windowAction", &json!(["minimize"])), Ok(json!({ "ok": true })));
    assert_eq!(host.invoke(&CARDS, "windowAction", &json!(["close"])), Ok(json!({ "ok": false })));
    assert!(host.invoke(&CARDS, "windowAction", &json!(["drag"])).is_ok());
    for args in [json!(["quit"]), json!(["reveal"]), json!([]), json!(["minimize", "close"]), json!(["drag", 10, 20]), json!([1]), json!([{ "action": "close" }]), json!("minimize")] {
        assert_eq!(host.invoke(&CARDS, "windowAction", &args), Err(INVALID.to_string()));
    }
    assert_eq!(*actions.lock().unwrap(), ["minimize", "close", "drag"]);
    assert!(calls.lock().unwrap().is_empty());
}

#[test]
fn service_failures_are_generic_and_cannot_echo_credentials_into_the_page() {
    let (host, _, _) = host(Err("synthetic-private-token".into()));
    let error = host.invoke(&CARDS, "init", &json!([])).unwrap_err();
    assert_eq!(error, FAILED);
    assert!(!error.contains("synthetic-private-token"));
}

#[test]
fn only_https_links_from_the_cards_open_outside() {
    let (host, calls, _) = host(Ok(json!(true)));
    for url in ["https://developer.riotgames.com", "file:///private-data", "http://example.invalid", "not a link"] {
        host.open_external(url);
    }
    assert_eq!(*calls.lock().unwrap(), [("openExternal".to_string(), vec![json!("https://developer.riotgames.com")])]);
}

#[test]
fn the_bridge_reuses_the_manager_preload_over_the_single_manager_command() {
    let script = bridge_script();
    assert_eq!(COMMAND, "manager");
    assert!(script.contains(include_str!("../../../../src/integration/manager/manager-preload.js")));
    assert!(script.contains("window.__TAURI_INTERNALS__.invoke('manager', { method, args })"));
    assert!(script.contains("Object.defineProperty(window, 'api', { value: api, enumerable: true })"));
    assert!(script.starts_with("(() => {\nconst module = undefined;\n"));
    assert!(!script.contains("electron") && !script.contains("require("));
}
