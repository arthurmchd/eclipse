use eclipse::integration::overlay::overlay_cover::{language_script, CoverSteps, DETAIL_LIMIT, INIT_SCRIPT};
use serde_json::{json, Value};

#[test]
fn only_a_running_sign_in_becomes_steps_and_unknown_values_fall_back_to_the_first_step_and_league() {
    for operation in [json!(null), json!({ "status": "failed", "step": "sign_in" }), json!({ "status": "succeeded" }), json!({ "step": "verify" })] {
        assert_eq!(CoverSteps::from_operation(&operation), None, "{operation}");
    }
    let steps = CoverSteps::from_operation(&json!({ "status": "running", "step": "launch", "game": "val", "signedIn": true, "text": "Starting VALORANT in the background…" })).unwrap();
    assert_eq!(steps, CoverSteps { step: "launch", game: "val", signed_in: true, detail: "Starting VALORANT in the background…".into() });
    let odd = CoverSteps::from_operation(&json!({ "status": "running", "step": "LAUNCH", "game": "<b>", "signedIn": "yes", "text": 42 })).unwrap();
    assert_eq!(odd, CoverSteps { step: "prepare", game: "lol", signed_in: false, detail: String::new() });
}

#[test]
fn the_detail_is_short_and_without_control_characters_and_the_script_carries_it_as_json_data() {
    let long = format!("a\nb\u{0}c{}", "x".repeat(400));
    let steps = CoverSteps::from_operation(&json!({ "status": "running", "step": "verify", "game": "lol", "text": long })).unwrap();
    assert_eq!(steps.detail.chars().count(), DETAIL_LIMIT);
    assert!(steps.detail.starts_with("abcx"));
    let tricky = CoverSteps { step: "verify", game: "lol", signed_in: true, detail: "\"); alert(1); (\" </script> `${x}`".into() };
    let script = tricky.script();
    let prefix = "window.__eclipseCover && window.__eclipseCover.steps(";
    assert!(script.starts_with(prefix) && script.ends_with(')'));
    let payload: Value = serde_json::from_str(&script[prefix.len()..script.len() - 1]).unwrap();
    assert_eq!(payload, json!({ "step": "verify", "game": "lol", "signedIn": true, "detail": tricky.detail }));
}

#[test]
fn the_cover_only_listens_and_gets_one_of_two_languages() {
    assert_eq!(language_script("en"), "window.__eclipseCover && window.__eclipseCover.language('en')");
    for other in ["pt", "", "xx", "en'); alert(1); ('"] {
        assert_eq!(language_script(other), "window.__eclipseCover && window.__eclipseCover.language('pt')");
    }
    assert!(!INIT_SCRIPT.contains("invoke"));
    assert!(!INIT_SCRIPT.contains("__TAURI"));
    assert!(INIT_SCRIPT.contains("onSteps") && INIT_SCRIPT.contains("onLanguage"));
}
