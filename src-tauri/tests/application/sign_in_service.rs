use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use eclipse::application::language::localize;
use eclipse::application::sign_in_service::{SignInObservers, SignInRunner, SignInService, KEEP_LEAVING_FAILED};
use eclipse::application::timers::{ThreadTimers, Timers};
use eclipse::riot::sign_in_flow::{Closed, SignInOutcome, SignInRequest, StatusDetails};
use eclipse::riot::{RiotError, RiotId, RiotResult};
use serde_json::{json, Value};

use super::{FakeStore, ManualTimers};

type Behavior = Box<dyn Fn(&Runner, &SignInRequest) -> RiotResult<SignInOutcome> + Send + Sync>;

#[derive(Debug, Clone, Default)]
struct Received {
    username: String,
    password: String,
    session: Option<String>,
    has_saved_session: bool,
    game: String,
    remember: bool,
    client_path: String,
}

struct Runner {
    store: Arc<FakeStore>,
    result: Mutex<SignInOutcome>,
    received: Mutex<Option<Received>>,
    behavior: Mutex<Option<Behavior>>,
    service: Mutex<Option<SignInService>>,
}

impl Runner {
    fn service(&self) -> SignInService {
        self.service.lock().unwrap().clone().unwrap()
    }

    fn result(&self) -> SignInOutcome {
        self.result.lock().unwrap().clone()
    }
}

impl SignInRunner for Runner {
    fn sign_in(&self, request: &SignInRequest) -> RiotResult<SignInOutcome> {
        self.store.record(json!(["sign-in"]));
        *self.received.lock().unwrap() = Some(Received {
            username: request.account.username.clone(),
            password: request.account.password.clone(),
            session: (request.session)().unwrap(),
            has_saved_session: request.has_saved_session,
            game: request.game.clone(),
            remember: request.remember,
            client_path: request.client_path.clone(),
        });
        match self.behavior.lock().unwrap().as_ref() {
            Some(behavior) => behavior(self, request),
            None => Ok(self.result()),
        }
    }
}

struct Fixture {
    service: SignInService,
    store: Arc<FakeStore>,
    runner: Arc<Runner>,
    timers: Arc<ManualTimers>,
    statuses: Arc<Mutex<Vec<Value>>>,
    operations: Arc<Mutex<Vec<Value>>>,
    updates: Arc<Mutex<Vec<Value>>>,
    logs: Arc<Mutex<Vec<String>>>,
    launched: Arc<Mutex<usize>>,
    closed_failure: Arc<Mutex<Option<String>>>,
    language: Arc<Mutex<Option<&'static str>>>,
}

fn fixture_with(timers: Arc<dyn Timers>, manual: Arc<ManualTimers>) -> Fixture {
    let store = FakeStore::new(vec![json!({ "id": "test-account", "username": "private-login", "password": "encrypted-secret", "gameName": "Example", "tagLine": "BR1" })]);
    store.set("riotClientPath", json!("C:/Example/RiotClientServices.exe"));
    store.session("test-account", "remembered-session");
    let result = SignInOutcome { game_started: true, riot_id: Some(RiotId::new("Example", "BR1")), session: Some("private-session".into()), ..SignInOutcome::default() };
    let runner = Arc::new(Runner { store: store.clone(), result: Mutex::new(result), received: Mutex::new(None), behavior: Mutex::new(None), service: Mutex::new(None) });
    let statuses = Arc::new(Mutex::new(Vec::new()));
    let operations = Arc::new(Mutex::new(Vec::new()));
    let updates = Arc::new(Mutex::new(Vec::new()));
    let logs = Arc::new(Mutex::new(Vec::new()));
    let launched = Arc::new(Mutex::new(0));
    let closed_failure: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let language: Arc<Mutex<Option<&'static str>>> = Arc::new(Mutex::new(None));
    let observers = SignInObservers {
        status: Box::new({
            let statuses = statuses.clone();
            move |status| statuses.lock().unwrap().push(status.clone())
        }),
        operation_updated: Box::new({
            let operations = operations.clone();
            move |operation| operations.lock().unwrap().push(operation.clone())
        }),
        account_updated: Box::new({
            let updates = updates.clone();
            move |account| updates.lock().unwrap().push(Value::Object(account.clone()))
        }),
        log: Box::new({
            let logs = logs.clone();
            move |line| logs.lock().unwrap().push(line.to_string())
        }),
        on_closed: Box::new({
            let store = store.clone();
            let failure = closed_failure.clone();
            move |closed: &Closed| {
                store.record(json!(["on-closed", closed.yaml]));
                failure.lock().unwrap().clone().map_or(Ok(()), Err)
            }
        }),
        on_launched: Box::new({
            let launched = launched.clone();
            move |_| *launched.lock().unwrap() += 1
        }),
        translate: Box::new({
            let language = language.clone();
            move |text| match *language.lock().unwrap() {
                Some(language) => localize(text, Some(language)),
                None => text.to_string(),
            }
        }),
    };
    let service = SignInService::new(store.clone(), runner.clone(), timers, observers);
    *runner.service.lock().unwrap() = Some(service.clone());
    Fixture { service, store, runner, timers: manual, statuses, operations, updates, logs, launched, closed_failure, language }
}

fn fixture() -> Fixture {
    let timers = ManualTimers::new();
    fixture_with(timers.clone(), timers)
}

impl Fixture {
    fn behave(&self, behavior: impl Fn(&Runner, &SignInRequest) -> RiotResult<SignInOutcome> + Send + Sync + 'static) {
        *self.runner.behavior.lock().unwrap() = Some(Box::new(behavior));
    }

    fn play(&self, game: &str) -> Value {
        self.service.start_from_manager("test-account", game).unwrap();
        self.timers.next(Some(0));
        assert!(!self.service.is_busy());
        let last = self.operations.lock().unwrap().last().cloned().unwrap();
        assert!(last.get("finishedAt").is_some());
        last
    }

    fn received(&self) -> Received {
        self.runner.received.lock().unwrap().clone().unwrap()
    }

    fn exposed(&self) -> String {
        json!([self.operations.lock().unwrap().clone(), self.service.get_state(), self.updates.lock().unwrap().clone(), self.logs.lock().unwrap().clone(), self.statuses.lock().unwrap().clone()]).to_string()
    }

    fn logs(&self) -> Vec<String> {
        self.logs.lock().unwrap().clone()
    }

    fn update_fields(&self) -> Value {
        self.store.calls().into_iter().find(|call| call[0] == "update").unwrap()[2].clone()
    }
}

fn error_with(message: &str, change: impl FnOnce(&mut RiotError)) -> RiotError {
    let mut error = RiotError::new(message);
    change(&mut error);
    error
}

#[test]
fn a_sign_in_passes_decrypted_credentials_only_to_riot_and_finishes_with_public_metadata() {
    let f = fixture();
    f.service.start_from_manager("test-account", "lol").unwrap();
    assert!(f.service.is_busy());
    assert_eq!(f.service.active_account_id().as_deref(), Some("test-account"));
    assert!(f.runner.received.lock().unwrap().is_none());
    f.timers.next(Some(0));
    let state = f.service.get_state();
    assert_eq!(state["status"], "succeeded");
    assert_eq!(state["text"], "Game opened");
    let received = f.received();
    assert_eq!(received.password, "decrypted-secret");
    assert_eq!(received.username, "private-login");
    assert_eq!(received.session.as_deref(), Some("remembered-session"));
    assert!(received.has_saved_session);
    assert_eq!(received.client_path, "C:/Example/RiotClientServices.exe");
    assert_eq!(f.service.active_account_id(), None);
    let exposed = f.exposed();
    for secret in ["private-login", "encrypted-secret", "decrypted-secret", "private-session"] {
        assert!(!exposed.contains(secret), "{secret}");
    }
}

#[test]
fn the_cards_start_returns_immediately_and_the_work_runs_later() {
    let f = fixture();
    let accepted = f.service.start_from_manager("test-account", "tft").unwrap();
    assert_eq!(accepted["ok"], true);
    let state = f.service.get_state();
    assert_eq!(accepted["operationId"], state["id"]);
    assert_eq!(state["operationId"], state["id"]);
    assert_eq!(state["status"], "running");
    assert_eq!(state["text"], "Preparing sign-in…");
    assert!(f.store.calls().is_empty());
    assert_eq!(f.timers.delays(), [0]);
    f.timers.next(Some(0));
    assert_eq!(f.received().game, "tft");
    assert_eq!(f.service.get_state()["status"], "succeeded");
}

#[test]
fn a_second_sign_in_is_refused_while_one_is_running() {
    let f = fixture();
    f.behave(|runner, _| {
        assert_eq!(runner.service().start_from_manager("test-account", "tft").unwrap_err(), "A sign-in is already in progress");
        Ok(runner.result())
    });
    f.service.start_from_manager("test-account", "lol").unwrap();
    assert_eq!(f.service.start_from_manager("test-account", "val").unwrap_err(), "A sign-in is already in progress");
    f.timers.next(Some(0));
    assert_eq!(f.service.get_state()["game"], "lol");
    assert_eq!(f.service.get_state()["status"], "succeeded");
    assert!(!f.service.is_busy());
    assert_eq!(f.timers.pending(), 0);
}

#[test]
fn cancellation_before_scheduled_execution_performs_no_client_or_credential_work() {
    let f = fixture();
    f.service.start_from_manager("test-account", "lol").unwrap();
    assert_eq!(f.service.cancel(), json!({ "ok": true }));
    f.timers.next(Some(0));
    let state = f.service.get_state();
    assert_eq!(state["status"], "cancelled");
    assert_eq!(state["text"], "Sign-in cancelled");
    assert_eq!(state["needsAttention"], false);
    assert!(f.store.calls().is_empty());
    assert!(!f.service.is_busy());
}

#[test]
fn cancellation_propagates_to_an_active_riot_operation_and_frees_the_service() {
    let f = fixture();
    f.behave(|runner, request| {
        runner.service().cancel();
        request.cancel.unwrap().check()?;
        Ok(runner.result())
    });
    let operation = f.play("lol");
    assert_eq!(operation["status"], "cancelled");
    assert_eq!(operation["cancelled"], true);
    assert_eq!(operation["text"], "Sign-in cancelled");
    assert_eq!(f.service.get_state()["status"], "cancelled");
    assert_eq!(f.service.cancel(), json!({ "ok": true }));
}

#[test]
fn a_rejected_old_session_is_forgotten_before_persisting_the_replacement() {
    let f = fixture();
    f.runner.result.lock().unwrap().session_rejected = true;
    f.play("lol");
    let names = f.store.names();
    let forgotten = names.iter().position(|name| name == "forget-session").unwrap();
    let saved = names.iter().position(|name| name == "save-session").unwrap();
    assert!(saved > forgotten);
    assert_eq!(f.update_fields()["lastGame"], "lol");
    assert_eq!(f.updates.lock().unwrap().len(), 1);
}

#[test]
fn authentication_errors_clear_rejected_sessions_and_cleanup_failures_remain_handled() {
    let f = fixture();
    f.behave(|_, _| Err(error_with("Wrong username or password", |error| error.session_rejected = true)));
    f.store.fail("forget_session");
    let operation = f.play("lol");
    assert_eq!(operation["status"], "failed");
    assert_eq!(operation["error"], "Wrong username or password");
    assert!(f.logs().iter().any(|line| line.contains("could not forget")));
    let ok = fixture();
    ok.behave(|_, _| Err(error_with("Wrong username or password", |error| error.session_rejected = true)));
    ok.play("lol");
    assert!(ok.store.names().contains(&"forget-session".to_string()));
    assert_eq!(ok.updates.lock().unwrap().len(), 1);
}

#[test]
fn a_saved_session_of_another_account_is_forgotten_as_soon_as_it_is_found_before_riot_closes_it() {
    let f = fixture();
    f.behave(|runner, request| {
        (request.on_rejected)()?;
        runner.store.record(json!(["close-other-account"]));
        Ok(SignInOutcome { session_rejected: true, ..runner.result() })
    });
    assert_eq!(f.play("lol")["status"], "succeeded");
    let names = f.store.names();
    assert_eq!(f.store.calls().into_iter().find(|call| call[0] == "forget-session").unwrap(), json!(["forget-session", "test-account"]));
    assert!(names.iter().position(|name| name == "forget-session") < names.iter().position(|name| name == "close-other-account"));
}

#[test]
fn a_failure_to_forget_a_rejected_session_is_logged_without_stopping_the_sign_in() {
    let f = fixture();
    f.store.fail("forget_session");
    f.behave(|runner, request| {
        (request.on_rejected)()?;
        Ok(runner.result())
    });
    assert_eq!(f.play("lol")["status"], "succeeded");
    assert!(f.logs().contains(&"could not forget the rejected session: storage unavailable".to_string()));
}

#[test]
fn the_session_of_the_account_leaving_riot_reaches_the_main_process_before_the_flow_goes_on() {
    let f = fixture();
    f.behave(|runner, request| {
        (request.on_closed)(&Closed { signed_in: true, riot_id: Some(RiotId::new("Other", "BR1")), yaml: Some("leaving-session".into()) })?;
        runner.store.record(json!(["strip-login"]));
        Ok(runner.result())
    });
    assert_eq!(f.play("lol")["status"], "succeeded");
    let names = f.store.names();
    assert_eq!(f.store.calls().into_iter().find(|call| call[0] == "on-closed").unwrap(), json!(["on-closed", "leaving-session"]));
    assert!(names.iter().position(|name| name == "on-closed") < names.iter().position(|name| name == "strip-login"));
}

#[test]
fn a_failure_to_keep_the_leaving_session_stops_the_sign_in_before_riot_loses_it_without_system_details() {
    let f = fixture();
    *f.closed_failure.lock().unwrap() = Some("EPERM: C:\\Users\\example\\AppData\\Roaming\\riot-account-manager\\data.json".into());
    f.behave(|runner, request| {
        (request.on_closed)(&Closed { signed_in: true, riot_id: None, yaml: Some("leaving-session".into()) })?;
        runner.store.record(json!(["strip-login"]));
        Ok(runner.result())
    });
    let operation = f.play("lol");
    assert_eq!(operation["status"], "failed");
    assert_eq!(operation["error"], KEEP_LEAVING_FAILED);
    assert_ne!(localize(KEEP_LEAVING_FAILED, Some("pt")), KEEP_LEAVING_FAILED);
    let names = f.store.names();
    assert!(!names.contains(&"strip-login".to_string()));
    assert!(!names.iter().any(|name| name == "save-session" || name == "set-current"));
    assert!(f.logs().contains(&"could not keep the session of the account that was signed in".to_string()));
    let exposed = f.exposed();
    for detail in ["EPERM", "AppData", "data.json"] {
        assert!(!exposed.contains(detail), "{detail}");
    }
    assert!(!f.service.is_busy());
}

#[test]
fn progress_is_public_metadata_and_get_state_returns_an_independent_snapshot() {
    let f = fixture();
    f.behave(|runner, request| {
        (request.status)("Enter the 2FA code", StatusDetails { needs_attention: true, ..StatusDetails::default() });
        let mut state = runner.service().get_state();
        assert_eq!(state["needsAttention"], true);
        state["text"] = json!("external mutation");
        assert_eq!(runner.service().get_state()["text"], "Enter the 2FA code");
        Ok(runner.result())
    });
    f.play("lol");
    assert_eq!(*f.statuses.lock().unwrap(), [json!({ "id": "test-account", "text": "Enter the 2FA code", "needsAttention": true, "nativeClient": false })]);
    assert_eq!(f.service.get_state()["needsAttention"], false);
}

#[test]
fn native_verification_context_is_published_for_manual_handoff_and_cleared_by_later_progress() {
    let f = fixture();
    let operations = f.operations.clone();
    let statuses = f.statuses.clone();
    f.behave(move |runner, request| {
        let service = runner.service();
        assert_eq!(service.get_state()["nativeClient"], false);
        (request.status)("Complete the security check in Riot", StatusDetails { needs_attention: true, native_client: true, signed_in: false });
        assert_eq!(service.get_state()["nativeClient"], true);
        assert_eq!(service.get_state()["needsAttention"], true);
        assert_eq!(statuses.lock().unwrap().last().unwrap(), &json!({ "id": "test-account", "text": "Complete the security check in Riot", "needsAttention": true, "nativeClient": true }));
        assert_eq!(operations.lock().unwrap().last().unwrap()["nativeClient"], true);
        (request.status)("Preparing the game", StatusDetails::default());
        assert_eq!(service.get_state()["nativeClient"], false);
        assert_eq!(statuses.lock().unwrap().last().unwrap()["nativeClient"], false);
        Ok(runner.result())
    });
    assert_eq!(f.play("lol")["status"], "succeeded");
}

#[test]
fn failed_native_verification_retains_recovery_metadata_without_keeping_the_launch_busy() {
    let f = fixture();
    f.behave(|_, request| {
        (request.status)("Complete verification", StatusDetails { needs_attention: true, native_client: true, signed_in: false });
        Err(error_with("Verification timed out", |error| {
            error.needs_attention = true;
            error.native_client = true;
        }))
    });
    assert_eq!(f.play("lol")["status"], "failed");
    let state = f.service.get_state();
    assert_eq!(state["needsAttention"], true);
    assert_eq!(state["nativeClient"], true);
    assert!(!f.service.is_busy());
    assert_eq!(f.operations.lock().unwrap().last().unwrap(), &state);
    *f.runner.behavior.lock().unwrap() = None;
    assert_eq!(f.play("lol")["status"], "succeeded");
    assert_eq!(f.service.get_state()["needsAttention"], false);
    assert_eq!(f.service.get_state()["nativeClient"], false);
}

#[test]
fn ordinary_errors_and_cancellation_do_not_retain_stale_verification_notices() {
    for cancel in [false, true] {
        let f = fixture();
        f.behave(move |runner, request| {
            (request.status)("Needs attention", StatusDetails { needs_attention: true, native_client: true, signed_in: false });
            if cancel {
                runner.service().cancel();
                return Err(error_with("Stopped", |error| {
                    error.needs_attention = true;
                    error.native_client = true;
                }));
            }
            Err(RiotError::new("Stopped"))
        });
        f.play("lol");
        let state = f.service.get_state();
        assert_eq!(state["status"], if cancel { "cancelled" } else { "failed" });
        assert_eq!(state["needsAttention"], false);
        assert_eq!(state["nativeClient"], false);
    }
}

#[test]
fn credentials_edited_before_execution_are_never_mixed_with_the_original_username() {
    let f = fixture();
    f.service.start_from_manager("test-account", "lol").unwrap();
    f.store.edit("test-account", "password", json!("different-encrypted-value"));
    f.timers.next(Some(0));
    let state = f.service.get_state();
    assert_eq!(state["status"], "failed");
    assert!(state["error"].as_str().unwrap().contains("credentials changed"));
    assert!(!f.store.names().iter().any(|name| name == "get-password" || name == "sign-in"));
    assert!(!state.to_string().contains("different-encrypted-value"));
}

#[test]
fn client_errors_and_progress_cannot_expose_the_decrypted_password_or_username() {
    let f = fixture();
    f.behave(|_, request| {
        let (username, password) = (&request.account.username, &request.account.password);
        (request.status)(&format!("Unexpected input: {username} {password}"), StatusDetails::default());
        (request.log)(&format!("Input failed: {password}"))?;
        Err(RiotError::new(format!("Input failed: {username} {password}")))
    });
    let operation = f.play("lol");
    let exposed = f.exposed();
    assert!(!exposed.contains("private-login"));
    assert!(!exposed.contains("decrypted-secret"));
    assert!(operation["error"].as_str().unwrap().contains("[redacted]"));
}

#[test]
fn a_secret_too_short_to_redact_safely_replaces_the_whole_message() {
    let f = fixture();
    f.store.edit("test-account", "username", json!("abc"));
    f.behave(|_, _| Err(RiotError::new("Unknown account abc")));
    assert_eq!(f.play("lol")["error"], "Sign-in failed");
}

#[test]
fn unsupported_games_and_incomplete_accounts_never_start_an_operation() {
    let f = fixture();
    assert!(f.service.start_from_manager("test-account", "unknown").unwrap_err().contains("supported game"));
    assert!(f.service.start_from_manager("missing-account", "lol").unwrap_err().contains("not found"));
    f.store.edit("test-account", "password", json!(""));
    assert!(f.service.start_from_manager("test-account", "lol").unwrap_err().contains("username and password first"));
    f.store.edit("test-account", "password", Value::Null);
    assert!(f.service.start_from_manager("test-account", "lol").unwrap_err().contains("username and password first"));
    assert_eq!(f.service.get_state(), Value::Null);
    assert!(!f.service.is_busy());
    assert_eq!(f.timers.pending(), 0);
}

#[test]
fn a_launch_that_did_not_open_the_game_is_not_reported_as_success() {
    let f = fixture();
    f.runner.result.lock().unwrap().game_started = false;
    let operation = f.play("lol");
    assert_eq!(operation["status"], "failed");
    assert_eq!(operation["error"], "The game did not open. Open the Riot Client to see what happened");
    assert_eq!(*f.launched.lock().unwrap(), 0);
    let fields = f.update_fields();
    assert!(fields.get("lastPlayed").is_none());
    assert!(fields.get("lastGame").is_none());
}

#[test]
fn riot_client_only_succeeds_when_the_client_is_signed_in_without_recording_a_played_game() {
    let f = fixture();
    {
        let mut result = f.runner.result.lock().unwrap();
        result.game_started = false;
        result.client_opened = true;
    }
    let state = f.play("riot");
    assert_eq!(f.received().game, "riot");
    assert_eq!(state["status"], "succeeded");
    assert_eq!(state["text"], "Riot Client opened");
    assert!(f.store.calls().contains(&json!(["save-session", "test-account", "private-session"])));
    assert!(f.store.calls().contains(&json!(["set-current", "test-account"])));
    let fields = f.update_fields();
    assert!(fields.get("lastPlayed").is_none());
    assert!(fields.get("lastGame").is_none());
    assert_eq!(*f.launched.lock().unwrap(), 1);

    let unfinished = fixture();
    unfinished.runner.result.lock().unwrap().game_started = false;
    let failed = unfinished.play("riot");
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["error"], "The Riot Client did not finish signing in. Open it to see what happened");
    let game = fixture();
    {
        let mut result = game.runner.result.lock().unwrap();
        result.game_started = false;
        result.client_opened = true;
    }
    assert_eq!(game.play("lol")["status"], "failed");
}

#[test]
fn a_played_game_records_when_and_what_was_played_and_the_riot_id_riot_returned() {
    let f = fixture();
    f.runner.result.lock().unwrap().riot_id = Some(RiotId::new("Renamed", "NEW"));
    f.play("val");
    let fields = f.update_fields();
    assert_eq!(fields["lastGame"], "val");
    assert!(fields["lastPlayed"].as_str().unwrap().ends_with('Z'));
    assert_eq!(fields["gameName"], "Renamed");
    assert_eq!(fields["tagLine"], "NEW");
}

#[test]
fn a_failure_without_a_message_is_reported_as_a_failed_sign_in() {
    let f = fixture();
    f.behave(|_, _| Err(RiotError::new("")));
    let operation = f.play("lol");
    assert_eq!(operation["status"], "failed");
    assert_eq!(operation["error"], "Sign-in failed");
}

#[test]
fn stay_signed_in_follows_the_setting_and_the_signed_in_stage_is_published_once_reached() {
    let f = fixture();
    f.behave(|runner, request| {
        (request.status)("Signing in in the background…", StatusDetails::default());
        (request.status)("Signed in. Preparing the game…", StatusDetails { signed_in: true, ..StatusDetails::default() });
        (request.status)("Starting League of Legends in the background…", StatusDetails::default());
        Ok(runner.result())
    });
    f.play("lol");
    assert!(f.received().remember);
    f.store.set("staySignedIn", json!(false));
    f.play("lol");
    assert!(!f.received().remember);
    let running: Vec<Value> = f.operations.lock().unwrap().iter().filter(|operation| operation["status"] == "running").map(|operation| operation["signedIn"].clone()).collect();
    assert_eq!(running[..4], [json!(false), json!(false), json!(true), json!(true)]);
}

#[test]
fn published_texts_follow_the_chosen_language_while_the_log_stays_in_english() {
    let f = fixture();
    *f.language.lock().unwrap() = Some("pt");
    f.behave(|runner, request| {
        (request.status)("Signing in in the background…", StatusDetails::default());
        Ok(runner.result())
    });
    assert_eq!(f.play("lol")["text"], "Jogo aberto");
    assert_eq!(f.operations.lock().unwrap()[0]["text"], "Preparando o login…");
    let texts: Vec<Value> = f.statuses.lock().unwrap().iter().map(|status| status["text"].clone()).collect();
    assert_eq!(texts, [json!("Entrando em segundo plano…")]);
    assert_eq!(f.service.get_state()["text"], "Jogo aberto");
    *f.language.lock().unwrap() = Some("en");
    assert_eq!(f.service.get_state()["text"], "Game opened");
    assert!(f.logs().contains(&"Signing in in the background…".to_string()));
    assert!(!f.logs().iter().any(|line| line.contains("Entrando") || line.contains("Jogo aberto")));

    *f.language.lock().unwrap() = Some("pt");
    f.behave(|_, _| Err(RiotError::new("Wrong username or password")));
    let failed = f.play("lol");
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["text"], "Usuário ou senha incorretos");
    assert_eq!(failed["error"], "Usuário ou senha incorretos");
    assert_eq!(f.service.get_state()["error"], "Usuário ou senha incorretos");
    assert!(f.logs().contains(&"sign-in failed: Wrong username or password".to_string()));
}

#[test]
fn a_store_failure_after_riot_signed_in_fails_the_operation_with_its_message() {
    let f = fixture();
    f.store.fail("save_session");
    let operation = f.play("lol");
    assert_eq!(operation["status"], "failed");
    assert_eq!(operation["error"], "storage unavailable");
}

#[test]
fn with_real_timers_the_sign_in_runs_on_another_thread_and_frees_the_service_at_the_end() {
    let manual = ManualTimers::new();
    let f = fixture_with(Arc::new(ThreadTimers::new()), manual);
    let caller = std::thread::current().id();
    f.behave(move |runner, _| {
        assert_ne!(std::thread::current().id(), caller);
        std::thread::sleep(Duration::from_millis(50));
        Ok(runner.result())
    });
    f.service.start_from_manager("test-account", "lol").unwrap();
    assert!(f.service.is_busy());
    let started = Instant::now();
    while f.service.is_busy() && started.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(f.service.get_state()["status"], "succeeded");
}
