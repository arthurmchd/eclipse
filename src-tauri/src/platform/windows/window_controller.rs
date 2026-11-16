use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{json, Value};

use crate::riot::{Cancel, RiotError, RiotResult};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const GAMES: [&str; 3] = ["lol", "tft", "val"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelperFailure {
    Spawn(String),
    TimedOut,
    Cancelled,
}

pub trait HelperRunner: Send + Sync {
    fn run(&self, script: &Path, input: &str, timeout_ms: u64, cancel: Option<&Cancel>) -> Result<HelperOutput, HelperFailure>;
}

pub fn powershell_args(script: &Path) -> Vec<String> {
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"].iter().map(|arg| arg.to_string()).chain([script.display().to_string()]).collect()
}

pub struct PowerShell;

impl HelperRunner for PowerShell {
    fn run(&self, script: &Path, input: &str, timeout_ms: u64, cancel: Option<&Cancel>) -> Result<HelperOutput, HelperFailure> {
        let mut child = Command::new("powershell.exe")
            .args(powershell_args(script))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| HelperFailure::Spawn(error.to_string()))?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input.as_bytes());
        }
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let out = thread::spawn(move || {
            let mut text = String::new();
            let _ = stdout.read_to_string(&mut text);
            text
        });
        let err = thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        let pid = child.id().to_string();
        let (sender, receiver) = mpsc::channel();
        let waiter = thread::spawn(move || {
            let status = child.wait();
            let _ = sender.send(());
            status
        });
        let end = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            if receiver.recv_timeout(Duration::from_millis(25)).is_ok() {
                break;
            }
            let failure = if cancel.is_some_and(Cancel::is_cancelled) {
                HelperFailure::Cancelled
            } else if Instant::now() >= end {
                HelperFailure::TimedOut
            } else {
                continue;
            };
            let _ = Command::new("taskkill").args(["/F", "/T", "/PID", &pid]).creation_flags(CREATE_NO_WINDOW).output();
            return Err(failure);
        }
        let status = waiter.join().map_err(|_| HelperFailure::TimedOut)?;
        Ok(HelperOutput {
            code: status.ok().and_then(|status| status.code()),
            stdout: out.join().unwrap_or_default(),
            stderr: err.join().unwrap_or_default(),
        })
    }
}

pub fn safe_reason(text: &str) -> &str {
    static REASON: OnceLock<Regex> = OnceLock::new();
    if REASON.get_or_init(|| Regex::new(r"^[a-z0-9-]{1,64}$").unwrap()).is_match(text) {
        text
    } else {
        "unknown"
    }
}

pub struct WindowController {
    runner: Arc<dyn HelperRunner>,
    script: PathBuf,
    timeout_ms: u64,
    disposed: AtomicBool,
    queue: Mutex<()>,
}

impl WindowController {
    pub fn new(runner: Arc<dyn HelperRunner>, script: PathBuf, timeout_ms: u64) -> Self {
        Self { runner, script, timeout_ms, disposed: AtomicBool::new(false), queue: Mutex::new(()) }
    }

    fn run(&self, request: Value) -> RiotResult<Vec<String>> {
        let _turn = self.queue.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.disposed.load(Ordering::SeqCst) {
            return Err(RiotError::new("The background window guard is shutting down"));
        }
        let output = match self.runner.run(&self.script, &format!("{request}\n"), self.timeout_ms, None) {
            Ok(output) => output,
            Err(HelperFailure::TimedOut) | Err(HelperFailure::Cancelled) => return Err(RiotError::new("The background window helper timed out")),
            Err(HelperFailure::Spawn(message)) => return Err(RiotError::new(message)),
        };
        let lines: Vec<String> = output.stdout.split(['\r', '\n']).filter(|line| !line.is_empty()).map(str::to_string).collect();
        if let Some(reason) = lines.iter().find_map(|line| line.strip_prefix("error:")) {
            return Err(RiotError::new(format!("Background window guard: {}", safe_reason(reason))));
        }
        if output.code == Some(0) && lines.iter().any(|line| line == "ok") {
            return Ok(lines);
        }
        let code = output.code.map(|code| code.to_string()).unwrap_or_else(|| "null".into());
        let detail = if output.stderr.is_empty() { "" } else { ": helper error" };
        Err(RiotError::new(format!("The background window guard stopped ({code}){detail}")))
    }

    pub fn reveal(&self) -> RiotResult<()> {
        self.run(json!({ "action": "reveal" })).map(|_| ())
    }

    pub fn close_client(&self) -> RiotResult<()> {
        self.run(json!({ "action": "close-client" })).map(|_| ())
    }

    pub fn game_window(&self, game: &str) -> RiotResult<bool> {
        if !GAMES.contains(&game) {
            return Err(RiotError::new("Invalid game"));
        }
        Ok(self.run(json!({ "action": "game-window", "game": game }))?.iter().any(|line| line == "game-ready"))
    }

    pub fn stop(&self) {
        self.disposed.store(true, Ordering::SeqCst);
        drop(self.queue.lock());
    }
}
