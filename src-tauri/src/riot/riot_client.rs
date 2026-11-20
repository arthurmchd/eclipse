use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use super::game_ranks::{read_league_lockfile, GameRanks, INSTALLS_FILE};
use super::riot_app_controls::{CloseMode, RiotAppControls};
use super::riot_authentication::{AuthOutcome, AuthState, Credentials, RiotAuthentication, AUTHORIZATION};
use super::riot_interface::{wait_for, InterfaceOpener, SHOW_INTERFACE};
use super::riot_process::launch_client;
use super::riot_state::{Look, RiotProbe};
use super::riot_transport::{ClientPath, RiotTransport, DEFAULT_MAX_BYTES};
use super::sign_in_flow::{sign_in, Closed, LaunchAnswer, SignInIo, SignInOutcome, SignInRequest, TypeRequest};
use super::{check, AccountState, Cancel, LocalApi, Response, RiotError, RiotId, RiotResult, RunningGames, DEFAULT_TIMEOUT_MS};
use crate::paths::windows_helpers_dir;
use crate::platform::windows::window_controller::{HelperFailure, HelperRunner, PowerShell, WindowController, CREATE_NO_WINDOW};
use crate::platform::windows::windows_environment::local_app_data_for_riot;

pub const LOL_PROCESSES: [&str; 4] = ["LeagueClient.exe", "LeagueClientUx.exe", "LeagueClientUxRender.exe", "League of Legends.exe"];
pub const VAL_PROCESSES: [&str; 2] = ["VALORANT.exe", "VALORANT-Win64-Shipping.exe"];
pub const TFT_PROCESSES: [&str; 2] = ["TFTClient.exe", "TFTClient-Win64-Shipping.exe"];
pub const XKO_PROCESSES: [&str; 2] = ["Lion.exe", "Lion-Win64-Shipping.exe"];
pub const LOR_PROCESSES: [&str; 1] = ["LoR.exe"];
pub const GAME_PROCESSES: [&str; 11] = ["LeagueClient.exe", "LeagueClientUx.exe", "LeagueClientUxRender.exe", "League of Legends.exe", "VALORANT.exe", "VALORANT-Win64-Shipping.exe", "TFTClient.exe", "TFTClient-Win64-Shipping.exe", "Lion.exe", "Lion-Win64-Shipping.exe", "LoR.exe"];
pub const CLIENT_PROCESSES: [&str; 4] = ["RiotClientServices.exe", "Riot Client.exe", "RiotClientUx.exe", "RiotClientUxRender.exe"];
pub const CLIENT_WINDOWS: [&str; 2] = ["Riot Client.exe", "RiotClientUx.exe"];
pub const QUIT: &str = "/process-control/v1/process/quit";
pub const ACTIVE_ALIAS: &str = "/player-account/aliases/v1/active";
pub const FALLBACK_CLIENT: &str = "C:/Riot Games/Riot Client/RiotClientServices.exe";
pub const SETTINGS_PREFIX: &str = "riotgamesprivatesettings";
pub const LOGIN_TIMEOUT_MS: u64 = 90_000;
pub const REPLACE_ATTEMPTS: u32 = 5;
pub const REPLACE_DELAY_MS: u64 = 100;
pub const STALE_TEMP: Duration = Duration::from_secs(60);

fn pattern(cell: &'static OnceLock<Regex>, source: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(source).unwrap())
}

pub fn detect_client_path_with(override_path: &str, exists: &dyn Fn(&Path) -> bool, read_file: &dyn Fn(&Path) -> io::Result<String>) -> Option<String> {
    if !override_path.is_empty() && exists(Path::new(override_path)) {
        return Some(override_path.to_string());
    }
    if let Some(installs) = read_file(Path::new(INSTALLS_FILE)).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()) {
        for key in ["rc_default", "rc_live"] {
            if let Some(candidate) = installs.get(key).and_then(Value::as_str).filter(|candidate| !candidate.is_empty()) {
                if exists(Path::new(candidate)) {
                    return Some(candidate.to_string());
                }
            }
        }
    }
    exists(Path::new(FALLBACK_CLIENT)).then(|| FALLBACK_CLIENT.to_string())
}

pub fn detect_client_path(override_path: &str) -> Option<String> {
    detect_client_path_with(override_path, &|file| file.exists(), &|file| fs::read_to_string(file))
}

pub fn parse_tasklist(output: &str) -> HashSet<String> {
    output.lines().map(|line| line.split("\",\"").next().unwrap_or_default().trim_start_matches('"').to_lowercase()).collect()
}

pub fn running_games_in(processes: &HashSet<String>) -> RunningGames {
    let any = |names: &[&str]| names.iter().any(|name| processes.contains(&name.to_lowercase()));
    RunningGames {
        lol: any(&LOL_PROCESSES),
        val: any(&VAL_PROCESSES),
        tft: any(&TFT_PROCESSES),
        xko: any(&XKO_PROCESSES),
        lor: any(&LOR_PROCESSES),
        client: any(&CLIENT_PROCESSES),
        client_window: any(&CLIENT_WINDOWS),
    }
}

pub fn running_processes() -> RiotResult<HashSet<String>> {
    let output = Command::new("tasklist").args(["/FO", "CSV", "/NH"]).creation_flags(CREATE_NO_WINDOW).output();
    match output {
        Ok(output) if output.status.success() => Ok(parse_tasklist(&String::from_utf8_lossy(&output.stdout))),
        _ => Err(RiotError::new("Could not check running Riot games. No accounts were switched")),
    }
}

pub fn running_games() -> RiotResult<RunningGames> {
    Ok(running_games_in(&running_processes()?))
}

pub fn taskkill_args(names: &[&str]) -> Vec<String> {
    let mut args = vec!["/F".to_string(), "/T".to_string()];
    for name in names {
        args.push("/IM".into());
        args.push(name.to_string());
    }
    args
}

pub fn taskkill(names: &[&str]) {
    let _ = Command::new("taskkill").args(taskkill_args(names)).creation_flags(CREATE_NO_WINDOW).output();
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

fn split_lines(text: &str) -> Vec<&str> {
    text.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).collect()
}

pub fn has_persisted_login(yaml: Option<&str>) -> bool {
    static REFRESH: OnceLock<Regex> = OnceLock::new();
    static SSID: OnceLock<Regex> = OnceLock::new();
    let yaml = yaml.unwrap_or_default();
    pattern(&REFRESH, r"(?m)^\s+refresh_token:\s*\S").is_match(yaml) || pattern(&SSID, r#"name:\s*"ssid""#).is_match(yaml)
}

pub fn strip_persisted_login(yaml: &str) -> String {
    static RIOT_CLIENT: OnceLock<Regex> = OnceLock::new();
    static COOKIES: OnceLock<Regex> = OnceLock::new();
    static DEVICE: OnceLock<Regex> = OnceLock::new();
    let riot_client = pattern(&RIOT_CLIENT, r"^\s+riot-client:\s*$");
    let cookies = pattern(&COOKIES, r"^\s*cookies:\s*$");
    let device = pattern(&DEVICE, r#"name:\s*"tdid""#);
    let lines = split_lines(yaml);
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if riot_client.is_match(line) {
            let base = indent_of(line);
            out.push(format!("{}riot-client: null", " ".repeat(base)));
            let mut j = i + 1;
            while j < lines.len() && !lines[j].trim().is_empty() && indent_of(lines[j]) > base {
                j += 1;
            }
            i = j;
            continue;
        }
        out.push(line.to_string());
        if !cookies.is_match(line) {
            i += 1;
            continue;
        }
        let base = indent_of(line);
        let mut item: Option<Vec<&str>> = None;
        let flush = |item: &mut Option<Vec<&str>>, out: &mut Vec<String>| {
            if let Some(lines) = item.take() {
                if lines.iter().any(|line| device.is_match(line)) {
                    out.extend(lines.into_iter().map(str::to_string));
                }
            }
        };
        let mut j = i + 1;
        while j < lines.len() {
            let current = lines[j];
            let indent = indent_of(current);
            if current.trim().is_empty() {
                break;
            }
            let entry = current.trim_start().starts_with('-');
            if indent < base || (indent == base && !entry) {
                break;
            }
            if entry && indent <= base + 4 {
                flush(&mut item, &mut out);
                item = Some(vec![current]);
            } else if let Some(lines) = item.as_mut() {
                lines.push(current);
            }
            j += 1;
        }
        flush(&mut item, &mut out);
        i = j;
    }
    out.join("\n")
}

fn subject_like(value: &str) -> bool {
    static SUBJECT: OnceLock<Regex> = OnceLock::new();
    pattern(&SUBJECT, r"^[A-Za-z0-9-]{8,100}$").is_match(value)
}

pub fn id_token_claims(yaml: Option<&str>) -> Option<Map<String, Value>> {
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    let token = pattern(&TOKEN, r#"(?m)^\s+id_token:\s*"?([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*"?\s*$"#);
    let captures = token.captures(yaml?)?;
    let bytes = URL_SAFE_NO_PAD.decode(captures.get(2)?.as_str()).ok()?;
    match serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes)).ok()? {
        Value::Object(claims) => Some(claims),
        _ => None,
    }
}

pub fn cookie_subject(yaml: Option<&str>) -> Option<String> {
    static ITEM: OnceLock<Regex> = OnceLock::new();
    static FIELD: OnceLock<Regex> = OnceLock::new();
    let item_start = pattern(&ITEM, r"^\s*-\s+");
    let field = pattern(&FIELD, r#"^\s*(?:-\s+)?(name|value):\s*"([^"]*)"\s*$"#);
    let mut base: Option<usize> = None;
    let mut name: Option<String> = None;
    let mut value: Option<String> = None;
    let mut found: Option<String> = None;
    let mut close = |base: &mut Option<usize>, name: &mut Option<String>, value: &mut Option<String>| {
        if found.is_none() && name.as_deref() == Some("sub") && value.as_deref().is_some_and(subject_like) {
            found = value.clone();
        }
        *base = None;
        *name = None;
        *value = None;
    };
    for line in split_lines(yaml.unwrap_or_default()) {
        let indent = indent_of(line);
        let item = item_start.is_match(line);
        if item || base.is_some_and(|base| !line.trim().is_empty() && indent <= base) {
            close(&mut base, &mut name, &mut value);
        }
        if item {
            base = Some(indent);
        }
        if base.is_none() {
            continue;
        }
        if let Some(captures) = field.captures(line) {
            let text = captures[2].to_string();
            if &captures[1] == "name" {
                name = Some(text);
            } else {
                value = Some(text);
            }
        }
    }
    close(&mut base, &mut name, &mut value);
    found
}

pub fn persisted_subject(yaml: Option<&str>) -> Option<String> {
    cookie_subject(yaml).or_else(|| id_token_claims(yaml)?.get("sub").and_then(Value::as_str).filter(|sub| subject_like(sub)).map(str::to_string))
}

fn utf16_prefix(text: &str, max: usize) -> String {
    let mut used = 0;
    text.chars()
        .take_while(|c| {
            used += c.len_utf16();
            used <= max
        })
        .collect()
}

pub fn persisted_riot_id(yaml: Option<&str>) -> Option<RiotId> {
    let claims = id_token_claims(yaml)?;
    let account = claims.get("acct")?;
    let game_name = account.get("game_name").and_then(Value::as_str).map(|name| utf16_prefix(name, 64)).unwrap_or_default();
    let tag_line = account.get("tag_line").and_then(Value::as_str).map(|tag| utf16_prefix(tag, 16)).unwrap_or_default();
    (!game_name.is_empty()).then_some(RiotId { game_name, tag_line })
}

pub fn authorization_of(response: Option<&Response>) -> AccountState {
    match response.map(|response| response.status) {
        Some(200) => AccountState::Yes,
        Some(404) => AccountState::No,
        _ => AccountState::Unknown,
    }
}

pub fn own_temp_file(name: &str) -> bool {
    static TEMP: OnceLock<Regex> = OnceLock::new();
    pattern(&TEMP, r"^eclipse-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$").is_match(name)
}

pub trait SettingsFiles {
    fn create_dir_all(&self, dir: &Path) -> io::Result<()>;
    fn names(&self, dir: &Path) -> io::Result<Vec<String>>;
    fn modified(&self, file: &Path) -> io::Result<SystemTime>;
    fn remove(&self, file: &Path) -> io::Result<()>;
    fn write_new(&self, file: &Path, text: &str) -> io::Result<()>;
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn read(&self, file: &Path) -> io::Result<String>;
}

pub struct DiskFiles;

impl SettingsFiles for DiskFiles {
    fn create_dir_all(&self, dir: &Path) -> io::Result<()> {
        fs::create_dir_all(dir)
    }

    fn names(&self, dir: &Path) -> io::Result<Vec<String>> {
        Ok(fs::read_dir(dir)?.filter_map(Result::ok).map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
    }

    fn modified(&self, file: &Path) -> io::Result<SystemTime> {
        fs::metadata(file)?.modified()
    }

    fn remove(&self, file: &Path) -> io::Result<()> {
        fs::remove_file(file)
    }

    fn write_new(&self, file: &Path, text: &str) -> io::Result<()> {
        let mut handle = OpenOptions::new().write(true).create_new(true).open(file)?;
        handle.write_all(text.as_bytes())?;
        handle.sync_all()
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::rename(from, to)
    }

    fn read(&self, file: &Path) -> io::Result<String> {
        fs::read_to_string(file)
    }
}

pub fn retryable(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(5) | Some(32) | Some(33)) || error.kind() == io::ErrorKind::PermissionDenied
}

fn remove_stale_temps(files: &dyn SettingsFiles, dir: &Path, now: SystemTime) {
    let Ok(names) = files.names(dir) else {
        return;
    };
    for name in names.iter().filter(|name| own_temp_file(name)) {
        let temp = dir.join(name);
        if let Ok(modified) = files.modified(&temp) {
            if now.duration_since(modified).is_ok_and(|age| age > STALE_TEMP) {
                let _ = files.remove(&temp);
            }
        }
    }
}

pub fn replace_file_with(files: &dyn SettingsFiles, file: &Path, text: &str, expected: Option<&str>, now: SystemTime, sleep: &dyn Fn(u64)) -> io::Result<bool> {
    let dir = file.parent().unwrap_or(Path::new("."));
    files.create_dir_all(dir)?;
    remove_stale_temps(files, dir, now);
    let temp = dir.join(format!("eclipse-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        files.write_new(&temp, text)?;
        let mut attempt = 1;
        loop {
            if let Some(expected) = expected {
                if files.read(file).ok().as_deref() != Some(expected) {
                    return Ok(false);
                }
            }
            match files.rename(&temp, file) {
                Ok(()) => return Ok(true),
                Err(error) if !retryable(&error) || attempt >= REPLACE_ATTEMPTS => return Err(error),
                Err(_) => {}
            }
            attempt += 1;
            sleep(REPLACE_DELAY_MS);
        }
    })();
    let _ = files.remove(&temp);
    result
}

pub fn replace_file(file: &Path, text: &str, expected: Option<&str>) -> io::Result<bool> {
    replace_file_with(&DiskFiles, file, text, expected, SystemTime::now(), &|ms| thread::sleep(Duration::from_millis(ms)))
}

pub fn riot_dir() -> PathBuf {
    PathBuf::from(local_app_data_for_riot()).join("Riot Games").join("Riot Client")
}

pub fn settings_yaml_path() -> PathBuf {
    riot_dir().join("Data").join("RiotGamesPrivateSettings.yaml")
}

pub fn read_settings_yaml() -> Option<String> {
    fs::read_to_string(settings_yaml_path()).ok()
}

pub fn write_settings_yaml(text: &str) -> RiotResult<bool> {
    replace_file(&settings_yaml_path(), text, None).map_err(|_| RiotError::new("Could not update the Riot Client settings file"))
}

fn changed_file(event: &Event, accept: fn(&str) -> bool) -> bool {
    event.paths.is_empty() || event.paths.iter().any(|path| path.file_name().map(|name| accept(&name.to_string_lossy().to_lowercase())).unwrap_or(true))
}

pub fn settings_change(name: &str) -> bool {
    name.starts_with(SETTINGS_PREFIX)
}

pub fn lockfile_change(name: &str) -> bool {
    name == "lockfile"
}

fn watch(dir: &Path, accept: fn(&str) -> bool, on_change: Box<dyn Fn() + Send>) -> Option<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        if let Ok(event) = event {
            if changed_file(&event, accept) {
                on_change();
            }
        }
    })
    .ok()?;
    watcher.watch(dir, RecursiveMode::NonRecursive).ok()?;
    Some(watcher)
}

pub fn watch_settings(on_change: Box<dyn Fn() + Send>) -> Option<RecommendedWatcher> {
    watch(&riot_dir().join("Data"), settings_change, on_change)
}

pub fn watch_lockfile(on_change: Box<dyn Fn() + Send>) -> Option<RecommendedWatcher> {
    watch(&riot_dir().join("Config"), lockfile_change, on_change)
}

pub trait CloseIo: RiotProbe {
    fn active_riot_id(&self) -> RiotResult<Option<RiotId>>;
    fn quit(&self) -> RiotResult<Response>;
    fn taskkill(&self, names: &[&str]);
    fn read_settings_yaml(&self) -> Option<String>;
    fn wait_for(&self, probe: &mut dyn FnMut() -> RiotResult<bool>, timeout_ms: u64, every_ms: u64) -> RiotResult<bool>;
}

pub fn close_everything(io: &dyn CloseIo, log: &dyn Fn(&str)) -> RiotResult<Closed> {
    let mut info = Closed::default();
    let state = Look::new(io).account()?;
    if state == AccountState::Yes {
        info.signed_in = true;
        info.riot_id = io.active_riot_id()?;
    }
    io.taskkill(&GAME_PROCESSES);
    if state != AccountState::No {
        if io.quit().is_ok_and(|response| response.accepted()) {
            let quit = io.wait_for(&mut || Ok(!io.running_games()?.client), 10_000, 500)?;
            log(if quit { "Riot Client quit normally" } else { "Riot Client did not quit in 10 s, forcing" });
        } else {
            log("Riot Client did not accept the quit request, forcing");
        }
    }
    io.taskkill(&CLIENT_PROCESSES);
    let gone = io.wait_for(
        &mut || {
            let state = io.running_games()?;
            Ok(!state.any_game() && !state.client)
        },
        10_000,
        250,
    )?;
    if !gone {
        return Err(RiotError::new("Could not close the Riot Client"));
    }
    info.yaml = io.read_settings_yaml();
    Ok(info)
}

pub trait StartIo: RiotProbe {
    fn detect_client_path(&self, override_path: &str) -> Option<String>;
    fn select(&self, exe: &str);
    fn reveal(&self) -> RiotResult<()>;
    fn launch_client(&self, exe: &str, visible: bool) -> RiotResult<()>;
}

pub fn start_client(io: &dyn StartIo, client_path: &str) -> RiotResult<bool> {
    let exe = io.detect_client_path(client_path).ok_or_else(|| RiotError::new("Riot Client not found. Set its path in Settings"))?;
    if io.running_games()?.client {
        return Ok(false);
    }
    io.select(&exe);
    io.reveal()?;
    if io.running_games()?.client {
        return Ok(false);
    }
    io.launch_client(&exe, true)?;
    Ok(true)
}

fn product(game: &str) -> Option<&'static str> {
    match game {
        "lol" => Some("league_of_legends"),
        "val" => Some("valorant"),
        "tft" => Some("teamfighttactics"),
        "2xko" => Some("lion"),
        "lor" => Some("bacon"),
        _ => None,
    }
}

fn launch_code(json: &Value) -> Option<String> {
    static CODE: OnceLock<Regex> = OnceLock::new();
    json.get("errorCode").and_then(Value::as_str).filter(|code| pattern(&CODE, r"^[A-Za-z0-9_.-]{1,100}$").is_match(code)).map(str::to_string)
}

fn http_status(status: u16) -> u16 {
    if status < 1000 {
        status
    } else {
        0
    }
}

pub fn request_launch(api: &dyn LocalApi, game: &str, log: &dyn Fn(&str)) -> RiotResult<LaunchAnswer> {
    let product = product(game).ok_or_else(|| RiotError::new("Select a supported game"))?;
    let base = format!("/product-launcher/v1/products/{product}/patchlines/live");
    if let Ok(eligibility) = api.get(&format!("{base}/eligibility")) {
        let verdict = match eligibility.json {
            Value::Bool(true) => " eligible",
            Value::Bool(false) => " not eligible",
            _ => "",
        };
        let code = launch_code(&eligibility.json).map(|code| format!(" {code}")).unwrap_or_default();
        log(&format!("launch eligibility: HTTP {}{verdict}{code}", http_status(eligibility.status)));
    }
    let Ok(response) = api.request("POST", &base, None, 30_000, None) else {
        log("launch request: no answer from Riot");
        return Ok(LaunchAnswer { status: 0, error_code: None });
    };
    let status = http_status(response.status);
    let error_code = launch_code(&response.json);
    log(&format!("launch request: HTTP {status}{}", error_code.as_deref().map(|code| format!(" {code}")).unwrap_or_default()));
    Ok(LaunchAnswer { status, error_code })
}

pub fn login_request_json(request: &TypeRequest) -> String {
    json!({ "action": "type", "username": request.username, "password": request.password, "remember": request.remember }).to_string()
}

pub fn interpret_login_output(code: Option<i32>, output: &str) -> RiotResult<Vec<String>> {
    let lines: Vec<String> = split_lines(output.trim()).into_iter().map(str::to_string).collect();
    let last = lines.last().filter(|line| !line.is_empty()).cloned().unwrap_or_else(|| format!("exit code {}", code.map(|code| code.to_string()).unwrap_or_else(|| "null".into())));
    if code == Some(0) && last == "ok" {
        return Ok(lines);
    }
    if output.contains("error:window-not-found") {
        return Err(RiotError::new("The Riot Client window did not open"));
    }
    if output.contains("error:form-not-ready") {
        return Err(RiotError::new("The Riot Client sign-in screen did not load. Finish signing in there"));
    }
    Err(RiotError::new(format!("Riot Client window script failed: {last}")))
}

pub fn run_login_script(runner: &dyn HelperRunner, script: &Path, request: &TypeRequest, cancel: Option<&Cancel>) -> RiotResult<Vec<String>> {
    check(cancel)?;
    match runner.run(script, &login_request_json(request), LOGIN_TIMEOUT_MS, cancel) {
        Ok(output) => interpret_login_output(output.code, &format!("{}{}", output.stdout, output.stderr)),
        Err(HelperFailure::Cancelled) => Err(RiotError::cancelled()),
        Err(HelperFailure::TimedOut) => Err(RiotError::new("The Riot Client sign-in form did not respond")),
        Err(HelperFailure::Spawn(message)) => Err(RiotError::new(message)),
    }
}

fn sleep_ms(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

pub struct RiotClient {
    selected: Arc<Mutex<Option<String>>>,
    local_api: Arc<dyn LocalApi>,
    authentication: RiotAuthentication,
    app_controls: RiotAppControls,
    windows: WindowController,
    interface: InterfaceOpener,
    game_ranks: GameRanks,
    runner: Arc<dyn HelperRunner>,
    login_script: PathBuf,
    started: Instant,
}

impl RiotClient {
    pub fn new() -> Self {
        let selected: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let chosen = selected.clone();
        let client_path: ClientPath = Arc::new(move || chosen.lock().ok().and_then(|exe| exe.clone()).or_else(|| detect_client_path("")).map(PathBuf::from));
        let local_api: Arc<dyn LocalApi> = Arc::new(RiotTransport::for_riot_client(client_path.clone(), None, DEFAULT_MAX_BYTES));
        let league_api: Arc<dyn LocalApi> = Arc::new(RiotTransport::for_riot_client(client_path.clone(), Some(Arc::new(read_league_lockfile)), DEFAULT_MAX_BYTES));
        let riot_api: Arc<dyn LocalApi> = Arc::new(RiotTransport::for_riot_client(client_path, None, 8 * 1024 * 1024));
        let runner: Arc<dyn HelperRunner> = Arc::new(PowerShell);
        let helpers = windows_helpers_dir();
        Self {
            selected,
            local_api: local_api.clone(),
            authentication: RiotAuthentication::new(local_api.clone()),
            app_controls: RiotAppControls::new(local_api.clone()),
            windows: WindowController::new(runner.clone(), helpers.join("windowGuard.ps1"), 15_000),
            interface: InterfaceOpener {
                running_games: Arc::new(running_games),
                local_api,
                stop_client: Arc::new(|| {
                    taskkill(&CLIENT_PROCESSES);
                    Ok(())
                }),
                launch_client: Arc::new(launch_client),
                wait_for: Arc::new(wait_for),
                show_timeout_ms: 10_000,
                stop_timeout_ms: 10_000,
            },
            game_ranks: GameRanks::new(league_api, riot_api),
            runner,
            login_script: helpers.join("login.ps1"),
            started: Instant::now(),
        }
    }

    fn select_path(&self, exe: &str) {
        if let Ok(mut selected) = self.selected.lock() {
            *selected = Some(exe.to_string());
        }
    }

    fn selected_or_detected(&self) -> String {
        self.selected.lock().ok().and_then(|exe| exe.clone()).or_else(|| detect_client_path("")).unwrap_or_default()
    }

    fn current_riot_id(&self) -> Option<RiotId> {
        let json = self.local_api.get(ACTIVE_ALIAS).ok()?.json;
        let text = |keys: [&str; 2]| keys.iter().find_map(|key| json.get(*key).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string));
        let game_name = text(["game_name", "gameName"])?;
        Some(RiotId { game_name, tag_line: text(["tag_line", "tagLine"]).unwrap_or_default() })
    }

    pub fn sign_in(&self, request: &SignInRequest) -> RiotResult<SignInOutcome> {
        sign_in(self, request)
    }

    pub fn look(&self) -> Look<'_> {
        Look::new(self)
    }

    pub fn game_ranks(&self) -> &GameRanks {
        &self.game_ranks
    }

    pub fn show_interface(&self) -> bool {
        self.local_api.post(SHOW_INTERFACE).is_ok_and(|response| response.accepted())
    }

    pub fn quit_client(&self) -> Option<Response> {
        self.local_api.post(QUIT).ok()
    }

    pub fn start_client(&self, client_path: &str) -> RiotResult<bool> {
        start_client(self, client_path)
    }

    pub fn open_client(&self, client_path: &str) -> RiotResult<()> {
        let exe = detect_client_path(client_path).ok_or_else(|| RiotError::new("Riot Client not found. Set its path in Settings"))?;
        self.select_path(&exe);
        self.windows.reveal()?;
        if !running_games()?.client_window {
            self.interface.open(&exe, None, &|_| {})?;
        }
        Ok(())
    }

    pub fn read_login_screen_state(&self, cancel: Option<&Cancel>) -> RiotResult<Option<AuthState>> {
        self.authentication.login_screen_state(cancel)
    }

    pub fn close_client(&self) -> RiotResult<CloseMode> {
        self.app_controls.close()
    }

    pub fn dispose(&self) {
        self.windows.stop();
    }
}

impl Default for RiotClient {
    fn default() -> Self {
        Self::new()
    }
}

impl RiotProbe for RiotClient {
    fn running_games(&self) -> RiotResult<RunningGames> {
        running_games()
    }

    fn authorization(&self) -> RiotResult<AccountState> {
        Ok(authorization_of(self.local_api.get(AUTHORIZATION).ok().as_ref()))
    }

    fn session_state(&self) -> RiotResult<Option<AuthState>> {
        Ok(self.authentication.session_state(None).unwrap_or(None))
    }
}

impl CloseIo for RiotClient {
    fn active_riot_id(&self) -> RiotResult<Option<RiotId>> {
        Ok(self.current_riot_id())
    }

    fn quit(&self) -> RiotResult<Response> {
        self.local_api.post(QUIT)
    }

    fn taskkill(&self, names: &[&str]) {
        taskkill(names)
    }

    fn read_settings_yaml(&self) -> Option<String> {
        read_settings_yaml()
    }

    fn wait_for(&self, probe: &mut dyn FnMut() -> RiotResult<bool>, timeout_ms: u64, every_ms: u64) -> RiotResult<bool> {
        wait_for(probe, timeout_ms, every_ms)
    }
}

impl StartIo for RiotClient {
    fn detect_client_path(&self, override_path: &str) -> Option<String> {
        detect_client_path(override_path)
    }

    fn select(&self, exe: &str) {
        self.select_path(exe)
    }

    fn reveal(&self) -> RiotResult<()> {
        self.windows.reveal()
    }

    fn launch_client(&self, exe: &str, visible: bool) -> RiotResult<()> {
        launch_client(exe, visible)
    }
}

impl SignInIo for RiotClient {
    fn detect_client_path(&self, override_path: &str) -> Option<String> {
        let exe = detect_client_path(override_path)?;
        self.select_path(&exe);
        Some(exe)
    }

    fn close_everything(&self, log: &dyn Fn(&str)) -> RiotResult<Closed> {
        close_everything(self, log)
    }

    fn read_settings_yaml(&self) -> Option<String> {
        read_settings_yaml()
    }

    fn write_settings_yaml(&self, text: &str) -> RiotResult<bool> {
        write_settings_yaml(text)
    }

    fn has_persisted_login(&self, yaml: Option<&str>) -> bool {
        has_persisted_login(yaml)
    }

    fn strip_persisted_login(&self, yaml: &str) -> String {
        strip_persisted_login(yaml)
    }

    fn read_authentication_state(&self) -> RiotResult<Option<AuthState>> {
        self.authentication.session_state(None)
    }

    fn is_authorized(&self) -> RiotResult<bool> {
        Ok(RiotProbe::authorization(self)? == AccountState::Yes)
    }

    fn active_riot_id(&self) -> RiotResult<Option<RiotId>> {
        Ok(self.current_riot_id())
    }

    fn local_api(&self, method: &str, path: &str) -> RiotResult<Response> {
        self.local_api.request(method, path, None, DEFAULT_TIMEOUT_MS, None)
    }

    fn launch_product(&self, exe: &str, visible: bool) -> RiotResult<()> {
        launch_client(exe, visible)
    }

    fn request_launch(&self, game: &str, log: &dyn Fn(&str)) -> RiotResult<LaunchAnswer> {
        request_launch(self.local_api.as_ref(), game, log)
    }

    fn type_credentials(&self, request: &TypeRequest, cancel: Option<&Cancel>, log: &dyn Fn(&str)) -> RiotResult<Vec<String>> {
        self.interface.open(&self.selected_or_detected(), cancel, log)?;
        check(cancel)?;
        run_login_script(self.runner.as_ref(), &self.login_script, request, cancel)
    }

    fn authenticate(&self, account: &Credentials, cancel: Option<&Cancel>, remember: bool) -> RiotResult<Option<AuthOutcome>> {
        self.authentication.authenticate(account, cancel, remember).map(Some)
    }

    fn reveal(&self) -> RiotResult<()> {
        self.windows.reveal()
    }

    fn game_window(&self, game: &str) -> RiotResult<bool> {
        self.windows.game_window(game)
    }

    fn close_client_window(&self) -> RiotResult<()> {
        self.windows.close_client()
    }

    fn open_visible_interface(&self, exe: &str, cancel: Option<&Cancel>, log: &dyn Fn(&str)) -> RiotResult<()> {
        self.interface.open(exe, cancel, log).map(|_| ())
    }

    fn close_games(&self) -> RiotResult<()> {
        taskkill(&GAME_PROCESSES);
        Ok(())
    }

    fn now(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn sleep(&self, ms: u64) {
        sleep_ms(ms)
    }
}
