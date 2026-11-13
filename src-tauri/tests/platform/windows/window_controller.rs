use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use eclipse::platform::windows::window_controller::{powershell_args, safe_reason, HelperFailure, HelperOutput, HelperRunner, WindowController};
use eclipse::riot::Cancel;
use serde_json::{json, Value};

struct Runner {
    answers: Mutex<VecDeque<Result<HelperOutput, HelperFailure>>>,
    inputs: Mutex<Vec<(PathBuf, String, u64)>>,
    delay: Duration,
    busy: AtomicUsize,
    peak: AtomicUsize,
}

fn runner(answers: Vec<Result<HelperOutput, HelperFailure>>, delay: Duration) -> Arc<Runner> {
    Arc::new(Runner { answers: Mutex::new(answers.into()), inputs: Mutex::new(Vec::new()), delay, busy: AtomicUsize::new(0), peak: AtomicUsize::new(0) })
}

impl HelperRunner for Runner {
    fn run(&self, script: &Path, input: &str, timeout_ms: u64, _cancel: Option<&Cancel>) -> Result<HelperOutput, HelperFailure> {
        self.inputs.lock().unwrap().push((script.to_path_buf(), input.to_string(), timeout_ms));
        let now = self.busy.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
        thread::sleep(self.delay);
        self.busy.fetch_sub(1, Ordering::SeqCst);
        self.answers.lock().unwrap().pop_front().unwrap_or_else(|| Ok(output(0, "ok\n", "")))
    }
}

fn output(code: i32, stdout: &str, stderr: &str) -> HelperOutput {
    HelperOutput { code: Some(code), stdout: stdout.into(), stderr: stderr.into() }
}

fn controller(answers: Vec<Result<HelperOutput, HelperFailure>>) -> (Arc<Runner>, WindowController) {
    let runner = runner(answers, Duration::ZERO);
    let controller = WindowController::new(runner.clone(), PathBuf::from("C:/Example/windowGuard.ps1"), 300);
    (runner, controller)
}

fn requests(runner: &Runner) -> Vec<Value> {
    runner.inputs.lock().unwrap().iter().map(|(_, input, _)| serde_json::from_str(input.trim_end()).unwrap()).collect()
}

#[test]
fn reveal_runs_a_hidden_one_shot_helper_that_brings_the_riot_to_the_front() {
    let (runner, controller) = controller(vec![]);
    controller.reveal().unwrap();
    let inputs = runner.inputs.lock().unwrap().clone();
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].0, PathBuf::from("C:/Example/windowGuard.ps1"));
    assert_eq!(inputs[0].1.lines().count(), 1);
    assert_eq!(inputs[0].2, 300);
    assert_eq!(requests(&runner), [json!({ "action": "reveal" })]);
    assert_eq!(powershell_args(&PathBuf::from("C:/Example/windowGuard.ps1")), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:/Example/windowGuard.ps1"]);
}

#[test]
fn close_client_uses_the_dedicated_window_close_helper() {
    let (runner, controller) = controller(vec![]);
    controller.close_client().unwrap();
    assert_eq!(requests(&runner), [json!({ "action": "close-client" })]);
}

#[test]
fn game_window_answers_from_a_one_shot_helper() {
    let (runner, controller) = controller(vec![Ok(output(0, "game-ready\r\nok\r\n", "")), Ok(output(0, "ok\n", ""))]);
    assert!(controller.game_window("tft").unwrap());
    assert!(!controller.game_window("val").unwrap());
    assert_eq!(requests(&runner), [json!({ "action": "game-window", "game": "tft" }), json!({ "action": "game-window", "game": "val" })]);
}

#[test]
fn game_names_cannot_inject_additional_helper_actions() {
    let (runner, controller) = controller(vec![]);
    for game in ["lol\nreveal", "reveal"] {
        assert_eq!(controller.game_window(game).unwrap_err().message, "Invalid game");
    }
    assert!(runner.inputs.lock().unwrap().is_empty());
}

#[test]
fn helpers_run_one_at_a_time() {
    let runner = runner(vec![], Duration::from_millis(40));
    let controller = Arc::new(WindowController::new(runner.clone(), PathBuf::from("guard.ps1"), 300));
    let handles: Vec<_> = (0..3)
        .map(|_| {
            let controller = controller.clone();
            thread::spawn(move || controller.reveal().unwrap())
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    assert_eq!(runner.inputs.lock().unwrap().len(), 3);
    assert_eq!(runner.peak.load(Ordering::SeqCst), 1);
}

#[test]
fn a_helper_error_is_reported_only_with_a_fixed_vocabulary() {
    let (_, controller) = controller(vec![Ok(output(1, "error:invalid-game\n", "")), Ok(output(1, "error:Access to C:\\Users\\private\\file was denied\n", ""))]);
    assert_eq!(controller.reveal().unwrap_err().message, "Background window guard: invalid-game");
    assert_eq!(controller.close_client().unwrap_err().message, "Background window guard: unknown");
    assert_eq!(safe_reason("window-not-found"), "window-not-found");
    assert_eq!(safe_reason("C:\\private"), "unknown");
}

#[test]
fn a_helper_that_exits_without_confirming_fails_with_its_exit_code() {
    let silent = HelperOutput { code: None, stdout: String::new(), stderr: String::new() };
    let (_, controller) = controller(vec![Ok(output(3, "", "boom")), Ok(output(0, "", "")), Ok(silent)]);
    assert_eq!(controller.reveal().unwrap_err().message, "The background window guard stopped (3): helper error");
    assert_eq!(controller.reveal().unwrap_err().message, "The background window guard stopped (0)");
    assert_eq!(controller.reveal().unwrap_err().message, "The background window guard stopped (null)");
}

#[test]
fn a_timeout_or_a_spawn_error_rejects_with_fixed_text() {
    let (_, controller) = controller(vec![Err(HelperFailure::TimedOut), Err(HelperFailure::Spawn("spawn denied".into()))]);
    assert_eq!(controller.reveal().unwrap_err().message, "The background window helper timed out");
    assert_eq!(controller.reveal().unwrap_err().message, "spawn denied");
}

#[test]
fn stop_waits_for_the_running_helper_and_then_refuses_new_actions() {
    let runner = runner(vec![], Duration::from_millis(100));
    let controller = Arc::new(WindowController::new(runner.clone(), PathBuf::from("guard.ps1"), 300));
    let running = controller.clone();
    let revealing = thread::spawn(move || running.reveal());
    thread::sleep(Duration::from_millis(30));
    controller.stop();
    assert!(revealing.join().unwrap().is_ok());
    for result in [controller.reveal(), controller.close_client(), controller.game_window("lol").map(|_| ())] {
        assert_eq!(result.unwrap_err().message, "The background window guard is shutting down");
    }
    controller.stop();
    assert_eq!(runner.inputs.lock().unwrap().len(), 1);
}
