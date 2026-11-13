use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use eclipse::application::riot_wakeup::{OnChange, RiotWakeup, WakeupRiot, WakeupTiming, Watch};
use eclipse::riot::riot_authentication::{AuthKind, AuthState};
use eclipse::riot::riot_state::{Look, RiotProbe};
use eclipse::riot::{RiotError, RiotResult, RunningGames};

use super::ManualTimers;

const SETTLE: u64 = 1000;
const RETRY: u64 = 1001;
const GRACE: u64 = 2000;

#[derive(Clone, Copy)]
struct Scene {
    client: bool,
    client_window: bool,
    game: bool,
    full: bool,
    show: bool,
}

struct Closer(Arc<AtomicBool>);

impl Drop for Closer {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

struct Riot {
    scene: Mutex<Scene>,
    events: Mutex<Vec<&'static str>>,
    busy: Arc<AtomicBool>,
    busy_on_state: AtomicBool,
    broken: AtomicBool,
    on_change: Mutex<Option<OnChange>>,
    closed: Arc<AtomicBool>,
}

impl RiotProbe for Riot {
    fn running_games(&self) -> RiotResult<RunningGames> {
        self.events.lock().unwrap().push("processes?");
        if self.broken.load(Ordering::SeqCst) {
            return Err(RiotError::new("tasklist failed"));
        }
        let scene = *self.scene.lock().unwrap();
        Ok(RunningGames { client: scene.client, client_window: scene.client_window, lol: scene.game, val: false })
    }

    fn session_state(&self) -> RiotResult<Option<AuthState>> {
        self.events.lock().unwrap().push("state?");
        if self.busy_on_state.load(Ordering::SeqCst) {
            self.busy.store(true, Ordering::SeqCst);
        }
        Ok(self.scene.lock().unwrap().full.then_some(AuthState::of(AuthKind::Auth)))
    }
}

impl WakeupRiot for Riot {
    fn look(&self) -> Look<'_> {
        Look::new(self)
    }

    fn show_interface(&self) -> bool {
        self.events.lock().unwrap().push("show");
        self.scene.lock().unwrap().show
    }

    fn watch_lockfile(&self, on_change: OnChange) -> Option<Watch> {
        *self.on_change.lock().unwrap() = Some(on_change);
        Some(Box::new(Closer(self.closed.clone())))
    }
}

struct Fixture {
    wakeup: RiotWakeup,
    riot: Arc<Riot>,
    timers: Arc<ManualTimers>,
    logs: Arc<Mutex<Vec<String>>>,
    busy: Arc<AtomicBool>,
}

fn fixture(scene: Scene, attempts: u32) -> Fixture {
    let busy = Arc::new(AtomicBool::new(false));
    let riot = Arc::new(Riot {
        scene: Mutex::new(scene),
        events: Mutex::new(Vec::new()),
        busy: busy.clone(),
        busy_on_state: AtomicBool::new(false),
        broken: AtomicBool::new(false),
        on_change: Mutex::new(None),
        closed: Arc::new(AtomicBool::new(false)),
    });
    let timers = ManualTimers::new();
    let logs = Arc::new(Mutex::new(Vec::new()));
    let flag = busy.clone();
    let lines = logs.clone();
    let wakeup = RiotWakeup::new(
        riot.clone(),
        Box::new(move || flag.load(Ordering::SeqCst)),
        Box::new(move |line| lines.lock().unwrap().push(line.to_string())),
        timers.clone(),
        WakeupTiming { settle_ms: SETTLE, retry_ms: RETRY, attempts, grace_ms: GRACE },
    );
    Fixture { wakeup, riot, timers, logs, busy }
}

fn background() -> Scene {
    Scene { client: true, client_window: false, game: false, full: false, show: true }
}

impl Fixture {
    fn change(&self) {
        let guard = self.riot.on_change.lock().unwrap();
        guard.as_ref().unwrap()();
    }

    fn scene(&self, change: impl FnOnce(&mut Scene)) {
        change(&mut self.riot.scene.lock().unwrap());
    }

    fn shows(&self) -> usize {
        self.riot.events.lock().unwrap().iter().filter(|event| **event == "show").count()
    }

    fn set_busy(&self, value: bool) {
        self.busy.store(value, Ordering::SeqCst);
    }
}

#[test]
fn a_riot_that_leaves_background_mode_without_a_window_is_asked_to_show_it_after_a_grace_period() {
    let f = fixture(background(), 3);
    f.wakeup.start();
    f.timers.next(Some(0));
    assert_eq!(f.shows(), 0);
    f.scene(|scene| scene.full = true);
    f.change();
    f.timers.next(Some(SETTLE));
    assert_eq!(f.shows(), 0);
    f.timers.next(Some(GRACE));
    assert_eq!(f.shows(), 1);
    assert_eq!(*f.logs.lock().unwrap(), ["opened the Riot window after it left background mode without one"]);
    assert_eq!(f.timers.pending(), 0);
}

#[test]
fn the_wake_waits_while_riot_is_still_loading_its_services_and_gives_up_after_the_limit() {
    let f = fixture(background(), 2);
    f.wakeup.start();
    f.timers.next(Some(0));
    f.change();
    f.timers.next(Some(SETTLE));
    f.timers.next(Some(RETRY));
    f.scene(|scene| scene.full = true);
    f.timers.next(Some(RETRY));
    f.timers.next(Some(GRACE));
    assert_eq!(f.shows(), 1);
    let stuck = fixture(background(), 2);
    stuck.wakeup.start();
    stuck.timers.next(Some(0));
    stuck.change();
    stuck.timers.next(Some(SETTLE));
    stuck.timers.next(Some(RETRY));
    stuck.timers.next(Some(RETRY));
    assert_eq!(stuck.timers.pending(), 0);
    assert_eq!(stuck.shows(), 0);
}

#[test]
fn a_riot_that_opens_its_own_window_a_game_that_starts_or_a_sign_in_in_progress_is_never_shown_again() {
    let changes: [fn(&Fixture); 4] = [|f| f.scene(|scene| scene.client_window = true), |f| f.scene(|scene| scene.game = true), |f| f.set_busy(true), |f| f.scene(|scene| scene.client = false)];
    for change in changes {
        let f = fixture(background(), 3);
        f.wakeup.start();
        f.timers.next(Some(0));
        f.scene(|scene| scene.full = true);
        f.change();
        f.timers.next(Some(SETTLE));
        change(&f);
        f.timers.next(Some(GRACE));
        assert_eq!(f.shows(), 0);
        assert_eq!(f.timers.pending(), 0);
        f.set_busy(false);
        f.scene(|scene| {
            scene.client_window = false;
            scene.game = false;
            scene.client = true;
        });
        f.change();
        f.timers.next(Some(SETTLE));
        assert_eq!(f.timers.pending(), 0);
        assert_eq!(f.shows(), 0);
    }
}

#[test]
fn entering_background_mode_or_a_riot_that_opens_without_passing_through_it_never_shows_the_window() {
    let f = fixture(Scene { full: true, ..background() }, 3);
    f.wakeup.start();
    f.timers.next(Some(0));
    f.change();
    f.timers.next(Some(SETTLE));
    assert_eq!(f.timers.pending(), 0);
    f.scene(|scene| scene.full = false);
    f.change();
    f.timers.next(Some(SETTLE));
    assert_eq!(f.timers.pending(), 0);
    assert_eq!(f.shows(), 0);
    let closed = fixture(Scene { client: false, ..background() }, 3);
    closed.wakeup.start();
    closed.timers.next(Some(0));
    assert_eq!(*closed.riot.events.lock().unwrap(), ["processes?"]);
}

#[test]
fn a_sign_in_that_starts_during_the_check_a_failed_show_and_a_failed_process_check_are_handled_quietly() {
    let f = fixture(background(), 3);
    f.wakeup.start();
    f.timers.next(Some(0));
    f.scene(|scene| scene.full = true);
    f.riot.busy_on_state.store(true, Ordering::SeqCst);
    f.change();
    f.timers.next(Some(SETTLE));
    assert_eq!(f.timers.pending(), 0);
    let failing = fixture(background(), 3);
    failing.wakeup.start();
    failing.timers.next(Some(0));
    failing.scene(|scene| {
        scene.full = true;
        scene.show = false;
    });
    failing.change();
    failing.timers.next(Some(SETTLE));
    failing.timers.next(Some(GRACE));
    assert_eq!(*failing.logs.lock().unwrap(), ["Riot left background mode without a window and did not show it"]);
    let broken = fixture(background(), 3);
    broken.riot.broken.store(true, Ordering::SeqCst);
    broken.wakeup.start();
    broken.timers.next(Some(0));
    assert_eq!(broken.timers.pending(), 0);
}

#[test]
fn a_newer_lockfile_change_replaces_the_pending_check_and_stopping_closes_the_watcher_and_cancels_pending_work() {
    let f = fixture(background(), 3);
    f.wakeup.start();
    f.timers.next(Some(0));
    f.scene(|scene| scene.full = true);
    f.change();
    f.change();
    assert_eq!(f.timers.pending(), 1);
    f.timers.next(Some(SETTLE));
    f.wakeup.stop();
    assert!(f.riot.closed.load(Ordering::SeqCst));
    assert_eq!(f.timers.pending(), 0);
    assert_eq!(f.shows(), 0);
    f.change();
    assert_eq!(f.timers.pending(), 0);
}
