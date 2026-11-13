use std::sync::Arc;

use eclipse::riot::riot_app_controls::{close_mode, CloseMode, CloseSettings, RiotAppControls, CLOSE_READS, COMMAND_LINE, FLAG, PLAYER_CHOICE, QUIT, SWITCH_TO_BACKGROUND};
use eclipse::riot::RiotError;
use serde_json::{json, Map, Value};

use crate::{reply, route, FakeApi};

fn settings(value: &Value) -> CloseSettings {
    let get = |key: &str| value.get(key).cloned();
    CloseSettings {
        flag: get("flag"),
        player_choice: get("playerChoice"),
        command_line: get("commandLine"),
        from_xbox: get("fromXbox"),
        xbox_running: get("xboxRunning"),
        xbox_notice_dismissed: get("xboxNoticeDismissed"),
    }
}

#[test]
fn closing_follows_the_same_choice_as_the_riot_close_button() {
    use CloseMode::{Background, Quit};
    let cases = [
        (json!({}), Quit),
        (json!({ "flag": true }), Background),
        (json!({ "flag": true, "playerChoice": true }), Background),
        (json!({ "flag": true, "playerChoice": false }), Quit),
        (json!({ "flag": true, "playerChoice": "off" }), Background),
        (json!({ "flag": true, "playerChoice": false, "commandLine": ["--launch-product=valorant", "--launch-background-mode"] }), Background),
        (json!({ "flag": true, "playerChoice": false, "commandLine": "--launch-background-mode" }), Quit),
        (json!({ "flag": false, "playerChoice": true }), Quit),
        (json!({ "flag": false, "playerChoice": false, "fromXbox": true }), Background),
        (json!({ "flag": false, "xboxRunning": true }), Background),
        (json!({ "flag": false, "xboxRunning": true, "xboxNoticeDismissed": true }), Quit),
        (json!({ "flag": true, "playerChoice": false, "xboxRunning": true }), Background),
        (json!({ "flag": true, "playerChoice": false, "xboxRunning": true, "xboxNoticeDismissed": true }), Quit),
    ];
    for (input, expected) in cases {
        assert_eq!(close_mode(&settings(&input)), expected, "{input}");
    }
    assert_eq!(close_mode(&CloseSettings::default()), Quit);
}

fn values(pairs: &[(&str, Value)]) -> Map<String, Value> {
    pairs.iter().map(|(key, value)| (key.to_string(), value.clone())).collect()
}

fn controls(values: Map<String, Value>, post: u16) -> (Arc<FakeApi>, RiotAppControls) {
    let api = FakeApi::new(move |method, path, _| {
        if method == "POST" {
            return reply(post, Value::Null);
        }
        match values.get(path) {
            Some(value) => reply(200, value.clone()),
            None => reply(404, json!({ "errorCode": "RESOURCE_NOT_FOUND" })),
        }
    });
    let controls = RiotAppControls::new(api.clone());
    (api, controls)
}

fn posts(api: &FakeApi) -> usize {
    api.routes().iter().filter(|(method, _)| method == "POST").count()
}

#[test]
fn closing_reads_the_riot_settings_and_asks_the_local_service_to_go_to_the_background() {
    let (api, controls) = controls(values(&[(FLAG, json!(true))]), 204);
    assert_eq!(controls.close().unwrap(), CloseMode::Background);
    let mut reads: Vec<String> = api.routes().into_iter().filter(|(method, _)| method == "GET").map(|(_, path)| path).collect();
    reads.sort();
    let mut expected: Vec<String> = CLOSE_READS.iter().map(|path| path.to_string()).collect();
    expected.sort();
    assert_eq!(reads, expected);
    assert_eq!(api.routes().last().unwrap(), &route("POST", SWITCH_TO_BACKGROUND));
    assert_eq!(posts(&api), 1);
}

#[test]
fn closing_quits_through_the_local_service_when_the_player_turned_background_running_off() {
    let (api, controls) = controls(values(&[(FLAG, json!(true)), (PLAYER_CHOICE, json!(false)), (COMMAND_LINE, json!(["--launch-product=league_of_legends"]))]), 204);
    assert_eq!(controls.close().unwrap(), CloseMode::Quit);
    assert_eq!(api.routes().last().unwrap(), &route("POST", QUIT));
}

#[test]
fn closing_fails_without_a_second_request_when_the_service_refuses_or_is_unreachable() {
    let (refused_api, refused) = controls(values(&[(FLAG, json!(true))]), 500);
    assert!(refused.close().unwrap_err().message.contains("did not accept the close request"));
    assert_eq!(posts(&refused_api), 1);
    let api = FakeApi::new(|_, _, _| Err(RiotError::new("The local Riot service could not complete the request")));
    let unreachable = RiotAppControls::new(api.clone());
    assert!(unreachable.close().unwrap_err().message.contains("could not complete the request"));
    assert_eq!(posts(&api), 0);
}
