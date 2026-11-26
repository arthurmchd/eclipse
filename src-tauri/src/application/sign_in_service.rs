use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};

use super::store::{account_riot_id, client_path, now_iso, stay_signed_in, ServiceStore};
use super::timers::Timers;
use crate::riot::riot_client::RiotClient;
use crate::riot::sign_in_flow::{Account, Closed, SignInOutcome, SignInRequest, StatusDetails, Step, GAMES};
use crate::riot::{Cancel, RiotError, RiotResult, CANCELLED};

pub const ALREADY_RUNNING: &str = "A sign-in is already in progress";
pub const CREDENTIALS_CHANGED: &str = "Account credentials changed. Start sign-in again";
pub const KEEP_LEAVING_FAILED: &str = "Could not keep the session of the account that was signed in. Try Play again";
const FAILED: &str = "Sign-in failed";

pub trait SignInRunner: Send + Sync {
    fn sign_in(&self, request: &SignInRequest) -> RiotResult<SignInOutcome>;
}

impl SignInRunner for RiotClient {
    fn sign_in(&self, request: &SignInRequest) -> RiotResult<SignInOutcome> {
        RiotClient::sign_in(self, request)
    }
}

type Observer<T> = Box<dyn Fn(&T) + Send + Sync>;
type ClosedHandler = Box<dyn Fn(&Closed) -> Result<(), String> + Send + Sync>;

pub struct SignInObservers {
    pub status: Observer<Value>,
    pub operation_updated: Observer<Value>,
    pub account_updated: Observer<Map<String, Value>>,
    pub log: Observer<str>,
    pub on_closed: ClosedHandler,
    pub on_launched: Observer<SignInOutcome>,
    pub translate: Box<dyn Fn(&str) -> String + Send + Sync>,
}

impl Default for SignInObservers {
    fn default() -> Self {
        Self {
            status: Box::new(|_| {}),
            operation_updated: Box::new(|_| {}),
            account_updated: Box::new(|_| {}),
            log: Box::new(|_| {}),
            on_closed: Box::new(|_| Ok(())),
            on_launched: Box::new(|_| {}),
            translate: Box::new(str::to_string),
        }
    }
}

#[derive(Debug, Clone)]
struct Operation {
    id: String,
    account_id: String,
    game: String,
    status: &'static str,
    text: String,
    needs_attention: bool,
    native_client: bool,
    signed_in: bool,
    step: &'static str,
    started_at: String,
    finished_at: Option<String>,
    error: Option<String>,
    cancelled: Option<bool>,
}

#[derive(Default)]
struct State {
    operation: Option<Operation>,
    cancel: Option<Cancel>,
    busy: bool,
}

struct Attempt {
    operation_id: String,
    account_id: String,
    game: String,
    username: String,
    riot_id: crate::riot::RiotId,
    encrypted: Option<Value>,
    password: Mutex<String>,
}

impl Attempt {
    fn safe_text(&self, value: &str) -> String {
        if value.is_empty() {
            return FAILED.into();
        }
        let password = self.password.lock().map(|password| password.clone()).unwrap_or_default();
        let mut text = value.to_string();
        for secret in [self.username.as_str(), password.as_str()] {
            if secret.is_empty() || !text.contains(secret) {
                continue;
            }
            if secret.encode_utf16().count() < 4 {
                return FAILED.into();
            }
            text = text.replace(secret, "[redacted]");
        }
        text
    }
}

struct Inner {
    store: Arc<dyn ServiceStore>,
    riot: Arc<dyn SignInRunner>,
    timers: Arc<dyn Timers>,
    observers: SignInObservers,
    state: Mutex<State>,
}

#[derive(Clone)]
pub struct SignInService {
    inner: Arc<Inner>,
}

fn text_field(account: &Map<String, Value>, key: &str) -> String {
    account.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn filled(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Null) | None => false,
        Some(_) => true,
    }
}

impl SignInService {
    pub fn new(store: Arc<dyn ServiceStore>, riot: Arc<dyn SignInRunner>, timers: Arc<dyn Timers>, observers: SignInObservers) -> Self {
        Self { inner: Arc::new(Inner { store, riot, timers, observers, state: Mutex::new(State::default()) }) }
    }

    pub fn start_from_manager(&self, id: &str, game: &str) -> Result<Value, String> {
        let operation_id = self.begin(id, game)?;
        Ok(json!({ "ok": true, "operationId": operation_id }))
    }

    pub fn cancel(&self) -> Value {
        if let Some(cancel) = self.inner.state.lock().unwrap().cancel.as_ref() {
            cancel.cancel();
        }
        json!({ "ok": true })
    }

    pub fn get_state(&self) -> Value {
        let operation = self.inner.state.lock().unwrap().operation.clone();
        operation.map(|operation| self.inner.shown(&operation)).unwrap_or(Value::Null)
    }

    pub fn is_busy(&self) -> bool {
        self.inner.state.lock().unwrap().busy
    }

    pub fn active_account_id(&self) -> Option<String> {
        let state = self.inner.state.lock().unwrap();
        if state.busy {
            state.operation.as_ref().map(|operation| operation.account_id.clone())
        } else {
            None
        }
    }

    fn validate(&self, id: &str, game: &str) -> Result<Map<String, Value>, String> {
        if !GAMES.contains(&game) {
            return Err("Select a supported game".into());
        }
        let account = self.inner.store.account(id).ok_or("Account not found")?;
        if !filled(account.get("username")) || !filled(account.get("password")) {
            return Err("Add the username and password first".into());
        }
        Ok(account)
    }

    fn begin(&self, id: &str, game: &str) -> Result<String, String> {
        let mut state = self.inner.state.lock().unwrap();
        if state.busy {
            return Err(ALREADY_RUNNING.into());
        }
        let account = self.validate(id, game)?;
        let operation = Operation {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: id.to_string(),
            game: game.to_string(),
            status: "running",
            text: "Preparing sign-in…".into(),
            needs_attention: false,
            native_client: false,
            signed_in: false,
            step: Step::Prepare.code(),
            started_at: now_iso(),
            finished_at: None,
            error: None,
            cancelled: None,
        };
        let attempt = Arc::new(Attempt {
            operation_id: operation.id.clone(),
            account_id: id.to_string(),
            game: game.to_string(),
            username: text_field(&account, "username"),
            riot_id: account_riot_id(&account),
            encrypted: account.get("password").cloned(),
            password: Mutex::new(String::new()),
        });
        let cancel = Cancel::new();
        state.operation = Some(operation.clone());
        state.cancel = Some(cancel.clone());
        state.busy = true;
        drop(state);
        (self.inner.observers.operation_updated)(&self.inner.shown(&operation));
        let inner = self.inner.clone();
        self.inner.timers.later(0, Box::new(move || inner.execute(&attempt, &cancel)));
        Ok(operation.id)
    }
}

impl Inner {
    fn say(&self, text: &str) -> String {
        (self.observers.translate)(text)
    }

    fn shown(&self, operation: &Operation) -> Value {
        let mut value = json!({
            "id": operation.id,
            "operationId": operation.id,
            "accountId": operation.account_id,
            "game": operation.game,
            "status": operation.status,
            "text": self.say(&operation.text),
            "needsAttention": operation.needs_attention,
            "nativeClient": operation.native_client,
            "signedIn": operation.signed_in,
            "step": operation.step,
            "startedAt": operation.started_at,
        });
        let map = value.as_object_mut().unwrap();
        if let Some(finished) = &operation.finished_at {
            map.insert("finishedAt".into(), Value::String(finished.clone()));
        }
        if let Some(error) = &operation.error {
            map.insert("error".into(), Value::String(self.say(error)));
        }
        if let Some(cancelled) = operation.cancelled {
            map.insert("cancelled".into(), Value::Bool(cancelled));
        }
        value
    }

    fn write_log(&self, attempt: &Attempt, text: &str) {
        (self.observers.log)(&attempt.safe_text(text));
    }

    fn exists(&self, attempt: &Attempt) -> bool {
        self.store.account(&attempt.account_id).is_some()
    }

    fn report(&self, attempt: &Attempt, text: &str, details: StatusDetails) {
        let public = attempt.safe_text(text);
        let mut state = self.state.lock().unwrap();
        let Some(operation) = state.operation.as_mut().filter(|operation| operation.id == attempt.operation_id && operation.status == "running") else {
            return;
        };
        operation.text = public.clone();
        operation.needs_attention = details.needs_attention;
        operation.native_client = details.native_client;
        operation.signed_in = operation.signed_in || details.signed_in;
        operation.step = details.step.code();
        let snapshot = operation.clone();
        drop(state);
        (self.observers.log)(&public);
        (self.observers.status)(&json!({ "id": attempt.account_id, "text": self.say(&public), "needsAttention": snapshot.needs_attention, "nativeClient": snapshot.native_client }));
        (self.observers.operation_updated)(&self.shown(&snapshot));
    }

    fn run(&self, attempt: &Attempt, cancel: &Cancel) -> RiotResult<(&'static str, SignInOutcome)> {
        cancel.check()?;
        let id = attempt.account_id.as_str();
        let latest = self.store.account(id);
        let unchanged = latest.as_ref().is_some_and(|latest| text_field(latest, "username") == attempt.username && latest.get("password").cloned() == attempt.encrypted);
        if !unchanged {
            return Err(RiotError::new(CREDENTIALS_CHANGED));
        }
        self.write_log(attempt, &format!("--- sign in ({})", attempt.game));
        let password = self.store.password(id).map_err(RiotError::new)?;
        *attempt.password.lock().unwrap() = password.clone();
        let session = || Ok(self.store.load_session(id));
        let status = |text: &str, details: StatusDetails| self.report(attempt, text, details);
        let log = |line: &str| {
            self.write_log(attempt, line);
            Ok(())
        };
        let on_closed = |closed: &Closed| {
            (self.observers.on_closed)(closed).map_err(|_| {
                self.write_log(attempt, "could not keep the session of the account that was signed in");
                RiotError::new(KEEP_LEAVING_FAILED)
            })
        };
        let on_rejected = || {
            if self.exists(attempt) {
                if let Err(error) = self.store.forget_session(id) {
                    self.write_log(attempt, &format!("could not forget the rejected session: {}", attempt.safe_text(&error)));
                }
            }
            Ok(())
        };
        let request = SignInRequest {
            account: Account { username: attempt.username.clone(), password, riot_id: attempt.riot_id.clone() },
            session: &session,
            has_saved_session: self.store.has_session(id),
            game: attempt.game.clone(),
            client_path: client_path(self.store.as_ref()),
            remember: stay_signed_in(self.store.as_ref()),
            status: &status,
            log: &log,
            on_closed: &on_closed,
            on_rejected: &on_rejected,
            cancel: Some(cancel),
        };
        let result = self.riot.sign_in(&request)?;
        if result.session_rejected && self.exists(attempt) {
            self.store.forget_session(id).map_err(RiotError::new)?;
        }
        if let Some(session) = result.session.as_deref().filter(|_| self.exists(attempt)) {
            self.store.save_session(id, session).map_err(RiotError::new)?;
        }
        if self.exists(attempt) {
            self.store.set_current_account(id).map_err(RiotError::new)?;
            let mut fields = Map::new();
            if result.game_started || (attempt.game == "riot" && result.client_opened) {
                let count = self.store.account(id).and_then(|account| account.get("signInCount").and_then(Value::as_u64)).unwrap_or(0);
                fields.insert("signInCount".into(), Value::from(count + 1));
            }
            if result.game_started {
                fields.insert("lastPlayed".into(), Value::String(now_iso()));
                fields.insert("lastGame".into(), Value::String(attempt.game.clone()));
            }
            if let Some(riot_id) = result.riot_id.as_ref().filter(|riot_id| !riot_id.game_name.is_empty()) {
                fields.insert("gameName".into(), Value::String(riot_id.game_name.clone()));
                fields.insert("tagLine".into(), Value::String(riot_id.tag_line.clone()));
            }
            if let Some(updated) = self.store.update_account_fields(id, fields).map_err(RiotError::new)? {
                (self.observers.account_updated)(&updated);
            }
        }
        let client_only = attempt.game == "riot" && result.client_opened;
        if !result.game_started && !client_only {
            let text = if attempt.game == "riot" { "The Riot Client did not finish signing in. Open it to see what happened" } else { "The game did not open. Open the Riot Client to see what happened" };
            return Err(RiotError::new(text));
        }
        Ok((if client_only { "Riot Client opened" } else { "Game opened" }, result))
    }

    fn execute(&self, attempt: &Attempt, cancel: &Cancel) {
        let outcome = self.run(attempt, cancel);
        let mut launched = None;
        let finish: Box<dyn FnOnce(&mut Operation)> = match outcome {
            Ok((text, result)) => {
                launched = Some(result);
                Box::new(move |operation: &mut Operation| {
                    operation.status = "succeeded";
                    operation.step = Step::Done.code();
                    operation.text = text.into();
                })
            }
            Err(error) => {
                if error.session_rejected && self.exists(attempt) {
                    match self.store.forget_session(&attempt.account_id) {
                        Ok(()) => {
                            if let Some(account) = self.store.public_account(&attempt.account_id) {
                                (self.observers.account_updated)(&account);
                            }
                        }
                        Err(storage) => self.write_log(attempt, &format!("could not forget the rejected session: {}", attempt.safe_text(&storage))),
                    }
                }
                let cancelled = cancel.is_cancelled();
                let message = attempt.safe_text(&error.message);
                let status = if cancelled { "cancelled" } else { "failed" };
                self.write_log(attempt, &format!("sign-in {status}: {message}"));
                Box::new(move |operation: &mut Operation| {
                    operation.status = status;
                    operation.cancelled = Some(cancelled);
                    operation.needs_attention = !cancelled && error.needs_attention;
                    operation.native_client = !cancelled && error.needs_attention && error.native_client;
                    operation.text = if cancelled { CANCELLED.into() } else { message.clone() };
                    operation.error = Some(message);
                })
            }
        };
        if let Some(result) = &launched {
            (self.observers.on_launched)(result);
        }
        let mut state = self.state.lock().unwrap();
        let snapshot = state.operation.as_mut().filter(|operation| operation.id == attempt.operation_id).map(|operation| {
            finish(operation);
            if operation.status != "failed" {
                operation.needs_attention = false;
                operation.native_client = false;
            }
            operation.finished_at = Some(now_iso());
            operation.clone()
        });
        state.cancel = None;
        state.busy = false;
        drop(state);
        attempt.password.lock().unwrap().clear();
        if let Some(snapshot) = snapshot {
            (self.observers.operation_updated)(&self.shown(&snapshot));
        }
    }
}
