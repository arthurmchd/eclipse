#[path = "application/app_ports.rs"]
mod app_ports;
#[path = "application/language.rs"]
mod language;
#[path = "application/manager_service.rs"]
mod manager_service;
#[path = "application/notices.rs"]
mod notices;
#[path = "application/opgg.rs"]
mod opgg;
#[path = "application/rank_api.rs"]
mod rank_api;
#[path = "application/rank_watcher.rs"]
mod rank_watcher;
#[path = "application/refresher.rs"]
mod refresher;
#[path = "application/riot_wakeup.rs"]
mod riot_wakeup;
#[path = "application/session_keeper.rs"]
mod session_keeper;
#[path = "application/sign_in_service.rs"]
mod sign_in_service;
#[path = "application/store.rs"]
mod store;
#[path = "application/timers.rs"]
mod timers;
#[path = "application/updates.rs"]
mod updates;
#[path = "support/manual_timers.rs"]
mod manual_timers;

pub use manual_timers::ManualTimers;

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use eclipse::application::store::{ServiceStore, Store};
use eclipse::platform::windows::safe_storage::Cipher;
use serde_json::{Map, Value};
use tempfile::TempDir;

pub const FAKE_PREFIX: &str = "test-encrypted:";

pub struct FakeCipher;

impl Cipher for FakeCipher {
    fn encrypt(&self, plain: &[u8]) -> Result<Vec<u8>, String> {
        Ok(format!("{FAKE_PREFIX}{}", STANDARD.encode(plain)).into_bytes())
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, String> {
        let text = String::from_utf8(blob.to_vec()).map_err(|error| error.to_string())?;
        let encoded = text.strip_prefix(FAKE_PREFIX).ok_or("not encrypted by this user")?;
        STANDARD.decode(encoded).map_err(|error| error.to_string())
    }
}

pub fn temporary_store() -> (TempDir, Store) {
    let dir = tempfile::Builder::new().prefix("eclipse-store-test-").tempdir().unwrap();
    let store = Store::open(dir.path(), Arc::new(FakeCipher));
    (dir, store)
}

pub struct FakeStore {
    pub accounts: Mutex<Vec<Map<String, Value>>>,
    pub settings: Mutex<Map<String, Value>>,
    pub sessions: Mutex<BTreeMap<String, String>>,
    pub saved_at: Mutex<HashMap<String, f64>>,
    pub calls: Arc<Mutex<Vec<Value>>>,
    pub failing: Mutex<Vec<String>>,
    pub failure: Mutex<String>,
    pub decrypted: Mutex<String>,
}

pub fn object(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap()
}

impl FakeStore {
    pub fn new(accounts: Vec<Value>) -> Arc<Self> {
        Arc::new(Self {
            accounts: Mutex::new(accounts.into_iter().map(object).collect()),
            settings: Mutex::new(Map::new()),
            sessions: Mutex::new(BTreeMap::new()),
            saved_at: Mutex::new(HashMap::new()),
            calls: Arc::new(Mutex::new(Vec::new())),
            failing: Mutex::new(Vec::new()),
            failure: Mutex::new("storage unavailable".into()),
            decrypted: Mutex::new("decrypted-secret".into()),
        })
    }

    pub fn record(&self, call: Value) {
        self.calls.lock().unwrap().push(call);
    }

    pub fn calls(&self) -> Vec<Value> {
        self.calls.lock().unwrap().clone()
    }

    pub fn names(&self) -> Vec<String> {
        self.calls().iter().map(|call| call[0].as_str().unwrap_or_default().to_string()).collect()
    }

    pub fn fail(&self, method: &str) {
        self.failing.lock().unwrap().push(method.to_string());
    }

    pub fn set(&self, name: &str, value: Value) {
        self.settings.lock().unwrap().insert(name.into(), value);
    }

    pub fn session(&self, id: &str, yaml: &str) {
        self.sessions.lock().unwrap().insert(id.into(), yaml.into());
    }

    pub fn edit(&self, id: &str, key: &str, value: Value) {
        if let Some(account) = self.accounts.lock().unwrap().iter_mut().find(|account| account["id"] == id) {
            account.insert(key.into(), value);
        }
    }

    fn check(&self, method: &str, id: &str) -> Result<(), String> {
        let failing = self.failing.lock().unwrap();
        if failing.iter().any(|name| name == method || *name == format!("{method}:{id}")) {
            return Err(self.failure.lock().unwrap().clone());
        }
        Ok(())
    }

    fn public(account: &Map<String, Value>) -> Map<String, Value> {
        account.iter().filter(|(key, _)| *key != "password" && *key != "username").map(|(key, value)| (key.clone(), value.clone())).collect()
    }
}

impl ServiceStore for FakeStore {
    fn accounts(&self) -> Vec<Map<String, Value>> {
        self.accounts.lock().unwrap().clone()
    }

    fn account(&self, id: &str) -> Option<Map<String, Value>> {
        self.accounts.lock().unwrap().iter().find(|account| account["id"] == id).cloned()
    }

    fn setting(&self, name: &str) -> Option<Value> {
        self.settings.lock().unwrap().get(name).cloned()
    }

    fn password(&self, id: &str) -> Result<String, String> {
        self.record(serde_json::json!(["get-password", id]));
        self.check("password", id)?;
        Ok(self.decrypted.lock().unwrap().clone())
    }

    fn has_session(&self, id: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(id)
    }

    fn load_session(&self, id: &str) -> Option<String> {
        self.sessions.lock().unwrap().get(id).cloned()
    }

    fn save_session(&self, id: &str, yaml: &str) -> Result<(), String> {
        self.check("save_session", id)?;
        self.record(serde_json::json!(["save-session", id, yaml]));
        self.sessions.lock().unwrap().insert(id.into(), yaml.into());
        self.saved_at.lock().unwrap().remove(id);
        Ok(())
    }

    fn session_saved_at(&self, id: &str) -> Result<f64, String> {
        self.check("session_saved_at", id)?;
        if !self.has_session(id) {
            return Ok(0.0);
        }
        Ok(self.saved_at.lock().unwrap().get(id).copied().unwrap_or(eclipse::application::session_keeper::KEPT_SINCE_MS + 1.0))
    }

    fn forget_session(&self, id: &str) -> Result<(), String> {
        self.check("forget_session", id)?;
        self.record(serde_json::json!(["forget-session", id]));
        self.sessions.lock().unwrap().remove(id);
        Ok(())
    }

    fn set_current_account(&self, id: &str) -> Result<(), String> {
        self.check("set_current_account", id)?;
        self.record(serde_json::json!(["set-current", id]));
        Ok(())
    }

    fn update_account_fields(&self, id: &str, fields: Map<String, Value>) -> Result<Option<Map<String, Value>>, String> {
        self.check("update_account_fields", id)?;
        self.record(serde_json::json!(["update", id, fields]));
        let mut accounts = self.accounts.lock().unwrap();
        let Some(account) = accounts.iter_mut().find(|account| account["id"] == id) else {
            return Ok(None);
        };
        for (key, value) in fields {
            account.insert(key, value);
        }
        Ok(Some(Self::public(account)))
    }

    fn public_account(&self, id: &str) -> Option<Map<String, Value>> {
        self.account(id).map(|account| Self::public(&account))
    }
}
