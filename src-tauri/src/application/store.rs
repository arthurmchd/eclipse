use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{SecondsFormat, TimeZone, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::platform::windows::safe_storage::Cipher;

pub const RETIRED_SETTINGS: [&str; 4] = ["minimizeOnLaunch", "hideRiotClient", "closeRiotClient", "streamerMode"];
const BACKUP_ACCOUNT_FIELDS: [&str; 12] = ["id", "createdAt", "gameName", "tagLine", "region", "valRegion", "username", "password", "note", "lastSeason", "ban", "pinned"];
const BACKUP_LIMIT: usize = 30;
const LOG_LIMIT: u64 = 200 * 1024;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreData {
    pub accounts: Vec<Map<String, Value>>,
    pub settings: Map<String, Value>,
    pub last_refresh: Option<String>,
    pub current_account_id: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct AccountInput {
    pub id: Option<String>,
    pub game_name: String,
    pub tag_line: String,
    pub region: String,
    pub val_region: String,
    pub username: String,
    pub password: Option<String>,
    pub note: String,
    pub last_season: Map<String, Value>,
    pub ban: Value,
}

#[derive(Clone, Debug, Default)]
pub struct SettingsInput {
    pub refresh_minutes: Option<f64>,
    pub stay_signed_in: Option<bool>,
    pub riot_client_path: Option<String>,
    pub language: Option<String>,
    pub card_layout: Option<String>,
    pub riot_api_key: Option<String>,
    pub riot_tft_api_key: Option<String>,
    pub henrik_api_key: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ApiKeys {
    pub riot: String,
    pub tft: String,
    pub henrik: String,
}

pub fn default_settings() -> Map<String, Value> {
    let Value::Object(settings) = json!({
        "riotApiKey": null,
        "riotTftApiKey": null,
        "henrikApiKey": null,
        "refreshMinutes": 30,
        "staySignedIn": true,
        "riotClientPath": "",
        "language": "pt",
    }) else {
        unreachable!()
    };
    settings
}

pub fn clean_name(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(*c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}'))
        .collect::<String>()
        .trim()
        .to_string()
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn iso_from_millis(millis: i64) -> String {
    Utc.timestamp_millis_opt(millis).single().unwrap_or_else(Utc::now).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        Value::from(value as i64)
    } else {
        serde_json::Number::from_f64(value).map(Value::Number).unwrap_or(Value::Null)
    }
}

fn session_id_valid(id: &str) -> bool {
    static ALLOWED: OnceLock<Regex> = OnceLock::new();
    static RESERVED: OnceLock<Regex> = OnceLock::new();
    ALLOWED.get_or_init(|| Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$").unwrap()).is_match(id)
        && !RESERVED.get_or_init(|| Regex::new(r"(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])$").unwrap()).is_match(id)
}

fn text_of(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_string()
}

pub struct Store {
    pub dir: PathBuf,
    pub file: PathBuf,
    pub sessions_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub data: StoreData,
    cipher: Arc<dyn Cipher>,
    saved_snapshot: String,
    last_backup_time: i64,
}

impl Store {
    pub fn open(dir: &Path, cipher: Arc<dyn Cipher>) -> Self {
        let mut store = Self {
            dir: dir.to_path_buf(),
            file: dir.join("data.json"),
            sessions_dir: dir.join("sessions"),
            backups_dir: dir.join("backups"),
            data: StoreData::default(),
            cipher,
            saved_snapshot: String::new(),
            last_backup_time: 0,
        };
        store.data = store.load();
        store.saved_snapshot = store.backup_snapshot();
        store.log(&format!("opened with {} accounts", store.data.accounts.len()));
        if !store.data.accounts.is_empty() && store.list_backups().is_empty() {
            let json = store.to_json();
            store.backup(&json);
        }
        store
    }

    fn append(&self, name: &str, line: &str) {
        let file = self.dir.join(name);
        if fs::metadata(&file).map(|meta| meta.len() > LOG_LIMIT).unwrap_or(false) {
            let _ = fs::rename(&file, self.dir.join(format!("{name}.old")));
        }
        if let Ok(mut handle) = fs::OpenOptions::new().create(true).append(true).open(&file) {
            let _ = writeln!(handle, "{} {}", now_iso(), line);
        }
    }

    pub fn log(&self, line: &str) {
        self.append("data.log", line);
    }

    pub fn sign_in_log(&self, line: &str) {
        self.append("sign-in.log", line);
    }

    fn encrypt(&self, text: &str) -> Result<Value, String> {
        if text.is_empty() {
            return Ok(Value::Null);
        }
        Ok(Value::String(STANDARD.encode(self.cipher.encrypt(text.as_bytes())?)))
    }

    fn decrypt(&self, blob: Option<&Value>) -> Result<String, String> {
        let encoded = match blob {
            Some(Value::String(encoded)) if !encoded.is_empty() => encoded,
            _ => return Ok(String::new()),
        };
        let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
        let plain = self.cipher.decrypt(&bytes)?;
        String::from_utf8(plain).map_err(|error| error.to_string())
    }

    fn to_json(&self) -> String {
        serde_json::to_string_pretty(&self.data).unwrap_or_default()
    }

    fn backup_snapshot(&self) -> String {
        let accounts: Vec<Value> = self
            .data
            .accounts
            .iter()
            .map(|account| {
                Value::Object(
                    BACKUP_ACCOUNT_FIELDS
                        .iter()
                        .filter_map(|key| account.get(*key).map(|value| (key.to_string(), value.clone())))
                        .collect(),
                )
            })
            .collect();
        json!({ "accounts": accounts, "settings": self.data.settings }).to_string()
    }

    fn parse(&self, file: &Path) -> Result<StoreData, String> {
        let raw: Value = serde_json::from_slice(&fs::read(file).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        let mut accounts: Vec<Map<String, Value>> = raw
            .get("accounts")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(|item| item.as_object().cloned()).collect())
            .unwrap_or_default();
        for account in &mut accounts {
            for key in ["gameName", "tagLine"] {
                let cleaned = clean_name(&text_of(account.get(key)));
                account.insert(key.into(), Value::String(cleaned));
            }
        }
        let mut settings = default_settings();
        if let Some(saved) = raw.get("settings").and_then(Value::as_object) {
            for (key, value) in saved {
                settings.insert(key.clone(), value.clone());
            }
        }
        for key in RETIRED_SETTINGS {
            settings.shift_remove(key);
        }
        let optional = |key: &str| raw.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string);
        Ok(StoreData { accounts, settings, last_refresh: optional("lastRefresh"), current_account_id: optional("currentAccountId") })
    }

    pub fn list_backups(&self) -> Vec<String> {
        let Ok(entries) = fs::read_dir(&self.backups_dir) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| name.starts_with("data-") && name.ends_with(".json"))
            .collect();
        names.sort();
        names.reverse();
        names
    }

    pub fn load(&self) -> StoreData {
        match self.parse(&self.file) {
            Ok(data) => return data,
            Err(error) => {
                if self.file.exists() {
                    let corrupt = PathBuf::from(format!("{}.corrupt-{}", self.file.display(), Utc::now().timestamp_millis()));
                    let _ = fs::copy(&self.file, corrupt);
                    self.log(&format!("data.json unreadable ({error}), kept a copy"));
                }
            }
        }
        for name in self.list_backups() {
            if let Ok(data) = self.parse(&self.backups_dir.join(&name)) {
                self.log(&format!("restored {} accounts from backup {}", data.accounts.len(), name));
                return data;
            }
        }
        StoreData { settings: default_settings(), ..StoreData::default() }
    }

    fn backup(&mut self, json: &str) {
        let result = (|| -> Result<(), String> {
            fs::create_dir_all(&self.backups_dir).map_err(|error| error.to_string())?;
            self.last_backup_time = Utc::now().timestamp_millis().max(self.last_backup_time + 1);
            let stamp = iso_from_millis(self.last_backup_time).replace([':', '.'], "-");
            let name = format!("data-{stamp}-{}.json", uuid::Uuid::new_v4());
            fs::write(self.backups_dir.join(name), json).map_err(|error| error.to_string())?;
            for old in self.list_backups().into_iter().skip(BACKUP_LIMIT) {
                let _ = fs::remove_file(self.backups_dir.join(old));
            }
            Ok(())
        })();
        if let Err(error) = result {
            self.log(&format!("backup failed: {error}"));
        }
    }

    pub fn save(&mut self) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|error| error.to_string())?;
        let json = self.to_json();
        let temporary = PathBuf::from(format!("{}.tmp", self.file.display()));
        if let Err(error) = fs::write(&temporary, &json).and_then(|_| fs::rename(&temporary, &self.file)) {
            self.log(&format!("save FAILED: {error}"));
            return Err(error.to_string());
        }
        let snapshot = self.backup_snapshot();
        if snapshot != self.saved_snapshot {
            self.log(&format!("saved {} accounts", self.data.accounts.len()));
            self.backup(&json);
            self.saved_snapshot = snapshot;
        }
        Ok(())
    }

    pub fn public_account(&self, account: &Map<String, Value>) -> Map<String, Value> {
        let mut public: Map<String, Value> = account.iter().filter(|(key, _)| *key != "password").map(|(key, value)| (key.clone(), value.clone())).collect();
        let has_password = account.get("password").map(|value| !matches!(value, Value::Null) && value.as_str() != Some("")).unwrap_or(false);
        let id = text_of(account.get("id"));
        public.insert("hasPassword".into(), Value::Bool(has_password));
        public.insert("hasSession".into(), Value::Bool(self.has_session(&id).unwrap_or(false)));
        public
    }

    pub fn list_accounts(&self) -> Vec<Map<String, Value>> {
        self.data.accounts.iter().map(|account| self.public_account(account)).collect()
    }

    pub fn get_account(&self, id: &str) -> Option<&Map<String, Value>> {
        self.data.accounts.iter().find(|account| account.get("id").and_then(Value::as_str) == Some(id))
    }

    fn account_index(&self, id: &str) -> Option<usize> {
        self.data.accounts.iter().position(|account| account.get("id").and_then(Value::as_str) == Some(id))
    }

    pub fn upsert_account(&mut self, input: AccountInput) -> Result<Map<String, Value>, String> {
        let existing = input.id.as_deref().and_then(|id| self.account_index(id));
        let mut account = match existing {
            Some(index) => self.data.accounts[index].clone(),
            None => {
                let mut fresh = Map::new();
                fresh.insert("id".into(), Value::String(uuid::Uuid::new_v4().to_string()));
                fresh.insert("createdAt".into(), Value::String(now_iso()));
                fresh.insert("stats".into(), json!({}));
                fresh.insert("lastPlayed".into(), Value::Null);
                fresh
            }
        };
        account.insert("gameName".into(), Value::String(clean_name(&input.game_name)));
        account.insert("tagLine".into(), Value::String(clean_name(&input.tag_line).trim_start_matches('#').to_string()));
        account.insert("region".into(), Value::String(if input.region.is_empty() { "br1".into() } else { input.region.clone() }));
        account.insert("valRegion".into(), Value::String(input.val_region.clone()));
        let old_username = account.get("username").cloned();
        let username = input.username.trim().to_string();
        account.insert("username".into(), Value::String(username.clone()));
        account.insert("note".into(), Value::String(input.note.clone()));
        let mut seasons = Map::new();
        seasons.insert("lol".into(), Value::String(String::new()));
        seasons.insert("tft".into(), Value::String(String::new()));
        for (key, value) in input.last_season {
            seasons.insert(key, value);
        }
        account.insert("lastSeason".into(), Value::Object(seasons));
        account.insert("ban".into(), if input.ban.is_object() { input.ban.clone() } else { Value::Null });
        let new_password = input.password.as_deref().filter(|password| !password.is_empty());
        if let Some(password) = new_password {
            account.insert("password".into(), self.encrypt(password)?);
        }
        let id = text_of(account.get("id"));
        match existing {
            Some(index) => {
                self.data.accounts[index] = account;
                if new_password.is_some() || old_username != Some(Value::String(username)) {
                    self.forget_session(&id)?;
                }
            }
            None => self.data.accounts.push(account),
        }
        self.save()?;
        Ok(self.public_account(self.get_account(&id).unwrap()))
    }

    pub fn delete_account(&mut self, id: &str) -> Result<(), String> {
        self.forget_session(id)?;
        if self.data.current_account_id.as_deref() == Some(id) {
            self.data.current_account_id = None;
        }
        self.data.accounts.retain(|account| account.get("id").and_then(Value::as_str) != Some(id));
        self.save()
    }

    pub fn update_account_fields(&mut self, id: &str, fields: Map<String, Value>) -> Result<Option<Map<String, Value>>, String> {
        let Some(index) = self.account_index(id) else {
            return Ok(None);
        };
        for (key, value) in fields {
            self.data.accounts[index].insert(key, value);
        }
        self.save()?;
        Ok(Some(self.public_account(&self.data.accounts[index])))
    }

    pub fn get_password(&self, id: &str) -> Result<String, String> {
        match self.get_account(id) {
            Some(account) => self.decrypt(account.get("password")),
            None => Ok(String::new()),
        }
    }

    pub fn session_file(&self, id: &str) -> Result<PathBuf, String> {
        if !session_id_valid(id) {
            return Err("Invalid account ID".into());
        }
        Ok(self.sessions_dir.join(format!("{id}.bin")))
    }

    pub fn has_session(&self, id: &str) -> Result<bool, String> {
        Ok(self.session_file(id)?.exists())
    }

    pub fn save_session(&self, id: &str, yaml: &str) -> Result<(), String> {
        let file = self.session_file(id)?;
        if self.get_account(id).is_none() {
            return Err("Account not found".into());
        }
        if yaml.is_empty() {
            return Err("Cannot save an empty session".into());
        }
        let encrypted = self.cipher.encrypt(yaml.as_bytes())?;
        fs::create_dir_all(&self.sessions_dir).map_err(|error| error.to_string())?;
        let temporary = PathBuf::from(format!("{}.{}.tmp", file.display(), uuid::Uuid::new_v4()));
        let written = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .and_then(|mut handle| handle.write_all(&encrypted))
            .and_then(|_| fs::rename(&temporary, &file));
        let _ = fs::remove_file(&temporary);
        written.map_err(|error| error.to_string())
    }

    pub fn session_saved_at(&self, id: &str) -> Result<f64, String> {
        let file = self.session_file(id)?;
        Ok(fs::metadata(file)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_secs_f64() * 1000.0)
            .unwrap_or(0.0))
    }

    pub fn load_session(&self, id: &str) -> Option<String> {
        let bytes = fs::read(self.session_file(id).ok()?).ok()?;
        String::from_utf8(self.cipher.decrypt(&bytes).ok()?).ok()
    }

    pub fn forget_session(&self, id: &str) -> Result<(), String> {
        let file = self.session_file(id)?;
        if self.get_account(id).is_none() {
            return Err("Account not found".into());
        }
        match fs::remove_file(file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        }
    }

    pub fn set_current_account(&mut self, id: &str) -> Result<(), String> {
        self.data.current_account_id = Some(id.to_string());
        self.save()
    }

    pub fn public_settings(&self) -> Map<String, Value> {
        let settings = &self.data.settings;
        let mask = |blob: Option<&Value>| -> String {
            match self.decrypt(blob) {
                Ok(value) if value.is_empty() => String::new(),
                Ok(value) => {
                    let chars: Vec<char> = value.chars().collect();
                    let head: String = chars.iter().take(8).collect();
                    let tail: String = chars[chars.len().saturating_sub(4)..].iter().collect();
                    format!("{head}…{tail}")
                }
                Err(error) => {
                    self.log(&format!("could not decrypt a saved API key: {error}"));
                    let present = matches!(blob, Some(Value::String(text)) if !text.is_empty());
                    if present { "(unreadable, paste it again)".into() } else { String::new() }
                }
            }
        };
        let mut public = Map::new();
        public.insert("refreshMinutes".into(), settings.get("refreshMinutes").cloned().unwrap_or(Value::Null));
        public.insert("staySignedIn".into(), Value::Bool(settings.get("staySignedIn") != Some(&Value::Bool(false))));
        public.insert("riotClientPath".into(), settings.get("riotClientPath").cloned().unwrap_or(Value::Null));
        let language = if settings.get("language").and_then(Value::as_str) == Some("en") { "en" } else { "pt" };
        public.insert("language".into(), Value::String(language.into()));
        let layout = if settings.get("cardLayout").and_then(Value::as_str) == Some("list") { "list" } else { "plates" };
        public.insert("cardLayout".into(), Value::String(layout.into()));
        public.insert("riotApiKeyMasked".into(), Value::String(mask(settings.get("riotApiKey"))));
        public.insert("riotTftApiKeyMasked".into(), Value::String(mask(settings.get("riotTftApiKey"))));
        public.insert("henrikApiKeyMasked".into(), Value::String(mask(settings.get("henrikApiKey"))));
        public
    }

    pub fn update_settings(&mut self, input: SettingsInput) -> Result<Map<String, Value>, String> {
        if let Some(minutes) = input.refresh_minutes {
            self.data.settings.insert("refreshMinutes".into(), number(minutes));
        }
        if let Some(stay) = input.stay_signed_in {
            self.data.settings.insert("staySignedIn".into(), Value::Bool(stay));
        }
        if let Some(path) = input.riot_client_path {
            self.data.settings.insert("riotClientPath".into(), Value::String(path));
        }
        if let Some(language) = input.language {
            self.data.settings.insert("language".into(), Value::String(language));
        }
        if let Some(layout) = input.card_layout {
            self.data.settings.insert("cardLayout".into(), Value::String(layout));
        }
        for (name, value) in [("riotApiKey", input.riot_api_key), ("riotTftApiKey", input.riot_tft_api_key), ("henrikApiKey", input.henrik_api_key)] {
            if let Some(value) = value {
                let encrypted = self.encrypt(value.trim())?;
                self.data.settings.insert(name.into(), encrypted);
            }
        }
        self.save()?;
        Ok(self.public_settings())
    }

    pub fn get_keys(&self) -> ApiKeys {
        let readable = |name: &str| match self.decrypt(self.data.settings.get(name)) {
            Ok(value) => value,
            Err(_) => {
                self.log(&format!("could not decrypt the saved {name}, skipped it"));
                String::new()
            }
        };
        ApiKeys { riot: readable("riotApiKey"), tft: readable("riotTftApiKey"), henrik: readable("henrikApiKey") }
    }
}

pub trait ServiceStore: Send + Sync {
    fn accounts(&self) -> Vec<Map<String, Value>>;
    fn account(&self, id: &str) -> Option<Map<String, Value>>;
    fn setting(&self, name: &str) -> Option<Value>;
    fn password(&self, id: &str) -> Result<String, String>;
    fn has_session(&self, id: &str) -> bool;
    fn load_session(&self, id: &str) -> Option<String>;
    fn save_session(&self, id: &str, yaml: &str) -> Result<(), String>;
    fn session_saved_at(&self, id: &str) -> Result<f64, String>;
    fn forget_session(&self, id: &str) -> Result<(), String>;
    fn set_current_account(&self, id: &str) -> Result<(), String>;
    fn update_account_fields(&self, id: &str, fields: Map<String, Value>) -> Result<Option<Map<String, Value>>, String>;
    fn public_account(&self, id: &str) -> Option<Map<String, Value>>;
}

pub fn stay_signed_in(store: &dyn ServiceStore) -> bool {
    store.setting("staySignedIn") != Some(Value::Bool(false))
}

pub fn client_path(store: &dyn ServiceStore) -> String {
    store.setting("riotClientPath").and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default()
}

impl ServiceStore for std::sync::Mutex<Store> {
    fn accounts(&self) -> Vec<Map<String, Value>> {
        self.lock().map(|store| store.data.accounts.clone()).unwrap_or_default()
    }

    fn account(&self, id: &str) -> Option<Map<String, Value>> {
        self.lock().ok()?.get_account(id).cloned()
    }

    fn setting(&self, name: &str) -> Option<Value> {
        self.lock().ok()?.data.settings.get(name).cloned()
    }

    fn password(&self, id: &str) -> Result<String, String> {
        self.lock().map_err(|error| error.to_string())?.get_password(id)
    }

    fn has_session(&self, id: &str) -> bool {
        self.lock().ok().and_then(|store| store.has_session(id).ok()).unwrap_or(false)
    }

    fn load_session(&self, id: &str) -> Option<String> {
        self.lock().ok()?.load_session(id)
    }

    fn save_session(&self, id: &str, yaml: &str) -> Result<(), String> {
        self.lock().map_err(|error| error.to_string())?.save_session(id, yaml)
    }

    fn session_saved_at(&self, id: &str) -> Result<f64, String> {
        self.lock().map_err(|error| error.to_string())?.session_saved_at(id)
    }

    fn forget_session(&self, id: &str) -> Result<(), String> {
        self.lock().map_err(|error| error.to_string())?.forget_session(id)
    }

    fn set_current_account(&self, id: &str) -> Result<(), String> {
        self.lock().map_err(|error| error.to_string())?.set_current_account(id)
    }

    fn update_account_fields(&self, id: &str, fields: Map<String, Value>) -> Result<Option<Map<String, Value>>, String> {
        self.lock().map_err(|error| error.to_string())?.update_account_fields(id, fields)
    }

    fn public_account(&self, id: &str) -> Option<Map<String, Value>> {
        let store = self.lock().ok()?;
        store.get_account(id).map(|account| store.public_account(account))
    }
}

pub fn account_riot_id(account: &Map<String, Value>) -> crate::riot::RiotId {
    crate::riot::RiotId::new(&text_of(account.get("gameName")), &text_of(account.get("tagLine")))
}

pub fn account_id(account: &Map<String, Value>) -> String {
    text_of(account.get("id"))
}
