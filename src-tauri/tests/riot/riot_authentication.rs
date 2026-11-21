use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use eclipse::riot::riot_authentication::{AuthKind, AuthOutcome, AuthState, ChallengeSource, Credentials, RiotAuthentication, AUTHENTICATION as AUTH, AUTHORIZATION, BLOCKING_SESSION_STATES, COMPLETE, LEGACY_SESSION, NON_BLOCKING_SESSION_STATES, PLAYER_SESSION, START};
use eclipse::riot::{Cancel, Response, RiotError, RiotResult};
use serde_json::{json, Value};

use crate::{route, FakeApi};

const USERNAME: &str = "synthetic-private-login";
const PASSWORD: &str = "synthetic-private-password";

fn account() -> Credentials<'static> {
    Credentials { username: USERNAME, password: PASSWORD }
}

fn auth() -> Value {
    json!({ "type": "auth", "suuid": "synthetic-active-auth-context", "captcha": { "type": "none" } })
}

type Then = Box<dyn Fn() -> RiotResult<Response> + Send + Sync>;

enum Step {
    Reply(u16, Value),
    Fail(String),
    Then(Then),
}

fn ok(json: Value) -> Step {
    Step::Reply(200, json)
}

fn status(status: u16, json: Value) -> Step {
    Step::Reply(status, json)
}

struct Fixture {
    api: Arc<FakeApi>,
    service: RiotAuthentication,
}

fn fixture(steps: Vec<Step>) -> Fixture {
    let queue = Mutex::new(steps.into_iter().collect::<VecDeque<Step>>());
    let api = FakeApi::new(move |_, _, _| match queue.lock().unwrap().pop_front().expect("No further local requests were expected") {
        Step::Reply(status, json) => Ok(Response::new(status, json)),
        Step::Fail(message) => Err(RiotError::new(message)),
        Step::Then(then) => then(),
    });
    Fixture { service: RiotAuthentication::new(api.clone()), api }
}

impl Fixture {
    fn routes(&self) -> Vec<(String, String)> {
        self.api.routes()
    }

    fn count(&self, path: &str) -> usize {
        self.routes().iter().filter(|(_, endpoint)| endpoint == path).count()
    }

    fn sent_password(&self) -> bool {
        format!("{:?}", self.api.calls()).contains(PASSWORD)
    }

    fn authenticate(&self) -> RiotResult<AuthOutcome> {
        self.service.authenticate(&account(), None, true)
    }
}

fn routes(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs.iter().map(|(method, path)| route(method, path)).collect()
}

fn hidden(error: &RiotError) -> bool {
    !error.message.contains(PASSWORD) && !error.message.contains(USERNAME)
}

const NATIVE: AuthOutcome = AuthOutcome::native_form();

#[test]
fn the_overlay_detects_the_login_form_even_with_native_captcha_without_exposing_its_contents() {
    for captcha in [json!({ "type": "none" }), json!({ "type": "hcaptcha", "token": "synthetic-private" })] {
        let mut state = auth();
        state["captcha"] = captcha;
        let f = fixture(vec![ok(state), status(404, json!({}))]);
        assert_eq!(f.service.login_screen_state(None).unwrap(), Some(AuthState::of(AuthKind::Auth)));
        assert_eq!(f.routes(), routes(&[("GET", AUTH), ("GET", AUTHORIZATION)]));
    }
}

#[test]
fn the_overlay_hides_for_authenticated_mfa_unknown_and_unavailable_sessions_with_legacy_fallback() {
    for value in [json!({ "type": "authenticated" }), json!({ "type": "success" }), json!({ "type": "multifactor" }), json!({ "type": "challenge" }), json!({}), Value::Null] {
        assert_eq!(fixture(vec![ok(value)]).service.login_screen_state(None).unwrap(), None);
    }
    assert_eq!(fixture(vec![status(503, json!({}))]).service.login_screen_state(None).unwrap(), None);
    let f = fixture(vec![status(404, json!({})), ok(json!({ "type": "error", "error": "invalid_credentials" }))]);
    assert_eq!(f.service.login_screen_state(None).unwrap(), Some(AuthState::failed(AuthKind::Error, "auth_failure")));
    assert_eq!(f.routes()[1].1, LEGACY_SESSION);
}

#[test]
fn the_overlay_hides_when_an_account_is_already_authorized_even_if_the_authenticator_still_reports_its_login_form() {
    let f = fixture(vec![ok(auth()), ok(json!({ "type": "authorization" }))]);
    assert_eq!(f.service.login_screen_state(None).unwrap(), None);
    assert_eq!(f.routes()[1].1, AUTHORIZATION);
}

#[test]
fn direct_sign_in_uses_the_existing_context_and_submits_credentials_only_once_to_the_modern_local_endpoint() {
    let f = fixture(vec![ok(auth()), ok(json!({ "type": "success", "token": "synthetic-token-never-returned" }))]);
    assert_eq!(f.authenticate().unwrap(), AuthOutcome::done());
    assert_eq!(f.routes(), routes(&[("GET", AUTH), ("POST", COMPLETE)]));
    assert_eq!(f.api.timeouts(), [4000, 30000]);
    assert_eq!(f.api.calls()[0].2, None);
    assert_eq!(f.api.calls()[1].2, Some(json!({ "username": USERNAME, "password": PASSWORD, "remember": true, "language": "en_US", "captcha": "" })));
}

#[test]
fn direct_sign_in_asks_riot_not_to_remember_the_login_when_stay_signed_in_is_off() {
    let f = fixture(vec![ok(auth()), ok(json!({ "type": "success" }))]);
    assert_eq!(f.service.authenticate(&account(), None, false).unwrap(), AuthOutcome::done());
    assert_eq!(f.api.calls()[1].2, Some(json!({ "username": USERNAME, "password": PASSWORD, "remember": false, "language": "en_US", "captcha": "" })));
}

#[test]
fn a_missing_context_is_initialized_without_credentials_before_a_single_complete_request() {
    let f = fixture(vec![status(404, Value::Null), status(204, Value::Null), ok(auth()), ok(json!({ "type": "success" }))]);
    assert_eq!(f.authenticate().unwrap(), AuthOutcome::done());
    assert_eq!(f.routes(), routes(&[("GET", AUTH), ("DELETE", AUTH), ("POST", START), ("POST", COMPLETE)]));
    assert_eq!(f.api.calls()[2].2, Some(json!({ "language": "en_US", "productId": "riot-client", "state": "auth", "intendedProductId": "" })));
    assert!(!format!("{:?}", &f.api.calls()[..3]).contains(PASSWORD));
}

#[test]
fn an_accepted_empty_start_response_is_checked_with_get_before_credentials_are_submitted() {
    let f = fixture(vec![status(404, Value::Null), status(204, Value::Null), status(204, Value::Null), ok(auth()), status(202, Value::Null)]);
    assert_eq!(f.authenticate().unwrap(), AuthOutcome::done());
    assert_eq!(f.routes(), routes(&[("GET", AUTH), ("DELETE", AUTH), ("POST", START), ("GET", AUTH), ("POST", COMPLETE)]));
}

#[test]
fn a_stale_failed_attempt_creates_one_new_context_but_does_not_retry_a_rejected_password() {
    let f = fixture(vec![
        ok(json!({ "type": "error", "error": "auth_failure" })),
        status(204, Value::Null),
        ok(auth()),
        ok(json!({ "type": "error", "error": "auth_failure", "password": PASSWORD })),
    ]);
    assert_eq!(f.authenticate().unwrap_err().message, "Wrong username or password");
    assert_eq!(f.count(COMPLETE), 1);
    assert_eq!(f.count(START), 1);
    assert_eq!(f.routes().iter().filter(|(method, _)| method == "DELETE").count(), 1);
}

#[test]
fn a_failed_reset_stops_initialization_before_start_or_credentials_and_never_echoes_a_response_body() {
    for failed in [status(403, json!({ "error": PASSWORD })), ok(json!(["invalid"])), status(500, Value::Null)] {
        let f = fixture(vec![ok(json!({ "type": "auth", "suuid": "", "captcha": { "type": "none" } })), failed]);
        assert!(hidden(&f.authenticate().unwrap_err()));
        assert_eq!(f.routes(), routes(&[("GET", AUTH), ("DELETE", AUTH)]));
    }
}

#[test]
fn a_missing_reset_route_can_continue_to_start_but_rate_limits_and_unsupported_methods_cannot_submit_a_password() {
    let absent = fixture(vec![status(404, Value::Null), status(404, Value::Null), ok(auth()), ok(json!({ "type": "success" }))]);
    assert_eq!(absent.authenticate().unwrap(), AuthOutcome::done());
    assert_eq!(absent.routes(), routes(&[("GET", AUTH), ("DELETE", AUTH), ("POST", START), ("POST", COMPLETE)]));
    for code in [405, 501, 429] {
        let f = fixture(vec![ok(json!({ "type": "auth" })), status(code, Value::Null)]);
        let result = f.authenticate();
        if code == 429 {
            assert!(result.unwrap_err().message.contains("Too many attempts"));
        } else {
            assert_eq!(result.unwrap(), AuthOutcome::unsupported());
        }
        assert_eq!(f.routes().len(), 2);
        assert!(!f.sent_password());
    }
}

#[test]
fn cancelling_immediately_after_reset_prevents_creating_a_context_or_submitting_credentials() {
    let cancel = Cancel::new();
    let trigger = cancel.clone();
    let f = fixture(vec![
        ok(json!({ "type": "auth" })),
        Step::Then(Box::new(move || {
            trigger.cancel();
            Ok(Response::new(204, Value::Null))
        })),
    ]);
    assert!(f.service.authenticate(&account(), Some(&cancel), true).unwrap_err().is_cancelled());
    assert_eq!(f.routes(), routes(&[("GET", AUTH), ("DELETE", AUTH)]));
}

#[test]
fn unavailable_routes_before_submission_permit_the_ui_fallback_without_retrying_authentication() {
    for code in [404, 405, 501] {
        let steps = if code == 404 { vec![status(code, Value::Null), status(code, Value::Null), status(code, Value::Null)] } else { vec![status(code, Value::Null)] };
        let f = fixture(steps);
        assert_eq!(f.authenticate().unwrap(), AuthOutcome::unsupported());
        assert_eq!(f.count(COMPLETE), 0);
    }
}

#[test]
fn an_unavailable_route_after_the_password_was_submitted_fails_instead_of_allowing_a_second_submission() {
    for code in [404, 405, 501] {
        for body in [Value::Null, json!({ "error": "unexpected_server_detail" })] {
            let f = fixture(vec![ok(auth()), status(code, body)]);
            let error = f.authenticate().unwrap_err();
            assert_eq!(error.message, "Riot could not complete sign-in. Open Riot Client to continue");
            assert!(hidden(&error));
            assert_eq!(f.count(COMPLETE), 1);
        }
    }
}

#[test]
fn existing_mfa_and_all_human_verification_screens_receive_no_password_or_reset_request() {
    let mut states = vec![
        json!({ "type": "multifactor", "email": "private@example.invalid" }),
        json!({ "type": "auth", "captcha": { "type": "hcaptcha", "data": "private-challenge" } }),
        json!({ "type": "auth", "error": "captcha_not_allowed" }),
    ];
    states.extend(["healup", "confirm_age", "kr-id-verification", "ambiguous_auth", "ambiguous_username", "unexpected_new_screen"].iter().map(|kind| json!({ "type": kind })));
    for state in states {
        let kind = state["type"].as_str().unwrap().to_string();
        let native = kind == "auth";
        let f = fixture(vec![ok(state)]);
        let expected = if native {
            NATIVE
        } else {
            AuthOutcome::attention(if kind == "multifactor" { "multifactor" } else { "challenge" })
        };
        assert_eq!(f.authenticate().unwrap(), expected, "{kind}");
        assert_eq!(f.routes().len(), 1);
        assert!(!f.sent_password());
    }
}

#[test]
fn a_new_challenge_after_start_or_complete_is_returned_for_manual_intervention_without_further_submissions() {
    let start = fixture(vec![status(404, Value::Null), status(204, Value::Null), ok(json!({ "type": "auth", "captcha": { "type": "hcaptcha" } }))]);
    assert_eq!(start.authenticate().unwrap(), NATIVE);
    assert_eq!(start.routes().len(), 3);
    let complete = fixture(vec![ok(auth()), ok(json!({ "type": "multifactor", "token": "do-not-return" }))]);
    assert_eq!(complete.authenticate().unwrap(), AuthOutcome::attention("multifactor"));
    assert_eq!(complete.routes().len(), 2);
}

#[test]
fn a_captcha_required_by_the_new_context_selects_the_native_form_before_any_password_is_sent() {
    let f = fixture(vec![
        ok(json!({ "type": "auth", "suuid": "", "captcha": { "type": "none" } })),
        status(204, Value::Null),
        ok(json!({ "type": "auth", "suuid": "synthetic-new-context", "captcha": { "type": "hcaptcha" } })),
    ]);
    assert_eq!(f.authenticate().unwrap(), NATIVE);
    assert_eq!(f.routes(), routes(&[("GET", AUTH), ("DELETE", AUTH), ("POST", START)]));
    assert!(!f.sent_password());
}

#[test]
fn captcha_rejection_requests_manual_attention_and_does_not_retry_a_submitted_password() {
    let f = fixture(vec![ok(auth()), status(400, json!({ "error": "captcha_not_allowed", "token": "private" }))]);
    assert_eq!(f.authenticate().unwrap(), AuthOutcome::attention("security_check"));
    assert_eq!(f.count(COMPLETE), 1);
}

#[test]
fn malformed_verification_metadata_and_unknown_initial_failures_cannot_trigger_a_password_submission() {
    for state in [json!({ "type": "auth", "captcha": {} }), json!({ "type": "auth", "error": { "private": PASSWORD } }), json!({ "type": "error", "error": PASSWORD })] {
        let f = fixture(vec![ok(state)]);
        assert!(hidden(&f.authenticate().unwrap_err()));
        assert_eq!(f.routes().len(), 1);
    }
}

#[test]
fn rate_limiting_fails_without_resetting_context_or_falling_back_to_the_ui() {
    for step in [status(429, Value::Null), ok(json!({ "type": "error", "error": "rate_limited" }))] {
        let f = fixture(vec![step]);
        assert_eq!(f.authenticate().unwrap_err().message, "Too many attempts, wait a few minutes");
        assert_eq!(f.routes().len(), 1);
    }
}

#[test]
fn transport_unauthorized_malformed_and_unknown_failures_never_expose_raw_responses_or_retry_passwords() {
    let secret = format!("{USERNAME} {PASSWORD}");
    let replies = [
        Step::Fail(secret.clone()),
        status(401, json!({ "type": secret })),
        status(403, json!({ "error": secret })),
        status(400, json!({ "type": "error", "error": secret })),
        ok(Value::Null),
        ok(json!(["unexpected"])),
        status(700, auth()),
    ];
    for step in replies {
        let f = fixture(vec![ok(auth()), step]);
        assert!(hidden(&f.authenticate().unwrap_err()));
        assert_eq!(f.count(COMPLETE), 1);
    }
}

#[test]
fn an_already_authenticated_state_is_not_overwritten_and_still_requires_launch_flow_identity_verification() {
    let f = fixture(vec![ok(json!({ "type": "success" }))]);
    assert_eq!(f.authenticate().unwrap(), AuthOutcome::done());
    assert_eq!(f.routes().len(), 1);
}

#[test]
fn session_state_returns_only_fixed_type_and_error_values_and_falls_back_read_only_on_old_clients() {
    let cases = [
        (json!({ "type": "success", "access_token": "private" }), AuthState::of(AuthKind::Authenticated)),
        (json!({ "type": "auth", "captcha": { "type": "none" }, "username": USERNAME }), AuthState::of(AuthKind::Auth)),
        (json!({ "type": "multifactor", "email": "private@example.invalid" }), AuthState::of(AuthKind::Multifactor)),
        (json!({ "type": "auth", "captcha": { "type": "hcaptcha", "token": "private" } }), AuthState::challenge(ChallengeSource::Captcha("hcaptcha"))),
        (json!({ "type": "auth", "captcha": { "type": PASSWORD } }), AuthState::challenge(ChallengeSource::Captcha("other"))),
        (json!({ "type": "error", "error": PASSWORD }), AuthState::failed(AuthKind::Error, "authentication_error")),
        (json!({ "type": "auth", "error": "auth_failure" }), AuthState::failed(AuthKind::Error, "auth_failure")),
        (json!({ "type": "confirm_age", "token": "private" }), AuthState::challenge(ChallengeSource::AuthenticatorType)),
    ];
    for (raw, expected) in cases {
        let modern = if expected.kind == AuthKind::Authenticated {
            vec![ok(raw.clone()), ok(json!({ "loginState": "PendingProductContext" }))]
        } else if matches!(expected.source, Some(ChallengeSource::Captcha(_))) {
            vec![ok(raw.clone()), status(404, Value::Null)]
        } else {
            vec![ok(raw.clone())]
        };
        assert_eq!(fixture(modern).service.session_state(None).unwrap(), Some(expected), "{raw}");
        let legacy = fixture(vec![status(404, Value::Null), ok(raw.clone())]);
        assert_eq!(legacy.service.session_state(None).unwrap(), Some(expected), "{raw}");
        assert_eq!(legacy.routes(), routes(&[("GET", AUTH), ("GET", LEGACY_SESSION)]));
    }
    assert_eq!(fixture(vec![status(404, Value::Null), status(404, Value::Null)]).service.session_state(None).unwrap(), None);
}

fn form_captcha() -> Value {
    json!({ "type": "auth", "suuid": "synthetic-next-login", "captcha": { "type": "hcaptcha", "data": "private-challenge" } })
}

#[test]
fn a_captcha_on_the_next_login_form_does_not_block_an_authorized_account_and_the_player_session_decides() {
    let cases = [
        ("PendingProductContext", AuthState::of(AuthKind::Authenticated)),
        ("Authorized", AuthState::of(AuthKind::Authenticated)),
        ("PendingEulaAcceptance", AuthState::challenge(ChallengeSource::PlayerSession("pendingeulaacceptance"))),
        ("PendingMultifactor", AuthState::of(AuthKind::Multifactor)),
        ("SomethingNew", AuthState::challenge(ChallengeSource::PlayerSession("other"))),
    ];
    for (login_state, expected) in cases {
        let f = fixture(vec![ok(form_captcha()), ok(json!({ "type": "authorization" })), ok(json!({ "loginState": login_state, "sessionToken": PASSWORD }))]);
        assert_eq!(f.service.session_state(None).unwrap(), Some(expected), "{login_state}");
        assert_eq!(f.routes(), routes(&[("GET", AUTH), ("GET", AUTHORIZATION), ("GET", PLAYER_SESSION)]));
    }
    let unsupported = fixture(vec![ok(form_captcha()), ok(json!({ "type": "authorization" })), status(404, Value::Null)]);
    assert_eq!(unsupported.service.session_state(None).unwrap(), Some(AuthState::of(AuthKind::Authenticated)));
}

#[test]
fn a_form_captcha_still_blocks_when_the_account_is_not_confirmed_as_authorized() {
    for answer in [status(404, Value::Null), status(401, json!({ "error": PASSWORD })), status(500, Value::Null), Step::Fail(PASSWORD.into())] {
        let f = fixture(vec![ok(form_captcha()), answer]);
        assert_eq!(f.service.session_state(None).unwrap(), Some(AuthState::challenge(ChallengeSource::Captcha("hcaptcha"))));
        assert_eq!(f.routes(), routes(&[("GET", AUTH), ("GET", AUTHORIZATION)]));
    }
}

#[test]
fn a_refused_captcha_an_unknown_authenticator_screen_and_old_clients_never_ask_for_the_authorization() {
    for raw in [json!({ "type": "auth", "error": "captcha_not_allowed" }), json!({ "type": "confirm_age" })] {
        let f = fixture(vec![ok(raw.clone())]);
        assert_eq!(f.service.session_state(None).unwrap().unwrap().kind, AuthKind::Challenge, "{raw}");
        assert_eq!(f.routes(), routes(&[("GET", AUTH)]));
    }
    let legacy = fixture(vec![status(404, Value::Null), ok(form_captcha())]);
    assert_eq!(legacy.service.session_state(None).unwrap(), Some(AuthState::challenge(ChallengeSource::Captcha("hcaptcha"))));
    assert_eq!(legacy.routes(), routes(&[("GET", AUTH), ("GET", LEGACY_SESSION)]));
}

#[test]
fn cancelling_while_checking_the_authorization_of_a_form_captcha_is_reported_as_cancelled() {
    let cancel = Cancel::new();
    let trigger = cancel.clone();
    let f = fixture(vec![ok(form_captcha()), Step::Then(Box::new(move || {
        trigger.cancel();
        Ok(Response::new(200, json!({ "type": "authorization" })))
    }))]);
    assert!(f.service.session_state(Some(&cancel)).unwrap_err().is_cancelled());
    assert_eq!(f.routes().len(), 2);
}

fn player_state(login_state: &str) -> RiotResult<Option<AuthState>> {
    fixture(vec![ok(json!({ "type": "success", "access_token": "private-identity-token" })), ok(json!({ "loginState": login_state, "account": USERNAME, "sessionToken": PASSWORD }))]).service.session_state(None)
}

#[test]
fn successful_identity_authentication_still_reports_pending_player_session_verification_without_returning_session_data() {
    for login_state in ["PendingConsent", "PendingEulaAcceptance", "PendingForget", "PendingAgeVerification", "PendingHealup", "PendingMultifactor", "PendingKRIdVerification", "PendingDisambiguation", "PendingRiotID", "PendingLolRegionSelection", "PendingVNGProfile", "Error"] {
        let state = player_state(login_state).unwrap().unwrap();
        let expected = if login_state == "PendingMultifactor" { AuthKind::Multifactor } else { AuthKind::Challenge };
        assert_eq!(state.kind, expected, "{login_state}");
    }
    let f = fixture(vec![ok(json!({ "type": "success" })), ok(json!({ "loginState": "PendingConsent" }))]);
    f.service.session_state(None).unwrap();
    assert_eq!(f.routes(), routes(&[("GET", AUTH), ("GET", PLAYER_SESSION)]));
}

#[test]
fn initializing_authorized_and_automatic_riot_player_session_steps_do_not_ask_for_attention() {
    for login_state in ["Initializing", "PendingProductContext", "Authorized", "PendingProductContextInitialization", "PendingInitialization", "RestoreAuthorization", "RefreshAuthorization", "LoginTokenExchange", "PendingEulaData", "PendingUserInfoData", "PendingLoginQueue", "PendingGameSession"] {
        assert_eq!(player_state(login_state).unwrap(), Some(AuthState::of(AuthKind::Authenticated)), "{login_state}");
    }
}

#[test]
fn restriction_consent_and_account_choice_player_session_states_block_the_launch() {
    for login_state in [
        "SignupAgeRestricted", "ConfirmedAgeTooYoung", "PlatformAgeRestricted", "ProductAgeRestricted", "GamePlayRestricted", "PendingParentalEmail", "MultifactorChallengeDenied",
        "PendingUsernameChangedConfirmation", "PendingRecoverableAccount", "ReauthenticationRequired", "PendingCreateAccountStrategy", "PendingSignup", "PendingPlatformAuthorizationConsent",
        "PendingProviderCredentials", "PendingPlatformUser", "PendingAuthIntent", "PendingLoginStrategy", "PendingSignInStrategy", "KeyPairError", "PendingFutureVerification", "SomethingNew", PASSWORD,
    ] {
        assert_eq!(player_state(login_state).unwrap().unwrap().kind, AuthKind::Challenge, "{login_state}");
    }
}

#[test]
fn a_blocking_player_session_state_carries_only_its_name_from_a_fixed_list() {
    for (login_state, name) in [("PendingEulaAcceptance", "pendingeulaacceptance"), ("PendingSignInStrategy", "pendingsigninstrategy"), ("ConfirmedAgeTooYoung", "confirmedagetooyoung"), ("SomethingNew", "other"), (PASSWORD, "other")] {
        assert_eq!(player_state(login_state).unwrap(), Some(AuthState::challenge(ChallengeSource::PlayerSession(name))), "{login_state}");
    }
    assert_eq!(ChallengeSource::PlayerSession("pendingeulaacceptance").describe(), "player session: pendingeulaacceptance");
    assert_eq!(ChallengeSource::Captcha("hcaptcha").describe(), "authenticator captcha: hcaptcha");
    assert_eq!(ChallengeSource::AuthenticatorType.describe(), "authenticator type: other");
}

#[test]
fn the_blocking_player_session_names_are_lowercase_unique_and_never_overlap_the_non_blocking_ones() {
    let mut names = BLOCKING_SESSION_STATES.to_vec();
    assert!(names.iter().all(|name| !name.is_empty() && name.chars().all(|letter| letter.is_ascii_lowercase())));
    assert!(names.iter().all(|name| !NON_BLOCKING_SESSION_STATES.contains(name)));
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), BLOCKING_SESSION_STATES.len());
}

#[test]
fn unavailable_player_session_routes_keep_compatibility_but_other_failures_cannot_conceal_pending_verification() {
    for code in [404, 405, 501] {
        let f = fixture(vec![ok(json!({ "type": "success" })), status(code, Value::Null)]);
        assert_eq!(f.service.session_state(None).unwrap(), Some(AuthState::of(AuthKind::Authenticated)));
        assert_eq!(f.routes().len(), 2);
    }
    for failed in [status(500, json!({ "loginState": PASSWORD })), Step::Fail(PASSWORD.into()), ok(Value::Null), ok(json!({ "state": "PendingConsent" }))] {
        let f = fixture(vec![ok(json!({ "type": "success" })), failed]);
        assert!(hidden(&f.service.session_state(None).unwrap_err()));
        assert_eq!(f.routes().len(), 2);
    }
}

#[test]
fn cancellation_before_and_between_requests_prevents_any_later_credential_submission() {
    let already = Cancel::new();
    already.cancel();
    let before = fixture(vec![]);
    assert!(before.service.authenticate(&account(), Some(&already), true).unwrap_err().is_cancelled());
    assert!(before.routes().is_empty());
    let cancel = Cancel::new();
    let trigger = cancel.clone();
    let after = fixture(vec![Step::Then(Box::new(move || {
        trigger.cancel();
        Ok(Response::new(200, auth()))
    }))]);
    assert!(after.service.authenticate(&account(), Some(&cancel), true).unwrap_err().is_cancelled());
    assert_eq!(after.routes().len(), 1);
}

#[test]
fn invalid_credential_inputs_are_rejected_without_any_local_requests() {
    let long = "x".repeat(257);
    for (username, password) in [(USERNAME, ""), ("", PASSWORD), ("bad\nlogin", PASSWORD), (USERNAME, long.as_str())] {
        let f = fixture(vec![]);
        assert!(f.service.authenticate(&Credentials { username, password }, None, true).unwrap_err().message.contains("username and password"));
        assert!(f.routes().is_empty());
    }
}

#[test]
fn the_non_blocking_player_session_states_are_the_31_lowercase_names_kept_from_the_electron_version() {
    let mut names = NON_BLOCKING_SESSION_STATES.to_vec();
    assert!(names.iter().all(|name| !name.is_empty() && name.chars().all(|letter| letter.is_ascii_lowercase())));
    assert_eq!(names[..4], ["authorized", "initializing", "pendingproductcontext", "pendingproductcontextinitialization"]);
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), 31);
}
