use std::sync::{Arc, Mutex, Weak};

use serde_json::{Map, Value};

use super::riot_wakeup::{OnChange, Watch};
use super::store::{account_id, account_riot_id, client_path, stay_signed_in, ServiceStore};
use super::timers::Timers;
use crate::riot::riot_client::{self, RiotClient};
use crate::riot::riot_state::Look;
use crate::riot::{same_riot_id, AccountState, RiotId, RiotResult};

pub const KEPT_SINCE_MS: f64 = 1_793_970_000_000.0;
pub const REOPEN_POLLS: u32 = 5;

pub trait KeeperRiot: Send + Sync {
    fn look(&self) -> Look<'_>;
    fn read_settings_yaml(&self) -> Option<String>;
    fn write_settings_yaml(&self, text: &str, expected: &str) -> RiotResult<bool>;
    fn has_persisted_login(&self, yaml: Option<&str>) -> bool;
    fn strip_persisted_login(&self, yaml: &str) -> String;
    fn persisted_subject(&self, yaml: Option<&str>) -> Option<String>;
    fn persisted_riot_id(&self, yaml: Option<&str>) -> Option<RiotId>;
    fn same_riot_id(&self, a: &RiotId, b: &RiotId) -> bool {
        same_riot_id(Some(a), Some(b))
    }
    fn watch_settings(&self, on_change: OnChange) -> Option<Watch>;
    fn quit_client(&self);
    fn start_client(&self, client_path: &str) -> RiotResult<bool>;
}

impl KeeperRiot for RiotClient {
    fn look(&self) -> Look<'_> {
        RiotClient::look(self)
    }

    fn read_settings_yaml(&self) -> Option<String> {
        riot_client::read_settings_yaml()
    }

    fn write_settings_yaml(&self, text: &str, expected: &str) -> RiotResult<bool> {
        riot_client::replace_file(&riot_client::settings_yaml_path(), text, Some(expected)).map_err(|_| "Could not update the Riot Client settings file".into())
    }

    fn has_persisted_login(&self, yaml: Option<&str>) -> bool {
        riot_client::has_persisted_login(yaml)
    }

    fn strip_persisted_login(&self, yaml: &str) -> String {
        riot_client::strip_persisted_login(yaml)
    }

    fn persisted_subject(&self, yaml: Option<&str>) -> Option<String> {
        riot_client::persisted_subject(yaml)
    }

    fn persisted_riot_id(&self, yaml: Option<&str>) -> Option<RiotId> {
        riot_client::persisted_riot_id(yaml)
    }

    fn watch_settings(&self, on_change: OnChange) -> Option<Watch> {
        riot_client::watch_settings(on_change).map(|watcher| Box::new(watcher) as Watch)
    }

    fn quit_client(&self) {
        RiotClient::quit_client(self);
    }

    fn start_client(&self, client_path: &str) -> RiotResult<bool> {
        RiotClient::start_client(self, client_path)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct KeeperTiming {
    pub delay_ms: u64,
    pub poll_ms: u64,
    pub kept_since_ms: f64,
    pub reopen_polls: u32,
}

impl Default for KeeperTiming {
    fn default() -> Self {
        Self { delay_ms: 1000, poll_ms: 4000, kept_since_ms: KEPT_SINCE_MS, reopen_polls: REOPEN_POLLS }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct Held {
    serial: u64,
    account: String,
    yaml: String,
}

#[derive(Default)]
struct State {
    watcher: Option<Watch>,
    started: bool,
    timer: Option<u64>,
    poll_timer: Option<u64>,
    settling: bool,
    again: bool,
    stopped: bool,
    idle_seen: u32,
    game_seen: bool,
    failing: bool,
    reopen_left: u32,
    held: Option<Held>,
    serial: u64,
}

struct Inner {
    riot: Arc<dyn KeeperRiot>,
    store: Arc<dyn ServiceStore>,
    busy: Box<dyn Fn() -> bool + Send + Sync>,
    log: Box<dyn Fn(&str) + Send + Sync>,
    on_saved: Box<dyn Fn(&str) + Send + Sync>,
    timers: Arc<dyn Timers>,
    timing: KeeperTiming,
    state: Mutex<State>,
}

pub struct SessionKeeper {
    inner: Arc<Inner>,
}

pub struct KeeperHooks {
    pub busy: Box<dyn Fn() -> bool + Send + Sync>,
    pub log: Box<dyn Fn(&str) + Send + Sync>,
    pub on_saved: Box<dyn Fn(&str) + Send + Sync>,
}

impl Default for KeeperHooks {
    fn default() -> Self {
        Self { busy: Box::new(|| false), log: Box::new(|_| {}), on_saved: Box::new(|_| {}) }
    }
}

impl SessionKeeper {
    pub fn new(riot: Arc<dyn KeeperRiot>, store: Arc<dyn ServiceStore>, timers: Arc<dyn Timers>, hooks: KeeperHooks, timing: KeeperTiming) -> Self {
        Self { inner: Arc::new(Inner { riot, store, busy: hooks.busy, log: hooks.log, on_saved: hooks.on_saved, timers, timing, state: Mutex::new(State::default()) }) }
    }

    pub fn start(&self) {
        let mut state = self.inner.state.lock().unwrap();
        if state.stopped || state.started {
            return;
        }
        state.started = true;
        drop(state);
        self.inner.forget_old_sessions();
        let weak = Arc::downgrade(&self.inner);
        let watcher = self.inner.riot.watch_settings(Box::new(move || {
            if let Some(inner) = Weak::upgrade(&weak) {
                schedule(&inner);
            }
        }));
        self.inner.state.lock().unwrap().watcher = watcher;
        schedule(&self.inner);
        let polling = self.inner.state.lock().unwrap().poll_timer.is_some();
        if !polling {
            poll(&self.inner);
        }
    }

    pub fn check(&self) {
        schedule(&self.inner);
    }

    pub fn keep(&self, yaml: &str) -> Result<Option<String>, String> {
        self.inner.state.lock().unwrap().held = None;
        self.inner.keep_session(yaml)
    }

    pub fn stop(&self) {
        let mut state = self.inner.state.lock().unwrap();
        state.stopped = true;
        state.held = None;
        for timer in [state.timer.take(), state.poll_timer.take()].into_iter().flatten() {
            self.inner.timers.cancel(timer);
        }
        let watcher = state.watcher.take();
        drop(state);
        drop(watcher);
    }
}

fn schedule(inner: &Arc<Inner>) {
    let mut state = inner.state.lock().unwrap();
    if state.stopped {
        return;
    }
    if let Some(timer) = state.timer.take() {
        inner.timers.cancel(timer);
    }
    let task = inner.clone();
    state.timer = Some(inner.timers.later(inner.timing.delay_ms, Box::new(move || run(&task))));
}

fn run(inner: &Arc<Inner>) {
    {
        let mut state = inner.state.lock().unwrap();
        state.timer = None;
        if state.settling {
            state.again = true;
            return;
        }
        state.settling = true;
    }
    let result = inner.settle();
    let again = {
        let mut state = inner.state.lock().unwrap();
        match result {
            Ok(()) => state.failing = false,
            Err(()) => {
                if !state.failing {
                    (inner.log)("could not keep the Riot session");
                }
                state.failing = true;
            }
        }
        state.settling = false;
        std::mem::take(&mut state.again)
    };
    if again {
        schedule(inner);
    }
}

fn poll(inner: &Arc<Inner>) {
    let mut state = inner.state.lock().unwrap();
    if state.stopped || inner.timing.poll_ms == 0 {
        return;
    }
    let task = inner.clone();
    state.poll_timer = Some(inner.timers.later(
        inner.timing.poll_ms,
        Box::new(move || {
            task.state.lock().unwrap().poll_timer = None;
            if task.inspect_client().is_err() {
                task.state.lock().unwrap().idle_seen = 0;
            }
            poll(&task);
        }),
    ));
}

impl Inner {
    fn enabled(&self) -> bool {
        stay_signed_in(self.store.as_ref())
    }

    fn stopped(&self) -> bool {
        self.state.lock().unwrap().stopped
    }

    fn idle(&self) -> bool {
        !self.stopped() && self.enabled() && !(self.busy)()
    }

    fn saved(&self, id: &str) {
        (self.on_saved)(id);
    }

    fn release(&self) {
        self.state.lock().unwrap().held = None;
    }

    fn holds(&self, serial: u64) -> bool {
        self.state.lock().unwrap().held.as_ref().map(|held| held.serial) == Some(serial)
    }

    fn owner_of(&self, yaml: &str) -> Option<Map<String, Value>> {
        let accounts = self.store.accounts();
        if let Some(subject) = self.riot.persisted_subject(Some(yaml)) {
            let by_subject = accounts.iter().find(|account| {
                let id = account_id(account);
                self.store.has_session(&id) && self.riot.persisted_subject(self.store.load_session(&id).as_deref()).as_deref() == Some(subject.as_str())
            });
            if let Some(account) = by_subject {
                return Some(account.clone());
            }
        }
        let riot_id = self.riot.persisted_riot_id(Some(yaml))?;
        let matches: Vec<&Map<String, Value>> = accounts.iter().filter(|account| self.riot.same_riot_id(&riot_id, &account_riot_id(account))).collect();
        (matches.len() == 1).then(|| matches[0].clone())
    }

    fn keep_session(&self, yaml: &str) -> Result<Option<String>, String> {
        if self.stopped() || !self.enabled() || !self.riot.has_persisted_login(Some(yaml)) {
            return Ok(None);
        }
        let Some(owner) = self.owner_of(yaml) else {
            return Ok(None);
        };
        let id = account_id(&owner);
        if self.store.load_session(&id).as_deref() != Some(yaml) {
            self.store.save_session(&id, yaml)?;
            self.saved(&id);
        }
        Ok(Some(id))
    }

    fn forget_old_sessions(&self) {
        let mut forgotten = 0;
        for account in self.store.accounts() {
            let id = account_id(&account);
            let old = self.store.has_session(&id) && self.store.session_saved_at(&id).is_ok_and(|saved| saved < self.timing.kept_since_ms);
            if !old {
                continue;
            }
            if self.store.forget_session(&id).is_ok() {
                forgotten += 1;
                self.saved(&id);
            }
        }
        if forgotten > 0 {
            (self.log)(&format!("forgot {forgotten} saved session(s) from before cards mode kept sessions"));
        }
    }

    fn notice_sign_out(&self) -> RiotResult<()> {
        let Some(last) = self.state.lock().unwrap().held.clone() else {
            return Ok(());
        };
        let look = self.riot.look();
        let running = look.running()?;
        if !self.holds(last.serial) {
            return Ok(());
        }
        if !running || !self.idle() {
            self.release();
            return Ok(());
        }
        let state = look.account()?;
        if !self.holds(last.serial) {
            return Ok(());
        }
        if !self.idle() {
            self.release();
            return Ok(());
        }
        if state == AccountState::Unknown {
            return Ok(());
        }
        self.release();
        if state != AccountState::No || self.riot.has_persisted_login(self.riot.read_settings_yaml().as_deref()) {
            return Ok(());
        }
        if !self.store.has_session(&last.account) || self.store.load_session(&last.account).as_deref() != Some(last.yaml.as_str()) {
            return Ok(());
        }
        self.store.forget_session(&last.account).map_err(crate::riot::RiotError::new)?;
        self.saved(&last.account);
        (self.log)("forgot the saved session of an account signed out in Riot");
        Ok(())
    }

    fn settle(&self) -> Result<(), ()> {
        if !self.idle() {
            self.release();
            return Ok(());
        }
        let yaml = self.riot.read_settings_yaml();
        let Some(yaml) = yaml.filter(|yaml| self.riot.has_persisted_login(Some(yaml))) else {
            return self.notice_sign_out().map_err(|_| ());
        };
        let owner = self.keep_session(&yaml).map_err(|_| ())?;
        let holding = self.riot.look().signed_in().map_err(|_| ())?;
        if !self.idle() {
            self.release();
            return Ok(());
        }
        if holding {
            let mut state = self.state.lock().unwrap();
            state.serial += 1;
            let serial = state.serial;
            state.held = owner.map(|account| Held { serial, account, yaml });
            return Ok(());
        }
        self.release();
        if !self.riot.write_settings_yaml(&self.riot.strip_persisted_login(&yaml), &yaml).map_err(|_| ())? {
            return Ok(());
        }
        (self.log)(if owner.is_some() { "kept the Riot session for its account and cleared the remembered login" } else { "cleared a remembered Riot login that is not from an account in Eclipse" });
        Ok(())
    }

    fn reopen_client(self: &Arc<Self>, running: bool) -> bool {
        let left = {
            let mut state = self.state.lock().unwrap();
            state.reopen_left -= 1;
            state.reopen_left
        };
        if running || self.riot.has_persisted_login(self.riot.read_settings_yaml().as_deref()) {
            if left == 0 {
                (self.log)("gave up reopening the Riot after closing it");
            }
            return false;
        }
        self.state.lock().unwrap().reopen_left = 0;
        if !self.idle() {
            return true;
        }
        match self.riot.start_client(&client_path(self.store.as_ref())) {
            Ok(true) => (self.log)("reopened the Riot at the sign-in screen after closing it"),
            Ok(false) => {}
            Err(_) => (self.log)("could not reopen the Riot after closing it"),
        }
        true
    }

    fn inspect_client(self: &Arc<Self>) -> RiotResult<()> {
        if !self.idle() {
            let mut state = self.state.lock().unwrap();
            state.idle_seen = 0;
            state.reopen_left = 0;
            state.held = None;
            return Ok(());
        }
        let look = self.riot.look();
        if look.in_game()? {
            let mut state = self.state.lock().unwrap();
            state.game_seen = true;
            state.idle_seen = 0;
            state.reopen_left = 0;
            return Ok(());
        }
        let running = look.running()?;
        let window = look.window()?;
        if !running {
            self.release();
        }
        let reopening = self.state.lock().unwrap().reopen_left > 0;
        if reopening && self.reopen_client(running) {
            return Ok(());
        }
        let game_seen = self.state.lock().unwrap().game_seen;
        if window && !game_seen && !self.riot.has_persisted_login(self.riot.read_settings_yaml().as_deref()) {
            self.state.lock().unwrap().idle_seen = 0;
            return self.notice_sign_out();
        }
        let signed_in = look.signed_in()?;
        if !self.idle() {
            self.state.lock().unwrap().idle_seen = 0;
            return Ok(());
        }
        if !signed_in {
            {
                let mut state = self.state.lock().unwrap();
                state.game_seen = false;
                state.idle_seen = 0;
            }
            if self.riot.has_persisted_login(self.riot.read_settings_yaml().as_deref()) {
                schedule(self);
                return Ok(());
            }
            return self.notice_sign_out();
        }
        if window && !game_seen {
            self.state.lock().unwrap().idle_seen = 0;
            return Ok(());
        }
        {
            let mut state = self.state.lock().unwrap();
            state.idle_seen += 1;
            if state.idle_seen < 2 {
                return Ok(());
            }
            state.idle_seen = 0;
            state.game_seen = false;
        }
        (self.log)(if game_seen { "closing the signed-in Riot after the game; its session is kept" } else { "closing the signed-in Riot left without a window; its session is kept" });
        self.riot.quit_client();
        self.state.lock().unwrap().reopen_left = if window { self.timing.reopen_polls } else { 0 };
        schedule(self);
        Ok(())
    }
}
