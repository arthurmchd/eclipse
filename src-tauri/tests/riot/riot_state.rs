use std::cell::RefCell;

use eclipse::riot::riot_authentication::{AuthKind, AuthState};
use eclipse::riot::riot_state::{Look, Mode, RiotProbe, Services};
use eclipse::riot::{AccountState, RiotError, RiotResult, RunningGames};

struct Probe {
    processes: RiotResult<RunningGames>,
    account: RiotResult<AccountState>,
    session: RiotResult<Option<AuthState>>,
    calls: RefCell<Vec<&'static str>>,
}

impl RiotProbe for Probe {
    fn running_games(&self) -> RiotResult<RunningGames> {
        self.calls.borrow_mut().push("processes");
        self.processes.clone()
    }

    fn authorization(&self) -> RiotResult<AccountState> {
        self.calls.borrow_mut().push("authorization");
        self.account.clone()
    }

    fn session_state(&self) -> RiotResult<Option<AuthState>> {
        self.calls.borrow_mut().push("session");
        self.session.clone()
    }
}

fn riot(processes: RunningGames) -> Probe {
    Probe { processes: Ok(processes), account: Ok(AccountState::Yes), session: Ok(Some(AuthState::of(AuthKind::Auth))), calls: RefCell::new(Vec::new()) }
}

fn client() -> RunningGames {
    RunningGames { client: true, ..RunningGames::default() }
}

#[test]
fn a_closed_riot_has_no_account_and_no_services_without_asking_its_local_api() {
    let probe = riot(RunningGames::default());
    let look = Look::new(&probe);
    assert!(!look.running().unwrap());
    assert_eq!(look.account().unwrap(), AccountState::No);
    assert!(!look.signed_in().unwrap());
    assert_eq!(look.services().unwrap(), Services::Off);
    assert_eq!(look.mode().unwrap(), Mode::Closed);
    assert_eq!(*probe.calls.borrow(), ["processes"]);
}

#[test]
fn each_mode_of_an_open_riot_comes_from_its_processes_and_from_its_services_only_without_a_window_or_game() {
    let modes = [
        (RunningGames { client: true, lol: true, client_window: true, ..RunningGames::default() }, Mode::Game, vec!["processes"]),
        (RunningGames { client: true, tft: true, ..RunningGames::default() }, Mode::Game, vec!["processes"]),
        (RunningGames { client: true, xko: true, ..RunningGames::default() }, Mode::Game, vec!["processes"]),
        (RunningGames { client: true, lor: true, ..RunningGames::default() }, Mode::Game, vec!["processes"]),
        (RunningGames { client: true, val: true, ..RunningGames::default() }, Mode::Game, vec!["processes"]),
        (RunningGames { client: true, client_window: true, ..RunningGames::default() }, Mode::Window, vec!["processes"]),
        (client(), Mode::Hidden, vec!["processes", "session"]),
    ];
    for (processes, mode, calls) in modes {
        let probe = riot(processes);
        assert_eq!(Look::new(&probe).mode().unwrap(), mode);
        assert_eq!(*probe.calls.borrow(), calls);
    }
    let background = Probe { session: Ok(None), ..riot(client()) };
    assert_eq!(Look::new(&background).mode().unwrap(), Mode::Background);
}

#[test]
fn the_account_of_an_open_riot_is_yes_no_or_unknown_and_a_failure_is_unknown() {
    let answers = [
        (Ok(AccountState::Yes), AccountState::Yes),
        (Ok(AccountState::No), AccountState::No),
        (Ok(AccountState::Unknown), AccountState::Unknown),
        (Err(RiotError::new("synthetic failure")), AccountState::Unknown),
    ];
    for (answer, expected) in answers {
        let probe = Probe { account: answer, ..riot(client()) };
        let look = Look::new(&probe);
        assert_eq!(look.account().unwrap(), expected);
        assert_eq!(look.signed_in().unwrap(), expected == AccountState::Yes);
    }
}

#[test]
fn one_look_asks_each_question_once_and_a_new_look_asks_again() {
    let probe = riot(client());
    let look = Look::new(&probe);
    look.mode().unwrap();
    look.mode().unwrap();
    look.running().unwrap();
    look.in_game().unwrap();
    look.window().unwrap();
    look.account().unwrap();
    look.signed_in().unwrap();
    look.services().unwrap();
    let mut calls = probe.calls.borrow().clone();
    calls.sort();
    assert_eq!(calls, ["authorization", "processes", "session"]);
    Look::new(&probe).account().unwrap();
    assert_eq!(probe.calls.borrow()[3..], ["processes", "authorization"]);
}

#[test]
fn a_failing_service_check_means_background_and_a_failing_process_list_reaches_the_caller() {
    let failing = Probe { session: Err(RiotError::new("synthetic failure")), ..riot(client()) };
    assert_eq!(Look::new(&failing).services().unwrap(), Services::Background);
    let broken = Probe { processes: Err(RiotError::new("tasklist failed")), ..riot(client()) };
    let look = Look::new(&broken);
    assert_eq!(look.mode().unwrap_err().message, "tasklist failed");
    assert_eq!(look.account().unwrap_err().message, "tasklist failed");
}

#[test]
fn the_process_list_is_read_as_it_is_so_a_list_without_the_riot_means_closed() {
    let probe = riot(RunningGames { lol: true, ..RunningGames::default() });
    let look = Look::new(&probe);
    assert!(look.in_game().unwrap());
    assert_eq!(look.mode().unwrap(), Mode::Closed);
}
