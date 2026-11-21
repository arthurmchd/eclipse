use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use eclipse::application::updates::{checks_enabled, valid_version, InstallOutcome, UpdateFailure, UpdateHooks, UpdateSource, Updates, CHECK_EVERY_MS, CHECK_FAILED, FIRST_CHECK_MS, INSTALL_FAILED, UPDATE_CHECKS};
use serde_json::{json, Map, Value};

use super::ManualTimers;

#[derive(Default)]
struct Source {
    answers: Mutex<VecDeque<Result<Option<String>, UpdateFailure>>>,
    checks: Mutex<usize>,
    installs: Mutex<usize>,
    install_fails: AtomicBool,
}

impl UpdateSource for Source {
    fn check(&self) -> Result<Option<String>, UpdateFailure> {
        *self.checks.lock().unwrap() += 1;
        self.answers.lock().unwrap().pop_front().unwrap_or(Ok(None))
    }

    fn install(&self) -> Result<(), UpdateFailure> {
        *self.installs.lock().unwrap() += 1;
        if self.install_fails.load(Ordering::SeqCst) {
            Err(UpdateFailure)
        } else {
            Ok(())
        }
    }
}

struct Setup {
    updates: Updates,
    source: Arc<Source>,
    timers: Arc<ManualTimers>,
    enabled: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    announced: Arc<Mutex<Vec<String>>>,
    logs: Arc<Mutex<Vec<String>>>,
}

fn setup(answers: Vec<Result<Option<String>, UpdateFailure>>) -> Setup {
    let source = Arc::new(Source { answers: Mutex::new(answers.into()), ..Source::default() });
    let timers = ManualTimers::new();
    let (enabled, busy) = (Arc::new(AtomicBool::new(true)), Arc::new(AtomicBool::new(false)));
    let announced: Arc<Mutex<Vec<String>>> = Arc::default();
    let logs: Arc<Mutex<Vec<String>>> = Arc::default();
    let hooks = UpdateHooks {
        enabled: Box::new({
            let enabled = enabled.clone();
            move || enabled.load(Ordering::SeqCst)
        }),
        busy: Box::new({
            let busy = busy.clone();
            move || busy.load(Ordering::SeqCst)
        }),
        on_available: Box::new({
            let announced = announced.clone();
            move |version| announced.lock().unwrap().push(version.to_string())
        }),
        log: Box::new({
            let logs = logs.clone();
            move |line| logs.lock().unwrap().push(line.to_string())
        }),
        spawn: Box::new(|task| task()),
    };
    let updates = Updates::new(source.clone(), timers.clone(), hooks);
    Setup { updates, source, timers, enabled, busy, announced, logs }
}

fn some(version: &str) -> Result<Option<String>, UpdateFailure> {
    Ok(Some(version.to_string()))
}

#[test]
fn the_first_check_is_a_minute_after_start_and_then_every_twelve_hours_announcing_each_version_once() {
    let setup = setup(vec![some("2.20.0"), some("2.20.0"), some("2.21.0"), Ok(None)]);
    setup.updates.start();
    assert_eq!(setup.timers.delays(), [FIRST_CHECK_MS]);
    assert_eq!(*setup.source.checks.lock().unwrap(), 0);
    setup.timers.next(Some(FIRST_CHECK_MS));
    assert_eq!(setup.updates.available().as_deref(), Some("2.20.0"));
    assert_eq!(setup.timers.delays(), [CHECK_EVERY_MS]);
    setup.timers.next(Some(CHECK_EVERY_MS));
    assert_eq!(*setup.announced.lock().unwrap(), ["2.20.0"]);
    setup.timers.next(Some(CHECK_EVERY_MS));
    assert_eq!(*setup.announced.lock().unwrap(), ["2.20.0", "2.21.0"]);
    setup.timers.next(Some(CHECK_EVERY_MS));
    assert_eq!(setup.updates.available(), None);
    assert_eq!(*setup.logs.lock().unwrap(), ["update available: 2.20.0", "update available: 2.21.0"]);
    assert_eq!(FIRST_CHECK_MS, 60_000);
    assert_eq!(CHECK_EVERY_MS, 43_200_000);
}

#[test]
fn with_checks_turned_off_the_eclipse_never_asks_github() {
    let setup = setup(vec![some("2.20.0")]);
    setup.enabled.store(false, Ordering::SeqCst);
    setup.updates.start();
    setup.timers.next(Some(FIRST_CHECK_MS));
    setup.updates.check_now();
    assert_eq!(*setup.source.checks.lock().unwrap(), 0);
    assert!(setup.timers.pending_with(CHECK_EVERY_MS));
    setup.enabled.store(true, Ordering::SeqCst);
    setup.updates.check_now();
    assert_eq!(setup.updates.available().as_deref(), Some("2.20.0"));
}

#[test]
fn a_failed_check_is_logged_with_a_fixed_line_and_the_next_one_still_runs() {
    let setup = setup(vec![Err(UpdateFailure), some("2.20.0")]);
    setup.updates.start();
    setup.timers.next(Some(FIRST_CHECK_MS));
    assert_eq!(*setup.logs.lock().unwrap(), [CHECK_FAILED]);
    assert!(setup.timers.pending_with(CHECK_EVERY_MS));
    setup.timers.next(Some(CHECK_EVERY_MS));
    assert_eq!(*setup.announced.lock().unwrap(), ["2.20.0"]);
}

#[test]
fn a_version_outside_the_number_dot_number_dot_number_shape_is_never_shown() {
    for odd in ["2.20.0-beta", "2.20", "v2.20.0", "2.20.0.1", "../../x", "2.20.00000", "", "2.2a.0"] {
        assert!(!valid_version(odd), "{odd}");
        let setup = setup(vec![some(odd)]);
        setup.updates.check_now();
        assert_eq!(setup.updates.available(), None, "{odd}");
        assert!(setup.announced.lock().unwrap().is_empty(), "{odd}");
    }
    assert!(valid_version("2.20.0"));
    assert!(valid_version("10.0.1234"));
}

#[test]
fn install_only_runs_with_an_update_found_and_no_sign_in_in_progress() {
    let setup = setup(vec![some("2.20.0")]);
    assert_eq!(setup.updates.install(), InstallOutcome::NoUpdate);
    setup.updates.check_now();
    setup.busy.store(true, Ordering::SeqCst);
    assert_eq!(setup.updates.install(), InstallOutcome::Busy);
    assert_eq!(*setup.source.installs.lock().unwrap(), 0);
    setup.busy.store(false, Ordering::SeqCst);
    setup.source.install_fails.store(true, Ordering::SeqCst);
    assert_eq!(setup.updates.install(), InstallOutcome::Failed);
    assert_eq!(setup.logs.lock().unwrap().last().map(String::as_str), Some(INSTALL_FAILED));
    setup.source.install_fails.store(false, Ordering::SeqCst);
    assert_eq!(setup.updates.install(), InstallOutcome::Started);
    assert_eq!(*setup.source.installs.lock().unwrap(), 2);
}

#[test]
fn stop_cancels_the_next_check_and_refuses_to_install() {
    let setup = setup(vec![some("2.20.0")]);
    setup.updates.start();
    setup.updates.check_now();
    setup.updates.stop();
    assert!(setup.timers.all_cancelled());
    setup.updates.check_now();
    assert_eq!(*setup.source.checks.lock().unwrap(), 1);
    assert_eq!(setup.updates.install(), InstallOutcome::NoUpdate);
}

#[test]
fn checks_are_on_unless_the_setting_is_exactly_false() {
    let settings = |value: Value| -> Map<String, Value> { json!({ UPDATE_CHECKS: value }).as_object().unwrap().clone() };
    assert!(checks_enabled(&Map::new()));
    assert!(checks_enabled(&settings(json!(true))));
    assert!(checks_enabled(&settings(json!("false"))));
    assert!(!checks_enabled(&settings(json!(false))));
}
