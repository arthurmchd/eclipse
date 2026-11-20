use std::cell::OnceCell;

use super::riot_authentication::AuthState;
use super::{AccountState, RiotResult, RunningGames};

pub trait RiotProbe {
    fn running_games(&self) -> RiotResult<RunningGames>;

    fn authorization(&self) -> RiotResult<AccountState> {
        Ok(AccountState::Unknown)
    }

    fn session_state(&self) -> RiotResult<Option<AuthState>> {
        Ok(None)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Services {
    Off,
    Ready,
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Closed,
    Game,
    Window,
    Hidden,
    Background,
}

pub struct Look<'a> {
    probe: &'a dyn RiotProbe,
    processes: OnceCell<RiotResult<RunningGames>>,
    account: OnceCell<AccountState>,
    services: OnceCell<Services>,
}

impl<'a> Look<'a> {
    pub fn new(probe: &'a dyn RiotProbe) -> Self {
        Self { probe, processes: OnceCell::new(), account: OnceCell::new(), services: OnceCell::new() }
    }

    pub fn processes(&self) -> RiotResult<RunningGames> {
        self.processes.get_or_init(|| self.probe.running_games()).clone()
    }

    pub fn running(&self) -> RiotResult<bool> {
        Ok(self.processes()?.client)
    }

    pub fn in_game(&self) -> RiotResult<bool> {
        Ok(self.processes()?.any_game())
    }

    pub fn window(&self) -> RiotResult<bool> {
        Ok(self.processes()?.client_window)
    }

    pub fn account(&self) -> RiotResult<AccountState> {
        if !self.running()? {
            return Ok(AccountState::No);
        }
        Ok(*self.account.get_or_init(|| self.probe.authorization().unwrap_or(AccountState::Unknown)))
    }

    pub fn signed_in(&self) -> RiotResult<bool> {
        Ok(self.account()? == AccountState::Yes)
    }

    pub fn services(&self) -> RiotResult<Services> {
        if !self.running()? {
            return Ok(Services::Off);
        }
        Ok(*self.services.get_or_init(|| match self.probe.session_state() {
            Ok(Some(_)) => Services::Ready,
            _ => Services::Background,
        }))
    }

    pub fn mode(&self) -> RiotResult<Mode> {
        if !self.running()? {
            return Ok(Mode::Closed);
        }
        if self.in_game()? {
            return Ok(Mode::Game);
        }
        if self.window()? {
            return Ok(Mode::Window);
        }
        Ok(if self.services()? == Services::Ready { Mode::Hidden } else { Mode::Background })
    }
}
