use std::sync::{Arc, Mutex, Weak};

use serde_json::{Map, Value};

use super::timers::{Task, Timers};

pub const FIRST_CHECK_MS: u64 = 60_000;
pub const CHECK_EVERY_MS: u64 = 12 * 60 * 60 * 1000;
pub const UPDATE_CHECKS: &str = "updateChecks";
pub const CHECK_FAILED: &str = "update check failed";
pub const INSTALL_FAILED: &str = "update install failed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateFailure;

pub trait UpdateSource: Send + Sync {
    fn check(&self) -> Result<Option<String>, UpdateFailure>;
    fn install(&self) -> Result<(), UpdateFailure>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallOutcome {
    Started,
    Busy,
    NoUpdate,
    Failed,
}

pub fn valid_version(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| (1..=4).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_digit()))
}

pub fn checks_enabled(settings: &Map<String, Value>) -> bool {
    settings.get(UPDATE_CHECKS) != Some(&Value::Bool(false))
}

pub struct UpdateHooks {
    pub enabled: Box<dyn Fn() -> bool + Send + Sync>,
    pub busy: Box<dyn Fn() -> bool + Send + Sync>,
    pub on_available: Box<dyn Fn(&str) + Send + Sync>,
    pub log: Box<dyn Fn(&str) + Send + Sync>,
    pub spawn: Box<dyn Fn(Task) + Send + Sync>,
}

#[derive(Default)]
struct State {
    available: Option<String>,
    announced: Option<String>,
    timer: Option<u64>,
    checking: bool,
    installing: bool,
    stopped: bool,
}

struct Inner {
    source: Arc<dyn UpdateSource>,
    timers: Arc<dyn Timers>,
    hooks: UpdateHooks,
    state: Mutex<State>,
}

#[derive(Clone)]
pub struct Updates {
    inner: Arc<Inner>,
}

impl Updates {
    pub fn new(source: Arc<dyn UpdateSource>, timers: Arc<dyn Timers>, hooks: UpdateHooks) -> Self {
        Self { inner: Arc::new(Inner { source, timers, hooks, state: Mutex::new(State::default()) }) }
    }

    pub fn start(&self) {
        schedule(&self.inner, FIRST_CHECK_MS);
    }

    pub fn stop(&self) {
        let timer = {
            let mut state = self.inner.state.lock().unwrap();
            state.stopped = true;
            state.timer.take()
        };
        if let Some(timer) = timer {
            self.inner.timers.cancel(timer);
        }
    }

    pub fn available(&self) -> Option<String> {
        self.inner.state.lock().unwrap().available.clone()
    }

    pub fn check_now(&self) {
        check(&self.inner);
    }

    pub fn install(&self) -> InstallOutcome {
        let inner = &self.inner;
        {
            let mut state = inner.state.lock().unwrap();
            if state.stopped || state.available.is_none() {
                return InstallOutcome::NoUpdate;
            }
            if state.installing || (inner.hooks.busy)() {
                return InstallOutcome::Busy;
            }
            state.installing = true;
        }
        let result = inner.source.install();
        inner.state.lock().unwrap().installing = false;
        match result {
            Ok(()) => InstallOutcome::Started,
            Err(UpdateFailure) => {
                (inner.hooks.log)(INSTALL_FAILED);
                InstallOutcome::Failed
            }
        }
    }
}

fn schedule(inner: &Arc<Inner>, delay_ms: u64) {
    let weak: Weak<Inner> = Arc::downgrade(inner);
    let mut state = inner.state.lock().unwrap();
    if state.stopped {
        return;
    }
    let task: Task = Box::new(move || {
        if let Some(inner) = weak.upgrade() {
            let worker = inner.clone();
            (inner.hooks.spawn)(Box::new(move || {
                check(&worker);
                worker.state.lock().unwrap().timer = None;
                schedule(&worker, CHECK_EVERY_MS);
            }));
        }
    });
    if let Some(old) = state.timer.replace(inner.timers.later(delay_ms, task)) {
        inner.timers.cancel(old);
    }
}

fn check(inner: &Arc<Inner>) {
    {
        let mut state = inner.state.lock().unwrap();
        if state.stopped || state.checking || !(inner.hooks.enabled)() {
            return;
        }
        state.checking = true;
    }
    let result = inner.source.check();
    let announce = {
        let mut state = inner.state.lock().unwrap();
        state.checking = false;
        match result {
            Ok(Some(version)) if valid_version(&version) => {
                state.available = Some(version.clone());
                (state.announced.as_deref() != Some(version.as_str())).then(|| {
                    state.announced = Some(version.clone());
                    version
                })
            }
            Ok(_) => {
                state.available = None;
                None
            }
            Err(UpdateFailure) => {
                drop(state);
                (inner.hooks.log)(CHECK_FAILED);
                None
            }
        }
    };
    if let Some(version) = announce {
        (inner.hooks.log)(&format!("update available: {version}"));
        (inner.hooks.on_available)(&version);
    }
}
