use std::sync::{Arc, Mutex, Weak};

use super::timers::Timers;
use crate::riot::riot_client::{watch_lockfile, RiotClient};
use crate::riot::riot_state::{Look, Mode};

pub type Watch = Box<dyn Send>;
pub type OnChange = Box<dyn Fn() + Send>;

pub trait WakeupRiot: Send + Sync {
    fn look(&self) -> Look<'_>;
    fn show_interface(&self) -> bool;
    fn watch_lockfile(&self, on_change: OnChange) -> Option<Watch>;
}

impl WakeupRiot for RiotClient {
    fn look(&self) -> Look<'_> {
        RiotClient::look(self)
    }

    fn show_interface(&self) -> bool {
        RiotClient::show_interface(self)
    }

    fn watch_lockfile(&self, on_change: OnChange) -> Option<Watch> {
        watch_lockfile(on_change).map(|watcher| Box::new(watcher) as Watch)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct WakeupTiming {
    pub settle_ms: u64,
    pub retry_ms: u64,
    pub attempts: u32,
    pub grace_ms: u64,
}

impl Default for WakeupTiming {
    fn default() -> Self {
        Self { settle_ms: 1000, retry_ms: 1000, attempts: 8, grace_ms: 2000 }
    }
}

#[derive(Default)]
struct State {
    watcher: Option<Watch>,
    started: bool,
    timer: Option<u64>,
    stopped: bool,
    background: bool,
    generation: u64,
}

struct Inner {
    riot: Arc<dyn WakeupRiot>,
    busy: Box<dyn Fn() -> bool + Send + Sync>,
    log: Box<dyn Fn(&str) + Send + Sync>,
    timers: Arc<dyn Timers>,
    timing: WakeupTiming,
    state: Mutex<State>,
}

pub struct RiotWakeup {
    inner: Arc<Inner>,
}

impl RiotWakeup {
    pub fn new(riot: Arc<dyn WakeupRiot>, busy: Box<dyn Fn() -> bool + Send + Sync>, log: Box<dyn Fn(&str) + Send + Sync>, timers: Arc<dyn Timers>, timing: WakeupTiming) -> Self {
        Self { inner: Arc::new(Inner { riot, busy, log, timers, timing, state: Mutex::new(State::default()) }) }
    }

    pub fn start(&self) {
        let mut state = self.inner.state.lock().unwrap();
        if state.stopped || state.started {
            return;
        }
        state.started = true;
        drop(state);
        let weak = Arc::downgrade(&self.inner);
        let watcher = self.inner.riot.watch_lockfile(Box::new(move || changed(&weak)));
        let mut state = self.inner.state.lock().unwrap();
        state.watcher = watcher;
        state.generation += 1;
        let generation = state.generation;
        drop(state);
        follow(&self.inner, generation, false, 0, 0, false);
    }

    pub fn stop(&self) {
        let mut state = self.inner.state.lock().unwrap();
        state.stopped = true;
        if let Some(timer) = state.timer.take() {
            self.inner.timers.cancel(timer);
        }
        let watcher = state.watcher.take();
        drop(state);
        drop(watcher);
    }
}

fn changed(weak: &Weak<Inner>) {
    let Some(inner) = weak.upgrade() else {
        return;
    };
    let mut state = inner.state.lock().unwrap();
    if state.stopped {
        return;
    }
    state.generation += 1;
    let (generation, background) = (state.generation, state.background);
    drop(state);
    follow(&inner, generation, background, inner.timing.settle_ms, inner.timing.attempts, false);
}

fn follow(inner: &Arc<Inner>, generation: u64, was_background: bool, delay_ms: u64, left: u32, graced: bool) {
    let mut state = inner.state.lock().unwrap();
    if let Some(timer) = state.timer.take() {
        inner.timers.cancel(timer);
    }
    let task = inner.clone();
    state.timer = Some(inner.timers.later(delay_ms, Box::new(move || check(&task, generation, was_background, left, graced))));
}

fn current(inner: &Inner, generation: u64) -> bool {
    let state = inner.state.lock().unwrap();
    !state.stopped && state.generation == generation
}

fn set_background(inner: &Inner, value: bool) {
    inner.state.lock().unwrap().background = value;
}

fn check(inner: &Arc<Inner>, generation: u64, was_background: bool, left: u32, graced: bool) {
    {
        let mut state = inner.state.lock().unwrap();
        if state.generation == generation {
            state.timer = None;
        }
    }
    if !current(inner, generation) {
        return;
    }
    if (inner.busy)() {
        set_background(inner, false);
        return;
    }
    let Ok(mode) = inner.riot.look().mode() else {
        return;
    };
    if !current(inner, generation) {
        return;
    }
    if (inner.busy)() {
        set_background(inner, false);
        return;
    }
    match mode {
        Mode::Background => {
            if !was_background {
                set_background(inner, true);
            } else if left > 0 {
                follow(inner, generation, true, inner.timing.retry_ms, left - 1, false);
            }
        }
        Mode::Hidden if !was_background => set_background(inner, false),
        Mode::Hidden if !graced => follow(inner, generation, true, inner.timing.grace_ms, left, true),
        Mode::Hidden => {
            set_background(inner, false);
            let shown = inner.riot.show_interface();
            (inner.log)(if shown { "opened the Riot window after it left background mode without one" } else { "Riot left background mode without a window and did not show it" });
        }
        _ => set_background(inner, false),
    }
}
