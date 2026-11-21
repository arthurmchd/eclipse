use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use regex::Regex;

use super::window_guard::{WindowOps, GAMES};
use crate::riot::{RiotError, RiotResult};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn safe_reason(text: &str) -> &str {
    static REASON: OnceLock<Regex> = OnceLock::new();
    if REASON.get_or_init(|| Regex::new(r"^[a-z0-9-]{1,64}$").unwrap()).is_match(text) {
        text
    } else {
        "unknown"
    }
}

pub struct WindowController {
    ops: Arc<dyn WindowOps>,
    disposed: AtomicBool,
    queue: Mutex<()>,
}

impl WindowController {
    pub fn new(ops: Arc<dyn WindowOps>) -> Self {
        Self { ops, disposed: AtomicBool::new(false), queue: Mutex::new(()) }
    }

    fn run<T>(&self, action: impl FnOnce(&dyn WindowOps) -> Result<T, &'static str>) -> RiotResult<T> {
        let _turn = self.queue.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.disposed.load(Ordering::SeqCst) {
            return Err(RiotError::new("The background window guard is shutting down"));
        }
        action(self.ops.as_ref()).map_err(|reason| RiotError::new(format!("Background window guard: {}", safe_reason(reason))))
    }

    pub fn reveal(&self) -> RiotResult<()> {
        self.run(|ops| ops.reveal())
    }

    pub fn close_client(&self) -> RiotResult<()> {
        self.run(|ops| ops.close_client())
    }

    pub fn game_window(&self, game: &str) -> RiotResult<bool> {
        if !GAMES.contains(&game) {
            return Err(RiotError::new("Invalid game"));
        }
        self.run(|ops| ops.game_window(game))
    }

    pub fn stop(&self) {
        self.disposed.store(true, Ordering::SeqCst);
        drop(self.queue.lock());
    }
}
