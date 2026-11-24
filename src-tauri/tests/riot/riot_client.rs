use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use eclipse::platform::windows::login_form::{FillFailure, FillReport, InputMethod, LoginForm, Remember};
use eclipse::riot::riot_client::{
    authorization_of, close_everything, detect_client_path_with, fill_error, fill_error_for, fill_login_form, has_persisted_login, lockfile_change, persisted_riot_id, persisted_subject,
    replace_file_with, report_lines, request_launch, running_games_in, settings_change, skip_stay_signed_in_notice, start_client, strip_persisted_login, taskkill_args, CloseIo, DiskFiles, SettingsFiles, StartIo, FALLBACK_CLIENT, QUIT,
    STAY_SIGNED_IN_NOTICE,
};
use eclipse::riot::riot_state::RiotProbe;
use eclipse::riot::riot_version::{RiotVersion, NEWER_RIOT};
use eclipse::riot::sign_in_flow::{LaunchAnswer, TypeRequest};
use eclipse::riot::{AccountState, Cancel, Response, RiotError, RiotId, RiotResult, RunningGames};
use serde_json::{json, Value};
use tempfile::TempDir;

use crate::{reply, route, FakeApi};

const SUBJECT: &str = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN_SUBJECT: &str = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

fn cookie(name: &str, value: &str, domain: &str) -> Vec<String> {
    vec![
        format!("            -   domain: \"{domain}\""),
        "                hostOnly: true".into(),
        "                httpOnly: true".into(),
        format!("                name: \"{name}\""),
        "                path: \"/\"".into(),
        "                persistent: true".into(),
        "                secureOnly: true".into(),
        format!("                value: \"{value}\""),
    ]
}

fn remembered() -> String {
    let mut lines: Vec<String> = ["psl:", "    authorization:", "        riot-client:", "            refresh_token: \"synthetic-refresh\"", "riot-login:", "    persist:", "        region: \"BR\"", "        session:", "            cookies:"]
        .iter()
        .map(|line| line.to_string())
        .collect();
    lines.extend(cookie("tdid", "synthetic-device", "riotgames.com"));
    lines.extend(cookie("ssid", "synthetic-session", "auth.riotgames.com"));
    lines.extend(cookie("sub", SUBJECT, "auth.riotgames.com"));
    lines.extend(["rso-authenticator:", "    tdid:", "        domain: \"riotgames.com\"", "        name: \"tdid\"", "        value: \"synthetic-device\""].iter().map(|line| line.to_string()));
    lines.join("\n")
}

fn encode(value: &Value) -> String {
    URL_SAFE_NO_PAD.encode(value.to_string())
}

fn id_token(claims: &Value) -> String {
    format!("{}.{}.c2lnbmF0dXJl", encode(&json!({ "kid": "s1", "typ": "JWT", "alg": "RS256" })), encode(claims))
}

fn current(token: &str) -> String {
    let mut lines: Vec<String> = ["psl:", "    authorization:", "        riot-client:", "            claims: {}"].iter().map(|line| line.to_string()).collect();
    lines.push(format!("            id_token: \"{token}\""));
    lines.extend(["            refresh_token: \"synthetic-refresh\"", "            scopes:", "            - \"openid\"", "riot-login:", "    persist:", "        session:", "            cookies:"].iter().map(|line| line.to_string()));
    lines.extend(cookie("tdid", "synthetic-device", "riotgames.com"));
    lines.join("\r\n")
}

#[test]
fn the_subject_of_a_remembered_riot_login_comes_only_from_its_sub_cookie() {
    let yaml = remembered();
    assert_eq!(persisted_subject(Some(&yaml)).as_deref(), Some(SUBJECT));
    assert_eq!(persisted_subject(Some(&yaml.replace('\n', "\r\n"))).as_deref(), Some(SUBJECT));
    let stripped = strip_persisted_login(&yaml);
    for value in [None, Some(""), Some("riot-login: null"), Some(stripped.as_str())] {
        assert_eq!(persisted_subject(value), None);
    }
}

#[test]
fn a_sub_outside_the_cookie_list_or_with_an_unexpected_format_is_not_trusted() {
    let outside = ["other:", "    name: \"sub\"", &format!("    value: \"{SUBJECT}\"")].join("\n");
    assert_eq!(persisted_subject(Some(&outside)), None);
    let strange = remembered().replace(&format!("value: \"{SUBJECT}\""), "value: \"../../etc\"");
    assert_eq!(persisted_subject(Some(&strange)), None);
    let mut trailing = vec!["cookies:".to_string()];
    trailing.extend(cookie("tdid", "x", "auth.riotgames.com"));
    trailing.extend(["after:".to_string(), "    name: \"sub\"".to_string(), format!("    value: \"{SUBJECT}\"")]);
    assert_eq!(persisted_subject(Some(&trailing.join("\n"))), None);
}

#[test]
fn the_current_riot_format_without_a_sub_cookie_identifies_the_account_by_its_id_token() {
    let yaml = current(&id_token(&json!({ "sub": TOKEN_SUBJECT, "acct": { "game_name": "Example Name", "tag_line": "BR1" }, "iss": "https://auth.riotgames.com" })));
    assert!(has_persisted_login(Some(&yaml)));
    assert_eq!(persisted_subject(Some(&yaml)).as_deref(), Some(TOKEN_SUBJECT));
    assert_eq!(persisted_riot_id(Some(&yaml)), Some(RiotId::new("Example Name", "BR1")));
    let cleared = strip_persisted_login(&yaml);
    assert!(!has_persisted_login(Some(&cleared)));
    assert_eq!(persisted_subject(Some(&cleared)), None);
    assert_eq!(persisted_riot_id(Some(&cleared)), None);
    let both = format!("{}\n{}", remembered(), current(&id_token(&json!({ "sub": TOKEN_SUBJECT }))));
    assert_eq!(persisted_subject(Some(&both)).as_deref(), Some(SUBJECT));
}

#[test]
fn an_unreadable_id_token_or_claims_of_the_wrong_shape_identify_nobody() {
    let array = format!("{}.{}.x", encode(&json!({})), URL_SAFE_NO_PAD.encode("[1]"));
    for token in ["not-a-token".to_string(), "a.b.c".to_string(), array, id_token(&json!({ "sub": "../../x", "acct": { "game_name": 7 } })), id_token(&json!({ "acct": {} }))] {
        let yaml = current(&token);
        assert_eq!(persisted_subject(Some(&yaml)), None, "{token}");
        assert_eq!(persisted_riot_id(Some(&yaml)), None, "{token}");
    }
}

#[test]
fn a_riot_id_from_the_id_token_is_cut_to_the_riot_limits() {
    let yaml = current(&id_token(&json!({ "acct": { "game_name": "n".repeat(80), "tag_line": "t".repeat(20) } })));
    let riot_id = persisted_riot_id(Some(&yaml)).unwrap();
    assert_eq!(riot_id.game_name.len(), 64);
    assert_eq!(riot_id.tag_line.len(), 16);
}

#[test]
fn clearing_a_remembered_login_keeps_only_the_device_cookie() {
    let yaml = remembered();
    assert!(has_persisted_login(Some(&yaml)));
    let cleared = strip_persisted_login(&yaml);
    assert!(!has_persisted_login(Some(&cleared)));
    assert!(cleared.contains("riot-client: null"));
    assert!(cleared.contains("name: \"tdid\""));
    for secret in ["synthetic-refresh", "synthetic-session", SUBJECT] {
        assert!(!cleared.contains(secret), "{secret}");
    }
}

fn temp_dir() -> TempDir {
    tempfile::Builder::new().prefix("riot-settings-test-").tempdir().unwrap()
}

fn temporaries(dir: &Path) -> Vec<String> {
    fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).filter(|name| name.starts_with("eclipse-")).collect()
}

type Rename = Box<dyn Fn(&Path, &Path) -> io::Result<()>>;
type WriteNew = Box<dyn Fn(&Path, &str) -> io::Result<()>>;

struct Files {
    rename: Option<Rename>,
    write_new: Option<WriteNew>,
}

impl Files {
    fn plain() -> Self {
        Self { rename: None, write_new: None }
    }

    fn renaming(rename: impl Fn(&Path, &Path) -> io::Result<()> + 'static) -> Self {
        Self { rename: Some(Box::new(rename)), write_new: None }
    }
}

impl SettingsFiles for Files {
    fn create_dir_all(&self, dir: &Path) -> io::Result<()> {
        DiskFiles.create_dir_all(dir)
    }

    fn names(&self, dir: &Path) -> io::Result<Vec<String>> {
        DiskFiles.names(dir)
    }

    fn modified(&self, file: &Path) -> io::Result<SystemTime> {
        DiskFiles.modified(file)
    }

    fn remove(&self, file: &Path) -> io::Result<()> {
        DiskFiles.remove(file)
    }

    fn write_new(&self, file: &Path, text: &str) -> io::Result<()> {
        match &self.write_new {
            Some(write) => write(file, text),
            None => DiskFiles.write_new(file, text),
        }
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        match &self.rename {
            Some(rename) => rename(from, to),
            None => DiskFiles.rename(from, to),
        }
    }

    fn read(&self, file: &Path) -> io::Result<String> {
        DiskFiles.read(file)
    }
}

fn no_sleep(_: u64) {}

fn busy() -> io::Error {
    io::Error::from_raw_os_error(32)
}

fn denied() -> io::Error {
    io::Error::from_raw_os_error(5)
}

#[test]
fn the_riot_settings_are_replaced_whole_through_a_temporary_file_in_the_same_folder() {
    let dir = temp_dir();
    let file = dir.path().join("Data").join("RiotGamesPrivateSettings.yaml");
    let renames: std::rc::Rc<RefCell<Vec<(PathBuf, PathBuf)>>> = Default::default();
    let seen = renames.clone();
    let files = Files::renaming(move |from, to| {
        seen.borrow_mut().push((from.to_path_buf(), to.to_path_buf()));
        fs::rename(from, to)
    });
    assert!(replace_file_with(&files, &file, "first", None, SystemTime::now(), &no_sleep).unwrap());
    assert!(replace_file_with(&files, &file, "second", None, SystemTime::now(), &no_sleep).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), "second");
    let renames = renames.borrow();
    assert_eq!(renames.len(), 2);
    let temp_name = regex::Regex::new(r"^eclipse-[0-9a-f-]{36}\.tmp$").unwrap();
    for (from, to) in renames.iter() {
        assert_eq!(from.parent(), file.parent());
        let name = from.file_name().unwrap().to_string_lossy();
        assert!(temp_name.is_match(&name), "{name}");
        assert!(!name.to_lowercase().starts_with("riotgamesprivatesettings"));
        assert_eq!(to, &file);
    }
    assert!(temporaries(file.parent().unwrap()).is_empty());
}

#[test]
fn a_riot_settings_file_that_changed_since_it_was_read_is_left_as_riot_wrote_it() {
    let dir = temp_dir();
    let file = dir.path().join("RiotGamesPrivateSettings.yaml");
    fs::write(&file, "renewed by Riot").unwrap();
    assert!(!replace_file_with(&Files::plain(), &file, "stripped", Some("read before"), SystemTime::now(), &no_sleep).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), "renewed by Riot");
    assert!(replace_file_with(&Files::plain(), &file, "stripped", Some("renewed by Riot"), SystemTime::now(), &no_sleep).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), "stripped");
    assert!(temporaries(dir.path()).is_empty());
}

#[test]
fn a_riot_settings_file_in_use_is_tried_again_and_a_riot_write_during_the_wait_wins() {
    let dir = temp_dir();
    let file = dir.path().join("RiotGamesPrivateSettings.yaml");
    fs::write(&file, "original").unwrap();
    let left = std::rc::Rc::new(Cell::new(2));
    let counter = left.clone();
    let files = Files::renaming(move |from, to| {
        if counter.get() > 0 {
            counter.set(counter.get() - 1);
            return Err(busy());
        }
        fs::rename(from, to)
    });
    let pauses = RefCell::new(Vec::new());
    assert!(replace_file_with(&files, &file, "stripped", None, SystemTime::now(), &|ms| pauses.borrow_mut().push(ms)).unwrap());
    assert_eq!(*pauses.borrow(), [100, 100]);
    assert_eq!(fs::read_to_string(&file).unwrap(), "stripped");
    left.set(1);
    let written = replace_file_with(&files, &file, "stripped again", Some("stripped"), SystemTime::now(), &|_| fs::write(&file, "renewed by Riot").unwrap()).unwrap();
    assert!(!written);
    assert_eq!(fs::read_to_string(&file).unwrap(), "renewed by Riot");
    assert!(temporaries(dir.path()).is_empty());
}

#[test]
fn a_failed_replacement_keeps_the_riot_settings_and_leaves_no_temporary_file() {
    let dir = temp_dir();
    let file = dir.path().join("RiotGamesPrivateSettings.yaml");
    fs::write(&file, "original").unwrap();
    let tries = std::rc::Rc::new(Cell::new(0));
    let counter = tries.clone();
    let locked = Files::renaming(move |_, _| {
        counter.set(counter.get() + 1);
        Err(denied())
    });
    assert_eq!(replace_file_with(&locked, &file, "new", None, SystemTime::now(), &no_sleep).unwrap_err().raw_os_error(), Some(5));
    assert_eq!(tries.get(), 5);
    tries.set(0);
    let counter = tries.clone();
    let missing = Files::renaming(move |_, _| {
        counter.set(counter.get() + 1);
        Err(io::Error::from(io::ErrorKind::NotFound))
    });
    assert_eq!(replace_file_with(&missing, &file, "new", None, SystemTime::now(), &no_sleep).unwrap_err().kind(), io::ErrorKind::NotFound);
    assert_eq!(tries.get(), 1);
    let full = Files {
        rename: None,
        write_new: Some(Box::new(|target, _| {
            fs::write(target, "part")?;
            Err(io::Error::from_raw_os_error(112))
        })),
    };
    assert_eq!(replace_file_with(&full, &file, "new", None, SystemTime::now(), &no_sleep).unwrap_err().raw_os_error(), Some(112));
    assert_eq!(fs::read_to_string(&file).unwrap(), "original");
    assert!(temporaries(dir.path()).is_empty());
}

#[test]
fn only_old_temporary_files_of_eclipse_are_removed_from_the_riot_folder() {
    let dir = temp_dir();
    let file = dir.path().join("RiotGamesPrivateSettings.yaml");
    let old = "eclipse-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.tmp";
    let recent = "eclipse-1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e.tmp";
    let others = ["RiotGamesPrivateSettings.yaml.tmp", "eclipse-notes.tmp", "other.tmp"];
    for name in [old, recent].iter().chain(others.iter()) {
        fs::write(dir.path().join(name), "x").unwrap();
    }
    let now = SystemTime::now();
    File::options().write(true).open(dir.path().join(old)).unwrap().set_modified(now - Duration::from_secs(120)).unwrap();
    assert!(replace_file_with(&DiskFiles, &file, "new", None, now, &no_sleep).unwrap());
    let names: HashSet<String> = fs::read_dir(dir.path()).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(!names.contains(old));
    for name in [recent, "RiotGamesPrivateSettings.yaml"].iter().chain(others.iter()) {
        assert!(names.contains(*name), "{name}");
    }
}

#[test]
fn the_riot_account_state_reads_200_as_signed_in_404_as_signed_out_and_anything_else_as_unknown() {
    assert_eq!(authorization_of(Some(&Response::new(200, Value::Null))), AccountState::Yes);
    assert_eq!(authorization_of(Some(&Response::new(404, Value::Null))), AccountState::No);
    for status in [401, 204, 500] {
        assert_eq!(authorization_of(Some(&Response::new(status, Value::Null))), AccountState::Unknown);
    }
    assert_eq!(authorization_of(None), AccountState::Unknown);
}

struct Closer {
    state: AccountState,
    quit: RiotResult<Response>,
    quits: bool,
    stays: bool,
    processes: RefCell<RunningGames>,
    events: RefCell<Vec<String>>,
    waits: Cell<u32>,
}

fn closer() -> Closer {
    Closer {
        state: AccountState::Yes,
        quit: Ok(Response::new(204, Value::Null)),
        quits: true,
        stays: false,
        processes: RefCell::new(RunningGames { client: true, lol: true, ..RunningGames::default() }),
        events: RefCell::new(Vec::new()),
        waits: Cell::new(0),
    }
}

impl Closer {
    fn event(&self, event: &str) {
        self.events.borrow_mut().push(event.to_string());
    }

    fn run(&self) -> (RiotResult<eclipse::riot::sign_in_flow::Closed>, Vec<String>) {
        let logs = RefCell::new(Vec::new());
        let result = close_everything(self, &|line| logs.borrow_mut().push(line.to_string()));
        (result, logs.into_inner())
    }

    fn events(&self) -> Vec<String> {
        self.events.borrow().clone()
    }
}

impl RiotProbe for Closer {
    fn running_games(&self) -> RiotResult<RunningGames> {
        Ok(*self.processes.borrow())
    }

    fn authorization(&self) -> RiotResult<AccountState> {
        self.event("authorization?");
        Ok(self.state)
    }
}

impl CloseIo for Closer {
    fn active_riot_id(&self) -> RiotResult<Option<RiotId>> {
        self.event("identity?");
        Ok(Some(RiotId::new("Leaving", "BR1")))
    }

    fn quit(&self) -> RiotResult<Response> {
        self.event(&format!("POST {QUIT}"));
        if self.quits {
            self.processes.borrow_mut().client = false;
        }
        self.quit.clone()
    }

    fn taskkill(&self, names: &[&str]) {
        let games = names.contains(&"League of Legends.exe");
        self.event(if games { "kill-games" } else { "kill-riot" });
        let mut processes = self.processes.borrow_mut();
        if games {
            processes.lol = false;
            processes.val = false;
        } else if !self.stays {
            processes.client = false;
        }
    }

    fn read_settings_yaml(&self) -> Option<String> {
        self.event("read");
        Some("token:leaving".into())
    }

    fn wait_for(&self, probe: &mut dyn FnMut() -> RiotResult<bool>, _timeout_ms: u64, _every_ms: u64) -> RiotResult<bool> {
        self.waits.set(self.waits.get() + 1);
        probe()
    }
}

fn quit_event() -> String {
    format!("POST {QUIT}")
}

#[test]
fn a_signed_in_riot_gets_the_normal_quit_after_the_games_close_and_is_forced_only_afterwards() {
    let f = closer();
    let (result, logs) = f.run();
    let closed = result.unwrap();
    assert!(closed.signed_in);
    assert_eq!(closed.riot_id, Some(RiotId::new("Leaving", "BR1")));
    assert_eq!(closed.yaml.as_deref(), Some("token:leaving"));
    assert_eq!(f.events(), ["authorization?", "identity?", "kill-games", &quit_event(), "kill-riot", "read"]);
    assert_eq!(logs, ["Riot Client quit normally"]);
}

#[test]
fn a_riot_whose_account_state_cannot_be_read_still_gets_the_normal_quit_without_a_riot_id() {
    let f = Closer { state: AccountState::Unknown, ..closer() };
    let (result, logs) = f.run();
    let closed = result.unwrap();
    assert!(!closed.signed_in);
    assert_eq!(closed.riot_id, None);
    assert_eq!(f.events(), ["authorization?", "kill-games", &quit_event(), "kill-riot", "read"]);
    assert_eq!(logs, ["Riot Client quit normally"]);
}

#[test]
fn a_riot_without_an_account_and_a_closed_riot_are_never_asked_to_quit() {
    let signed_out = Closer { state: AccountState::No, ..closer() };
    let (result, logs) = signed_out.run();
    assert!(!result.unwrap().signed_in);
    assert_eq!(signed_out.events(), ["authorization?", "kill-games", "kill-riot", "read"]);
    assert!(logs.is_empty());
    let closed = Closer { processes: RefCell::new(RunningGames { lol: true, ..RunningGames::default() }), ..closer() };
    closed.run().0.unwrap();
    assert_eq!(closed.events(), ["kill-games", "kill-riot", "read"]);
}

#[test]
fn a_quit_request_answered_with_an_error_or_a_refusal_is_forced_at_once_instead_of_waiting() {
    for quit in [Err(RiotError::new("offline")), Ok(Response::new(404, Value::Null))] {
        let f = Closer { quit, quits: false, ..closer() };
        let (result, logs) = f.run();
        result.unwrap();
        assert_eq!(logs, ["Riot Client did not accept the quit request, forcing"]);
        assert_eq!(f.waits.get(), 1);
        assert_eq!(f.events()[f.events().len() - 2..], ["kill-riot", "read"]);
    }
}

#[test]
fn a_riot_that_does_not_quit_is_forced_after_the_wait_and_one_that_will_not_close_stops_the_switch() {
    let slow = Closer { quits: false, ..closer() };
    let (result, logs) = slow.run();
    result.unwrap();
    assert_eq!(logs, ["Riot Client did not quit in 10 s, forcing"]);
    assert_eq!(slow.waits.get(), 2);
    let stuck = Closer { quits: false, stays: true, ..closer() };
    assert_eq!(stuck.run().0.unwrap_err().message, "Could not close the Riot Client");
    assert!(!stuck.events().contains(&"read".to_string()));
}

struct Starter {
    exe: Option<String>,
    running: RefCell<Vec<bool>>,
    events: RefCell<Vec<String>>,
}

fn starter(exe: Option<&str>, running: &[bool]) -> Starter {
    Starter { exe: exe.map(str::to_string), running: RefCell::new(running.to_vec()), events: RefCell::new(Vec::new()) }
}

impl RiotProbe for Starter {
    fn running_games(&self) -> RiotResult<RunningGames> {
        self.events.borrow_mut().push("processes?".into());
        let mut states = self.running.borrow_mut();
        let client = if states.len() > 1 { states.remove(0) } else { states[0] };
        Ok(RunningGames { client, ..RunningGames::default() })
    }
}

impl StartIo for Starter {
    fn detect_client_path(&self, override_path: &str) -> Option<String> {
        self.events.borrow_mut().push(format!("detect {override_path}"));
        self.exe.clone()
    }

    fn select(&self, exe: &str) {
        self.events.borrow_mut().push(format!("select {exe}"));
    }

    fn reveal(&self) -> RiotResult<()> {
        self.events.borrow_mut().push("reveal".into());
        Ok(())
    }

    fn launch_client(&self, exe: &str, visible: bool) -> RiotResult<()> {
        self.events.borrow_mut().push(format!("launch {exe} visible={visible}"));
        Ok(())
    }
}

#[test]
fn a_closed_riot_is_started_with_its_interface_after_its_window_is_brought_to_the_front() {
    let f = starter(Some("riot-client.exe"), &[false]);
    assert!(start_client(&f, "custom-client.exe").unwrap());
    assert_eq!(*f.events.borrow(), ["detect custom-client.exe", "processes?", "select riot-client.exe", "reveal", "processes?", "launch riot-client.exe visible=true"]);
}

#[test]
fn a_running_riot_or_one_that_starts_meanwhile_is_never_started_again_closed_or_restarted() {
    let running = starter(Some("riot-client.exe"), &[true]);
    assert!(!start_client(&running, "").unwrap());
    assert_eq!(*running.events.borrow(), ["detect ", "processes?"]);
    let racing = starter(Some("riot-client.exe"), &[false, true]);
    assert!(!start_client(&racing, "").unwrap());
    assert!(!racing.events.borrow().iter().any(|event| event.starts_with("launch")));
    let missing = starter(None, &[false]);
    assert!(start_client(&missing, "").unwrap_err().message.contains("Riot Client not found"));
    assert_eq!(*missing.events.borrow(), ["detect "]);
}

fn launcher(get: RiotResult<Response>, post: RiotResult<Response>) -> std::sync::Arc<FakeApi> {
    FakeApi::new(move |method, _, _| if method == "GET" { get.clone() } else { post.clone() })
}

fn launch(api: &FakeApi, game: &str) -> (LaunchAnswer, Vec<String>) {
    let logs = RefCell::new(Vec::new());
    let answer = request_launch(api, game, &|line| logs.borrow_mut().push(line.to_string())).unwrap();
    (answer, logs.into_inner())
}

#[test]
fn the_game_launch_log_keeps_only_the_http_status_the_eligibility_and_a_well_formed_error_code() {
    let opened = launcher(reply(200, json!(true)), reply(200, json!("synthetic-launch-id-1234")));
    let (answer, logs) = launch(&opened, "val");
    assert_eq!(answer, LaunchAnswer { status: 200, error_code: None });
    assert_eq!(
        opened.routes(),
        [crate::route("GET", "/product-launcher/v1/products/valorant/patchlines/live/eligibility"), crate::route("POST", "/product-launcher/v1/products/valorant/patchlines/live")]
    );
    assert_eq!(logs, ["launch eligibility: HTTP 200 eligible", "launch request: HTTP 200"]);

    let failure = json!({ "errorCode": "launch_failed_product_not_up_to_date", "httpStatus": 424, "implementationDetails": "C:/Users/example/synthetic-detail", "message": "synthetic message for example-user" });
    let mut missing = failure.clone();
    missing["errorCode"] = json!("RESOURCE_NOT_FOUND");
    let outdated = launcher(reply(404, missing), reply(424, failure));
    let (answer, logs) = launch(&outdated, "lol");
    assert_eq!(answer, LaunchAnswer { status: 424, error_code: Some("launch_failed_product_not_up_to_date".into()) });
    assert_eq!(logs, ["launch eligibility: HTTP 404 RESOURCE_NOT_FOUND", "launch request: HTTP 424 launch_failed_product_not_up_to_date"]);
    for detail in ["synthetic-detail", "example-user", "synthetic message", "Users"] {
        assert!(!logs.join(" ").contains(detail), "{detail}");
    }
}

#[test]
fn a_launch_without_an_answer_or_with_an_odd_error_code_logs_only_fixed_text() {
    let silent = launcher(Err(RiotError::new("connect ECONNREFUSED 127.0.0.1:51234 synthetic-token")), Err(RiotError::new("request failed with synthetic-token")));
    let (answer, logs) = launch(&silent, "lol");
    assert_eq!(answer, LaunchAnswer { status: 0, error_code: None });
    assert_eq!(logs, ["launch request: no answer from Riot"]);

    let odd = launcher(reply(200, json!(false)), reply(1200, json!({ "errorCode": "code with spaces and example-user" })));
    let (answer, logs) = launch(&odd, "tft");
    assert_eq!(answer, LaunchAnswer { status: 0, error_code: None });
    assert_eq!(logs, ["launch eligibility: HTTP 200 not eligible", "launch request: HTTP 0"]);
    assert!(odd.routes()[1].1.contains("/products/teamfighttactics/"));
}

#[test]
fn each_game_launches_its_own_riot_product() {
    for (game, product) in [("lol", "league_of_legends"), ("val", "valorant"), ("tft", "teamfighttactics"), ("2xko", "lion"), ("lor", "bacon")] {
        let api = launcher(reply(200, json!(true)), reply(200, json!(true)));
        launch(&api, game);
        assert_eq!(
            api.routes(),
            [crate::route("GET", &format!("/product-launcher/v1/products/{product}/patchlines/live/eligibility")), crate::route("POST", &format!("/product-launcher/v1/products/{product}/patchlines/live"))],
            "{game}"
        );
    }
}

#[test]
fn only_a_supported_game_can_be_launched() {
    let api = launcher(reply(200, json!(true)), reply(200, json!(true)));
    assert!(request_launch(api.as_ref(), "riot", &|_| {}).is_err());
    assert!(api.routes().is_empty());
}

#[test]
fn the_riot_client_is_found_by_the_chosen_path_then_the_riot_installs_then_the_default_folder() {
    let installs = r#"{"rc_default":"D:/Riot/RiotClientServices.exe","rc_live":"E:/Riot/RiotClientServices.exe"}"#;
    let reader = |text: &'static str| move |_: &Path| -> io::Result<String> { Ok(text.to_string()) };
    let exists_in = |present: &'static [&'static str]| move |file: &Path| present.iter().any(|candidate| Path::new(candidate) == file);
    assert_eq!(detect_client_path_with("C:/Custom/Riot.exe", &exists_in(&["C:/Custom/Riot.exe", "D:/Riot/RiotClientServices.exe"]), &reader(installs)).as_deref(), Some("C:/Custom/Riot.exe"));
    assert_eq!(detect_client_path_with("C:/Missing.exe", &exists_in(&["D:/Riot/RiotClientServices.exe"]), &reader(installs)).as_deref(), Some("D:/Riot/RiotClientServices.exe"));
    assert_eq!(detect_client_path_with("", &exists_in(&["E:/Riot/RiotClientServices.exe"]), &reader(installs)).as_deref(), Some("E:/Riot/RiotClientServices.exe"));
    assert_eq!(detect_client_path_with("", &exists_in(&[FALLBACK_CLIENT]), &reader("not json")).as_deref(), Some(FALLBACK_CLIENT));
    assert_eq!(detect_client_path_with("", &exists_in(&[]), &|_| Err(io::Error::from(io::ErrorKind::NotFound))), None);
}

fn names(list: &[&str]) -> HashSet<String> {
    list.iter().map(|name| name.to_lowercase()).collect()
}

#[test]
fn the_process_list_finds_games_riot_services_and_the_riot_window_by_name() {
    let processes = names(&["System Idle Process", "RiotClientServices.exe", "league of legends.exe"]);
    assert_eq!(running_games_in(&processes), RunningGames { lol: true, client: true, ..RunningGames::default() });
    let window = names(&["Riot Client.exe", "VALORANT-Win64-Shipping.exe"]);
    assert_eq!(running_games_in(&window), RunningGames { val: true, client: true, client_window: true, ..RunningGames::default() });
    assert_eq!(running_games_in(&names(&[])), RunningGames::default());
    let tft = running_games_in(&names(&["TFTClient-Win64-Shipping.exe"]));
    assert_eq!(tft, RunningGames { tft: true, ..RunningGames::default() });
    assert!(tft.game("tft") && tft.any_game() && !tft.game("lol"));
    let xko = running_games_in(&names(&["Lion-Win64-Shipping.exe"]));
    assert_eq!(xko, RunningGames { xko: true, ..RunningGames::default() });
    assert!(xko.game("2xko") && !xko.game("lor"));
    let lor = running_games_in(&names(&["LoR.exe"]));
    assert_eq!(lor, RunningGames { lor: true, ..RunningGames::default() });
    assert!(lor.game("lor") && lor.any_game());
    assert!(!RunningGames { client: true, client_window: true, ..RunningGames::default() }.any_game());
    assert!(!RunningGames { lol: true, ..RunningGames::default() }.game("riot"));
}

#[test]
fn closing_processes_forces_each_name_with_its_children() {
    assert_eq!(taskkill_args(&["A.exe", "B C.exe"]), ["/F", "/T", "/IM", "A.exe", "/IM", "B C.exe"]);
}

#[test]
fn the_watchers_react_only_to_the_riot_settings_and_the_riot_lockfile() {
    for name in ["riotgamesprivatesettings.yaml", "riotgamesprivatesettings.yaml.tmp"] {
        assert!(settings_change(name), "{name}");
    }
    assert!(!settings_change("eclipse-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.tmp"));
    assert!(lockfile_change("lockfile"));
    assert!(!lockfile_change("lockfile.old"));
}

#[test]
fn a_filled_form_reports_how_it_was_filled_and_the_box_and_failures_become_fixed_text() {
    assert_eq!(report_lines(FillReport { input: InputMethod::Automation, remember: Remember::On }), ["input:uia", "remember:on", "ok"]);
    assert_eq!(report_lines(FillReport { input: InputMethod::Keys, remember: Remember::Unknown }), ["input:keys", "remember:unknown", "ok"]);
    let cases = [
        (FillFailure::WindowNotFound, "The Riot Client window did not open"),
        (FillFailure::FormNotReady, "The Riot Client sign-in screen did not load. Finish signing in there"),
        (FillFailure::InputFailed, "Riot Client sign-in form failed: input-failed"),
        (FillFailure::InvalidCredentials, "Riot Client sign-in form failed: invalid-credentials"),
        (FillFailure::Failed, "Riot Client sign-in form failed: window-script-failed"),
    ];
    for (failure, message) in cases {
        assert_eq!(fill_error(failure).message, message);
    }
    assert!(fill_error(FillFailure::Cancelled).is_cancelled());
}

struct Form {
    answer: Result<FillReport, FillFailure>,
    calls: std::sync::Mutex<Vec<(String, String, bool)>>,
}

impl LoginForm for Form {
    fn fill(&self, username: &str, password: &str, remember: bool, _cancel: Option<&Cancel>) -> Result<FillReport, FillFailure> {
        self.calls.lock().unwrap().push((username.to_string(), password.to_string(), remember));
        self.answer
    }
}

fn form(answer: Result<FillReport, FillFailure>) -> Form {
    Form { answer, calls: Default::default() }
}

fn typed() -> TypeRequest {
    TypeRequest { username: "synthetic-user".into(), password: "synthetic \"pass\"".into(), remember: true }
}

#[test]
fn the_credentials_go_straight_to_the_native_form_and_a_cancelled_sign_in_never_touches_it() {
    let filled = form(Ok(FillReport { input: InputMethod::Automation, remember: Remember::Off }));
    let lines = RefCell::new(Vec::<String>::new());
    let log = |line: &str| lines.borrow_mut().push(line.to_string());
    assert_eq!(fill_login_form(&filled, &typed(), Some(RiotVersion([143, 0, 14, 5311])), None, &log).unwrap(), ["input:uia", "remember:off", "ok"]);
    assert_eq!(*lines.borrow(), ["Riot Client 143.0.14.5311"]);
    assert_eq!(*filled.calls.lock().unwrap(), [("synthetic-user".to_string(), "synthetic \"pass\"".to_string(), true)]);
    let gone = form(Err(FillFailure::Cancelled));
    assert!(fill_login_form(&gone, &typed(), None, None, &log).unwrap_err().is_cancelled());
    let cancel = Cancel::new();
    cancel.cancel();
    let never = form(Ok(FillReport { input: InputMethod::Keys, remember: Remember::On }));
    assert!(fill_login_form(&never, &typed(), None, Some(&cancel), &log).unwrap_err().is_cancelled());
    assert!(never.calls.lock().unwrap().is_empty());
    assert_eq!(lines.borrow().len(), 2);
}

#[test]
fn a_form_that_fails_on_a_riot_newer_than_the_last_tested_says_so_and_names_its_version() {
    let newer = Some(RiotVersion([144, 0, 2, 7]));
    let message = format!("{NEWER_RIOT}144");
    assert_eq!(fill_error_for(FillFailure::FormNotReady, newer).message, message);
    assert_eq!(fill_error_for(FillFailure::InputFailed, newer).message, message);
    assert_eq!(fill_error_for(FillFailure::FormNotReady, Some(RiotVersion([143, 0, 0, 0]))).message, "The Riot Client sign-in screen did not load. Finish signing in there");
    assert_eq!(fill_error_for(FillFailure::WindowNotFound, newer).message, "The Riot Client window did not open");
    assert!(fill_error_for(FillFailure::Cancelled, newer).is_cancelled());
    let failing = form(Err(FillFailure::FormNotReady));
    let lines = RefCell::new(Vec::<String>::new());
    let log = |line: &str| lines.borrow_mut().push(line.to_string());
    assert_eq!(fill_login_form(&failing, &typed(), newer, None, &log).unwrap_err().message, message);
    assert_eq!(*lines.borrow(), ["Riot Client 144.0.2.7 (newer than the last tested, 143)"]);
}

#[test]
fn the_riot_stay_signed_in_notice_is_marked_as_seen_before_the_form_so_it_never_covers_the_sign_in_button() {
    let lines = RefCell::new(Vec::<String>::new());
    let log = |line: &str| lines.borrow_mut().push(line.to_string());
    let fresh = FakeApi::new(|method, _, _| if method == "GET" { reply(404, Value::Null) } else { reply(204, Value::Null) });
    skip_stay_signed_in_notice(fresh.as_ref(), &log);
    assert_eq!(fresh.routes(), [route("GET", STAY_SIGNED_IN_NOTICE), route("POST", STAY_SIGNED_IN_NOTICE)]);
    assert_eq!(fresh.calls()[1].2, Some(Value::Bool(true)));
    let seen = FakeApi::new(|_, _, _| reply(200, Value::Bool(true)));
    skip_stay_signed_in_notice(seen.as_ref(), &log);
    assert_eq!(seen.routes(), [route("GET", STAY_SIGNED_IN_NOTICE)]);
    let refused = FakeApi::new(|method, _, _| if method == "GET" { reply(200, json!("")) } else { Err(RiotError::new("offline")) });
    skip_stay_signed_in_notice(refused.as_ref(), &log);
    assert_eq!(refused.routes().len(), 2);
    assert_eq!(*lines.borrow(), ["marked the Riot stay signed in notice as seen", "could not mark the Riot stay signed in notice as seen"]);
}
