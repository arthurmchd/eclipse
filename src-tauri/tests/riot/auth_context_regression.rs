use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use eclipse::riot::riot_authentication::{AuthOutcome, Credentials, RiotAuthentication, AUTHENTICATION as AUTH, COMPLETE, START};
use eclipse::riot::RiotError;
use serde_json::{json, Value};

use crate::{reply, route, FakeApi};

const USERNAME: &str = "synthetic-user-only";
const PASSWORD: &str = "synthetic-password-only";

fn account() -> Credentials<'static> {
    Credentials { username: USERNAME, password: PASSWORD }
}

fn expected_routes() -> Vec<(String, String)> {
    vec![route("GET", AUTH), route("DELETE", AUTH), route("POST", START), route("POST", COMPLETE)]
}

#[test]
fn a_headless_default_auth_response_without_a_usable_session_id_must_initialize_before_sending_credentials() {
    for context in [json!({ "suuid": "" }), json!({})] {
        let initialized = Arc::new(AtomicBool::new(false));
        let flag = initialized.clone();
        let context_reply = context.clone();
        let api = FakeApi::new(move |method, endpoint, body| match (method, endpoint) {
            ("GET", AUTH) => {
                let mut state = json!({ "type": "auth", "captcha": { "type": "none" } });
                state.as_object_mut().unwrap().extend(context_reply.as_object().unwrap().clone());
                reply(200, state)
            }
            ("DELETE", AUTH) => reply(204, Value::Null),
            ("POST", START) => {
                let text = body.map(Value::to_string).unwrap_or_default();
                assert!(!text.contains(PASSWORD) && !text.contains(USERNAME));
                flag.store(true, Ordering::SeqCst);
                reply(200, json!({ "type": "auth", "suuid": "synthetic-initialized-session", "captcha": { "type": "none" } }))
            }
            ("POST", COMPLETE) if flag.load(Ordering::SeqCst) => reply(200, json!({ "type": "success" })),
            ("POST", COMPLETE) => reply(400, json!({ "error": "invalid_request" })),
            _ => Err(RiotError::new("Unexpected synthetic request")),
        });
        let service = RiotAuthentication::new(api.clone());
        assert_eq!(service.authenticate(&account(), None, true).unwrap(), AuthOutcome::done(), "{context}");
        assert_eq!(api.routes(), expected_routes());
        assert!(initialized.load(Ordering::SeqCst));
    }
}

#[test]
fn an_initial_invalid_request_state_is_deleted_before_starting_a_new_context() {
    let reset = Arc::new(AtomicBool::new(false));
    let flag = reset.clone();
    let api = FakeApi::new(move |method, endpoint, _| match (method, endpoint) {
        ("GET", _) => reply(200, json!({ "type": "error", "error": "invalid_request", "suuid": "" })),
        ("DELETE", AUTH) => {
            flag.store(true, Ordering::SeqCst);
            reply(204, Value::Null)
        }
        (_, START) if flag.load(Ordering::SeqCst) => reply(200, json!({ "type": "auth", "suuid": "synthetic-new-context", "captcha": { "type": "none" } })),
        (_, START) => reply(403, json!({ "error": "invalid_request", "message": "Invalid auth state" })),
        (_, COMPLETE) => reply(200, json!({ "type": "success" })),
        _ => Err(RiotError::new("Unexpected synthetic request")),
    });
    let service = RiotAuthentication::new(api.clone());
    assert_eq!(service.authenticate(&account(), None, true).unwrap(), AuthOutcome::done());
    assert_eq!(api.routes(), expected_routes());
    assert!(!format!("{:?}", &api.calls()[..3]).contains(PASSWORD));
}

#[test]
fn an_invalid_request_returned_after_submitting_credentials_never_retries_or_resets_the_context() {
    let api = FakeApi::new(|method, _, _| {
        if method == "GET" {
            reply(200, json!({ "type": "auth", "suuid": "synthetic-existing-context", "captcha": { "type": "none" } }))
        } else {
            reply(400, json!({ "error": "invalid_request", "message": PASSWORD }))
        }
    });
    let service = RiotAuthentication::new(api.clone());
    let error = service.authenticate(&account(), None, true).unwrap_err();
    assert!(!error.message.contains(PASSWORD));
    assert_eq!(api.routes(), [route("GET", AUTH), route("POST", COMPLETE)]);
}
