use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::manager_service::{Failure, ManagerPorts};
use super::rank_api::{regions_json, VAL_REGIONS};
use super::refresher::Refresher;
use super::sign_in_service::SignInService;
use super::store::{account_id, account_riot_id, ServiceStore};
use crate::riot::riot_client::has_persisted_login;
use crate::riot::sign_in_flow::Closed;
use crate::riot::{same_riot_id, RunningGames};

pub type Probe = Box<dyn Fn() -> Result<RunningGames, String> + Send + Sync>;
pub type Opener = Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>;
pub type SettingsChanged = Box<dyn Fn(&Map<String, Value>) + Send + Sync>;

pub const OPEN_FAILED: &str = "Could not open the link";

pub fn running_games_json(games: RunningGames) -> Value {
    json!({ "lol": games.lol, "val": games.val, "client": games.client, "clientWindow": games.client_window })
}

pub struct AppPorts {
    pub sign_in: Arc<SignInService>,
    pub refresher: Arc<Refresher>,
    pub running_games: Probe,
    pub open_external: Opener,
    pub settings_changed: SettingsChanged,
    pub version: String,
}

impl ManagerPorts for AppPorts {
    fn active_account_id(&self) -> Option<String> {
        self.sign_in.active_account_id()
    }

    fn operation(&self) -> Value {
        self.sign_in.get_state()
    }

    fn start_sign_in(&self, id: &str, game: &str) -> Result<Value, Failure> {
        self.sign_in.start_from_manager(id, game).map_err(|message| Failure::new(&message, 409))
    }

    fn cancel_sign_in(&self) -> Value {
        self.sign_in.cancel()
    }

    fn running_games(&self) -> Result<Value, Failure> {
        (self.running_games)().map(running_games_json).map_err(|message| Failure::new(&message, 500))
    }

    fn open_external(&self, url: &str) -> Result<(), Failure> {
        (self.open_external)(url).map_err(|_| Failure::new(OPEN_FAILED, 500))
    }

    fn refresh_all(&self, ids: Option<Vec<String>>) {
        self.refresher.request(ids);
    }

    fn schedule_refresh(&self) {
        self.refresher.schedule();
    }

    fn init_context(&self) -> Map<String, Value> {
        let mut context = Map::new();
        context.insert("regions".into(), regions_json());
        context.insert("valRegions".into(), json!(VAL_REGIONS));
        context.insert("version".into(), Value::String(self.version.clone()));
        context.insert("lastRefresh".into(), self.refresher.last_refresh());
        context.insert("nextRefresh".into(), self.refresher.next_refresh());
        context
    }

    fn settings_changed(&self, settings: &Map<String, Value>) {
        (self.settings_changed)(settings);
    }
}

pub const KEPT_OWNER: &str = "updated the session of the account that was signed in";
pub const UNCONFIRMED: &str = "previous session identity could not be confirmed; not saving it";
pub const KEPT_PREVIOUS: &str = "updated the previous account session";

pub struct Leaving<'a> {
    pub keep: &'a dyn Fn(&str) -> Result<Option<String>, String>,
    pub store: &'a dyn ServiceStore,
    pub current: Option<String>,
    pub publish: &'a dyn Fn(Map<String, Value>),
    pub log: &'a dyn Fn(&str),
}

pub fn save_leaving_session(closed: &Closed, leaving: Leaving) -> Result<(), String> {
    let yaml = closed.yaml.as_deref();
    if let Some(yaml) = yaml {
        if (leaving.keep)(yaml)?.is_some() {
            (leaving.log)(KEPT_OWNER);
            return Ok(());
        }
    }
    let Some(previous) = leaving.current.as_deref().and_then(|id| leaving.store.account(id)) else {
        return Ok(());
    };
    if !has_persisted_login(yaml) {
        return Ok(());
    }
    if !same_riot_id(closed.riot_id.as_ref(), Some(&account_riot_id(&previous))) {
        (leaving.log)(UNCONFIRMED);
        return Ok(());
    }
    let id = account_id(&previous);
    leaving.store.save_session(&id, yaml.unwrap_or_default())?;
    if let Some(account) = leaving.store.public_account(&id) {
        (leaving.publish)(account);
    }
    (leaving.log)(KEPT_PREVIOUS);
    Ok(())
}
