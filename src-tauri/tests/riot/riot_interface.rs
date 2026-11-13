use std::sync::{Arc, Mutex};

use eclipse::riot::riot_interface::{InterfaceOpener, Opened, SHOW_INTERFACE};
use eclipse::riot::{Cancel, RiotError, RunningGames};
use serde_json::Value;

use crate::{reply, FakeApi};

const EXE: &str = "C:/Riot/RiotClientServices.exe";

#[derive(Clone, Copy)]
struct Setup {
    client: bool,
    client_window: bool,
    show_status: Option<u16>,
    window_after_show: bool,
    stops: bool,
}

impl Default for Setup {
    fn default() -> Self {
        Self { client: false, client_window: false, show_status: Some(204), window_after_show: false, stops: true }
    }
}

struct Fixture {
    opener: InterfaceOpener,
    events: Arc<Mutex<Vec<String>>>,
    logs: Mutex<Vec<String>>,
}

fn fixture(setup: Setup) -> Fixture {
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let state = Arc::new(Mutex::new(RunningGames { client: setup.client, client_window: setup.client_window, ..RunningGames::default() }));
    let (api_events, api_state) = (events.clone(), state.clone());
    let api = FakeApi::new(move |method, path, _| {
        api_events.lock().unwrap().push(format!("api {method} {path}"));
        let Some(status) = setup.show_status else {
            return Err(RiotError::new("connection refused"));
        };
        if setup.window_after_show {
            api_state.lock().unwrap().client_window = true;
        }
        reply(status, Value::Null)
    });
    let (stop_events, stop_state) = (events.clone(), state.clone());
    let (launch_events, launch_state) = (events.clone(), state.clone());
    let processes = state.clone();
    let opener = InterfaceOpener {
        running_games: Arc::new(move || Ok(*processes.lock().unwrap())),
        local_api: api,
        stop_client: Arc::new(move || {
            stop_events.lock().unwrap().push("stop".into());
            if setup.stops {
                stop_state.lock().unwrap().client = false;
            }
            Ok(())
        }),
        launch_client: Arc::new(move |exe, visible| {
            launch_events.lock().unwrap().push(format!("launch {exe} visible={visible}"));
            let mut state = launch_state.lock().unwrap();
            state.client = true;
            state.client_window = true;
            Ok(())
        }),
        wait_for: Arc::new(|probe, _, _| {
            for _ in 0..3 {
                if probe()? {
                    return Ok(true);
                }
            }
            Ok(false)
        }),
        show_timeout_ms: 10_000,
        stop_timeout_ms: 10_000,
    };
    Fixture { opener, events, logs: Mutex::new(Vec::new()) }
}

impl Fixture {
    fn open(&self, cancel: Option<&Cancel>) -> Result<Opened, RiotError> {
        self.opener.open(EXE, cancel, &|line| self.logs.lock().unwrap().push(line.to_string()))
    }

    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }

    fn logs(&self) -> String {
        self.logs.lock().unwrap().join("\n")
    }
}

#[test]
fn an_existing_riot_interface_window_is_reused_without_restarting_anything() {
    let f = fixture(Setup { client: true, client_window: true, ..Setup::default() });
    assert_eq!(f.open(None).unwrap(), Opened::Existing);
    assert!(f.events().is_empty());
}

#[test]
fn headless_services_are_asked_to_show_their_interface_before_any_restart() {
    let f = fixture(Setup { client: true, window_after_show: true, ..Setup::default() });
    assert_eq!(f.open(None).unwrap(), Opened::Shown);
    assert_eq!(f.events(), [format!("api POST {SHOW_INTERFACE}")]);
    assert!(f.logs().contains("background service"));
}

#[test]
fn headless_services_that_do_not_show_an_interface_are_restarted_with_it_visible() {
    for show_status in [Some(204), Some(404), None] {
        let f = fixture(Setup { client: true, show_status, ..Setup::default() });
        assert_eq!(f.open(None).unwrap(), Opened::Launched);
        let events = f.events();
        assert_eq!(events.iter().map(|event| event.split(' ').next().unwrap()).collect::<Vec<_>>(), ["api", "stop", "launch"]);
        assert_eq!(events[2], format!("launch {EXE} visible=true"));
        assert!(f.logs().contains("restarting it with the interface"));
    }
}

#[test]
fn stopped_services_start_directly_with_the_visible_interface() {
    let f = fixture(Setup::default());
    assert_eq!(f.open(None).unwrap(), Opened::Launched);
    assert_eq!(f.events(), [format!("launch {EXE} visible=true")]);
}

#[test]
fn services_that_refuse_to_stop_are_reported_instead_of_starting_a_second_client() {
    let f = fixture(Setup { client: true, stops: false, ..Setup::default() });
    assert_eq!(f.open(None).unwrap_err().message, "Could not restart the Riot Client with its interface");
    assert!(!f.events().iter().any(|event| event.starts_with("launch")));
}

#[test]
fn cancellation_stops_before_showing_restarting_or_launching_the_interface() {
    let cancel = Cancel::new();
    cancel.cancel();
    let f = fixture(Setup { client: true, ..Setup::default() });
    assert!(f.open(Some(&cancel)).unwrap_err().is_cancelled());
    assert!(f.events().is_empty());
}
