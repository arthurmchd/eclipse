pub mod game_ranks;
pub mod riot_app_controls;
pub mod riot_authentication;
pub mod riot_client;
pub mod riot_interface;
pub mod riot_process;
pub mod riot_state;
pub mod riot_transport;
pub mod sign_in_flow;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;

pub const CANCELLED: &str = "Sign-in cancelled";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RiotError {
    pub message: String,
    pub code: Option<String>,
    pub needs_attention: bool,
    pub native_client: bool,
    pub session_rejected: bool,
}

impl RiotError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), ..Self::default() }
    }

    pub fn with_code(message: impl Into<String>, code: &str) -> Self {
        Self { message: message.into(), code: Some(code.to_string()), ..Self::default() }
    }

    pub fn cancelled() -> Self {
        Self::new(CANCELLED)
    }

    pub fn is_cancelled(&self) -> bool {
        self.message == CANCELLED
    }
}

impl fmt::Display for RiotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RiotError {}

impl From<&str> for RiotError {
    fn from(message: &str) -> Self {
        Self::new(message)
    }
}

pub type RiotResult<T> = Result<T, RiotError>;

#[derive(Debug, Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> RiotResult<()> {
        if self.is_cancelled() {
            Err(RiotError::cancelled())
        } else {
            Ok(())
        }
    }
}

pub fn check(cancel: Option<&Cancel>) -> RiotResult<()> {
    cancel.map(Cancel::check).unwrap_or(Ok(()))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Response {
    pub status: u16,
    pub json: Value,
}

impl Response {
    pub fn new(status: u16, json: Value) -> Self {
        Self { status, json }
    }

    pub fn accepted(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

pub const DEFAULT_TIMEOUT_MS: u64 = 4000;

pub trait LocalApi: Send + Sync {
    fn request(&self, method: &str, path: &str, body: Option<&Value>, timeout_ms: u64, cancel: Option<&Cancel>) -> RiotResult<Response>;

    fn get(&self, path: &str) -> RiotResult<Response> {
        self.request("GET", path, None, DEFAULT_TIMEOUT_MS, None)
    }

    fn post(&self, path: &str) -> RiotResult<Response> {
        self.request("POST", path, None, DEFAULT_TIMEOUT_MS, None)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RunningGames {
    pub lol: bool,
    pub val: bool,
    pub client: bool,
    pub client_window: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiotId {
    pub game_name: String,
    pub tag_line: String,
}

impl RiotId {
    pub fn new(game_name: &str, tag_line: &str) -> Self {
        Self { game_name: game_name.to_string(), tag_line: tag_line.to_string() }
    }
}

pub fn same_riot_id(a: Option<&RiotId>, b: Option<&RiotId>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) if !a.game_name.is_empty() && !b.game_name.is_empty() => {
            a.game_name.to_lowercase() == b.game_name.to_lowercase() && a.tag_line.to_lowercase() == b.tag_line.to_lowercase()
        }
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountState {
    Yes,
    No,
    Unknown,
}
