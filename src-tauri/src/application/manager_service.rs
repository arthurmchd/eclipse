use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};

use regex::Regex;
use serde_json::{json, Map, Value};

use super::language::LANGUAGES;

pub const CARD_LAYOUTS: [&str; 2] = ["plates", "list"];
pub const PAGE_THEMES: [&str; 2] = ["light", "dark"];
pub const CARD_SORTS: [&str; 4] = ["manual", "rank", "name", "recent"];
pub const MAX_BATCH: usize = 50;
use super::store::{account_riot_id, AccountInput, SettingsInput, Store, ACCOUNT_GAMES};
use crate::riot::{same_riot_id, RiotId};

pub const CHANNELS: [&str; 5] = ["account-updated", "refresh-progress", "next-refresh", "sign-in-status", "sign-in-operation"];
const ACCOUNT_FIELDS: [&str; 18] = ["id", "createdAt", "gameName", "tagLine", "region", "valRegion", "username", "note", "lastSeason", "ban", "pinned", "games", "signInCount", "stats", "lastPlayed", "lastGame", "hasPassword", "hasSession"];
const GAMES: [&str; 6] = ["lol", "tft", "val", "2xko", "lor", "riot"];
const RESERVED_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub message: String,
    pub status: u16,
}

impl Failure {
    pub fn new(message: &str, status: u16) -> Self {
        Self { message: message.to_string(), status }
    }

    fn invalid() -> Self {
        Self::new("Invalid account command", 400)
    }

    fn internal(message: String) -> Self {
        Self { message, status: 500 }
    }
}

pub trait ManagerPorts: Send + Sync {
    fn active_account_id(&self) -> Option<String>;
    fn operation(&self) -> Value;
    fn start_sign_in(&self, id: &str, game: &str) -> Result<Value, Failure>;
    fn cancel_sign_in(&self) -> Value;
    fn running_games(&self) -> Result<Value, Failure>;
    fn open_external(&self, url: &str) -> Result<(), Failure>;
    fn refresh_all(&self, ids: Option<Vec<String>>);
    fn schedule_refresh(&self);
    fn init_context(&self) -> Map<String, Value>;
    fn settings_changed(&self, settings: &Map<String, Value>);
    fn start_with_windows(&self, turn: Option<bool>) -> Option<bool>;
}

fn secret_key(key: &str) -> bool {
    static SECRET: OnceLock<Regex> = OnceLock::new();
    if key == "hasPassword" || key == "hasSession" || key.ends_with("ApiKeyMasked") {
        return false;
    }
    SECRET
        .get_or_init(|| Regex::new(r"(?i)password|token|secret|cookie|authorization|api.?key|ssid|^session$|^__|^constructor$|^prototype$").unwrap())
        .is_match(key)
}

fn plain_object(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object().filter(|map| map.keys().all(|key| !RESERVED_KEYS.contains(&key.as_str())))
}

fn utf16_length(value: &str) -> usize {
    value.encode_utf16().count()
}

pub fn copy_public(value: &Value) -> Value {
    copy_public_at(value, 0)
}

fn copy_public_at(value: &Value, depth: usize) -> Value {
    if depth > 12 {
        return Value::Null;
    }
    match value {
        Value::String(text) => Value::String(text.chars().take(8192).collect()),
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        Value::Array(items) => Value::Array(items.iter().take(1000).map(|item| copy_public_at(item, depth + 1)).collect()),
        Value::Object(_) => match plain_object(value) {
            Some(map) => Value::Object(
                map.iter()
                    .filter(|(key, _)| !secret_key(key))
                    .map(|(key, item)| (key.clone(), copy_public_at(item, depth + 1)))
                    .collect(),
            ),
            None => Value::Null,
        },
    }
}

pub fn public_account(value: &Value) -> Value {
    let Some(map) = value.as_object() else {
        return Value::Null;
    };
    let picked: Map<String, Value> = ACCOUNT_FIELDS.iter().filter_map(|key| map.get(*key).map(|item| (key.to_string(), item.clone()))).collect();
    copy_public(&Value::Object(picked))
}

struct EventsState {
    cursor: i64,
    bytes: usize,
    history: VecDeque<(Value, usize)>,
}

pub struct ManagerEvents {
    limit: usize,
    max_bytes: usize,
    state: Mutex<EventsState>,
}

impl Default for ManagerEvents {
    fn default() -> Self {
        Self::new(256, 768 * 1024)
    }
}

impl ManagerEvents {
    pub fn new(limit: usize, max_bytes: usize) -> Self {
        Self { limit, max_bytes, state: Mutex::new(EventsState { cursor: 0, bytes: 0, history: VecDeque::new() }) }
    }

    pub fn publish(&self, channel: &str, payload: &Value) {
        if !CHANNELS.contains(&channel) {
            return;
        }
        let mut state = self.state.lock().unwrap();
        state.cursor += 1;
        let payload = if channel == "account-updated" { public_account(payload) } else { copy_public(payload) };
        let event = json!({ "id": state.cursor, "channel": channel, "payload": payload });
        let size = event.to_string().len();
        if size > self.max_bytes {
            state.history.clear();
            state.bytes = 0;
            return;
        }
        state.history.push_back((event, size));
        state.bytes += size;
        while state.history.len() > self.limit || state.bytes > self.max_bytes {
            let (_, dropped) = state.history.pop_front().unwrap();
            state.bytes -= dropped;
        }
    }

    pub fn read(&self, after: &Value) -> Result<Value, Failure> {
        let after = after
            .as_i64()
            .filter(|value| (0..=MAX_SAFE_INTEGER).contains(value))
            .or_else(|| after.as_f64().filter(|value| value.fract() == 0.0 && *value >= 0.0 && *value <= MAX_SAFE_INTEGER as f64).map(|value| value as i64))
            .ok_or_else(|| Failure::new("Invalid event cursor", 400))?;
        let state = self.state.lock().unwrap();
        let first = state.history.front().map(|(event, _)| event["id"].as_i64().unwrap()).unwrap_or(state.cursor + 1);
        let events: Vec<Value> = state.history.iter().filter(|(event, _)| event["id"].as_i64().unwrap() > after).map(|(event, _)| event.clone()).collect();
        Ok(json!({ "cursor": state.cursor, "reset": after > state.cursor || after < first - 1, "events": events }))
    }

    pub fn cursor(&self) -> i64 {
        self.state.lock().unwrap().cursor
    }
}

fn keys(value: &Value, allowed: &[&str]) -> Result<(), Failure> {
    match plain_object(value) {
        Some(map) if map.keys().all(|key| allowed.contains(&key.as_str())) => Ok(()),
        _ => Err(Failure::invalid()),
    }
}

fn text(value: Option<&Value>, max: usize, required: bool) -> Result<String, Failure> {
    static CONTROL: OnceLock<Regex> = OnceLock::new();
    let Some(Value::String(text)) = value else {
        return Err(Failure::invalid());
    };
    let control = CONTROL.get_or_init(|| Regex::new(r"[\x00-\x08\x0b\x0c\x0e-\x1f]").unwrap());
    if utf16_length(text) > max || control.is_match(text) || (required && text.trim().is_empty()) {
        return Err(Failure::invalid());
    }
    Ok(text.clone())
}

fn valid_date(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok() || chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn ban(value: Option<&Value>) -> Result<Value, Failure> {
    let value = match value {
        None | Some(Value::Null) => return Ok(Value::Null),
        Some(value) => value,
    };
    keys(value, &["game", "permanent", "until"])?;
    let game = value.get("game").and_then(Value::as_str).filter(|game| ["all", "lol", "val"].contains(game)).ok_or_else(Failure::invalid)?;
    let permanent = value.get("permanent").and_then(Value::as_bool).ok_or_else(Failure::invalid)?;
    if permanent {
        return Ok(json!({ "game": game, "permanent": true, "until": null }));
    }
    let until = value.get("until").and_then(Value::as_str).filter(|until| valid_date(until)).ok_or_else(Failure::invalid)?;
    Ok(json!({ "game": game, "permanent": false, "until": until }))
}

fn seasons(value: Option<&Value>) -> Result<Map<String, Value>, Failure> {
    let value = match value {
        None | Some(Value::Null) => return Ok(Map::new()),
        Some(value) => value,
    };
    keys(value, &["lol", "tft", "val"])?;
    let mut result = Map::new();
    for (key, item) in value.as_object().unwrap() {
        result.insert(key.clone(), Value::String(text(Some(item), 128, false)?));
    }
    Ok(result)
}

fn games(value: Option<&Value>) -> Result<Vec<String>, Failure> {
    let list = match value {
        None | Some(Value::Null) => return Ok(ACCOUNT_GAMES.iter().map(|game| game.to_string()).collect()),
        Some(Value::Array(list)) if !list.is_empty() && list.len() <= ACCOUNT_GAMES.len() => list,
        _ => return Err(Failure::new("Choose at least one game", 400)),
    };
    if list.iter().any(|game| !game.as_str().is_some_and(|game| ACCOUNT_GAMES.contains(&game))) {
        return Err(Failure::new("Choose at least one game", 400));
    }
    Ok(ACCOUNT_GAMES.iter().filter(|game| list.iter().any(|chosen| chosen.as_str() == Some(**game))).map(|game| game.to_string()).collect())
}

fn arity(method: &str) -> Option<(usize, usize)> {
    Some(match method {
        "init" | "operation" | "runningGames" | "cancelSignIn" => (0, 0),
        "events" | "refresh" => (0, 1),
        "saveAccount" | "addAccounts" | "reorderAccounts" | "deleteAccount" | "saveSettings" | "openExternal" => (1, 1),
        "signIn" | "pinAccount" => (2, 2),
        _ => return None,
    })
}

pub struct ManagerService {
    store: Arc<Mutex<Store>>,
    ports: Arc<dyn ManagerPorts>,
    pub events: Arc<ManagerEvents>,
}

impl ManagerService {
    pub fn new(store: Arc<Mutex<Store>>, ports: Arc<dyn ManagerPorts>, events: Arc<ManagerEvents>) -> Self {
        Self { store, ports, events }
    }

    fn account(&self, id: Option<&Value>, editable: bool) -> Result<String, Failure> {
        static ID: OnceLock<Regex> = OnceLock::new();
        let id = id
            .and_then(Value::as_str)
            .filter(|id| ID.get_or_init(|| Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$").unwrap()).is_match(id))
            .ok_or_else(|| Failure::new("Invalid account identifier", 400))?;
        if self.store.lock().unwrap().get_account(id).is_none() {
            return Err(Failure::new("Account not found", 404));
        }
        if editable && self.ports.active_account_id().as_deref() == Some(id) {
            return Err(Failure::new("Wait for sign-in to finish before changing this account", 409));
        }
        Ok(id.to_string())
    }

    pub fn dispatch(&self, method: &str, args: &[Value]) -> Result<Value, Failure> {
        let Some((least, most)) = arity(method) else {
            return Err(Failure::new("Unknown account command", 400));
        };
        if args.len() < least || args.len() > most {
            return Err(Failure::new("Unknown account command", 400));
        }
        let first = args.first();
        match method {
            "init" => self.init(),
            "events" => self.events.read(first.unwrap_or(&json!(0))),
            "operation" => Ok(copy_public(&self.ports.operation())),
            "saveAccount" => self.save_account(first.unwrap()),
            "addAccounts" => self.add_accounts(first.unwrap()),
            "reorderAccounts" => self.reorder_accounts(first.unwrap()),
            "pinAccount" => {
                let id = self.account(first, false)?;
                let pinned = args[1].as_bool().ok_or_else(Failure::invalid)?;
                let mut fields = Map::new();
                fields.insert("pinned".into(), Value::Bool(pinned));
                let saved = self.store.lock().unwrap().update_account_fields(&id, fields).map_err(Failure::internal)?;
                Ok(saved.map(|account| public_account(&Value::Object(account))).unwrap_or(Value::Null))
            }
            "deleteAccount" => {
                let id = self.account(first, true)?;
                self.store.lock().unwrap().delete_account(&id).map_err(Failure::internal)?;
                Ok(Value::Bool(true))
            }
            "refresh" => self.refresh(first),
            "runningGames" => self.ports.running_games(),
            "signIn" => {
                let id = self.account(first, false)?;
                let game = args[1].as_str().filter(|game| GAMES.contains(game)).ok_or_else(|| Failure::new("Select a supported game", 400))?;
                self.ports.start_sign_in(&id, game)
            }
            "cancelSignIn" => Ok(self.ports.cancel_sign_in()),
            "saveSettings" => self.save_settings(first.unwrap()),
            "openExternal" => self.open_external(first),
            _ => Err(Failure::new("Unknown account command", 400)),
        }
    }

    fn init(&self) -> Result<Value, Failure> {
        let mut result = self.ports.init_context();
        let store = self.store.lock().unwrap();
        let accounts: Vec<Value> = store.list_accounts().into_iter().map(|account| public_account(&Value::Object(account))).collect();
        let seen = result.remove("seenAccount").and_then(|seen| {
            let riot_id = RiotId::new(seen.get("gameName")?.as_str()?, seen.get("tagLine")?.as_str()?);
            let saved = store.data.accounts.iter().any(|account| same_riot_id(Some(&riot_id), Some(&account_riot_id(account))));
            (!saved && !riot_id.game_name.is_empty()).then(|| json!({ "gameName": riot_id.game_name, "tagLine": riot_id.tag_line }))
        });
        result.insert("seenAccount".into(), seen.unwrap_or(Value::Null));
        result.insert("accounts".into(), Value::Array(accounts));
        result.insert("settings".into(), Value::Object(store.public_settings()));
        drop(store);
        result.insert("startWithWindows".into(), self.ports.start_with_windows(None).map_or(Value::Null, Value::Bool));
        result.insert("operation".into(), copy_public(&self.ports.operation()));
        result.insert("eventCursor".into(), json!(self.events.cursor()));
        Ok(Value::Object(result))
    }

    fn clean_account(&self, input: &Value, context: &Map<String, Value>, id: Option<String>) -> Result<AccountInput, Failure> {
        let unsupported = || Failure::new("Select a supported region", 400);
        let region = input
            .get("region")
            .and_then(Value::as_str)
            .filter(|region| context.get("regions").and_then(Value::as_object).is_some_and(|regions| regions.contains_key(*region)))
            .ok_or_else(unsupported)?;
        let val_region = match input.get("valRegion") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => "",
            Some(Value::String(value)) if value.is_empty() => "",
            Some(Value::String(value)) if context.get("valRegions").and_then(Value::as_array).is_some_and(|list| list.iter().any(|item| item.as_str() == Some(value))) => value,
            _ => return Err(unsupported()),
        };
        let note = match input.get("note") {
            None | Some(Value::Null) => String::new(),
            note => text(note, 500, false)?,
        };
        let clean = AccountInput {
            id: id.clone(),
            game_name: text(input.get("gameName"), 64, true)?,
            tag_line: text(input.get("tagLine"), 16, true)?,
            username: text(input.get("username"), 256, true)?,
            region: region.to_string(),
            val_region: val_region.to_string(),
            note,
            last_season: seasons(input.get("lastSeason"))?,
            ban: ban(input.get("ban"))?,
            games: games(input.get("games"))?,
            password: match input.get("password") {
                None => None,
                password => Some(text(password, 256, false)?),
            },
        };
        if id.is_none() && clean.password.as_deref().unwrap_or_default().is_empty() {
            return Err(Failure::new("Add a password for the new account", 400));
        }
        Ok(clean)
    }

    fn save_account(&self, input: &Value) -> Result<Value, Failure> {
        keys(input, &["id", "gameName", "tagLine", "region", "valRegion", "username", "password", "note", "lastSeason", "ban", "games"])?;
        let id = match input.get("id") {
            None | Some(Value::Null) => None,
            Some(Value::String(id)) if id.is_empty() => None,
            Some(id) => Some(self.account(Some(id), true)?),
        };
        let clean = self.clean_account(input, &self.ports.init_context(), id)?;
        let saved = self.store.lock().unwrap().upsert_account(clean).map_err(Failure::internal)?;
        let saved = public_account(&Value::Object(saved));
        if let Some(saved_id) = saved.get("id").and_then(Value::as_str) {
            self.ports.refresh_all(Some(vec![saved_id.to_string()]));
        }
        Ok(saved)
    }

    fn add_accounts(&self, list: &Value) -> Result<Value, Failure> {
        let Value::Array(items) = list else {
            return Err(Failure::invalid());
        };
        if items.is_empty() || items.len() > MAX_BATCH {
            return Err(Failure::new("Add between 1 and 50 accounts at a time", 400));
        }
        let context = self.ports.init_context();
        let mut clean = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            let line = |failure: Failure| Failure::new(&format!("Line {}: {}", index + 1, failure.message), failure.status);
            keys(item, &["gameName", "tagLine", "region", "valRegion", "username", "password", "games"]).map_err(line)?;
            clean.push(self.clean_account(item, &context, None).map_err(line)?);
        }
        let saved = self.store.lock().unwrap().add_accounts(clean).map_err(Failure::internal)?;
        let saved: Vec<Value> = saved.into_iter().map(|account| public_account(&Value::Object(account))).collect();
        let ids: Vec<String> = saved.iter().filter_map(|account| account.get("id").and_then(Value::as_str).map(str::to_string)).collect();
        self.ports.refresh_all(Some(ids));
        Ok(Value::Array(saved))
    }

    fn reorder_accounts(&self, list: &Value) -> Result<Value, Failure> {
        let Value::Array(items) = list else {
            return Err(Failure::invalid());
        };
        let ids: Option<Vec<String>> = items.iter().map(|item| item.as_str().map(str::to_string)).collect();
        let ids = ids.filter(|ids| ids.len() <= 1000).ok_or_else(Failure::invalid)?;
        self.store.lock().unwrap().reorder_accounts(&ids).map_err(|message| Failure::new(&message, 409))?;
        Ok(Value::Bool(true))
    }

    fn refresh(&self, ids: Option<&Value>) -> Result<Value, Failure> {
        let selection = match ids {
            None | Some(Value::Null) => None,
            Some(Value::Array(list)) if list.len() <= 128 => {
                let mut checked = Vec::with_capacity(list.len());
                for id in list {
                    checked.push(self.account(Some(id), false)?);
                }
                Some(checked)
            }
            Some(_) => return Err(Failure::new("Invalid refresh selection", 400)),
        };
        self.ports.refresh_all(selection);
        Ok(json!({ "started": true, "nextRefresh": self.ports.init_context().get("nextRefresh").cloned().unwrap_or(Value::Null) }))
    }

    fn save_settings(&self, input: &Value) -> Result<Value, Failure> {
        keys(input, &["refreshMinutes", "staySignedIn", "riotClientPath", "language", "cardLayout", "cardSort", "pageTheme", "uiSounds", "startWithWindows", "riotApiKey", "riotTftApiKey", "henrikApiKey"])?;
        let mut clean = SettingsInput::default();
        let mut startup = None;
        for (key, value) in input.as_object().unwrap() {
            match key.as_str() {
                "startWithWindows" => startup = Some(value.as_bool().ok_or_else(|| Failure::new("Invalid setting", 400))?),
                "refreshMinutes" => {
                    let minutes = value.as_f64().filter(|minutes| minutes.is_finite() && (0.0..=10080.0).contains(minutes)).ok_or_else(|| Failure::new("Invalid refresh interval", 400))?;
                    clean.refresh_minutes = Some(minutes);
                }
                "staySignedIn" => clean.stay_signed_in = Some(value.as_bool().ok_or_else(|| Failure::new("Invalid setting", 400))?),
                "uiSounds" => clean.ui_sounds = Some(value.as_bool().ok_or_else(|| Failure::new("Invalid setting", 400))?),
                "language" => {
                    let language = value.as_str().filter(|language| LANGUAGES.contains(language)).ok_or_else(|| Failure::new("Invalid setting", 400))?;
                    clean.language = Some(language.to_string());
                }
                "cardLayout" => {
                    let layout = value.as_str().filter(|layout| CARD_LAYOUTS.contains(layout)).ok_or_else(|| Failure::new("Invalid setting", 400))?;
                    clean.card_layout = Some(layout.to_string());
                }
                "pageTheme" => {
                    let theme = value.as_str().filter(|theme| PAGE_THEMES.contains(theme)).ok_or_else(|| Failure::new("Invalid setting", 400))?;
                    clean.page_theme = Some(theme.to_string());
                }
                "cardSort" => {
                    let sort = value.as_str().filter(|sort| CARD_SORTS.contains(sort)).ok_or_else(|| Failure::new("Invalid setting", 400))?;
                    clean.card_sort = Some(sort.to_string());
                }
                "riotClientPath" => clean.riot_client_path = Some(text(Some(value), 2048, false)?),
                "riotApiKey" => clean.riot_api_key = Some(text(Some(value), 4096, false)?),
                "riotTftApiKey" => clean.riot_tft_api_key = Some(text(Some(value), 4096, false)?),
                _ => clean.henrik_api_key = Some(text(Some(value), 4096, false)?),
            }
        }
        let settings = self.store.lock().unwrap().update_settings(clean).map_err(Failure::internal)?;
        let started = startup.map(|turn| self.ports.start_with_windows(Some(turn)));
        self.ports.schedule_refresh();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.ports.settings_changed(&settings)));
        let mut result = settings;
        if let Some(started) = started {
            result.insert("startWithWindows".into(), started.map_or(Value::Null, Value::Bool));
        }
        result.insert("nextRefresh".into(), self.ports.init_context().get("nextRefresh").cloned().unwrap_or(Value::Null));
        Ok(Value::Object(result))
    }

    fn open_external(&self, url: Option<&Value>) -> Result<Value, Failure> {
        let raw = text(url, 2048, true)?;
        let parsed = url::Url::parse(&raw).map_err(|_| Failure::new("Invalid link", 400))?;
        if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(Failure::new("Only HTTPS links are allowed", 400));
        }
        self.ports.open_external(parsed.as_str())?;
        Ok(Value::Bool(true))
    }
}
