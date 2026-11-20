use std::cell::{Cell, RefCell};
use std::rc::Rc;

use eclipse::riot::riot_authentication::{AuthKind, AuthOutcome, AuthState, Credentials};
use eclipse::riot::riot_state::RiotProbe;
use eclipse::riot::sign_in_flow::{sign_in, Account, Closed, LaunchAnswer, SignInIo, SignInOutcome, SignInRequest, StatusDetails, TypeRequest};
use eclipse::riot::{AccountState, Cancel, Response, RiotError, RiotId, RiotResult, RunningGames};
use serde_json::Value;

type Hook<R> = Box<dyn Fn(&Fake) -> R>;

struct Opts {
    game: &'static str,
    session: Hook<RiotResult<Option<String>>>,
    has_saved_session: bool,
    remember: bool,
    log: Box<dyn Fn(&Fake, &str) -> RiotResult<()>>,
    on_closed: Box<dyn Fn(&Fake, &Closed) -> RiotResult<()>>,
    on_rejected: Hook<RiotResult<()>>,
    on_status: Box<dyn Fn(&Fake, &str, StatusDetails)>,
}

struct Fake {
    clock: Cell<u64>,
    events: RefCell<Vec<String>>,
    statuses: RefCell<Vec<(String, StatusDetails)>>,
    logs: RefCell<Vec<String>>,
    typed: RefCell<Vec<TypeRequest>>,
    authorized: Cell<bool>,
    game_window: Cell<bool>,
    identity: RefCell<Option<RiotId>>,
    processes: Cell<RunningGames>,
    launched: Cell<bool>,
    cancel: Cancel,
    opts: Opts,
    on_running_games: Hook<RiotResult<RunningGames>>,
    on_authorization: Hook<RiotResult<AccountState>>,
    on_session_state: Hook<RiotResult<Option<AuthState>>>,
    on_read_authentication_state: Hook<RiotResult<Option<AuthState>>>,
    on_is_authorized: Hook<RiotResult<bool>>,
    on_active_riot_id: Hook<RiotResult<Option<RiotId>>>,
    on_close_everything: Hook<RiotResult<Closed>>,
    on_read_settings_yaml: Hook<Option<String>>,
    on_local_api: Box<dyn Fn(&Fake, &str, &str) -> RiotResult<Response>>,
    on_launch_product: Box<dyn Fn(&Fake, bool) -> RiotResult<()>>,
    on_request_launch: Box<dyn Fn(&Fake, &str) -> RiotResult<LaunchAnswer>>,
    on_type_credentials: Box<dyn Fn(&Fake, &TypeRequest, &dyn Fn(&str)) -> RiotResult<Vec<String>>>,
    on_authenticate: Box<dyn Fn(&Fake, bool) -> RiotResult<Option<AuthOutcome>>>,
    on_reveal: Hook<RiotResult<()>>,
    on_game_window: Hook<RiotResult<bool>>,
    on_open_visible_interface: Hook<RiotResult<()>>,
    on_sleep: Box<dyn Fn(&Fake, u64)>,
}

fn example() -> RiotId {
    RiotId::new("Example", "BR1")
}

fn state(kind: AuthKind) -> RiotResult<Option<AuthState>> {
    Ok(Some(AuthState::of(kind)))
}

fn yes_or(authorized: bool, otherwise: AccountState) -> AccountState {
    if authorized {
        AccountState::Yes
    } else {
        otherwise
    }
}

fn fixture() -> Fake {
    Fake {
        clock: Cell::new(0),
        events: RefCell::new(Vec::new()),
        statuses: RefCell::new(Vec::new()),
        logs: RefCell::new(Vec::new()),
        typed: RefCell::new(Vec::new()),
        authorized: Cell::new(true),
        game_window: Cell::new(true),
        identity: RefCell::new(Some(example())),
        processes: Cell::new(RunningGames::default()),
        launched: Cell::new(false),
        cancel: Cancel::new(),
        opts: Opts {
            game: "lol",
            session: Box::new(|_: &Fake| Ok(Some("token:saved".into()))),
            has_saved_session: true,
            remember: true,
            log: Box::new(|_: &Fake, _: &str| Ok(())),
            on_closed: Box::new(|_: &Fake, _: &Closed| Ok(())),
            on_rejected: Box::new(|_: &Fake| Ok(())),
            on_status: Box::new(|_: &Fake, _: &str, _: StatusDetails| {}),
        },
        on_running_games: Box::new(|_: &Fake| Ok(RunningGames { lol: true, val: true, ..RunningGames::default() })),
        on_authorization: Box::new(|f: &Fake| Ok(yes_or((f.on_is_authorized)(f)?, AccountState::Unknown))),
        on_session_state: Box::new(|f: &Fake| state(if f.authorized.get() { AuthKind::Authenticated } else { AuthKind::Auth })),
        on_read_authentication_state: Box::new(|f: &Fake| (f.on_session_state)(f)),
        on_is_authorized: Box::new(|f: &Fake| Ok(f.authorized.get())),
        on_active_riot_id: Box::new(|f: &Fake| Ok(f.identity.borrow().clone())),
        on_close_everything: Box::new(|f: &Fake| {
            f.event("closed");
            Ok(Closed::default())
        }),
        on_read_settings_yaml: Box::new(|_: &Fake| Some("token:current".into())),
        on_local_api: Box::new(|f: &Fake, method: &str, path: &str| {
            f.event(format!("{method} {path}"));
            f.authorized.set(false);
            Ok(Response::new(200, Value::Null))
        }),
        on_launch_product: Box::new(|f: &Fake, visible: bool| {
            f.event(if visible { "launch visible" } else { "launch" });
            Ok(())
        }),
        on_request_launch: Box::new(|f: &Fake, _: &str| {
            f.event("request-launch");
            Ok(LaunchAnswer::default())
        }),
        on_type_credentials: Box::new(|f: &Fake, request: &TypeRequest, _: &dyn Fn(&str)| {
            f.event("type");
            f.typed.borrow_mut().push(request.clone());
            f.authorized.set(true);
            Ok(vec!["remember:on".into()])
        }),
        on_authenticate: Box::new(|_: &Fake, _: bool| Ok(Some(AuthOutcome::unsupported()))),
        on_reveal: Box::new(|f: &Fake| {
            f.event("reveal");
            Ok(())
        }),
        on_game_window: Box::new(|f: &Fake| {
            f.event("game-window");
            Ok(f.game_window.get())
        }),
        on_open_visible_interface: Box::new(|f: &Fake| {
            f.event("visible-interface");
            Ok(())
        }),
        on_sleep: Box::new(|f: &Fake, ms: u64| f.clock.set(f.clock.get() + ms)),
    }
}

fn direct() -> Fake {
    let mut f = fixture();
    f.authorized.set(false);
    f.processes.set(RunningGames { client: true, ..RunningGames::default() });
    f.opts.has_saved_session = false;
    f.on_running_games = Box::new(|f: &Fake| Ok(f.processes.get()));
    f.on_active_riot_id = Box::new(|f: &Fake| {
        f.event("identity");
        Ok(f.identity.borrow().clone())
    });
    f.on_authenticate = Box::new(|f: &Fake, _: bool| {
        f.event("authenticate");
        f.authorized.set(true);
        Ok(Some(AuthOutcome::done()))
    });
    f.on_request_launch = Box::new(|f: &Fake, game: &str| {
        f.event("request-launch");
        f.start_game(game);
        Ok(LaunchAnswer::default())
    });
    f
}

fn restore() -> Fake {
    let mut f = fixture();
    f.authorized.set(false);
    f.on_running_games = Box::new(|f: &Fake| Ok(RunningGames { lol: f.launched.get(), ..RunningGames::default() }));
    f.on_request_launch = Box::new(|f: &Fake, _: &str| {
        f.event("request-launch");
        f.launched.set(true);
        Ok(LaunchAnswer { status: 200, error_code: None })
    });
    f
}

fn authorizing_launch(f: &Fake, visible: bool) -> RiotResult<()> {
    f.event(if visible { "launch visible" } else { "launch" });
    f.authorized.set(true);
    Ok(())
}

fn type_as_example(f: &Fake, _: &TypeRequest, _: &dyn Fn(&str)) -> RiotResult<Vec<String>> {
    f.event("type");
    *f.identity.borrow_mut() = Some(example());
    f.authorized.set(true);
    Ok(vec!["remember:on".into()])
}

fn native_form(_: &Fake, _: bool) -> RiotResult<Option<AuthOutcome>> {
    Ok(Some(AuthOutcome::native_form()))
}

fn unsupported(_: &Fake, _: bool) -> RiotResult<Option<AuthOutcome>> {
    Ok(Some(AuthOutcome::unsupported()))
}

impl Fake {
    fn event(&self, event: impl Into<String>) {
        self.events.borrow_mut().push(event.into());
    }

    fn events(&self) -> Vec<String> {
        self.events.borrow().clone()
    }

    fn matches(event: &str, name: &str) -> bool {
        event == name || event.starts_with(&format!("{name} "))
    }

    fn has(&self, name: &str) -> bool {
        self.first(name).is_some()
    }

    fn count(&self, name: &str) -> usize {
        self.events.borrow().iter().filter(|event| Self::matches(event, name)).count()
    }

    fn first(&self, name: &str) -> Option<usize> {
        self.events.borrow().iter().position(|event| Self::matches(event, name))
    }

    fn last(&self, name: &str) -> Option<usize> {
        self.events.borrow().iter().rposition(|event| Self::matches(event, name))
    }

    fn at(&self, name: &str) -> usize {
        self.first(name).unwrap_or_else(|| panic!("no {name} in {:?}", self.events()))
    }

    fn last_event(&self) -> String {
        self.events.borrow().last().cloned().unwrap_or_default()
    }

    fn reveals(&self) -> usize {
        self.count("reveal")
    }

    fn elapsed(&self) -> u64 {
        self.clock.get()
    }

    fn statuses(&self) -> Vec<(String, StatusDetails)> {
        self.statuses.borrow().clone()
    }

    fn attention(&self) -> Vec<String> {
        self.statuses().into_iter().filter(|(_, details)| details.needs_attention).map(|(text, _)| text).collect()
    }

    fn logs(&self) -> Vec<String> {
        self.logs.borrow().clone()
    }

    fn start_game(&self, game: &str) {
        let mut processes = self.processes.get();
        match game {
            "val" => processes.val = true,
            "tft" => processes.tft = true,
            "2xko" => processes.xko = true,
            "lor" => processes.lor = true,
            _ => processes.lol = true,
        }
        self.processes.set(processes);
    }

    fn run(&self) -> RiotResult<SignInOutcome> {
        let session = || (self.opts.session)(self);
        let status = |text: &str, details: StatusDetails| {
            self.statuses.borrow_mut().push((text.to_string(), details));
            (self.opts.on_status)(self, text, details);
        };
        let log = |line: &str| {
            self.logs.borrow_mut().push(line.to_string());
            (self.opts.log)(self, line)
        };
        let on_closed = |closed: &Closed| (self.opts.on_closed)(self, closed);
        let on_rejected = || (self.opts.on_rejected)(self);
        let request = SignInRequest {
            account: Account { username: "example-user".into(), password: "example-password".into(), riot_id: example() },
            session: &session,
            has_saved_session: self.opts.has_saved_session,
            game: self.opts.game.to_string(),
            client_path: String::new(),
            remember: self.opts.remember,
            status: &status,
            log: &log,
            on_closed: &on_closed,
            on_rejected: &on_rejected,
            cancel: Some(&self.cancel),
        };
        sign_in(self, &request)
    }
}

impl RiotProbe for Fake {
    fn running_games(&self) -> RiotResult<RunningGames> {
        (self.on_running_games)(self)
    }

    fn authorization(&self) -> RiotResult<AccountState> {
        (self.on_authorization)(self)
    }

    fn session_state(&self) -> RiotResult<Option<AuthState>> {
        (self.on_session_state)(self)
    }
}

impl SignInIo for Fake {
    fn detect_client_path(&self, _override_path: &str) -> Option<String> {
        Some("C:/Example/RiotClientServices.exe".into())
    }

    fn close_everything(&self, _log: &dyn Fn(&str)) -> RiotResult<Closed> {
        (self.on_close_everything)(self)
    }

    fn read_settings_yaml(&self) -> Option<String> {
        (self.on_read_settings_yaml)(self)
    }

    fn write_settings_yaml(&self, text: &str) -> RiotResult<bool> {
        self.event(format!("write {text}"));
        Ok(true)
    }

    fn has_persisted_login(&self, yaml: Option<&str>) -> bool {
        yaml.is_some_and(|yaml| yaml.starts_with("token:"))
    }

    fn strip_persisted_login(&self, _yaml: &str) -> String {
        "stripped".into()
    }

    fn read_authentication_state(&self) -> RiotResult<Option<AuthState>> {
        (self.on_read_authentication_state)(self)
    }

    fn is_authorized(&self) -> RiotResult<bool> {
        (self.on_is_authorized)(self)
    }

    fn active_riot_id(&self) -> RiotResult<Option<RiotId>> {
        (self.on_active_riot_id)(self)
    }

    fn local_api(&self, method: &str, path: &str) -> RiotResult<Response> {
        (self.on_local_api)(self, method, path)
    }

    fn launch_product(&self, _exe: &str, visible: bool) -> RiotResult<()> {
        (self.on_launch_product)(self, visible)
    }

    fn request_launch(&self, game: &str, _log: &dyn Fn(&str)) -> RiotResult<LaunchAnswer> {
        (self.on_request_launch)(self, game)
    }

    fn type_credentials(&self, request: &TypeRequest, _cancel: Option<&Cancel>, log: &dyn Fn(&str)) -> RiotResult<Vec<String>> {
        (self.on_type_credentials)(self, request, log)
    }

    fn authenticate(&self, _account: &Credentials, _cancel: Option<&Cancel>, remember: bool) -> RiotResult<Option<AuthOutcome>> {
        (self.on_authenticate)(self, remember)
    }

    fn reveal(&self) -> RiotResult<()> {
        (self.on_reveal)(self)
    }

    fn game_window(&self, _game: &str) -> RiotResult<bool> {
        (self.on_game_window)(self)
    }

    fn close_client_window(&self) -> RiotResult<()> {
        self.event("close-client-window");
        Ok(())
    }

    fn open_visible_interface(&self, _exe: &str, _cancel: Option<&Cancel>, _log: &dyn Fn(&str)) -> RiotResult<()> {
        (self.on_open_visible_interface)(self)
    }

    fn close_games(&self) -> RiotResult<()> {
        self.event("close-games");
        Ok(())
    }

    fn now(&self) -> u64 {
        self.clock.get()
    }

    fn sleep(&self, ms: u64) {
        (self.on_sleep)(self, ms)
    }
}

fn error_of(result: RiotResult<SignInOutcome>) -> RiotError {
    result.expect_err("the sign-in should have failed")
}

#[test]
fn the_login_keeps_the_official_interface_open_and_closes_its_window_only_after_the_game_is_ready() {
    let mut f = fixture();
    f.opts.has_saved_session = false;
    f.authorized.set(false);
    f.on_running_games = Box::new(|f: &Fake| Ok(RunningGames { lol: f.authorized.get(), ..RunningGames::default() }));
    assert!(f.run().unwrap().game_started);
    assert!(!f.has("closed"));
    assert!(!f.has("write"));
    assert!(f.at("visible-interface") < f.at("type"));
    assert_eq!(f.last_event(), "close-client-window");
    assert!(f.at("close-client-window") > f.at("game-window"));
}

#[test]
fn login_errors_keep_riot_open_without_requesting_or_closing_a_game() {
    let mut f = fixture();
    f.opts.has_saved_session = false;
    f.authorized.set(false);
    f.on_running_games = Box::new(|_: &Fake| Ok(RunningGames::default()));
    f.on_authenticate = Box::new(|_: &Fake, _: bool| Err(RiotError::new("Wrong username or password")));
    assert_eq!(error_of(f.run()).message, "Wrong username or password");
    for event in ["closed", "request-launch", "close-client-window"] {
        assert!(!f.has(event), "{event}");
    }
}

#[test]
fn the_sign_in_never_hides_the_riot_and_starts_by_bringing_it_to_the_front() {
    let f = fixture();
    assert!(f.run().unwrap().game_started);
    assert_eq!(f.events()[0], "reveal");
    assert!(f.has("game-window") && f.has("close-client-window"));
}

#[test]
fn loads_the_latest_remembered_session_only_after_the_leaving_session_is_persisted() {
    let mut f = fixture();
    let saved = Rc::new(RefCell::new("token:old".to_string()));
    let updated = saved.clone();
    f.opts.on_closed = Box::new(move |f: &Fake, _: &Closed| {
        f.event("persist-leaving");
        *updated.borrow_mut() = "token:updated".into();
        Ok(())
    });
    let current = saved.clone();
    f.opts.session = Box::new(move |f: &Fake| {
        f.event("load-session");
        Ok(Some(current.borrow().clone()))
    });
    assert!(f.run().unwrap().used_saved_session);
    assert!(f.at("persist-leaving") > f.at("closed"));
    assert!(f.at("load-session") > f.at("persist-leaving"));
    assert_eq!(f.events()[f.at("write")], "write token:updated");
    assert!(!f.has("type"));
}

#[test]
fn a_riot_window_that_cannot_be_shown_stops_the_login_before_touching_riot() {
    let mut f = fixture();
    f.on_reveal = Box::new(|_: &Fake| Err(RiotError::new("window unavailable")));
    assert_eq!(error_of(f.run()).message, "window unavailable");
    for event in ["launch", "closed", "visible-interface", "close-games"] {
        assert!(!f.has(event), "{event}");
    }
}

#[test]
fn the_riot_window_closes_only_after_a_real_game_window_is_ready() {
    let mut f = fixture();
    f.on_game_window = Box::new(|f: &Fake| {
        let ready = f.elapsed() >= 5000;
        f.event(if ready { "game-ready" } else { "game-not-ready" });
        Ok(ready)
    });
    assert!(f.run().unwrap().game_started);
    assert!(f.elapsed() >= 5000);
    assert!(f.last("close-client-window") > f.first("game-ready"));
    assert_eq!(f.count("close-client-window"), 1);
    assert!(f.has("request-launch"));
}

#[test]
fn tft_2xko_and_runeterra_wait_for_their_own_game_and_announce_it_by_name() {
    for (game, status) in [("tft", "Starting Teamfight Tactics in the background…"), ("2xko", "Starting 2XKO in the background…"), ("lor", "Starting Legends of Runeterra in the background…")] {
        let mut f = direct();
        f.opts.game = game;
        assert!(f.run().unwrap().game_started, "{game}");
        assert!(f.has("request-launch"), "{game}");
        assert!(f.processes.get().game(game), "{game}");
        assert!(f.statuses().iter().any(|(text, _)| text == status), "{game}");
    }
}

#[test]
fn a_running_game_process_without_a_game_window_times_out_without_reporting_success() {
    let f = fixture();
    f.game_window.set(false);
    assert!(error_of(f.run()).message.contains("game did not open"));
    assert!(f.elapsed() >= 180_000);
    assert!(!f.has("close-client-window"));
    assert_eq!(f.reveals(), 1);
    assert!(!f.statuses().iter().any(|(text, _)| text == "Game opened"));
}

#[test]
fn cancellation_interrupts_authentication_polling_and_keeps_the_riot_open() {
    let mut f = fixture();
    f.opts.has_saved_session = false;
    f.authorized.set(false);
    f.on_type_credentials = Box::new(|_: &Fake, _: &TypeRequest, _: &dyn Fn(&str)| Ok(Vec::new()));
    f.on_sleep = Box::new(|f: &Fake, ms: u64| {
        f.clock.set(f.clock.get() + ms);
        if f.elapsed() >= 1000 {
            f.cancel.cancel();
        }
    });
    assert!(error_of(f.run()).is_cancelled());
    assert!(f.elapsed() < 2000);
    assert!(!f.has("request-launch"));
    assert!(!f.has("close-client-window"));
    assert_eq!(f.reveals(), 1);
}

#[test]
fn riot_client_only_signs_in_keeps_the_session_and_shows_the_client_without_requesting_any_game() {
    let mut f = fixture();
    f.opts.game = "riot";
    f.opts.has_saved_session = false;
    f.authorized.set(false);
    f.on_running_games = Box::new(|_: &Fake| Ok(RunningGames::default()));
    let result = f.run().unwrap();
    assert!(result.client_opened);
    assert!(!result.game_started);
    assert_eq!(result.session.as_deref(), Some("token:current"));
    assert_eq!(result.riot_id, Some(example()));
    for event in ["request-launch", "game-window", "close-client-window"] {
        assert!(!f.has(event), "{event}");
    }
    assert_eq!(f.last_event(), "reveal");
    let (text, details) = f.statuses().last().cloned().unwrap();
    assert_eq!(text, "Riot Client opened");
    assert!(details.signed_in);
}

#[test]
fn riot_client_only_never_shows_the_client_for_a_different_signed_in_account() {
    let mut f = fixture();
    f.opts.game = "riot";
    f.opts.has_saved_session = false;
    f.authorized.set(false);
    f.on_running_games = Box::new(|_: &Fake| Ok(RunningGames::default()));
    *f.identity.borrow_mut() = Some(RiotId::new("Someone", "ELSE"));
    assert!(error_of(f.run()).message.contains("does not match"));
    assert!(!f.has("request-launch"));
    assert_eq!(f.reveals(), 1);
}

#[test]
fn rejects_unsupported_products_before_touching_client_processes() {
    let mut f = fixture();
    f.opts.game = "unrecognised";
    assert!(error_of(f.run()).message.contains("supported game"));
    assert!(f.events().is_empty());
}

#[test]
fn rejects_a_different_signed_in_account_after_credential_entry_before_saving_its_session() {
    let mut f = fixture();
    f.opts.has_saved_session = false;
    f.authorized.set(false);
    *f.identity.borrow_mut() = Some(RiotId::new("AnotherAccount", "BR1"));
    let read = Rc::new(Cell::new(false));
    let flag = read.clone();
    f.on_read_settings_yaml = Box::new(move |_: &Fake| {
        flag.set(true);
        Some("token:wrong-account".into())
    });
    assert!(error_of(f.run()).message.contains("does not match the selected account"));
    assert!(!read.get());
    assert!(!f.has("request-launch"));
    assert!(!f.has("close-client-window"));
}

#[test]
fn cancelling_while_the_riot_window_is_shown_never_closes_games_afterward() {
    let mut f = fixture();
    f.on_reveal = Box::new(|f: &Fake| {
        f.event("reveal");
        f.cancel.cancel();
        Ok(())
    });
    assert!(error_of(f.run()).is_cancelled());
    for event in ["closed", "launch", "close-games", "visible-interface"] {
        assert!(!f.has(event), "{event}");
    }
}

#[test]
fn cancelling_during_session_loading_never_replaces_the_riot_settings_afterward() {
    let mut f = fixture();
    f.opts.session = Box::new(|f: &Fake| {
        f.cancel.cancel();
        Ok(Some("token:saved".into()))
    });
    assert!(error_of(f.run()).is_cancelled());
    assert!(!f.has("write"));
    assert!(!f.has("launch"));
}

#[test]
fn a_verified_current_account_opens_the_selected_game_without_restarting_or_submitting_credentials() {
    let mut f = direct();
    f.authorized.set(true);
    f.opts.session = Box::new(|_: &Fake| Err(RiotError::new("The current account needs no stored-session read")));
    let result = f.run().unwrap();
    assert!(result.reused_current_session);
    assert!(result.game_started);
    for event in ["closed", "launch", "authenticate", "type", "write"] {
        assert!(!f.has(event), "{event}");
    }
    assert_eq!(f.reveals(), 1);
    assert!(f.at("identity") < f.at("request-launch"));
    assert_eq!(f.elapsed(), 0);
}

#[test]
fn an_authorized_account_still_waits_for_a_required_player_session_verification_before_launching() {
    let mut f = direct();
    f.authorized.set(true);
    f.on_session_state = Box::new(|f: &Fake| state(if f.elapsed() < 2100 { AuthKind::Challenge } else { AuthKind::Authenticated }));
    f.on_request_launch = Box::new(|f: &Fake, game: &str| {
        assert!(f.elapsed() >= 2100);
        f.event("request-launch");
        f.start_game(game);
        Ok(LaunchAnswer::default())
    });
    assert!(f.run().unwrap().game_started);
    assert!(!f.attention().is_empty());
    assert!(!f.has("authenticate"));
    assert!(!f.has("closed"));
}

#[test]
fn an_unresolved_player_session_verification_never_opens_a_game_despite_existing_authorization() {
    let mut f = direct();
    f.authorized.set(true);
    f.on_session_state = Box::new(|_: &Fake| state(AuthKind::Challenge));
    assert_eq!(error_of(f.run()).message, "Sign-in timed out. Open the Riot Client to see what happened");
    assert!(f.attention().iter().all(|text| !text.contains("security check")));
    assert!(!f.has("request-launch"));
    assert!(!f.has("authenticate"));
    assert_eq!(f.reveals(), 1);
}

#[test]
fn player_session_inspection_errors_cannot_be_mistaken_for_completed_verification() {
    let mut f = direct();
    f.authorized.set(true);
    f.on_read_authentication_state = Box::new(|_: &Fake| Err(RiotError::new("Could not inspect player session")));
    assert_eq!(error_of(f.run()).message, "Could not inspect player session");
    assert!(!f.has("request-launch"));
    assert_eq!(f.reveals(), 1);
}

#[test]
fn a_signed_out_riot_signs_in_directly_for_each_game_without_restarting_or_typing() {
    for game in ["lol", "tft", "val"] {
        let mut f = direct();
        f.opts.game = game;
        assert!(f.run().unwrap().game_started, "{game}");
        assert_eq!(f.count("authenticate"), 1);
        for event in ["closed", "launch", "type", "write"] {
            assert!(!f.has(event), "{event}");
        }
        assert_eq!(f.reveals(), 1);
        assert!(f.at("visible-interface") < f.at("authenticate"));
        assert!(f.at("identity") < f.at("request-launch"));
        assert_eq!(f.elapsed(), 0);
    }
}

#[test]
fn direct_authentication_errors_never_fall_back_to_typing_or_launch_a_game() {
    for message in ["Wrong username or password", "Network unavailable", "Too many attempts"] {
        let mut f = direct();
        f.on_authenticate = Box::new(move |f: &Fake, _: bool| {
            f.event("authenticate");
            Err(RiotError::new(message))
        });
        assert_eq!(error_of(f.run()).message, message);
        assert_eq!(f.count("authenticate"), 1);
        assert!(!f.has("type"));
        assert!(!f.has("request-launch"));
        assert_eq!(f.reveals(), 1);
    }
}

#[test]
fn an_unsupported_direct_endpoint_falls_back_to_the_visible_form_once() {
    let mut f = direct();
    f.on_authenticate = Box::new(|f: &Fake, _: bool| {
        f.event("authenticate");
        Ok(Some(AuthOutcome::unsupported()))
    });
    assert!(f.run().unwrap().game_started);
    assert_eq!(f.count("type"), 1);
    assert_eq!(*f.typed.borrow(), [TypeRequest { username: "example-user".into(), password: "example-password".into(), remember: true }]);
    assert!(!f.has("closed"));
    assert_eq!(f.reveals(), 1);
}

#[test]
fn a_captcha_required_before_any_credential_submission_uses_the_visible_form_once() {
    let mut f = direct();
    f.on_authenticate = Box::new(native_form);
    assert!(f.run().unwrap().game_started);
    assert_eq!(f.count("type"), 1);
    assert!(!f.has("closed"));
    assert_eq!(f.reveals(), 1);
    assert!(f.statuses().iter().any(|(text, details)| text == "Signing in…" && details.native_client && !details.needs_attention));
}

#[test]
fn the_visible_form_reports_how_the_riot_interface_was_opened_to_the_sign_in_log() {
    let mut f = direct();
    f.on_authenticate = Box::new(native_form);
    f.on_type_credentials = Box::new(|f: &Fake, _: &TypeRequest, log: &dyn Fn(&str)| {
        log("started the Riot Client with its interface");
        f.authorized.set(true);
        Ok(vec!["remember:on".into()])
    });
    assert!(f.run().unwrap().game_started);
    assert!(f.logs().contains(&"started the Riot Client with its interface".to_string()));
    assert!(f.logs().contains(&"credentials entered (remember:on)".to_string()));
}

fn typed_flag(f: &mut Fake) -> Rc<Cell<bool>> {
    let typed = Rc::new(Cell::new(false));
    let flag = typed.clone();
    f.on_type_credentials = Box::new(move |f: &Fake, _: &TypeRequest, _: &dyn Fn(&str)| {
        flag.set(true);
        f.event("type");
        Ok(vec!["remember:on".into()])
    });
    typed
}

fn authorize_after(f: &mut Fake, ms: u64) {
    f.on_is_authorized = Box::new(move |f: &Fake| {
        if f.elapsed() >= ms {
            f.authorized.set(true);
        }
        Ok(f.authorized.get())
    });
}

#[test]
fn manual_verification_after_native_credential_entry_identifies_the_original_challenge_window() {
    let mut f = direct();
    f.on_authenticate = Box::new(native_form);
    let typed = typed_flag(&mut f);
    f.on_session_state = Box::new(move |f: &Fake| state(if f.authorized.get() { AuthKind::Authenticated } else if typed.get() { AuthKind::Multifactor } else { AuthKind::Auth }));
    authorize_after(&mut f, 1400);
    assert!(f.run().unwrap().game_started);
    assert!(f.statuses().iter().any(|(_, details)| details.needs_attention && details.native_client));
    assert_eq!(f.count("type"), 1);
    assert_eq!(f.reveals(), 2);
    assert!(f.last("reveal") < f.first("request-launch"));
    assert_eq!(f.last_event(), "close-client-window");
}

#[test]
fn a_native_verification_remains_available_after_it_expires() {
    let challenges = [AuthState::of(AuthKind::Multifactor), AuthState::of(AuthKind::Challenge), AuthState::failed(AuthKind::Challenge, "captcha_not_allowed")];
    for challenge in challenges {
        let mut f = direct();
        f.on_authenticate = Box::new(unsupported);
        let typed = typed_flag(&mut f);
        f.on_session_state = Box::new(move |_: &Fake| Ok(Some(if typed.get() { challenge } else { AuthState::of(AuthKind::Auth) })));
        let error = error_of(f.run());
        if challenge == AuthState::of(AuthKind::Challenge) {
            assert_eq!(error.message, "Sign-in timed out. Open the Riot Client to see what happened");
        } else {
            assert!(error.message.contains("timed out waiting for your attention"), "{challenge:?}");
        }
        assert!(error.needs_attention && error.native_client);
        assert_eq!(f.reveals(), 2);
        assert_eq!(f.last_event(), "reveal");
        assert_eq!(f.count("type"), 1);
        for event in ["request-launch", "closed", "launch"] {
            assert!(!f.has(event), "{event}");
        }
    }
}

#[test]
fn a_native_verification_remains_recoverable_when_revealing_its_existing_window_fails() {
    let mut f = direct();
    f.on_authenticate = Box::new(unsupported);
    let typed = typed_flag(&mut f);
    let seen = typed.clone();
    f.on_session_state = Box::new(move |_: &Fake| state(if seen.get() { AuthKind::Multifactor } else { AuthKind::Auth }));
    f.on_reveal = Box::new(move |f: &Fake| {
        f.event("reveal");
        if typed.get() {
            return Err(RiotError::new("window-style-denied"));
        }
        Ok(())
    });
    let error = error_of(f.run());
    assert_eq!(error.message, "window-style-denied");
    assert!(error.needs_attention && error.native_client);
    assert_eq!(f.last_event(), "reveal");
    assert!(!f.has("request-launch"));
}

#[test]
fn a_failure_right_after_native_entry_recovers_pending_mfa_even_if_window_recovery_fails() {
    for reveal_fails in [false, true] {
        let mut f = direct();
        f.opts.log = Box::new(|_: &Fake, line: &str| if line.starts_with("credentials entered") { Err(RiotError::new("original failure")) } else { Ok(()) });
        f.on_authenticate = Box::new(unsupported);
        let typed = typed_flag(&mut f);
        let inspections = Rc::new(Cell::new(0));
        let counter = inspections.clone();
        f.on_read_authentication_state = Box::new(move |_: &Fake| {
            counter.set(counter.get() + 1);
            state(AuthKind::Multifactor)
        });
        f.on_reveal = Box::new(move |f: &Fake| {
            f.event("reveal");
            if typed.get() && reveal_fails {
                return Err(RiotError::new("recovery failed"));
            }
            Ok(())
        });
        let error = error_of(f.run());
        assert_eq!(error.message, "original failure");
        assert!(error.needs_attention && error.native_client);
        assert_eq!(inspections.get(), 1);
        assert_eq!(f.reveals(), 2);
        assert_eq!(f.last_event(), "reveal");
        assert_eq!(f.count("type"), 1);
        for event in ["request-launch", "closed", "launch"] {
            assert!(!f.has(event), "{event}");
        }
        assert_eq!(f.logs().contains(&"could not recover the native sign-in verification window".to_string()), reveal_fails);
    }
}

#[test]
fn an_unreadable_state_during_native_error_recovery_keeps_the_original_failure_without_inventing_a_challenge() {
    let mut f = direct();
    f.opts.log = Box::new(|_: &Fake, line: &str| if line.starts_with("credentials entered") { Err(RiotError::new("original failure")) } else { Ok(()) });
    f.on_authenticate = Box::new(unsupported);
    f.on_type_credentials = Box::new(|_: &Fake, _: &TypeRequest, _: &dyn Fn(&str)| Ok(vec!["remember:on".into()]));
    let inspections = Rc::new(Cell::new(0));
    let counter = inspections.clone();
    f.on_read_authentication_state = Box::new(move |_: &Fake| {
        counter.set(counter.get() + 1);
        Err(RiotError::new("inspection failed"))
    });
    let error = error_of(f.run());
    assert_eq!(error.message, "original failure");
    assert!(!error.needs_attention && !error.native_client);
    assert_eq!(inspections.get(), 1);
    assert_eq!(f.reveals(), 1);
}

#[test]
fn cancellation_after_native_entry_never_inspects_or_reveals_another_verification() {
    let mut f = direct();
    f.on_authenticate = Box::new(unsupported);
    f.on_type_credentials = Box::new(|f: &Fake, _: &TypeRequest, _: &dyn Fn(&str)| {
        f.cancel.cancel();
        Ok(vec!["remember:on".into()])
    });
    f.on_read_authentication_state = Box::new(|_: &Fake| panic!("A cancelled operation must not inspect authentication"));
    assert!(error_of(f.run()).is_cancelled());
    assert_eq!(f.reveals(), 1);
}

#[test]
fn a_failure_after_native_authentication_completes_never_reopens_a_newly_reported_challenge() {
    let mut f = direct();
    f.on_authenticate = Box::new(unsupported);
    let finished = Rc::new(Cell::new(false));
    let extra = Rc::new(Cell::new(0));
    let (done, counter) = (finished.clone(), extra.clone());
    f.on_read_authentication_state = Box::new(move |_: &Fake| {
        if done.get() {
            counter.set(counter.get() + 1);
        }
        state(if done.get() { AuthKind::Multifactor } else { AuthKind::Authenticated })
    });
    f.on_request_launch = Box::new(move |_: &Fake, _: &str| {
        finished.set(true);
        Err(RiotError::new("game launch failed"))
    });
    let error = error_of(f.run());
    assert_eq!(error.message, "game launch failed");
    assert!(!error.needs_attention && !error.native_client);
    assert_eq!(extra.get(), 0);
    assert_eq!(f.reveals(), 1);
    assert!(!f.has("close-client-window"));
}

#[test]
fn a_slow_native_sign_in_preserves_manual_recovery_without_automatically_revealing_the_client() {
    let mut f = direct();
    f.on_authenticate = Box::new(unsupported);
    f.on_type_credentials = Box::new(|_: &Fake, _: &TypeRequest, _: &dyn Fn(&str)| Ok(vec!["remember:on".into()]));
    let error = error_of(f.run());
    assert!(error.needs_attention && error.native_client);
    assert_eq!(f.reveals(), 1);
    assert!(!f.has("request-launch"));
}

#[test]
fn cancelling_a_revealed_native_verification_clears_recovery_flags() {
    let mut f = direct();
    f.on_authenticate = Box::new(unsupported);
    let typed = typed_flag(&mut f);
    f.on_session_state = Box::new(move |_: &Fake| state(if typed.get() { AuthKind::Multifactor } else { AuthKind::Auth }));
    f.on_sleep = Box::new(|f: &Fake, ms: u64| {
        f.clock.set(f.clock.get() + ms);
        f.cancel.cancel();
    });
    let error = error_of(f.run());
    assert!(error.is_cancelled());
    assert!(!error.needs_attention && !error.native_client);
    assert_eq!(f.reveals(), 2);
    assert!(!f.has("request-launch"));
}

#[test]
fn a_game_timeout_after_native_verification_does_not_retain_authentication_recovery_flags() {
    let mut f = direct();
    f.game_window.set(false);
    f.on_authenticate = Box::new(unsupported);
    let typed = typed_flag(&mut f);
    f.on_session_state = Box::new(move |f: &Fake| state(if f.authorized.get() { AuthKind::Authenticated } else if typed.get() { AuthKind::Multifactor } else { AuthKind::Auth }));
    authorize_after(&mut f, 1400);
    let error = error_of(f.run());
    assert!(error.message.contains("game did not open"));
    assert!(!error.needs_attention && !error.native_client);
    assert!(f.attention().iter().any(|text| text.contains("game is taking longer")));
    assert_eq!(f.reveals(), 2);
    assert!(!f.has("close-client-window"));
}

#[test]
fn an_invalid_direct_login_result_fails_closed_without_duplicate_credential_submission() {
    let mut f = direct();
    f.on_authenticate = Box::new(|_: &Fake, _: bool| Ok(None));
    assert!(error_of(f.run()).message.contains("invalid response"));
    assert!(!f.has("type"));
    assert!(!f.has("request-launch"));
}

#[test]
fn direct_login_never_requests_a_game_when_the_signed_in_identity_differs() {
    let mut f = direct();
    *f.identity.borrow_mut() = Some(RiotId::new("Unexpected", "BR1"));
    let read = Rc::new(Cell::new(false));
    let flag = read.clone();
    f.on_read_settings_yaml = Box::new(move |_: &Fake| {
        flag.set(true);
        Some("token:unexpected".into())
    });
    assert!(error_of(f.run()).message.contains("does not match the selected account"));
    assert!(!f.has("request-launch"));
    assert!(!read.get());
}

#[test]
fn an_existing_different_account_is_restarted_before_reading_the_target_saved_session() {
    let mut f = direct();
    f.authorized.set(true);
    *f.identity.borrow_mut() = Some(RiotId::new("Previous", "BR1"));
    f.opts.has_saved_session = true;
    f.opts.on_closed = Box::new(|f: &Fake, _: &Closed| {
        f.event("persist-leaving");
        Ok(())
    });
    f.opts.session = Box::new(|f: &Fake| {
        f.event("load-session");
        Ok(Some("token:target".into()))
    });
    f.on_launch_product = Box::new(|f: &Fake, visible: bool| {
        assert!(!visible);
        f.event("launch");
        *f.identity.borrow_mut() = Some(example());
        Ok(())
    });
    let result = f.run().unwrap();
    assert!(result.used_saved_session);
    assert!(!result.reused_current_session);
    assert!(f.at("load-session") > f.at("persist-leaving"));
    assert!(f.at("persist-leaving") > f.at("closed"));
    assert!(!f.has("authenticate"));
}

#[test]
fn an_expired_saved_session_uses_direct_authentication_after_restoring_only_background_services() {
    let mut f = direct();
    f.opts.has_saved_session = true;
    f.on_launch_product = Box::new(|f: &Fake, visible: bool| {
        assert!(!visible);
        f.event("launch");
        Ok(())
    });
    let result = f.run().unwrap();
    assert!(result.session_rejected);
    assert!(result.game_started);
    assert!(f.at("authenticate") > f.at("launch"));
    assert!(!f.has("type"));
}

#[test]
fn a_current_account_the_riot_reports_as_unknown_is_never_reused_even_with_its_services_answering() {
    let mut f = direct();
    f.authorized.set(true);
    f.on_authorization = Box::new(|f: &Fake| Ok(if f.authorized.get() { AccountState::Unknown } else { AccountState::No }));
    let result = f.run().unwrap();
    assert!(!result.reused_current_session);
    assert!(result.game_started);
    assert!(f.at("closed") < f.at("visible-interface"));
    assert!(f.at("visible-interface") < f.at("authenticate"));
}

#[test]
fn a_game_already_running_prevents_reusing_even_a_matching_current_session() {
    let mut f = direct();
    f.authorized.set(true);
    f.processes.set(RunningGames { client: true, val: true, ..RunningGames::default() });
    f.on_close_everything = Box::new(|f: &Fake| {
        f.event("closed");
        f.authorized.set(false);
        f.processes.set(RunningGames { client: true, ..RunningGames::default() });
        Ok(Closed::default())
    });
    let result = f.run().unwrap();
    assert!(!result.reused_current_session);
    assert!(f.at("closed") < f.at("visible-interface"));
    assert!(f.at("visible-interface") < f.at("authenticate"));
}

#[test]
fn direct_mfa_waits_for_user_intervention_without_typing_or_submitting_credentials_twice() {
    let mut f = direct();
    f.on_session_state = Box::new(|f: &Fake| state(if f.authorized.get() { AuthKind::Authenticated } else if f.has("authenticate") { AuthKind::Multifactor } else { AuthKind::Auth }));
    f.on_authenticate = Box::new(|f: &Fake, _: bool| {
        f.event("authenticate");
        Ok(Some(AuthOutcome::done()))
    });
    authorize_after(&mut f, 1400);
    assert!(f.run().unwrap().game_started);
    assert_eq!(f.count("authenticate"), 1);
    assert_eq!(f.attention().len(), 1);
    assert!(!f.has("type"));
    assert_eq!(f.reveals(), 1);
}

#[test]
fn cancellation_during_direct_authentication_never_launches_a_product_or_types_credentials_afterward() {
    let mut f = direct();
    f.on_authenticate = Box::new(|f: &Fake, _: bool| {
        f.cancel.cancel();
        Ok(Some(AuthOutcome::done()))
    });
    assert!(error_of(f.run()).is_cancelled());
    assert!(!f.has("request-launch"));
    assert!(!f.has("type"));
}

#[test]
fn saving_a_delayed_session_never_delays_requesting_the_verified_game() {
    let mut f = direct();
    f.on_read_settings_yaml = Box::new(|f: &Fake| {
        assert!(f.has("request-launch"));
        (f.elapsed() >= 1500).then(|| "token:fresh".to_string())
    });
    let result = f.run().unwrap();
    assert!(result.game_started);
    assert_eq!(result.session.as_deref(), Some("token:fresh"));
    assert!(f.elapsed() < 2500);
}

#[test]
fn stay_signed_in_off_ignores_saved_sessions_types_with_remember_off_and_keeps_no_session() {
    let mut f = fixture();
    f.opts.remember = false;
    f.on_close_everything = Box::new(|f: &Fake| {
        f.event("closed");
        f.authorized.set(false);
        Ok(Closed::default())
    });
    f.opts.session = Box::new(|_: &Fake| panic!("Saved sessions must not be read"));
    let result = f.run().unwrap();
    assert!(result.game_started);
    assert!(!result.used_saved_session);
    assert_eq!(result.session, None);
    assert_eq!(f.typed.borrow().iter().map(|request| request.remember).collect::<Vec<_>>(), [false]);
    assert!(!f.has("write"));
}

#[test]
fn direct_sign_in_forwards_the_stay_signed_in_choice_and_marks_every_status_after_authorization() {
    let mut f = direct();
    f.opts.remember = false;
    let chosen = Rc::new(Cell::new(None));
    let seen = chosen.clone();
    f.on_authenticate = Box::new(move |f: &Fake, remember: bool| {
        seen.set(Some(remember));
        f.authorized.set(true);
        Ok(Some(AuthOutcome::done()))
    });
    f.run().unwrap();
    assert_eq!(chosen.get(), Some(false));
    let statuses = f.statuses();
    let first = statuses.iter().position(|(_, details)| details.signed_in).unwrap();
    assert!(first > 0);
    assert_eq!(statuses[first].0, "Signed in. Preparing the game…");
    assert!(statuses[..first].iter().all(|(_, details)| !details.signed_in));
    assert!(statuses[first..].iter().all(|(_, details)| details.signed_in));
}

type Timeline = Rc<RefCell<Vec<(&'static str, u64)>>>;

fn automatic_check(check_ms: u64) -> (Fake, Timeline) {
    let mut f = direct();
    let timeline: Timeline = Rc::default();
    let submitted: Rc<Cell<Option<u64>>> = Rc::default();
    f.on_authenticate = Box::new(native_form);
    let mark = submitted.clone();
    f.on_type_credentials = Box::new(move |f: &Fake, _: &TypeRequest, _: &dyn Fn(&str)| {
        mark.set(Some(f.elapsed()));
        Ok(vec!["remember:unknown".into()])
    });
    let since = submitted.clone();
    f.on_read_authentication_state = Box::new(move |f: &Fake| state(if since.get().is_some_and(|at| f.elapsed() - at < check_ms) { AuthKind::Challenge } else { AuthKind::Auth }));
    let done = submitted.clone();
    f.on_is_authorized = Box::new(move |f: &Fake| Ok(done.get().is_some_and(|at| f.elapsed() - at >= check_ms)));
    let (revealed, reveal_at) = (timeline.clone(), submitted.clone());
    f.on_reveal = Box::new(move |f: &Fake| {
        if let Some(at) = reveal_at.get() {
            revealed.borrow_mut().push(("reveal", f.elapsed() - at));
        }
        Ok(())
    });
    let (noticed, notice_at) = (timeline.clone(), submitted);
    f.opts.on_status = Box::new(move |f: &Fake, _: &str, details: StatusDetails| {
        if details.needs_attention {
            noticed.borrow_mut().push(("attention", f.elapsed() - notice_at.get().unwrap_or(0)));
        }
    });
    (f, timeline)
}

#[test]
fn a_brief_automatic_riot_check_after_native_credential_entry_does_not_ask_for_attention() {
    let (f, timeline) = automatic_check(3000);
    assert!(f.run().unwrap().game_started);
    assert!(timeline.borrow().is_empty());
    assert!(f.attention().is_empty());
}

#[test]
fn a_riot_check_that_outlasts_the_grace_period_still_asks_for_attention_and_reveals_the_native_window() {
    let (f, timeline) = automatic_check(20_000);
    assert!(f.run().unwrap().game_started);
    let attention = timeline.borrow().iter().find(|(kind, _)| *kind == "attention").copied().unwrap();
    assert!(attention.1 >= 12_000 && attention.1 < 20_000);
    assert!(timeline.borrow().iter().any(|(kind, _)| *kind == "reveal"));
}

#[test]
fn an_unfinished_riot_sign_in_that_ends_in_a_riot_service_error_never_claims_a_security_check() {
    let mut f = direct();
    f.on_authenticate = Box::new(native_form);
    let typed = typed_flag(&mut f);
    f.on_session_state = Box::new(move |f: &Fake| {
        if !typed.get() {
            return state(AuthKind::Auth);
        }
        if f.elapsed() > 40_000 {
            return Err(RiotError::new("Could not contact the Riot authentication service"));
        }
        state(AuthKind::Challenge)
    });
    let error = error_of(f.run());
    assert_eq!(error.message, "Could not contact the Riot authentication service");
    let attention = f.attention();
    assert_eq!(attention, vec!["Riot has not finished signing in. Check the Riot window in case it needs you".to_string()]);
    assert!(f.reveals() >= 2);
    assert!(!f.has("request-launch"));
}

#[test]
fn only_a_captcha_the_riot_refused_or_a_2fa_request_is_announced_as_a_verification() {
    let cases = [
        (AuthState::failed(AuthKind::Challenge, "captcha_not_allowed"), "Riot needs a security check. Complete it in the Riot window"),
        (AuthState::of(AuthKind::Multifactor), "Riot needs your 2FA code. Enter it in the Riot window"),
        (AuthState::of(AuthKind::Challenge), "Riot has not finished signing in. Check the Riot window in case it needs you"),
    ];
    for (riot_state, text) in cases {
        let mut f = direct();
        f.on_authenticate = Box::new(native_form);
        let typed = typed_flag(&mut f);
        f.on_session_state = Box::new(move |_: &Fake| Ok(Some(if typed.get() { riot_state } else { AuthState::of(AuthKind::Auth) })));
        let _ = f.run();
        assert_eq!(f.attention().first().map(String::as_str), Some(text), "{riot_state:?}");
    }
}

#[test]
fn a_background_sign_in_names_a_verification_only_when_the_riot_reason_confirms_it() {
    for (reason, text) in [
        ("multifactor", "Riot needs your 2FA code. Enter it in the Riot window"),
        ("security_check", "Riot needs a security check. Complete it in the Riot window"),
        ("challenge", "Riot has not finished signing in. Check the Riot window in case it needs you"),
    ] {
        let mut f = direct();
        f.on_authenticate = Box::new(move |f: &Fake, _: bool| {
            f.event("authenticate");
            Ok(Some(AuthOutcome::attention(reason)))
        });
        authorize_after(&mut f, 1400);
        assert!(f.run().unwrap().game_started, "{reason}");
        assert_eq!(f.attention().first().map(String::as_str), Some(text), "{reason}");
    }
}

fn outdated(updated_at: u64) -> (Fake, Rc<RefCell<Vec<u64>>>) {
    let mut f = direct();
    let requests: Rc<RefCell<Vec<u64>>> = Rc::default();
    let seen = requests.clone();
    f.on_request_launch = Box::new(move |f: &Fake, game: &str| {
        seen.borrow_mut().push(f.elapsed());
        f.event("request-launch");
        if f.elapsed() < updated_at {
            return Ok(LaunchAnswer { status: 424, error_code: Some("launch_failed_product_not_up_to_date".into()) });
        }
        f.start_game(game);
        Ok(LaunchAnswer { status: 200, error_code: None })
    });
    (f, requests)
}

#[test]
fn an_outdated_game_is_requested_again_until_the_update_finishes_and_then_opens() {
    let (f, requests) = outdated(300_000);
    assert!(f.run().unwrap().game_started);
    assert!(f.elapsed() >= 300_000);
    let requests = requests.borrow();
    assert!(requests.len() > 2);
    assert!(requests.windows(2).all(|pair| pair[1] - pair[0] >= 15_000));
    assert!(f.statuses().iter().any(|(text, details)| text.to_lowercase().contains("waiting for the league of legends update") && details.signed_in && !details.needs_attention));
    assert!(!f.statuses().iter().any(|(text, _)| text.contains("game is taking longer")));
}

#[test]
fn an_update_that_never_finishes_fails_only_after_the_update_timeout() {
    let (f, _) = outdated(u64::MAX);
    assert!(error_of(f.run()).message.contains("update did not finish in time"));
    assert!(f.elapsed() >= 1_200_000);
    assert!(!f.statuses().iter().any(|(text, _)| text.contains("game is taking longer")));
}

#[test]
fn the_open_deadline_counts_from_the_accepted_request_after_an_update() {
    let (mut f, _) = outdated(250_000);
    let accepted: Rc<Cell<Option<u64>>> = Rc::default();
    let request = std::mem::replace(&mut f.on_request_launch, Box::new(|_: &Fake, _: &str| Ok(LaunchAnswer::default())));
    let mark = accepted.clone();
    f.on_request_launch = Box::new(move |f: &Fake, game: &str| {
        let launch = request(f, game)?;
        if launch.status == 200 && mark.get().is_none() {
            mark.set(Some(f.elapsed()));
        }
        Ok(launch)
    });
    f.on_game_window = Box::new(move |f: &Fake| Ok(accepted.get().is_some_and(|at| f.elapsed() >= at + 100_000)));
    assert!(f.run().unwrap().game_started);
    assert!(f.elapsed() > 180_000 + 100_000);
    assert!(f.attention().iter().any(|text| text.contains("game is taking longer")));
}

#[test]
fn a_launch_refused_for_another_reason_is_not_repeated_and_keeps_the_open_timeout() {
    let mut f = direct();
    f.game_window.set(false);
    f.on_request_launch = Box::new(|f: &Fake, _: &str| {
        f.event("request-launch");
        Ok(LaunchAnswer { status: 500, error_code: Some("other".into()) })
    });
    assert!(error_of(f.run()).message.contains("game did not open"));
    assert_eq!(f.count("request-launch"), 1);
    assert!(f.elapsed() < 200_000);
}

#[test]
fn restores_a_saved_session_in_the_background_without_opening_riot_or_typing() {
    let mut f = restore();
    f.on_launch_product = Box::new(authorizing_launch);
    let result = f.run().unwrap();
    assert!(result.used_saved_session);
    assert!(result.game_started);
    assert_eq!(result.session.as_deref(), Some("token:current"));
    assert_eq!(f.events()[f.at("write")], "write token:saved");
    assert_eq!(f.events()[f.at("launch")], "launch");
    for name in ["visible-interface", "type", "DELETE"] {
        assert!(!f.has(name), "{name}");
    }
    assert!(f.at("closed") < f.at("write"));
    assert!(f.at("write") < f.at("launch"));
    assert!(f.at("launch") < f.at("request-launch"));
    assert_eq!(f.last_event(), "close-client-window");
    assert!(f.statuses().iter().any(|(text, _)| text == "Signing in with the saved session…"));
}

#[test]
fn falls_back_to_the_visible_riot_form_when_the_saved_session_is_no_longer_accepted() {
    let f = restore();
    let result = f.run().unwrap();
    assert!(result.session_rejected);
    assert!(!result.used_saved_session);
    assert!(result.game_started);
    assert_eq!(f.count("launch"), 1);
    assert!(f.at("launch") < f.at("visible-interface"));
    assert!(!f.has("DELETE"));
    assert!(f.at("visible-interface") < f.at("type"));
    assert!(f.at("type") < f.at("request-launch"));
    assert_eq!(f.last_event(), "close-client-window");
}

#[test]
fn closes_a_restored_session_of_another_account_normally_hands_it_over_and_types_the_selected_one() {
    let mut f = restore();
    let leaving: Rc<RefCell<Vec<Option<String>>>> = Rc::default();
    f.on_authorization = Box::new(|f: &Fake| Ok(yes_or(f.authorized.get(), AccountState::No)));
    f.opts.on_rejected = Box::new(|f: &Fake| {
        f.event("rejected");
        Ok(())
    });
    let handed = leaving.clone();
    f.opts.on_closed = Box::new(move |f: &Fake, closed: &Closed| {
        handed.borrow_mut().push(closed.yaml.clone());
        f.event("persist-leaving");
        Ok(())
    });
    f.on_close_everything = Box::new(|f: &Fake| {
        f.event("closed");
        let signed_in = f.authorized.get();
        f.authorized.set(false);
        Ok(Closed { signed_in, riot_id: if signed_in { f.identity.borrow().clone() } else { None }, yaml: signed_in.then(|| "token:another-renewed".to_string()) })
    });
    f.on_launch_product = Box::new(|f: &Fake, visible: bool| {
        f.event(if visible { "launch visible" } else { "launch" });
        f.authorized.set(true);
        *f.identity.borrow_mut() = Some(RiotId::new("AnotherAccount", "BR1"));
        Ok(())
    });
    f.on_type_credentials = Box::new(type_as_example);
    let result = f.run().unwrap();
    assert!(result.session_rejected);
    assert!(!result.used_saved_session);
    assert!(result.game_started);
    assert!(!f.has("DELETE"));
    assert_eq!(*leaving.borrow(), [None, Some("token:another-renewed".to_string())]);
    let stripped = f.events().iter().position(|event| event == "write stripped").unwrap();
    assert_eq!(f.count("rejected"), 1);
    assert!(f.at("rejected") < f.last("closed").unwrap());
    assert!(f.last("closed") < f.last("persist-leaving"));
    assert!(f.last("persist-leaving").unwrap() < stripped);
    assert!(stripped < f.at("visible-interface"));
    assert!(f.at("visible-interface") < f.at("type"));
}

#[test]
fn an_account_riot_restores_on_its_own_is_closed_normally_before_the_visible_form_never_signed_out() {
    let mut f = restore();
    let leaving: Rc<RefCell<Vec<Option<String>>>> = Rc::default();
    f.opts.has_saved_session = false;
    let handed = leaving.clone();
    f.opts.on_closed = Box::new(move |f: &Fake, closed: &Closed| {
        handed.borrow_mut().push(closed.yaml.clone());
        f.event("persist-leaving");
        Ok(())
    });
    f.on_authorization = Box::new(|f: &Fake| Ok(yes_or(f.authorized.get(), AccountState::No)));
    let opened = Rc::new(Cell::new(0));
    f.on_open_visible_interface = Box::new(move |f: &Fake| {
        f.event("visible-interface");
        opened.set(opened.get() + 1);
        if opened.get() == 1 {
            f.authorized.set(true);
            *f.identity.borrow_mut() = Some(RiotId::new("AnotherAccount", "BR1"));
        }
        Ok(())
    });
    f.on_close_everything = Box::new(|f: &Fake| {
        f.event("closed");
        f.authorized.set(false);
        Ok(Closed { signed_in: true, riot_id: Some(RiotId::new("AnotherAccount", "BR1")), yaml: Some("token:another".into()) })
    });
    f.on_type_credentials = Box::new(type_as_example);
    assert!(f.run().unwrap().game_started);
    assert!(!f.has("DELETE"));
    assert_eq!(*leaving.borrow(), [Some("token:another".to_string())]);
    let reopened = f.last("visible-interface").unwrap();
    assert!(f.at("visible-interface") < f.at("closed"));
    assert!(f.at("closed") < f.at("persist-leaving"));
    assert!(f.at("persist-leaving") < f.at("write"));
    assert!(f.at("write") < reopened);
    assert!(reopened < f.at("type"));
}

#[test]
fn an_account_that_stays_signed_in_after_a_normal_close_stops_the_switch_without_being_signed_out() {
    let mut f = restore();
    f.opts.has_saved_session = false;
    f.on_authorization = Box::new(|_: &Fake| Ok(AccountState::Yes));
    f.on_close_everything = Box::new(|f: &Fake| {
        f.event("closed");
        Ok(Closed { signed_in: true, riot_id: None, yaml: None })
    });
    assert!(error_of(f.run()).message.contains("Could not sign out the previous account"));
    assert!(!f.has("DELETE"));
    assert!(!f.has("type"));
    assert_eq!(f.count("closed"), 1);
    assert_eq!(f.count("visible-interface"), 2);
}

#[test]
fn the_visible_form_clears_only_an_unfinished_sign_in_of_a_signed_out_riot() {
    let scenarios = [
        ("a pending 2FA", AuthState::of(AuthKind::Multifactor), AccountState::No, true),
        ("a failed attempt", AuthState::failed(AuthKind::Error, "auth_failure"), AccountState::No, true),
        ("a clean form", AuthState::of(AuthKind::Auth), AccountState::No, false),
        ("a pending 2FA with an unreadable account state", AuthState::of(AuthKind::Multifactor), AccountState::Unknown, false),
        ("a pending security check", AuthState::of(AuthKind::Challenge), AccountState::No, false),
    ];
    for (label, left, account, cleared) in scenarios {
        let mut f = restore();
        let pending = Rc::new(Cell::new(true));
        f.opts.has_saved_session = false;
        f.on_authorization = Box::new(move |_: &Fake| Ok(account));
        let still = pending.clone();
        f.on_session_state = Box::new(move |f: &Fake| Ok(Some(if f.authorized.get() { AuthState::of(AuthKind::Authenticated) } else if still.get() { left } else { AuthState::of(AuthKind::Auth) })));
        let api = pending.clone();
        f.on_local_api = Box::new(move |f: &Fake, method: &str, path: &str| {
            f.event(format!("{method} {path}"));
            api.set(false);
            Ok(Response::new(204, Value::Null))
        });
        f.on_type_credentials = Box::new(move |f: &Fake, request: &TypeRequest, log: &dyn Fn(&str)| {
            pending.set(false);
            type_as_example(f, request, log)
        });
        assert!(f.run().unwrap().game_started, "{label}");
        if !cleared {
            assert!(!f.has("DELETE"), "{label}");
            continue;
        }
        assert_eq!(f.events()[f.at("DELETE")], "DELETE /rso-auth/v1/session", "{label}");
        assert!(f.at("visible-interface") < f.at("DELETE"));
        assert!(f.at("DELETE") < f.at("type"));
    }
}

#[test]
fn stay_signed_in_off_never_restarts_riot_for_a_stored_session() {
    let mut f = restore();
    f.opts.remember = false;
    let result = f.run().unwrap();
    assert!(result.game_started);
    assert!(!result.used_saved_session);
    for name in ["closed", "write", "launch"] {
        assert!(!f.has(name), "{name}");
    }
    assert!(f.at("visible-interface") < f.at("type"));
}

#[test]
fn an_account_without_a_stored_session_keeps_the_visible_form_path() {
    let mut f = restore();
    f.opts.has_saved_session = false;
    f.run().unwrap();
    for name in ["closed", "write", "launch"] {
        assert!(!f.has(name), "{name}");
    }
    assert!(f.at("visible-interface") < f.at("type"));
}

#[test]
fn riot_client_only_opens_the_interface_after_the_background_restore() {
    let mut f = restore();
    f.opts.game = "riot";
    f.on_launch_product = Box::new(authorizing_launch);
    let result = f.run().unwrap();
    assert!(result.client_opened);
    assert!(result.used_saved_session);
    for name in ["type", "DELETE", "request-launch", "close-client-window"] {
        assert!(!f.has(name), "{name}");
    }
    assert!(f.at("launch") < f.at("visible-interface"));
    assert_eq!(f.last_event(), "reveal");
}

#[test]
fn after_a_background_restore_only_a_session_riot_has_renewed_is_kept_never_the_copy_just_consumed() {
    let mut stale = restore();
    stale.on_launch_product = Box::new(authorizing_launch);
    stale.on_read_settings_yaml = Box::new(|_: &Fake| Some("token:saved".into()));
    let result = stale.run().unwrap();
    assert!(result.used_saved_session);
    assert_eq!(result.session, None);
    assert!(stale.logs().contains(&"Riot has not renewed the restored session yet".to_string()));
    let mut renewed = restore();
    renewed.on_launch_product = Box::new(authorizing_launch);
    let reads = Rc::new(Cell::new(0));
    renewed.on_read_settings_yaml = Box::new(move |_: &Fake| {
        reads.set(reads.get() + 1);
        Some(if reads.get() < 3 { "token:saved" } else { "token:renewed" }.into())
    });
    assert_eq!(renewed.run().unwrap().session.as_deref(), Some("token:renewed"));
}

#[test]
fn closes_another_signed_in_account_normally_keeping_its_session_instead_of_signing_it_out() {
    let mut f = restore();
    f.opts.has_saved_session = false;
    f.authorized.set(true);
    *f.identity.borrow_mut() = Some(RiotId::new("AnotherAccount", "BR1"));
    let leaving: Rc<RefCell<Option<Closed>>> = Rc::default();
    let handed = leaving.clone();
    f.opts.on_closed = Box::new(move |f: &Fake, closed: &Closed| {
        *handed.borrow_mut() = Some(closed.clone());
        f.event("persist-leaving");
        Ok(())
    });
    f.on_close_everything = Box::new(|f: &Fake| {
        f.event("closed");
        f.authorized.set(false);
        Ok(Closed { signed_in: true, riot_id: Some(RiotId::new("AnotherAccount", "BR1")), yaml: Some("token:other".into()) })
    });
    f.on_type_credentials = Box::new(type_as_example);
    assert!(f.run().unwrap().game_started);
    assert_eq!(leaving.borrow().as_ref().unwrap().yaml.as_deref(), Some("token:other"));
    assert!(!f.has("DELETE"));
    assert!(f.at("closed") < f.at("persist-leaving"));
    assert!(f.at("persist-leaving") < f.at("write"));
    assert_eq!(f.events()[f.at("write")], "write stripped");
    assert!(f.at("write") < f.at("visible-interface"));
    assert!(f.at("visible-interface") < f.at("type"));
}
