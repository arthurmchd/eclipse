use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use eclipse::platform::windows::window_controller::{safe_reason, WindowController};
use eclipse::platform::windows::window_guard::WindowOps;

struct Ops {
    answers: Mutex<VecDeque<Result<bool, &'static str>>>,
    calls: Mutex<Vec<String>>,
    delay: Duration,
    busy: AtomicUsize,
    peak: AtomicUsize,
}

fn ops(answers: Vec<Result<bool, &'static str>>, delay: Duration) -> Arc<Ops> {
    Arc::new(Ops { answers: Mutex::new(answers.into()), calls: Mutex::new(Vec::new()), delay, busy: AtomicUsize::new(0), peak: AtomicUsize::new(0) })
}

impl Ops {
    fn answer(&self, call: String) -> Result<bool, &'static str> {
        self.calls.lock().unwrap().push(call);
        let now = self.busy.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
        thread::sleep(self.delay);
        self.busy.fetch_sub(1, Ordering::SeqCst);
        self.answers.lock().unwrap().pop_front().unwrap_or(Ok(false))
    }
}

impl WindowOps for Ops {
    fn reveal(&self) -> Result<(), &'static str> {
        self.answer("reveal".into()).map(|_| ())
    }

    fn close_client(&self) -> Result<(), &'static str> {
        self.answer("close-client".into()).map(|_| ())
    }

    fn game_window(&self, game: &str) -> Result<bool, &'static str> {
        self.answer(format!("game-window {game}"))
    }
}

fn controller(answers: Vec<Result<bool, &'static str>>) -> (Arc<Ops>, WindowController) {
    let ops = ops(answers, Duration::ZERO);
    (ops.clone(), WindowController::new(ops))
}

fn calls(ops: &Ops) -> Vec<String> {
    ops.calls.lock().unwrap().clone()
}

#[test]
fn reveal_close_and_the_game_window_go_straight_to_the_native_window_helper() {
    let (ops, controller) = controller(vec![Ok(false), Ok(false), Ok(true), Ok(false)]);
    controller.reveal().unwrap();
    controller.close_client().unwrap();
    assert!(controller.game_window("tft").unwrap());
    assert!(!controller.game_window("val").unwrap());
    assert_eq!(calls(&ops), ["reveal", "close-client", "game-window tft", "game-window val"]);
}

#[test]
fn game_names_outside_the_list_are_refused_before_looking_at_any_window() {
    let (ops, controller) = controller(vec![]);
    for game in ["lol\nreveal", "reveal", "", "LOL"] {
        assert_eq!(controller.game_window(game).unwrap_err().message, "Invalid game");
    }
    assert!(calls(&ops).is_empty());
}

#[test]
fn window_actions_run_one_at_a_time() {
    let ops = ops(vec![], Duration::from_millis(40));
    let controller = Arc::new(WindowController::new(ops.clone()));
    let handles: Vec<_> = (0..3)
        .map(|_| {
            let controller = controller.clone();
            thread::spawn(move || controller.reveal().unwrap())
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    assert_eq!(calls(&ops).len(), 3);
    assert_eq!(ops.peak.load(Ordering::SeqCst), 1);
}

#[test]
fn a_helper_error_is_reported_only_with_a_fixed_vocabulary() {
    let (_, controller) = controller(vec![Err("invalid-game"), Err("Access to C:\\Users\\private\\file was denied")]);
    assert_eq!(controller.reveal().unwrap_err().message, "Background window guard: invalid-game");
    assert_eq!(controller.close_client().unwrap_err().message, "Background window guard: unknown");
    assert_eq!(safe_reason("window-not-found"), "window-not-found");
    assert_eq!(safe_reason("C:\\private"), "unknown");
}

#[test]
fn stop_waits_for_the_running_action_and_then_refuses_new_ones() {
    let ops = ops(vec![], Duration::from_millis(100));
    let controller = Arc::new(WindowController::new(ops.clone()));
    let running = controller.clone();
    let revealing = thread::spawn(move || running.reveal());
    thread::sleep(Duration::from_millis(30));
    controller.stop();
    assert!(revealing.join().unwrap().is_ok());
    for result in [controller.reveal(), controller.close_client(), controller.game_window("lol").map(|_| ())] {
        assert_eq!(result.unwrap_err().message, "The background window guard is shutting down");
    }
    controller.stop();
    assert_eq!(calls(&ops).len(), 1);
}
