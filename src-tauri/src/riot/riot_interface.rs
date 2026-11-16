use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::{check, Cancel, LocalApi, RiotError, RiotResult, RunningGames};

pub const SHOW_INTERFACE: &str = "/riot-client-lifecycle/v1/show";

pub type Probe<'a> = dyn FnMut() -> RiotResult<bool> + 'a;
pub type WaitFor = Arc<dyn Fn(&mut Probe<'_>, u64, u64) -> RiotResult<bool> + Send + Sync>;
pub type Processes = Arc<dyn Fn() -> RiotResult<RunningGames> + Send + Sync>;
pub type Action = Arc<dyn Fn() -> RiotResult<()> + Send + Sync>;
pub type Launch = Arc<dyn Fn(&str, bool) -> RiotResult<()> + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opened {
    Existing,
    Shown,
    Launched,
}

pub fn wait_for(probe: &mut Probe<'_>, timeout_ms: u64, every_ms: u64) -> RiotResult<bool> {
    let end = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() < end {
        if probe()? {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(every_ms));
    }
    Ok(false)
}

pub struct InterfaceOpener {
    pub running_games: Processes,
    pub local_api: Arc<dyn LocalApi>,
    pub stop_client: Action,
    pub launch_client: Launch,
    pub wait_for: WaitFor,
    pub show_timeout_ms: u64,
    pub stop_timeout_ms: u64,
}

impl InterfaceOpener {
    fn request_show(&self) -> bool {
        self.local_api.post(SHOW_INTERFACE).map(|response| response.accepted()).unwrap_or(false)
    }

    pub fn open(&self, exe: &str, cancel: Option<&Cancel>, log: &dyn Fn(&str)) -> RiotResult<Opened> {
        check(cancel)?;
        let running = (self.running_games)()?;
        check(cancel)?;
        if running.client_window {
            return Ok(Opened::Existing);
        }
        if running.client {
            if self.request_show() {
                check(cancel)?;
                let games = self.running_games.clone();
                let shown = (self.wait_for)(&mut || { check(cancel)?; Ok(games()?.client_window) }, self.show_timeout_ms, 500)?;
                if shown {
                    log("opened the Riot interface through the background service");
                    return Ok(Opened::Shown);
                }
            }
            check(cancel)?;
            log("the background service did not open its interface; restarting it with the interface");
            (self.stop_client)()?;
            let games = self.running_games.clone();
            let stopped = (self.wait_for)(&mut || { check(cancel)?; Ok(!games()?.client) }, self.stop_timeout_ms, 250)?;
            if !stopped {
                return Err(RiotError::new("Could not restart the Riot Client with its interface"));
            }
        }
        check(cancel)?;
        (self.launch_client)(exe, true)?;
        log("started the Riot Client with its interface");
        Ok(Opened::Launched)
    }
}
