use super::riot_authentication::{AuthKind, AuthOutcome, AuthState, ChallengeSource, Credentials};
use super::riot_state::{Look, RiotProbe, Services};
use super::{check, same_riot_id, AccountState, Cancel, Response, RiotError, RiotId, RiotResult};

pub const AUTOMATIC_CHECK_GRACE_MS: u64 = 12_000;
const TWO_FACTOR: &str = "Riot needs your 2FA code. Enter it in the Riot window";
const SECURITY_CHECK: &str = "Riot needs a security check. Complete it in the Riot window";
const UNFINISHED: &str = "Riot has not finished signing in. Check the Riot window in case it needs you";
pub const GAME_OPEN_TIMEOUT_MS: u64 = 180_000;
pub const GAME_UPDATE_TIMEOUT_MS: u64 = 1_200_000;
pub const RELAUNCH_INTERVAL_MS: u64 = 15_000;
pub const TERMS_GRACE_MS: u64 = 20_000;
pub const TERMS_RETRY_MS: u64 = 3_000;
pub const INPUT_METHODS: [&str; 2] = ["input:uia", "input:keys"];
pub const GAMES: [&str; 6] = ["lol", "tft", "val", "2xko", "lor", "riot"];
pub const STEPS: [&str; 5] = ["prepare", "sign_in", "verify", "launch", "done"];
pub const SLOW_GAME: &str = "The game is taking longer to open or is updating…";
pub const GAME_TERMS: &str = "Riot needs you to accept the game terms. Click Play in the Riot window to read and accept them";
pub const LAUNCH_REFUSED: &str = "Riot refused to open the game. Check the Riot window";
const TERMS_NOT_ACCEPTED: &str = "Accept the game terms in the Riot Client, then try Play again";

fn starting_status(game: &str) -> &'static str {
    match game {
        "val" => "Starting VALORANT in the background…",
        "tft" => "Starting Teamfight Tactics in the background…",
        "2xko" => "Starting 2XKO in the background…",
        "lor" => "Starting Legends of Runeterra in the background…",
        _ => "Starting League of Legends in the background…",
    }
}

fn updating_status(game: &str) -> &'static str {
    match game {
        "val" => "Waiting for the VALORANT update to finish…",
        "tft" => "Waiting for the Teamfight Tactics update to finish…",
        "2xko" => "Waiting for the 2XKO update to finish…",
        "lor" => "Waiting for the Legends of Runeterra update to finish…",
        _ => "Waiting for the League of Legends update to finish…",
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Closed {
    pub signed_in: bool,
    pub riot_id: Option<RiotId>,
    pub yaml: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchAnswer {
    pub status: u16,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeRequest {
    pub username: String,
    pub password: String,
    pub remember: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Step {
    #[default]
    Prepare,
    SignIn,
    Verify,
    Launch,
    Done,
}

impl Step {
    pub fn code(self) -> &'static str {
        match self {
            Step::Prepare => STEPS[0],
            Step::SignIn => STEPS[1],
            Step::Verify => STEPS[2],
            Step::Launch => STEPS[3],
            Step::Done => STEPS[4],
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StatusDetails {
    pub needs_attention: bool,
    pub native_client: bool,
    pub signed_in: bool,
    pub step: Step,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SignInOutcome {
    pub riot_id: Option<RiotId>,
    pub game_started: bool,
    pub client_opened: bool,
    pub session: Option<String>,
    pub used_saved_session: bool,
    pub reused_current_session: bool,
    pub session_rejected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub username: String,
    pub password: String,
    pub riot_id: RiotId,
}

pub trait SignInIo: RiotProbe {
    fn detect_client_path(&self, override_path: &str) -> Option<String>;
    fn close_everything(&self, log: &dyn Fn(&str)) -> RiotResult<Closed>;
    fn read_settings_yaml(&self) -> Option<String>;
    fn write_settings_yaml(&self, text: &str) -> RiotResult<bool>;
    fn has_persisted_login(&self, yaml: Option<&str>) -> bool;
    fn strip_persisted_login(&self, yaml: &str) -> String;
    fn same_riot_id(&self, a: Option<&RiotId>, b: &RiotId) -> bool {
        same_riot_id(a, Some(b))
    }
    fn read_authentication_state(&self) -> RiotResult<Option<AuthState>> {
        self.session_state()
    }
    fn is_authorized(&self) -> RiotResult<bool>;
    fn active_riot_id(&self) -> RiotResult<Option<RiotId>>;
    fn local_api(&self, method: &str, path: &str) -> RiotResult<Response>;
    fn launch_product(&self, exe: &str, visible: bool) -> RiotResult<()>;
    fn request_launch(&self, game: &str, log: &dyn Fn(&str)) -> RiotResult<LaunchAnswer>;
    fn type_credentials(&self, request: &TypeRequest, cancel: Option<&Cancel>, log: &dyn Fn(&str)) -> RiotResult<Vec<String>>;
    fn authenticate(&self, account: &Credentials, cancel: Option<&Cancel>, remember: bool) -> RiotResult<Option<AuthOutcome>>;
    fn reveal(&self) -> RiotResult<()>;
    fn game_window(&self, game: &str) -> RiotResult<bool>;
    fn close_client_window(&self) -> RiotResult<()>;
    fn open_visible_interface(&self, exe: &str, cancel: Option<&Cancel>, log: &dyn Fn(&str)) -> RiotResult<()>;
    fn close_games(&self) -> RiotResult<()>;
    fn now(&self) -> u64;
    fn sleep(&self, ms: u64);
}

pub struct SignInRequest<'a> {
    pub account: Account,
    pub session: &'a dyn Fn() -> RiotResult<Option<String>>,
    pub has_saved_session: bool,
    pub game: String,
    pub client_path: String,
    pub remember: bool,
    pub status: &'a dyn Fn(&str, StatusDetails),
    pub log: &'a dyn Fn(&str) -> RiotResult<()>,
    pub on_closed: &'a dyn Fn(&Closed) -> RiotResult<()>,
    pub on_rejected: &'a dyn Fn() -> RiotResult<()>,
    pub cancel: Option<&'a Cancel>,
}

fn outdated(launch: &LaunchAnswer) -> bool {
    launch.status == 424 && launch.error_code.as_deref() == Some("launch_failed_product_not_up_to_date")
}

fn refused(launch: &LaunchAnswer) -> bool {
    launch.status >= 400 && launch.status != 423 && !outdated(launch)
}

fn terms_missing(launch: &LaunchAnswer) -> bool {
    launch.error_code.as_deref() == Some("eula_not_accepted")
}

fn unfinished_login(state: Option<AuthState>) -> bool {
    matches!(state.map(|state| state.kind), Some(AuthKind::Multifactor) | Some(AuthKind::Error))
}

fn is_human_step(state: Option<AuthState>) -> bool {
    state.is_some_and(|state| state.kind == AuthKind::Multifactor || state.kind == AuthKind::Challenge || state.error == Some("captcha_not_allowed"))
}

fn pause(io: &dyn SignInIo, cancel: Option<&Cancel>, ms: u64) -> RiotResult<()> {
    check(cancel)?;
    let mut left = ms;
    while left > 0 {
        let step = left.min(100);
        io.sleep(step);
        check(cancel)?;
        left -= step;
    }
    Ok(())
}

fn wait<T>(io: &dyn SignInIo, cancel: Option<&Cancel>, mut probe: impl FnMut() -> RiotResult<Option<T>>, timeout_ms: u64, interval_ms: u64) -> RiotResult<Option<T>> {
    let end = io.now() + timeout_ms;
    while io.now() < end {
        check(cancel)?;
        let value = probe()?;
        check(cancel)?;
        if value.is_some() {
            return Ok(value);
        }
        pause(io, cancel, interval_ms)?;
    }
    Ok(None)
}

struct Flow<'a> {
    io: &'a dyn SignInIo,
    request: &'a SignInRequest<'a>,
    exe: String,
    result: SignInOutcome,
    manual_attention: bool,
    attention_text: String,
    native_form_used: bool,
    native_authentication_complete: bool,
    native_attention_pending: bool,
    native_attention_revealed: bool,
    confirmed_step: bool,
    automatic_check_until: u64,
    restored_yaml: Option<String>,
    interface_open: bool,
    logged_challenge: Option<Option<ChallengeSource>>,
}

impl<'a> Flow<'a> {
    fn check(&self) -> RiotResult<()> {
        check(self.request.cancel)
    }

    fn log(&self, line: &str) -> RiotResult<()> {
        (self.request.log)(line)
    }

    fn quiet_log(&self) -> impl Fn(&str) + 'a {
        let log = self.request.log;
        move |line: &str| {
            let _ = log(line);
        }
    }

    fn status(&self, text: &str, details: StatusDetails) {
        (self.request.status)(text, details)
    }

    fn step_status(&self, text: &str, step: Step) {
        self.status(text, StatusDetails { step, ..StatusDetails::default() })
    }

    fn signed_in_status(&self, text: &str, step: Step) {
        self.status(text, StatusDetails { signed_in: true, step, ..StatusDetails::default() })
    }

    fn attention(&mut self, text: &str) {
        self.manual_attention = true;
        if self.attention_text == text {
            return;
        }
        self.attention_text = text.to_string();
        self.status(text, StatusDetails { needs_attention: true, native_client: self.native_form_used, signed_in: false, step: Step::SignIn });
    }

    fn launch_refused(&mut self, launch: &LaunchAnswer) -> RiotResult<()> {
        let text = if terms_missing(launch) { GAME_TERMS } else { LAUNCH_REFUSED };
        self.manual_attention = true;
        self.attention_text = text.to_string();
        self.status(text, StatusDetails { needs_attention: true, native_client: false, signed_in: true, step: Step::Launch });
        if !self.interface_open {
            self.io.open_visible_interface(&self.exe, self.request.cancel, &self.quiet_log())?;
            self.interface_open = true;
        }
        self.io.reveal()
    }

    fn authentication_attention(&mut self, text: &str, reveal_native: bool) -> RiotResult<()> {
        self.attention(text);
        if !self.native_form_used {
            return Ok(());
        }
        self.native_attention_pending = true;
        if reveal_native && !self.native_attention_revealed {
            self.io.reveal()?;
            self.native_attention_revealed = true;
        }
        Ok(())
    }

    fn log_challenge(&mut self, source: Option<ChallengeSource>) -> RiotResult<()> {
        if self.logged_challenge == Some(source) {
            return Ok(());
        }
        self.logged_challenge = Some(source);
        let detail = source.map(ChallengeSource::describe).unwrap_or_else(|| "source unavailable".to_string());
        self.log(&format!("Riot reported an unfinished sign-in ({detail})"))
    }

    fn auth_state(&mut self) -> RiotResult<Option<AuthState>> {
        let state = self.io.read_authentication_state()?;
        match state {
            Some(current) if current.kind == AuthKind::Multifactor => {
                self.confirmed_step = true;
                self.authentication_attention(TWO_FACTOR, true)?;
            }
            Some(current) if current.error == Some("captcha_not_allowed") || current.kind == AuthKind::Challenge => {
                if self.io.now() < self.automatic_check_until {
                    return Ok(state);
                }
                if current.error == Some("captcha_not_allowed") {
                    self.confirmed_step = true;
                    self.authentication_attention(SECURITY_CHECK, true)?;
                } else {
                    self.log_challenge(current.source)?;
                    self.authentication_attention(UNFINISHED, true)?;
                }
            }
            Some(AuthState { error: Some(error), .. }) => {
                return Err(RiotError::new(match error {
                    "auth_failure" => "Wrong username or password".to_string(),
                    "rate_limited" => "Too many attempts, wait a few minutes".to_string(),
                    other => format!("Riot sign-in error: {other}"),
                }));
            }
            _ => {}
        }
        Ok(state)
    }

    fn await_authorization(&mut self, timeout_ms: u64) -> RiotResult<bool> {
        let (io, cancel) = (self.io, self.request.cancel);
        let began = io.now();
        let mut stalled = false;
        let found = wait(
            io,
            cancel,
            || {
                let state = self.auth_state()?;
                let authorized = io.is_authorized()?;
                if authorized && !is_human_step(state) {
                    return Ok(Some(()));
                }
                if !self.manual_attention && !stalled && io.now() - began > 35_000 {
                    stalled = true;
                    self.authentication_attention("Sign-in is taking longer. Check the Riot window in case it needs you", false)?;
                }
                Ok(None)
            },
            timeout_ms,
            700,
        )?;
        Ok(found.is_some())
    }

    fn keep_session(&mut self) -> RiotResult<()> {
        let (io, cancel) = (self.io, self.request.cancel);
        let restored = self.restored_yaml.clone();
        self.result.session = if self.request.remember {
            wait(
                io,
                cancel,
                || {
                    let yaml = io.read_settings_yaml();
                    Ok(yaml.filter(|yaml| io.has_persisted_login(Some(yaml)) && Some(yaml) != restored.as_ref()))
                },
                6000,
                500,
            )?
        } else {
            None
        };
        let line = if !self.request.remember {
            "stay signed in is off; no session was kept"
        } else if self.result.session.is_some() {
            "session available for next launch"
        } else if self.restored_yaml.is_some() {
            "Riot has not renewed the restored session yet"
        } else {
            "no remembered login was written"
        };
        self.log(line)?;
        self.check()
    }

    fn leave_signed_in_account(&mut self) -> RiotResult<()> {
        let closed = self.io.close_everything(&self.quiet_log())?;
        self.check()?;
        (self.request.on_closed)(&closed)?;
        self.check()?;
        if let Some(yaml) = closed.yaml.as_deref().filter(|yaml| self.io.has_persisted_login(Some(yaml))) {
            self.io.write_settings_yaml(&self.io.strip_persisted_login(yaml))?;
        }
        self.log("closed the other signed-in account without signing it out")
    }

    fn start_services(&mut self) -> RiotResult<()> {
        self.step_status("Starting Riot services in the background…", Step::Prepare);
        self.check()?;
        self.io.launch_product(&self.exe, false)?;
        let io = self.io;
        if wait(io, self.request.cancel, || io.session_state(), 45_000, 500)?.is_none() {
            return Err(RiotError::new("The Riot Client did not start. Open it to see what happened"));
        }
        Ok(())
    }

    fn open_visible_form(&mut self) -> RiotResult<()> {
        let io = self.io;
        if io.session_state()?.is_none() {
            io.launch_product(&self.exe, true)?;
            if wait(io, self.request.cancel, || io.session_state(), 45_000, 500)?.is_none() {
                return Err(RiotError::new("The Riot Client did not start"));
            }
        }
        io.open_visible_interface(&self.exe, self.request.cancel, &self.quiet_log())?;
        self.interface_open = true;
        Ok(())
    }

    fn prepare_visible_login(&mut self, games_open: bool, signed_in: bool, step: Step) -> RiotResult<()> {
        self.step_status("Preparing the Riot Client sign-in…", step);
        if !signed_in && self.io.is_authorized()? {
            self.leave_signed_in_account()?;
        } else if games_open {
            self.io.close_games()?;
        }
        self.open_visible_form()?;
        if signed_in {
            return Ok(());
        }
        let mut current = self.io.authorization()?;
        self.check()?;
        if current == AccountState::Yes {
            self.leave_signed_in_account()?;
            self.open_visible_form()?;
            current = self.io.authorization()?;
            self.check()?;
            if current == AccountState::Yes {
                return Err(RiotError::new("Could not sign out the previous account"));
            }
        }
        if current == AccountState::No && unfinished_login(self.io.session_state()?) {
            self.check()?;
            self.io.local_api("DELETE", "/rso-auth/v1/session")?;
            self.log("cleared an unfinished Riot sign-in")?;
        }
        Ok(())
    }

    fn launch_game(&mut self) -> RiotResult<()> {
        let request = self.request;
        let game = request.game.as_str();
        self.signed_in_status(starting_status(game), Step::Launch);
        let io = self.io;
        let is_game_ready = || -> RiotResult<bool> {
            Ok(io.running_games()?.game(game) && io.game_window(game)?)
        };
        let mut ready = is_game_ready()?;
        self.check()?;
        if !ready {
            let quiet = self.quiet_log();
            let mut launch = io.request_launch(game, &quiet)?;
            let mut requested_at = io.now();
            let mut updating = false;
            let mut notified = false;
            let mut asked = false;
            let mut terms = false;
            let mut retried_at = requested_at;
            let began = io.now();
            loop {
                if !asked && refused(&launch) && terms_missing(&launch) && io.now() - began < TERMS_GRACE_MS {
                    terms = true;
                    if io.now() - retried_at >= TERMS_RETRY_MS {
                        launch = io.request_launch(game, &quiet)?;
                        retried_at = io.now();
                        if !refused(&launch) {
                            requested_at = retried_at;
                        }
                        self.check()?;
                    }
                } else if !asked && refused(&launch) {
                    asked = true;
                    terms = terms_missing(&launch);
                    self.launch_refused(&launch)?;
                    self.check()?;
                }
                let limit = if outdated(&launch) { began + GAME_UPDATE_TIMEOUT_MS } else { requested_at + GAME_OPEN_TIMEOUT_MS };
                if ready || io.now() >= limit {
                    break;
                }
                self.check()?;
                ready = is_game_ready()?;
                self.check()?;
                if ready {
                    break;
                }
                if outdated(&launch) {
                    if !updating {
                        updating = true;
                        self.signed_in_status(updating_status(game), Step::Launch);
                    }
                    if io.now() - requested_at >= RELAUNCH_INTERVAL_MS {
                        launch = io.request_launch(game, &quiet)?;
                        requested_at = io.now();
                        self.check()?;
                    }
                } else if !notified && !asked && !refused(&launch) && io.now() - requested_at > 40_000 {
                    notified = true;
                    self.signed_in_status(SLOW_GAME, Step::Launch);
                }
                pause(io, request.cancel, 1000)?;
            }
            if !ready && outdated(&launch) {
                return Err(RiotError::new("The game update did not finish in time. Open Riot Client to check the update"));
            }
            if !ready && terms {
                return Err(RiotError::new(TERMS_NOT_ACCEPTED));
            }
        }
        if !ready {
            return Err(RiotError::new("The game did not open. Open the Riot Client to check updates or the installation"));
        }
        self.check()?;
        self.signed_in_status("Game opened", Step::Done);
        self.keep_session()?;
        io.close_client_window()?;
        self.result.game_started = true;
        Ok(())
    }

    fn run(&mut self) -> RiotResult<()> {
        let (io, request) = (self.io, self.request);
        let account = &request.account;
        self.check()?;
        io.reveal()?;
        self.check()?;
        let mut signed_in = false;
        let mut restoring = false;
        let at_start = Look::new(io);
        let games_open = at_start.in_game()?;
        self.check()?;
        if !games_open {
            let ready = at_start.services()? == Services::Ready;
            self.check()?;
            if ready && at_start.signed_in()? {
                let identity = wait(io, request.cancel, || io.active_riot_id(), 8000, 500)?;
                if io.same_riot_id(identity.as_ref(), &account.riot_id) {
                    signed_in = true;
                    self.result.reused_current_session = true;
                    self.log("reused the verified current account")?;
                }
            }
            self.check()?;
        }

        let background_restore = request.remember && request.has_saved_session && !signed_in;
        if !background_restore {
            self.prepare_visible_login(games_open, signed_in, Step::Prepare)?;
        } else {
            self.step_status("Closing Riot Client in the background…", Step::Prepare);
            let closed = io.close_everything(&self.quiet_log())?;
            self.check()?;
            (request.on_closed)(&closed)?;
            self.check()?;
            let saved = (request.session)()?;
            self.check()?;
            restoring = io.has_persisted_login(saved.as_deref());
            if let (true, Some(saved)) = (restoring, saved) {
                io.write_settings_yaml(&saved)?;
                self.restored_yaml = Some(saved);
                self.log("restored the saved session")?;
            } else if let Some(yaml) = closed.yaml.as_deref().filter(|yaml| io.has_persisted_login(Some(yaml))) {
                io.write_settings_yaml(&io.strip_persisted_login(yaml))?;
                self.log("cleared the previous remembered login")?;
            }
            self.start_services()?;
        }

        if restoring {
            self.step_status("Signing in with the saved session…", Step::SignIn);
            signed_in = wait(io, request.cancel, || Ok(io.is_authorized()?.then_some(())), 15_000, 500)?.is_some();
            if signed_in {
                let identity = wait(io, request.cancel, || io.active_riot_id(), 8000, 500)?;
                if !io.same_riot_id(identity.as_ref(), &account.riot_id) {
                    self.result.session_rejected = true;
                    self.log("saved session identity did not match the selected account")?;
                    (request.on_rejected)()?;
                    self.check()?;
                    signed_in = false;
                } else {
                    self.result.used_saved_session = true;
                    self.log("signed in with the saved session")?;
                }
            } else {
                self.result.session_rejected = true;
                self.log("saved session is no longer usable")?;
            }
        }
        if background_restore && !signed_in {
            self.prepare_visible_login(false, false, Step::SignIn)?;
        }

        if !signed_in {
            self.step_status("Signing in in the background…", Step::SignIn);
            let credentials = Credentials { username: &account.username, password: &account.password };
            let direct = io.authenticate(&credentials, request.cancel, request.remember)?;
            self.check()?;
            let direct = direct.ok_or_else(|| RiotError::new("The Riot background sign-in service returned an invalid response"))?;
            if !direct.supported || direct.requires_native_form {
                self.check()?;
                self.native_form_used = true;
                self.status("Signing in…", StatusDetails { native_client: true, step: Step::SignIn, ..StatusDetails::default() });
                let typed = TypeRequest { username: account.username.clone(), password: account.password.clone(), remember: request.remember };
                let lines = io.type_credentials(&typed, request.cancel, &self.quiet_log())?;
                self.automatic_check_until = io.now() + AUTOMATIC_CHECK_GRACE_MS;
                let mut summary: Vec<&str> = lines.iter().map(String::as_str).find(|line| INPUT_METHODS.contains(line)).into_iter().collect();
                let remembered: Vec<&str> = lines.iter().map(String::as_str).filter(|line| line.starts_with("remember:")).collect();
                if remembered.is_empty() { summary.push("remember state unavailable") } else { summary.extend(remembered) }
                self.log(&format!("credentials entered ({})", summary.join(", ")))?;
            } else {
                self.log("sign-in requested through the Riot background service")?;
                if direct.needs_attention {
                    let text = match direct.reason {
                        Some("multifactor") => TWO_FACTOR,
                        Some("security_check") => SECURITY_CHECK,
                        _ => UNFINISHED,
                    };
                    self.confirmed_step = text != UNFINISHED;
                    self.attention(text);
                }
            }
            self.check()?;
            if !self.await_authorization(180_000)? {
                return Err(RiotError::new(if self.native_attention_pending && self.confirmed_step {
                    "Sign-in timed out waiting for your attention. Complete the pending step in Riot Client, then try Play again"
                } else {
                    "Sign-in timed out. Open the Riot Client to see what happened"
                }));
            }
        }

        let state = self.auth_state()?;
        if is_human_step(state) && !self.await_authorization(180_000)? {
            return Err(RiotError::new(if self.confirmed_step {
                "Riot security check timed out. Open the Riot Client to continue"
            } else {
                "Sign-in timed out. Open the Riot Client to see what happened"
            }));
        }

        self.native_authentication_complete = true;
        self.native_attention_pending = false;
        self.manual_attention = false;
        self.signed_in_status("Signed in. Preparing the game…", Step::Verify);
        self.result.riot_id = wait(io, request.cancel, || io.active_riot_id(), 8000, 500)?;
        let Some(riot_id) = self.result.riot_id.clone() else {
            return Err(RiotError::new("Could not verify the signed-in account"));
        };
        if !io.same_riot_id(Some(&riot_id), &account.riot_id) {
            return Err(RiotError::new("The signed-in Riot ID does not match the selected account. Check the Riot ID saved in this app"));
        }
        if request.game == "riot" {
            self.check()?;
            self.keep_session()?;
            if !self.interface_open {
                io.open_visible_interface(&self.exe, request.cancel, &self.quiet_log())?;
            }
            io.reveal()?;
            self.result.client_opened = true;
            self.signed_in_status("Riot Client opened", Step::Done);
            return Ok(());
        }
        self.launch_game()
    }

    fn recover(&mut self, error: &mut RiotError) {
        let cancelled = self.request.cancel.is_some_and(Cancel::is_cancelled);
        if self.native_form_used && !self.native_authentication_complete && !self.native_attention_pending && !cancelled && self.auth_state().is_err() {
            let _ = self.log("could not recover the native sign-in verification window");
        }
        if self.native_attention_pending && !cancelled {
            error.needs_attention = true;
            error.native_client = true;
        }
        error.session_rejected = self.result.session_rejected;
    }
}

pub fn sign_in(io: &dyn SignInIo, request: &SignInRequest) -> RiotResult<SignInOutcome> {
    if !GAMES.contains(&request.game.as_str()) {
        return Err(RiotError::new("Select a supported game"));
    }
    let exe = io.detect_client_path(&request.client_path).ok_or_else(|| RiotError::new("Riot Client not found. Set its path in Settings"))?;
    let mut flow = Flow {
        io,
        request,
        exe,
        result: SignInOutcome::default(),
        manual_attention: false,
        attention_text: String::new(),
        native_form_used: false,
        native_authentication_complete: false,
        native_attention_pending: false,
        native_attention_revealed: false,
        confirmed_step: false,
        automatic_check_until: 0,
        restored_yaml: None,
        interface_open: false,
        logged_challenge: None,
    };
    match flow.run() {
        Ok(()) => Ok(flow.result),
        Err(mut error) => {
            flow.recover(&mut error);
            Err(error)
        }
    }
}
