use std::sync::Arc;

use serde_json::{json, Value};

use super::{check, Cancel, LocalApi, Response, RiotResult, DEFAULT_TIMEOUT_MS};

pub const AUTHENTICATION: &str = "/rso-authenticator/v1/authentication";
pub const START: &str = "/rso-authenticator/v1/authentication/riot-identity/start";
pub const COMPLETE: &str = "/rso-authenticator/v1/authentication/riot-identity/complete";
pub const LEGACY_SESSION: &str = "/rso-auth/v1/session";
pub const AUTHORIZATION: &str = "/rso-auth/v1/authorization";
pub const PLAYER_SESSION: &str = "/player-session-lifecycle/v1/session";

const UNSUPPORTED: [u16; 3] = [404, 405, 501];
pub const NON_BLOCKING_SESSION_STATES: [&str; 31] = [
    "authorized", "initializing", "pendingproductcontext", "pendingproductcontextinitialization",
    "pendinginitialization", "pendingclientconfigdata", "pendingclientid", "migrateauthorization",
    "pendingpersistenceinitialization", "restoreauthorization", "pendingcreateauthorization",
    "pendingauthintentdata", "pendingloginstrategydata", "pendingauthentication", "logintokenexchange",
    "refreshauthorization", "pendingeuladata", "pendinggamepassstatus", "pendingriotiddata",
    "pendingvngprofiledata", "pendinglolregionselectiondata", "pendingproductlaunchrestrictiondata",
    "pendingproductagerestrictiondata", "pendingaccountentitlementdata", "pendinguserinfodata",
    "pendingpersistentflagsdata", "pendingaffinitydata", "pendingloginqueuedata",
    "pendingloginqueuebypass", "pendingloginqueue", "pendinggamesession",
];

const INVALID: &str = "The Riot authentication service returned an invalid response";
const NOT_COMPLETED: &str = "Riot could not complete sign-in. Open Riot Client to continue";
const TOO_MANY: &str = "Too many attempts, wait a few minutes";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthKind {
    Authenticated,
    Auth,
    Multifactor,
    Challenge,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthState {
    pub kind: AuthKind,
    pub error: Option<&'static str>,
}

impl AuthState {
    pub const fn of(kind: AuthKind) -> Self {
        Self { kind, error: None }
    }

    pub const fn failed(kind: AuthKind, error: &'static str) -> Self {
        Self { kind, error: Some(error) }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AuthOutcome {
    pub supported: bool,
    pub needs_attention: bool,
    pub requires_native_form: bool,
    pub reason: Option<&'static str>,
}

impl AuthOutcome {
    pub const fn unsupported() -> Self {
        Self { supported: false, needs_attention: false, requires_native_form: false, reason: None }
    }

    pub const fn done() -> Self {
        Self { supported: true, needs_attention: false, requires_native_form: false, reason: None }
    }

    pub const fn attention(reason: &'static str) -> Self {
        Self { supported: true, needs_attention: true, requires_native_form: false, reason: Some(reason) }
    }

    pub const fn native_form() -> Self {
        Self { supported: true, needs_attention: false, requires_native_form: true, reason: Some("captcha") }
    }
}

pub struct Credentials<'a> {
    pub username: &'a str,
    pub password: &'a str,
}

fn safe_error(error: &str) -> Option<&'static str> {
    Some(match error.to_lowercase().as_str() {
        "auth_failure" | "invalid_credentials" | "bad_credentials" => "auth_failure",
        "rate_limited" | "too_many_requests" => "rate_limited",
        "captcha_not_allowed" | "captcha_required" => "captcha_not_allowed",
        "invalid_request" => "invalid_request",
        _ => return None,
    })
}

fn normalize_state(value: &Value) -> RiotResult<AuthState> {
    let object = value.as_object().ok_or(INVALID)?;
    let kind = object.get("type").and_then(Value::as_str).filter(|kind| !kind.is_empty()).ok_or(INVALID)?.to_lowercase();
    let error = match object.get("error") {
        None | Some(Value::Null) => None,
        Some(Value::String(error)) if error.is_empty() => None,
        Some(Value::String(error)) => Some(safe_error(error).unwrap_or("authentication_error")),
        Some(_) => return Err(INVALID.into()),
    };
    if error == Some("captcha_not_allowed") {
        return Ok(AuthState::failed(AuthKind::Challenge, "captcha_not_allowed"));
    }
    if let Some(error) = error {
        return Ok(AuthState::failed(AuthKind::Error, error));
    }
    match object.get("captcha") {
        None | Some(Value::Null) => {}
        Some(captcha) => {
            let captcha_type = captcha.as_object().and_then(|captcha| captcha.get("type")).and_then(Value::as_str).ok_or(INVALID)?;
            if captcha_type.to_lowercase() != "none" {
                return Ok(AuthState::of(AuthKind::Challenge));
            }
        }
    }
    Ok(AuthState::of(match kind.as_str() {
        "success" | "authenticated" => AuthKind::Authenticated,
        "multifactor" => AuthKind::Multifactor,
        "auth" => AuthKind::Auth,
        "error" => return Ok(AuthState::failed(AuthKind::Error, "authentication_error")),
        _ => AuthKind::Challenge,
    }))
}

fn attention(state: &AuthState) -> Option<AuthOutcome> {
    match state.kind {
        AuthKind::Multifactor => Some(AuthOutcome::attention("multifactor")),
        AuthKind::Challenge if state.error == Some("captcha_not_allowed") => Some(AuthOutcome::attention("security_check")),
        AuthKind::Challenge => Some(AuthOutcome::attention("challenge")),
        _ => None,
    }
}

fn pre_submission_attention(state: &AuthState, value: &Value) -> Option<AuthOutcome> {
    let raw_type = value.get("type").and_then(Value::as_str);
    if state.kind == AuthKind::Challenge && value.is_object() && matches!(raw_type, Some("auth") | Some("error")) {
        let captcha_error = value.get("error").and_then(Value::as_str).and_then(safe_error) == Some("captcha_not_allowed");
        let active_captcha = raw_type == Some("auth")
            && value.get("captcha").and_then(Value::as_object).and_then(|captcha| captcha.get("type")).and_then(Value::as_str).is_some_and(|kind| kind.to_lowercase() != "none");
        if captcha_error || active_captcha {
            return Some(AuthOutcome::native_form());
        }
    }
    attention(state)
}

fn fail_for_state(state: &AuthState) -> RiotResult<()> {
    match state.error {
        Some("auth_failure") => Err("Wrong username or password".into()),
        Some("rate_limited") => Err(TOO_MANY.into()),
        _ if state.kind == AuthKind::Error => Err(NOT_COMPLETED.into()),
        _ => Ok(()),
    }
}

fn valid_text(value: &str) -> bool {
    !value.is_empty() && value.encode_utf16().count() <= 256 && !value.contains(['\r', '\n', '\0'])
}

pub struct RiotAuthentication {
    request: Arc<dyn LocalApi>,
}

impl RiotAuthentication {
    pub fn new(request: Arc<dyn LocalApi>) -> Self {
        Self { request }
    }

    fn call(&self, method: &str, endpoint: &str, body: Option<&Value>, cancel: Option<&Cancel>, timeout_ms: u64) -> RiotResult<Response> {
        check(cancel)?;
        let response = match self.request.request(method, endpoint, body, timeout_ms, cancel) {
            Ok(response) => response,
            Err(_) => {
                check(cancel)?;
                return Err("Could not contact the Riot authentication service".into());
            }
        };
        check(cancel)?;
        if !(100..=599).contains(&response.status) {
            return Err(INVALID.into());
        }
        Ok(response)
    }

    fn get(&self, endpoint: &str, cancel: Option<&Cancel>) -> RiotResult<Response> {
        self.call("GET", endpoint, None, cancel, DEFAULT_TIMEOUT_MS)
    }

    fn successful_state(&self, response: &Response, allow_empty: bool) -> RiotResult<Option<AuthState>> {
        if response.status == 429 {
            return Err(TOO_MANY.into());
        }
        if !response.accepted() {
            if let Some(error) = response.json.as_object().and_then(|json| json.get("error")).and_then(Value::as_str) {
                let error = safe_error(error).unwrap_or("authentication_error");
                if error == "captcha_not_allowed" {
                    return Ok(Some(AuthState::failed(AuthKind::Challenge, error)));
                }
                fail_for_state(&AuthState::failed(AuthKind::Error, error))?;
            }
            return Err(NOT_COMPLETED.into());
        }
        if allow_empty && (response.status == 202 || response.status == 204) && response.json.is_null() {
            return Ok(None);
        }
        normalize_state(&response.json).map(Some)
    }

    pub fn session_state(&self, cancel: Option<&Cancel>) -> RiotResult<Option<AuthState>> {
        let mut response = self.get(AUTHENTICATION, cancel)?;
        let mut legacy = false;
        if UNSUPPORTED.contains(&response.status) {
            legacy = true;
            response = self.get(LEGACY_SESSION, cancel)?;
        }
        if response.status == 429 {
            return Ok(Some(AuthState::failed(AuthKind::Error, "rate_limited")));
        }
        if response.status != 200 {
            return Ok(None);
        }
        let state = normalize_state(&response.json)?;
        if legacy || state.kind != AuthKind::Authenticated {
            return Ok(Some(state));
        }
        let player = self.get(PLAYER_SESSION, cancel)?;
        if UNSUPPORTED.contains(&player.status) {
            return Ok(Some(state));
        }
        if player.status != 200 {
            return Err("Riot could not confirm the sign-in session. Open Riot Client to continue".into());
        }
        let login_state = player.json.get("loginState").and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or(INVALID)?.to_lowercase();
        if login_state == "pendingmultifactor" {
            return Ok(Some(AuthState::of(AuthKind::Multifactor)));
        }
        if !NON_BLOCKING_SESSION_STATES.contains(&login_state.as_str()) {
            return Ok(Some(AuthState::of(AuthKind::Challenge)));
        }
        Ok(Some(state))
    }

    pub fn authenticate(&self, account: &Credentials, cancel: Option<&Cancel>, remember: bool) -> RiotResult<AuthOutcome> {
        check(cancel)?;
        if !valid_text(account.username) || !valid_text(account.password) {
            return Err("Add the username and password first".into());
        }
        let initial = self.get(AUTHENTICATION, cancel)?;
        if initial.status == 405 || initial.status == 501 {
            return Ok(AuthOutcome::unsupported());
        }
        let mut state = if initial.status == 404 { None } else { self.successful_state(&initial, false)? };
        let mut context = initial.json.clone();
        if let Some(current) = &state {
            if let Some(required) = pre_submission_attention(current, &initial.json) {
                return Ok(required);
            }
            if current.kind == AuthKind::Authenticated {
                return Ok(AuthOutcome::done());
            }
            if matches!(current.error, Some("rate_limited") | Some("authentication_error")) {
                fail_for_state(current)?;
            }
        }
        let active_context = initial
            .json
            .get("suuid")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty() && id.encode_utf16().count() <= 256 && !id.chars().any(|c| (c as u32) <= 0x20 || c as u32 == 0x7f));
        if state.is_none() || state.is_some_and(|state| state.kind == AuthKind::Error) || !active_context {
            let reset = self.call("DELETE", AUTHENTICATION, None, cancel, DEFAULT_TIMEOUT_MS)?;
            if reset.status == 405 || reset.status == 501 {
                return Ok(AuthOutcome::unsupported());
            }
            if reset.status == 429 {
                return Err(TOO_MANY.into());
            }
            let body_failed = !reset.json.is_null() && (!reset.json.is_object() || reset.json.get("error").is_some_and(|error| !matches!(error, Value::Null | Value::Bool(false)) && error.as_str() != Some("")));
            if reset.status != 404 && (!reset.accepted() || body_failed) {
                return Err("Riot could not initialize sign-in. Open Riot Client to continue".into());
            }
            let body = json!({ "language": "en_US", "productId": "riot-client", "state": "auth", "intendedProductId": "" });
            let started = self.call("POST", START, Some(&body), cancel, 15000)?;
            if UNSUPPORTED.contains(&started.status) {
                return Ok(AuthOutcome::unsupported());
            }
            state = self.successful_state(&started, true)?;
            context = started.json.clone();
            if state.is_none() {
                let current = self.get(AUTHENTICATION, cancel)?;
                if UNSUPPORTED.contains(&current.status) {
                    return Ok(AuthOutcome::unsupported());
                }
                state = self.successful_state(&current, false)?;
                context = current.json.clone();
            }
        }
        let state = state.ok_or(INVALID)?;
        if let Some(required) = pre_submission_attention(&state, &context) {
            return Ok(required);
        }
        fail_for_state(&state)?;
        if state.kind == AuthKind::Authenticated {
            return Ok(AuthOutcome::done());
        }
        if state.kind != AuthKind::Auth {
            return Err("Riot needs your attention. Open Riot Client to continue".into());
        }
        check(cancel)?;
        let body = json!({ "username": account.username, "password": account.password, "remember": remember, "language": "en_US", "captcha": "" });
        let completed = self.call("POST", COMPLETE, Some(&body), cancel, 30000)?;
        if let Some(result) = self.successful_state(&completed, true)? {
            if let Some(challenge) = attention(&result) {
                return Ok(challenge);
            }
            fail_for_state(&result)?;
        }
        Ok(AuthOutcome::done())
    }

    pub fn login_screen_state(&self, cancel: Option<&Cancel>) -> RiotResult<Option<AuthState>> {
        let mut response = self.get(AUTHENTICATION, cancel)?;
        if UNSUPPORTED.contains(&response.status) {
            response = self.get(LEGACY_SESSION, cancel)?;
        }
        let Some(value) = response.json.as_object().filter(|_| response.status == 200) else {
            return Ok(None);
        };
        let Some(kind) = value.get("type").and_then(Value::as_str).map(str::to_lowercase) else {
            return Ok(None);
        };
        if kind == "auth" {
            return Ok(if self.get(AUTHORIZATION, cancel)?.status == 200 { None } else { Some(AuthState::of(AuthKind::Auth)) });
        }
        if kind == "error" && value.get("error").and_then(Value::as_str).and_then(safe_error) == Some("auth_failure") {
            return Ok(Some(AuthState::failed(AuthKind::Error, "auth_failure")));
        }
        Ok(None)
    }
}
