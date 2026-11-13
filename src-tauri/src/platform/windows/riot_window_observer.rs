use std::io::{self, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::thread;

use regex::Regex;
use serde_json::{json, Value};

use super::window_controller::{powershell_args, CREATE_NO_WINDOW};
use crate::application::timers::Timers;

pub const COMMANDS: [&str; 2] = ["minimize", "close"];
pub const PANEL_POINT: (f64, f64) = (0.026, 0.5);
pub const FOLLOW_FAILED: &str = "Could not follow the Riot window. Restart Eclipse.";
pub const STALE_MS: f64 = 3000.0;
pub const STALE_CHECK_MS: u64 = 1000;
pub const KILL_DELAY_MS: u64 = 1000;
const MAX_PARTIAL: usize = 16384;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub corner: Option<i32>,
    pub minimized: bool,
    pub dimmed: bool,
    pub form_hidden: bool,
}

fn integer(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_f64().filter(|number| number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0).map(|number| number as i64))
}

fn flag(value: &Value, key: &str) -> Option<bool> {
    match value.get(key) {
        None => Some(false),
        Some(Value::Bool(true)) => Some(true),
        Some(_) => None,
    }
}

fn numeric_id(text: &str) -> bool {
    static ID: OnceLock<Regex> = OnceLock::new();
    ID.get_or_init(|| Regex::new(r"^\d{1,20}$").unwrap()).is_match(text)
}

pub fn valid_target(value: &Value) -> Option<Target> {
    let id = value.get("id")?.as_str().filter(|id| numeric_id(id))?;
    let mut numbers = [0i32; 4];
    for (slot, key) in numbers.iter_mut().zip(["x", "y", "width", "height"]) {
        let number = integer(value.get(key)?).filter(|number| number.abs() <= 100_000)?;
        *slot = number as i32;
    }
    let [x, y, width, height] = numbers;
    if width < 320 || height < 240 {
        return None;
    }
    let corner = match value.get("corner") {
        None => None,
        Some(corner) => Some(integer(corner).filter(|corner| (0..=64).contains(corner))? as i32),
    };
    Some(Target { id: id.to_string(), x, y, width, height, corner, minimized: flag(value, "minimized")?, dimmed: flag(value, "dimmed")?, form_hidden: flag(value, "formHidden")? })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BadLine;

pub fn read_line(line: &[u8]) -> Result<Option<Target>, BadLine> {
    let data: Value = serde_json::from_slice(line).map_err(|_| BadLine)?;
    match data.get("target") {
        Some(Value::Null) => Ok(None),
        Some(target) => valid_target(target).map(Some).ok_or(BadLine),
        None => Err(BadLine),
    }
}

pub fn request_line(owner_pid: u32, client_path: &str, overlay_window: Option<&str>) -> String {
    let overlay = overlay_window.filter(|handle| numeric_id(handle));
    format!("{}\n", json!({ "ownerPid": owner_pid, "clientPath": client_path, "overlayWindow": overlay }))
}

pub type Output = Arc<dyn Fn(Option<&[u8]>) + Send + Sync>;

pub struct ObserverChild {
    pub input: Box<dyn Write + Send>,
    pub kill: Box<dyn FnOnce() + Send>,
}

pub trait ObserverSpawn: Send + Sync {
    fn spawn(&self, script: &Path, output: Output) -> io::Result<ObserverChild>;
}

pub struct ObserverHooks {
    pub on_state: Box<dyn Fn(Option<Target>) + Send + Sync>,
    pub on_error: Box<dyn Fn(&str) + Send + Sync>,
    pub now: Box<dyn Fn() -> f64 + Send + Sync>,
}

#[derive(Default)]
struct State {
    disposed: bool,
    started: bool,
    input: Option<Box<dyn Write + Send>>,
    kill: Option<Box<dyn FnOnce() + Send>>,
    partial: Vec<u8>,
    last: f64,
    timer: Option<u64>,
}

struct Inner {
    spawner: Arc<dyn ObserverSpawn>,
    script: PathBuf,
    owner_pid: u32,
    timers: Arc<dyn Timers>,
    hooks: ObserverHooks,
    state: Mutex<State>,
}

enum Event {
    State(Option<Target>),
    Failed,
}

impl Inner {
    fn emit(&self, events: Vec<Event>) {
        for event in events {
            match event {
                Event::State(target) => (self.hooks.on_state)(target),
                Event::Failed => {
                    (self.hooks.on_state)(None);
                    (self.hooks.on_error)(FOLLOW_FAILED);
                }
            }
        }
    }

    fn output(&self, chunk: Option<&[u8]>) {
        let mut events = Vec::new();
        {
            let mut state = self.state.lock().unwrap();
            if state.disposed {
                return;
            }
            match chunk {
                None => events.push(Event::Failed),
                Some(bytes) => {
                    state.partial.extend_from_slice(bytes);
                    if state.partial.len() > MAX_PARTIAL {
                        state.partial.clear();
                        events.push(Event::Failed);
                    } else {
                        while let Some(end) = state.partial.iter().position(|byte| *byte == b'\n') {
                            let mut line: Vec<u8> = state.partial.drain(..=end).collect();
                            line.pop();
                            if line.last() == Some(&b'\r') {
                                line.pop();
                            }
                            match read_line(&line) {
                                Ok(target) => {
                                    state.last = (self.hooks.now)();
                                    events.push(Event::State(target));
                                }
                                Err(BadLine) => events.push(Event::Failed),
                            }
                        }
                    }
                }
            }
        }
        self.emit(events);
    }

    fn schedule(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        let id = self.timers.later(STALE_CHECK_MS, Box::new(move || {
            if let Some(inner) = weak.upgrade() {
                inner.check_stale();
            }
        }));
        self.state.lock().unwrap().timer = Some(id);
    }

    fn check_stale(self: &Arc<Self>) {
        let stale = {
            let state = self.state.lock().unwrap();
            if state.disposed {
                return;
            }
            (self.hooks.now)() - state.last > STALE_MS
        };
        if stale {
            (self.hooks.on_state)(None);
        }
        self.schedule();
    }
}

pub struct RiotWindowObserver {
    inner: Arc<Inner>,
}

impl RiotWindowObserver {
    pub fn new(spawner: Arc<dyn ObserverSpawn>, script: PathBuf, owner_pid: u32, timers: Arc<dyn Timers>, hooks: ObserverHooks) -> Self {
        Self { inner: Arc::new(Inner { spawner, script, owner_pid, timers, hooks, state: Mutex::new(State::default()) }) }
    }

    pub fn start(&self, client_path: &str, overlay_window: Option<&str>) {
        {
            let mut state = self.inner.state.lock().unwrap();
            if state.disposed || state.started {
                return;
            }
            state.started = true;
            state.last = (self.inner.hooks.now)();
        }
        let weak: Weak<Inner> = Arc::downgrade(&self.inner);
        let output: Output = Arc::new(move |chunk| {
            if let Some(inner) = weak.upgrade() {
                inner.output(chunk);
            }
        });
        match self.inner.spawner.spawn(&self.inner.script, output) {
            Ok(mut child) => {
                let _ = child.input.write_all(request_line(self.inner.owner_pid, client_path, overlay_window).as_bytes());
                let _ = child.input.flush();
                let mut state = self.inner.state.lock().unwrap();
                if state.disposed {
                    drop(state);
                    drop(child.input);
                    (child.kill)();
                    return;
                }
                state.input = Some(child.input);
                state.kill = Some(child.kill);
            }
            Err(_) => self.inner.emit(vec![Event::Failed]),
        }
        self.inner.schedule();
    }

    pub fn command(&self, name: &str) -> bool {
        if !COMMANDS.contains(&name) {
            return false;
        }
        let mut state = self.inner.state.lock().unwrap();
        if state.disposed {
            return false;
        }
        let Some(input) = state.input.as_mut() else {
            return false;
        };
        input.write_all(format!("{name}\n").as_bytes()).and_then(|()| input.flush()).is_ok()
    }

    pub fn stop(&self) {
        let (timer, input, kill) = {
            let mut state = self.inner.state.lock().unwrap();
            state.disposed = true;
            (state.timer.take(), state.input.take(), state.kill.take())
        };
        if let Some(id) = timer {
            self.inner.timers.cancel(id);
        }
        drop(input);
        if let Some(kill) = kill {
            self.inner.timers.later(KILL_DELAY_MS, kill);
        }
    }
}

pub struct PowerShellObserver;

impl ObserverSpawn for PowerShellObserver {
    fn spawn(&self, script: &Path, output: Output) -> io::Result<ObserverChild> {
        let mut child = Command::new("powershell.exe")
            .args(powershell_args(script))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
        let input = child.stdin.take().ok_or_else(|| io::Error::other("no input"))?;
        let mut stdout = child.stdout.take().ok_or_else(|| io::Error::other("no output"))?;
        let mut stderr = child.stderr.take().ok_or_else(|| io::Error::other("no error output"))?;
        thread::Builder::new().name("eclipse-observer-output".into()).spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match stdout.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => output(Some(&buffer[..read])),
                }
            }
            output(None);
        })?;
        thread::Builder::new().name("eclipse-observer-errors".into()).spawn(move || {
            let _ = io::copy(&mut stderr, &mut io::sink());
        })?;
        let child = Arc::new(Mutex::new(child));
        Ok(ObserverChild {
            input: Box::new(input),
            kill: Box::new(move || {
                let mut child = child.lock().unwrap();
                let _ = child.kill();
                let _ = child.wait();
            }),
        })
    }
}
