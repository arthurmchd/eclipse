use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use eclipse::paths::windows_helpers_dir;
use eclipse::platform::windows::riot_window_observer::{read_line, BadLine, request_line, valid_target, ObserverChild, ObserverHooks, ObserverSpawn, Output, RiotWindowObserver, Target, FOLLOW_FAILED, KILL_DELAY_MS, PANEL_POINT, STALE_CHECK_MS};
use serde_json::{json, Value};

use super::ManualTimers;

#[derive(Clone, Default)]
struct Input(Arc<Mutex<Vec<u8>>>);

impl Write for Input {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Default)]
struct Spawner {
    input: Input,
    output: Mutex<Option<Output>>,
    script: Mutex<Option<PathBuf>>,
    killed: Arc<Mutex<bool>>,
    fail: bool,
}

impl Spawner {
    fn send(&self, text: &str) {
        let output = self.output.lock().unwrap().clone().unwrap();
        output(Some(text.as_bytes()));
    }

    fn close(&self) {
        let output = self.output.lock().unwrap().clone().unwrap();
        output(None);
    }

    fn written(&self) -> String {
        String::from_utf8(self.input.0.lock().unwrap().clone()).unwrap()
    }
}

impl ObserverSpawn for Spawner {
    fn spawn(&self, script: &Path, output: Output) -> io::Result<ObserverChild> {
        if self.fail {
            return Err(io::Error::other("synthetic spawn failure"));
        }
        *self.script.lock().unwrap() = Some(script.to_path_buf());
        *self.output.lock().unwrap() = Some(output);
        let killed = self.killed.clone();
        Ok(ObserverChild { input: Box::new(self.input.clone()), kill: Box::new(move || *killed.lock().unwrap() = true) })
    }
}

struct Setup {
    observer: RiotWindowObserver,
    spawner: Arc<Spawner>,
    timers: Arc<ManualTimers>,
    states: Arc<Mutex<Vec<Option<Target>>>>,
    errors: Arc<Mutex<Vec<String>>>,
    time: Arc<Mutex<f64>>,
}

fn setup(spawner: Spawner) -> Setup {
    let spawner = Arc::new(spawner);
    let timers = ManualTimers::new();
    let states: Arc<Mutex<Vec<Option<Target>>>> = Arc::default();
    let errors: Arc<Mutex<Vec<String>>> = Arc::default();
    let time = Arc::new(Mutex::new(0.0));
    let (seen, failed, clock) = (states.clone(), errors.clone(), time.clone());
    let hooks = ObserverHooks {
        on_state: Box::new(move |state| seen.lock().unwrap().push(state)),
        on_error: Box::new(move |error| failed.lock().unwrap().push(error.to_string())),
        now: Box::new(move || *clock.lock().unwrap()),
    };
    let observer = RiotWindowObserver::new(spawner.clone(), windows_helpers_dir().join("riotWindowObserver.ps1"), 77, timers.clone(), hooks);
    Setup { observer, spawner, timers, states, errors, time }
}

fn target(id: &str) -> Target {
    Target { id: id.into(), x: -100, y: 10, width: 1000, height: 800, corner: None, minimized: false, dimmed: false, form_hidden: false }
}

#[test]
fn the_observer_reads_fragmented_lines_fails_on_bad_metadata_hides_when_stale_and_ends_its_own_helper() {
    let setup = setup(Spawner::default());
    setup.observer.start("C:/Riot/RiotClientServices.exe", None);
    assert_eq!(*setup.spawner.script.lock().unwrap(), Some(windows_helpers_dir().join("riotWindowObserver.ps1")));
    let message = json!({ "target": { "id": "123", "x": -100, "y": 10, "width": 1000, "height": 800 } }).to_string();
    setup.spawner.send(&message[..10]);
    assert!(setup.states.lock().unwrap().is_empty());
    setup.spawner.send(&format!("{}\r\n", &message[10..]));
    assert_eq!(*setup.states.lock().unwrap(), [Some(target("123"))]);
    setup.spawner.send("{\"target\":{\"width\":-10}}\n");
    assert_eq!(setup.states.lock().unwrap().last().unwrap(), &None);
    assert_eq!(*setup.errors.lock().unwrap(), [FOLLOW_FAILED]);
    setup.spawner.send("{\"target\":null}\n");
    assert_eq!(setup.states.lock().unwrap().len(), 3);
    *setup.time.lock().unwrap() = 4000.0;
    setup.timers.next(Some(STALE_CHECK_MS));
    assert_eq!(setup.states.lock().unwrap().len(), 4);
    assert_eq!(setup.states.lock().unwrap().last().unwrap(), &None);
    assert!(setup.timers.pending_with(STALE_CHECK_MS));
    setup.observer.stop();
    assert!(!*setup.spawner.killed.lock().unwrap());
    assert_eq!(setup.timers.delays(), [KILL_DELAY_MS]);
    setup.timers.next(Some(KILL_DELAY_MS));
    assert!(*setup.spawner.killed.lock().unwrap());
    setup.spawner.close();
    setup.spawner.send("{\"target\":null}\n");
    assert_eq!(setup.errors.lock().unwrap().len(), 1);
    assert_eq!(setup.states.lock().unwrap().len(), 4);
}

#[test]
fn a_helper_that_ends_overflows_or_cannot_start_reports_one_fixed_error_and_no_window() {
    let ended = setup(Spawner::default());
    ended.observer.start("C:/Riot/RiotClientServices.exe", None);
    ended.spawner.close();
    assert_eq!(*ended.states.lock().unwrap(), [None]);
    assert_eq!(*ended.errors.lock().unwrap(), [FOLLOW_FAILED]);
    let flooded = setup(Spawner::default());
    flooded.observer.start("C:/Riot/RiotClientServices.exe", None);
    flooded.spawner.send(&"x".repeat(20000));
    assert_eq!(*flooded.errors.lock().unwrap(), [FOLLOW_FAILED]);
    let missing = setup(Spawner { fail: true, ..Spawner::default() });
    missing.observer.start("C:/Riot/RiotClientServices.exe", None);
    assert_eq!(*missing.states.lock().unwrap(), [None]);
    assert_eq!(*missing.errors.lock().unwrap(), [FOLLOW_FAILED]);
    assert!(!missing.observer.command("minimize"));
    for line in ["{\"error\":\"observer-unavailable\"}", "{}", "not json", "{\"target\":{\"id\":\"1\"}}"] {
        assert_eq!(read_line(line.as_bytes()), Err(BadLine), "{line}");
    }
}

#[test]
fn the_helper_gets_only_a_numeric_overlay_handle() {
    let requests: Vec<Value> = [Some("4660"), Some("12; rm"), Some(""), Some("123456789012345678901"), None].into_iter().map(|handle| serde_json::from_str(request_line(77, "C:/Riot/RiotClientServices.exe", handle).trim_end()).unwrap()).collect();
    let handles: Vec<&Value> = requests.iter().map(|request| &request["overlayWindow"]).collect();
    assert_eq!(handles, [&json!("4660"), &Value::Null, &Value::Null, &Value::Null, &Value::Null]);
    assert_eq!(requests[0], json!({ "ownerPid": 77, "clientPath": "C:/Riot/RiotClientServices.exe", "overlayWindow": "4660" }));
    let setup = setup(Spawner::default());
    setup.observer.start("C:/Riot/RiotClientServices.exe", Some("4660"));
    assert_eq!(setup.spawner.written(), request_line(77, "C:/Riot/RiotClientServices.exe", Some("4660")));
    assert!(setup.spawner.written().ends_with('\n'));
}

#[test]
fn the_observer_forwards_only_minimize_and_close_one_line_each_and_only_while_running() {
    let setup = setup(Spawner::default());
    assert!(!setup.observer.command("minimize"));
    setup.observer.start("C:/Riot/RiotClientServices.exe", None);
    let request = setup.spawner.written();
    for name in ["minimize", "close"] {
        assert!(setup.observer.command(name));
    }
    for name in ["quit", "minimize\nclose", "", "Close"] {
        assert!(!setup.observer.command(name));
    }
    assert_eq!(&setup.spawner.written()[request.len()..], "minimize\nclose\n");
    setup.observer.start("C:/Riot/RiotClientServices.exe", None);
    assert_eq!(&setup.spawner.written()[request.len()..], "minimize\nclose\n");
    setup.observer.stop();
    assert!(!setup.observer.command("close"));
    assert_eq!(&setup.spawner.written()[request.len()..], "minimize\nclose\n");
}

#[test]
fn a_target_needs_a_numeric_id_a_real_size_and_explicit_flags() {
    let base = json!({ "id": "123", "x": 10, "y": 20, "width": 1000, "height": 800 });
    let with = |key: &str, value: Value| {
        let mut target = base.clone();
        target[key] = value;
        target
    };
    assert_eq!(valid_target(&base), Some(Target { x: 10, y: 20, ..target("123") }));
    for corner in [0, 8, 12, 64] {
        assert_eq!(valid_target(&with("corner", json!(corner))).unwrap().corner, Some(corner));
    }
    for corner in [json!(-1), json!(65), json!(7.5), json!("8"), Value::Null] {
        assert!(valid_target(&with("corner", corner.clone())).is_none(), "{corner}");
    }
    for key in ["minimized", "dimmed", "formHidden"] {
        assert!(valid_target(&with(key, json!(true))).is_some());
        for value in [json!(false), json!("true"), json!(1), Value::Null, json!({})] {
            assert!(valid_target(&with(key, value.clone())).is_none(), "{key} {value}");
        }
        assert!(valid_target(&json!({ "id": "123", key: true })).is_none());
    }
    let flagged = valid_target(&json!({ "id": "1", "x": 0, "y": 0, "width": 320, "height": 240, "minimized": true, "dimmed": true, "formHidden": true })).unwrap();
    assert!(flagged.minimized && flagged.dimmed && flagged.form_hidden);
    for (key, value) in [("id", json!(123)), ("id", json!("12a")), ("id", json!("123456789012345678901")), ("width", json!(319)), ("height", json!(239)), ("x", json!(100001)), ("y", json!(1.5)), ("x", json!("10"))] {
        assert!(valid_target(&with(key, value.clone())).is_none(), "{key} {value}");
    }
    assert_eq!(valid_target(&with("x", json!(-100000))).unwrap().x, -100000);
}

#[test]
fn the_panel_point_left_uncovered_is_the_one_the_helper_reads_and_the_box_matches_the_login_helper() {
    let source = std::fs::read_to_string(windows_helpers_dir().join("riotWindowObserver.ps1")).unwrap();
    assert!(source.contains(&format!("const double PANEL_X = {}, PANEL_Y = {};", PANEL_POINT.0, PANEL_POINT.1)));
    assert_eq!(PANEL_POINT, (0.026, 0.5));
}

#[test]
fn the_real_helper_ends_on_its_own_when_its_input_closes_and_reports_no_riot_window() {
    let missing = std::env::temp_dir().join("eclipse-no-riot").join("RiotClientServices.exe");
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(windows_helpers_dir().join("riotWindowObserver.ps1"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let request = request_line(std::process::id(), &missing.display().to_string(), None);
    child.stdin.take().unwrap().write_all(request.as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(0));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.lines().count() >= 1);
    assert!(text.lines().all(|line| read_line(line.as_bytes()) == Ok(None)), "{text}");
}
