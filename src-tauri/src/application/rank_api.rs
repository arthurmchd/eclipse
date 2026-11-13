use std::collections::HashMap;
use std::io;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::store::ApiKeys;

pub struct Region {
    pub id: &'static str,
    pub label: &'static str,
    pub routing: &'static str,
    pub val: &'static str,
}

const fn region(id: &'static str, label: &'static str, routing: &'static str, val: &'static str) -> Region {
    Region { id, label, routing, val }
}

pub const REGIONS: [Region; 15] = [
    region("br1", "BR", "americas", "br"),
    region("na1", "NA", "americas", "na"),
    region("la1", "LAN", "americas", "latam"),
    region("la2", "LAS", "americas", "latam"),
    region("euw1", "EUW", "europe", "eu"),
    region("eun1", "EUNE", "europe", "eu"),
    region("tr1", "TR", "europe", "eu"),
    region("ru", "RU", "europe", "eu"),
    region("me1", "ME", "europe", "eu"),
    region("kr", "KR", "asia", "kr"),
    region("jp1", "JP", "asia", "ap"),
    region("oc1", "OCE", "asia", "ap"),
    region("sg2", "SG", "asia", "ap"),
    region("tw2", "TW", "asia", "ap"),
    region("vn2", "VN", "asia", "ap"),
];

pub const VAL_REGIONS: [&str; 6] = ["br", "na", "latam", "eu", "kr", "ap"];
const APEX: [&str; 3] = ["MASTER", "GRANDMASTER", "CHALLENGER"];
const APEX_LISTS: [&str; 3] = ["challengerleagues", "grandmasterleagues", "masterleagues"];
const APEX_QUEUES: [(&str, &str); 2] = [("solo", "RANKED_SOLO_5x5"), ("flex", "RANKED_FLEX_SR")];
const APEX_TTL_MS: i64 = 10 * 60_000;
const RETRY_DEFAULT_MS: u64 = 5000;
const RETRY_LIMIT_MS: i64 = 60_000;
const SPACING_MS: u64 = 80;
pub const TIMEOUT_MS: u64 = 15_000;
pub const TOO_SLOW: &str = "The rank service took too long to answer";

pub fn regions_json() -> Value {
    Value::Object(REGIONS.iter().map(|region| (region.id.to_string(), json!({ "label": region.label, "routing": region.routing, "val": region.val }))).collect())
}

fn find_region(id: &str) -> Option<&'static Region> {
    REGIONS.iter().find(|region| region.id == id)
}

#[derive(Debug, Clone, PartialEq)]
pub struct HttpAnswer {
    pub status: u16,
    pub retry_after: Option<String>,
    pub body: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpFailure {
    TimedOut,
    Failed(String),
}

pub trait RankHttp: Send + Sync {
    fn get(&self, url: &str, headers: &[(&str, &str)], timeout_ms: u64) -> Result<HttpAnswer, HttpFailure>;
}

fn timed_out(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(error) = current {
        if let Some(io) = error.downcast_ref::<io::Error>() {
            if matches!(io.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock) {
                return true;
            }
        }
        current = error.source();
    }
    false
}

pub struct UreqHttp;

impl RankHttp for UreqHttp {
    fn get(&self, url: &str, headers: &[(&str, &str)], timeout_ms: u64) -> Result<HttpAnswer, HttpFailure> {
        let connector = native_tls::TlsConnector::new().map_err(|error| HttpFailure::Failed(error.to_string()))?;
        let agent = ureq::AgentBuilder::new().tls_connector(Arc::new(connector)).timeout(Duration::from_millis(timeout_ms)).build();
        let mut request = agent.get(url);
        for (name, value) in headers {
            request = request.set(name, value);
        }
        let response = match request.call() {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(ureq::Error::Transport(transport)) => {
                return Err(if timed_out(&transport) { HttpFailure::TimedOut } else { HttpFailure::Failed(transport.to_string()) });
            }
        };
        let status = response.status();
        let retry_after = response.header("retry-after").map(str::to_string);
        let text = response.into_string().map_err(|error| if timed_out(&error) { HttpFailure::TimedOut } else { HttpFailure::Failed(error.to_string()) })?;
        Ok(HttpAnswer { status, retry_after, body: serde_json::from_str(&text).ok() })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}

impl ApiError {
    fn new(status: u16, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }

    fn denied(&self) -> bool {
        self.status == 401 || self.status == 403
    }
}

fn riot_key_error(error: &ApiError) -> String {
    if error.denied() {
        "Riot API key is invalid or expired (dev keys expire every 24h)".into()
    } else {
        error.message.clone()
    }
}

enum Answer {
    Data(Value),
    NotFound,
}

impl Answer {
    fn data(&self) -> Option<&Value> {
        match self {
            Answer::Data(value) => Some(value),
            Answer::NotFound => None,
        }
    }
}

fn put(map: &mut Map<String, Value>, key: &str, value: Option<&Value>) {
    if let Some(value) = value {
        map.insert(key.into(), value.clone());
    }
}

pub fn map_entry(entry: Option<&Value>) -> Value {
    let Some(entry) = entry.filter(|entry| entry.is_object()) else {
        return Value::Null;
    };
    let tier = entry.get("tier");
    let apex = tier.and_then(Value::as_str).is_some_and(|tier| APEX.contains(&tier));
    let mut mapped = Map::new();
    put(&mut mapped, "tier", tier);
    if apex {
        mapped.insert("division".into(), Value::String(String::new()));
    } else {
        put(&mut mapped, "division", entry.get("rank"));
    }
    put(&mut mapped, "lp", entry.get("leaguePoints"));
    put(&mut mapped, "wins", entry.get("wins"));
    put(&mut mapped, "losses", entry.get("losses"));
    let hot = entry.get("hotStreak").is_some_and(|value| match value {
        Value::Bool(flag) => *flag,
        Value::Null => false,
        Value::String(text) => !text.is_empty(),
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        _ => true,
    });
    mapped.insert("hotStreak".into(), Value::Bool(hot));
    Value::Object(mapped)
}

fn queue_entry<'a>(entries: &'a [Value], queue: &str) -> Option<&'a Value> {
    entries.iter().find(|entry| entry.get("queueType").and_then(Value::as_str) == Some(queue))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cutoffs {
    pub challenger: Option<i64>,
    pub grandmaster: Option<i64>,
}

impl Cutoffs {
    fn to_json(self) -> Value {
        json!({ "challenger": self.challenger, "grandmaster": self.grandmaster })
    }
}

fn points(entries: &[Value]) -> impl Iterator<Item = i64> + '_ {
    entries.iter().filter_map(|entry| entry.get("leaguePoints").and_then(Value::as_f64)).filter(|value| value.is_finite()).map(|value| value as i64)
}

pub fn ladder_cutoffs(challenger: &[Value], grandmaster: &[Value], master: &[Value]) -> Cutoffs {
    let mut ladder: Vec<i64> = points(challenger).chain(points(grandmaster)).chain(points(master)).collect();
    ladder.sort_by(|a, b| b.cmp(a));
    let at = |count: usize| (count > 0 && ladder.len() >= count).then(|| ladder[count - 1]);
    Cutoffs {
        challenger: if challenger.is_empty() { None } else { at(challenger.len()) },
        grandmaster: if grandmaster.is_empty() { None } else { at(challenger.len() + grandmaster.len()) },
    }
}

pub fn retry_delay(value: Option<&str>, now_ms: i64) -> Option<u64> {
    let text = value.unwrap_or_default().trim();
    if text.is_empty() {
        return Some(RETRY_DEFAULT_MS);
    }
    let delay = if !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()) {
        text.parse::<i64>().ok().map(|seconds| seconds.saturating_mul(1000))
    } else {
        DateTime::parse_from_rfc2822(text).ok().map(|date| date.timestamp_millis() - now_ms)
    };
    match delay {
        None => Some(RETRY_DEFAULT_MS),
        Some(delay) if delay > RETRY_LIMIT_MS => None,
        Some(delay) => Some(delay.max(0) as u64),
    }
}

pub fn encode_component(text: &str) -> String {
    let mut encoded = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub fn key_hash(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>()[..12].to_string()
}

fn text(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_string()
}

fn riot_id_text(game_name: &str, tag_line: &str) -> String {
    format!("{game_name}#{tag_line}")
}

#[derive(Debug, Clone, PartialEq)]
pub struct Refresh {
    pub fields: Map<String, Value>,
    pub errors: Map<String, Value>,
}

pub struct ApiHooks {
    pub wait: Box<dyn Fn(u64) + Send + Sync>,
    pub now: Box<dyn Fn() -> i64 + Send + Sync>,
    pub timeout_ms: u64,
}

impl Default for ApiHooks {
    fn default() -> Self {
        Self { wait: Box::new(|ms| std::thread::sleep(Duration::from_millis(ms))), now: Box::new(|| Utc::now().timestamp_millis()), timeout_ms: TIMEOUT_MS }
    }
}

struct ApexEntry {
    at: i64,
    value: Option<Cutoffs>,
}

pub struct RankApi {
    http: Arc<dyn RankHttp>,
    hooks: ApiHooks,
    queue: Mutex<Option<i64>>,
    apex: Mutex<HashMap<String, ApexEntry>>,
}

struct Lookup<'a> {
    cache: Map<String, Value>,
    checked: bool,
    game_name: String,
    tag_line: String,
    region: &'a str,
}

impl RankApi {
    pub fn new(http: Arc<dyn RankHttp>, hooks: ApiHooks) -> Self {
        Self { http, hooks, queue: Mutex::new(None), apex: Mutex::new(HashMap::new()) }
    }

    pub fn live() -> Self {
        Self::new(Arc::new(UreqHttp), ApiHooks::default())
    }

    fn now(&self) -> i64 {
        (self.hooks.now)()
    }

    fn get_json(&self, url: &str, headers: &[(&str, &str)]) -> Result<Answer, ApiError> {
        let mut attempt = 0;
        loop {
            let mut last = self.queue.lock().unwrap();
            if let Some(gap) = last.map(|at| self.now() - at).filter(|gap| *gap < SPACING_MS as i64) {
                (self.hooks.wait)(SPACING_MS - gap.max(0) as u64);
            }
            let answer = self.http.get(url, headers, self.hooks.timeout_ms);
            *last = Some(self.now());
            let answer = match answer {
                Ok(answer) => answer,
                Err(HttpFailure::TimedOut) => return Err(ApiError::new(0, TOO_SLOW)),
                Err(HttpFailure::Failed(message)) => return Err(ApiError::new(0, message)),
            };
            if answer.status == 429 && attempt < 3 {
                if let Some(delay) = retry_delay(answer.retry_after.as_deref(), self.now()) {
                    (self.hooks.wait)(delay);
                    drop(last);
                    attempt += 1;
                    continue;
                }
            }
            if answer.status == 404 {
                return Ok(Answer::NotFound);
            }
            if !(200..300).contains(&answer.status) {
                let body = answer.body.as_ref();
                let message = [body.and_then(|body| body.pointer("/status/message")), body.and_then(|body| body.pointer("/errors/0/message")), body.and_then(|body| body.get("message"))]
                    .into_iter()
                    .flatten()
                    .find_map(|value| value.as_str().filter(|text| !text.is_empty()))
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("HTTP {}", answer.status));
                return Err(ApiError::new(answer.status, message));
            }
            return answer.body.map(Answer::Data).ok_or_else(|| ApiError::new(answer.status, "The rank service sent an invalid answer"));
        }
    }

    fn resolve_puuid(&self, lookup: &mut Lookup, key: &str) -> Result<String, ApiError> {
        let region = find_region(lookup.region).ok_or_else(|| ApiError::new(0, format!("Unknown region {}", lookup.region)))?;
        let riot_id = riot_id_text(&lookup.game_name, &lookup.tag_line);
        let hash = key_hash(key);
        let headers = [("X-Riot-Token", key)];
        let accounts = format!("https://{}.api.riotgames.com/riot/account/v1/accounts", region.routing);
        let hit = lookup.cache.get(&hash).cloned();
        let hit_puuid = hit.as_ref().map(|hit| text(hit.get("puuid"))).filter(|puuid| !puuid.is_empty());
        if let Some(puuid) = hit_puuid.filter(|_| hit.as_ref().map(|hit| text(hit.get("riotId"))) == Some(riot_id.clone())) {
            if lookup.checked {
                return Ok(puuid);
            }
            lookup.checked = true;
            let current = self.get_json(&format!("{accounts}/by-puuid/{}", encode_component(&puuid)), &headers);
            if !matches!(current, Ok(Answer::NotFound)) {
                let data = current.ok().and_then(|answer| answer.data().cloned());
                let game_name = data.as_ref().map(|data| text(data.get("gameName"))).unwrap_or_default();
                let tag_line = data.as_ref().map(|data| text(data.get("tagLine"))).unwrap_or_default();
                if !game_name.is_empty() && !tag_line.is_empty() {
                    lookup.cache.insert(hash, json!({ "riotId": riot_id_text(&game_name, &tag_line), "puuid": puuid }));
                    lookup.game_name = game_name;
                    lookup.tag_line = tag_line;
                }
                return Ok(puuid);
            }
        }
        let answer = self.get_json(&format!("{accounts}/by-riot-id/{}/{}", encode_component(&lookup.game_name), encode_component(&lookup.tag_line)), &headers)?;
        let Answer::Data(data) = answer else {
            return Err(ApiError::new(404, format!("Riot ID {riot_id} not found")));
        };
        lookup.checked = true;
        let puuid = text(data.get("puuid"));
        let (game_name, tag_line) = (text(data.get("gameName")), text(data.get("tagLine")));
        lookup.cache.insert(hash, json!({ "riotId": riot_id_text(&game_name, &tag_line), "puuid": puuid }));
        if !game_name.is_empty() {
            lookup.game_name = game_name;
            lookup.tag_line = tag_line;
        }
        Ok(puuid)
    }

    fn apex_cutoffs(&self, platform: &str, queue: &str, key: &str) -> Option<Cutoffs> {
        let id = format!("{platform}:{queue}");
        let now = self.now();
        if let Some(entry) = self.apex.lock().unwrap().get(&id).filter(|entry| now - entry.at < APEX_TTL_MS) {
            return entry.value;
        }
        let headers = [("X-Riot-Token", key)];
        let mut lists = Vec::new();
        for list in APEX_LISTS {
            match self.get_json(&format!("https://{platform}.api.riotgames.com/lol/league/v4/{list}/by-queue/{queue}"), &headers) {
                Ok(answer) => lists.push(answer.data().and_then(|data| data.get("entries")).and_then(Value::as_array).cloned().unwrap_or_default()),
                Err(_) => {
                    self.apex.lock().unwrap().remove(&id);
                    return None;
                }
            }
        }
        let cutoffs = ladder_cutoffs(&lists[0], &lists[1], &lists[2]);
        let value = (cutoffs.challenger.is_some() || cutoffs.grandmaster.is_some()).then_some(cutoffs);
        self.apex.lock().unwrap().insert(id, ApexEntry { at: now, value });
        value
    }

    fn updated_at(&self) -> Value {
        Value::String(Utc.timestamp_millis_opt(self.now()).single().unwrap_or_else(Utc::now).to_rfc3339_opts(SecondsFormat::Millis, true))
    }

    fn fetch_lol(&self, lookup: &mut Lookup, key: &str) -> Result<Value, ApiError> {
        let platform = lookup.region.to_string();
        let region = find_region(&platform).ok_or_else(|| ApiError::new(0, format!("Unknown region {platform}")))?;
        let headers = [("X-Riot-Token", key)];
        let puuid = self.resolve_puuid(lookup, key)?;
        let base = format!("https://{platform}.api.riotgames.com");
        let summoner = self.get_json(&format!("{base}/lol/summoner/v4/summoners/by-puuid/{puuid}"), &headers)?;
        let league = self.get_json(&format!("{base}/lol/league/v4/entries/by-puuid/{puuid}"), &headers)?;
        let Answer::Data(summoner) = summoner else {
            return Err(ApiError::new(404, format!("No League profile on {}", region.label)));
        };
        let entries = league.data().and_then(Value::as_array).cloned().unwrap_or_default();
        let mut ranked = Map::new();
        for (name, queue) in APEX_QUEUES {
            let mut entry = map_entry(queue_entry(&entries, queue));
            let apex = entry.get("tier").and_then(Value::as_str).is_some_and(|tier| APEX.contains(&tier));
            if apex {
                if let Some(cutoffs) = self.apex_cutoffs(&platform, queue, key) {
                    entry.as_object_mut().unwrap().insert("cutoffs".into(), cutoffs.to_json());
                }
            }
            ranked.insert(name.into(), entry);
        }
        Ok(json!({
            "level": summoner.get("summonerLevel").cloned().unwrap_or(Value::Null),
            "iconId": summoner.get("profileIconId").cloned().unwrap_or(Value::Null),
            "solo": ranked["solo"],
            "flex": ranked["flex"],
            "updatedAt": self.updated_at(),
        }))
    }

    fn fetch_tft(&self, lookup: &mut Lookup, key: &str) -> Result<Value, ApiError> {
        let platform = lookup.region.to_string();
        find_region(&platform).ok_or_else(|| ApiError::new(0, format!("Unknown region {platform}")))?;
        let puuid = self.resolve_puuid(lookup, key)?;
        let answer = self.get_json(&format!("https://{platform}.api.riotgames.com/tft/league/v1/by-puuid/{puuid}"), &[("X-Riot-Token", key)])?;
        let entries = answer.data().and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(json!({
            "ranked": map_entry(queue_entry(&entries, "RANKED_TFT")),
            "doubleUp": map_entry(queue_entry(&entries, "RANKED_TFT_DOUBLE_UP")),
            "updatedAt": self.updated_at(),
        }))
    }

    fn fetch_valorant(&self, account: &Map<String, Value>, game_name: &str, tag_line: &str, key: &str) -> Result<Value, ApiError> {
        let chosen = text(account.get("valRegion"));
        let region = if !chosen.is_empty() { chosen } else { find_region(&text(account.get("region"))).map(|region| region.val.to_string()).unwrap_or_else(|| "na".into()) };
        let headers = [("Authorization", key)];
        let (name, tag) = (encode_component(game_name), encode_component(tag_line));
        let host = "https://api.henrikdev.xyz/valorant";
        let mmr = self.get_json(&format!("{host}/v3/mmr/{region}/pc/{name}/{tag}"), &headers)?;
        let profile = self.get_json(&format!("{host}/v1/account/{name}/{tag}"), &headers).ok().and_then(|answer| answer.data().cloned());
        let Answer::Data(mmr) = mmr else {
            return Err(ApiError::new(404, format!("No VALORANT profile for {game_name}#{tag_line} on {}", region.to_uppercase())));
        };
        let empty = Value::Object(Map::new());
        let data = mmr.get("data").filter(|data| data.is_object()).unwrap_or(&empty);
        let current = data.get("current").unwrap_or(&empty);
        let tier = current.get("tier");
        let seasonal: Vec<&Value> = data
            .get("seasonal")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter(|season| season.pointer("/end_tier/id").and_then(Value::as_f64).is_some_and(|id| id > 0.0)).collect())
            .unwrap_or_default();
        let season = |value: &Value| value.pointer("/season/short").and_then(Value::as_str).filter(|short| !short.is_empty()).unwrap_or("").to_string();
        let peak = data.get("peak").filter(|peak| peak.get("tier").is_some_and(|tier| !tier.is_null())).map(|peak| json!({ "tier": peak.pointer("/tier/id"), "name": peak.pointer("/tier/name"), "season": season(peak) }));
        let last = seasonal.last().map(|last| json!({ "tier": last.pointer("/end_tier/id"), "name": last.pointer("/end_tier/name"), "season": season(last) }));
        let player = profile.as_ref().and_then(|profile| profile.get("data"));
        let card = player.and_then(|player| player.get("card"));
        let card = match card {
            Some(Value::String(id)) => Value::String(format!("https://media.valorant-api.com/playercards/{id}/smallart.png")),
            Some(card) => card.get("small").filter(|small| small.as_str().is_some_and(|small| !small.is_empty())).cloned().unwrap_or(Value::Null),
            None => Value::Null,
        };
        let present = |value: Option<&Value>| value.filter(|value| !value.is_null()).cloned();
        Ok(json!({
            "tier": present(tier.and_then(|tier| tier.get("id"))).unwrap_or(json!(0)),
            "tierName": tier.and_then(|tier| tier.get("name")).and_then(Value::as_str).filter(|name| !name.is_empty()).unwrap_or("Unrated"),
            "rr": present(current.get("rr")).unwrap_or(json!(0)),
            "lastChange": present(current.get("last_change")).unwrap_or(Value::Null),
            "peak": peak,
            "lastSeason": last,
            "level": present(player.and_then(|player| player.get("account_level"))).unwrap_or(Value::Null),
            "card": card,
            "region": region,
            "updatedAt": self.updated_at(),
        }))
    }

    pub fn refresh_account(&self, account: &Map<String, Value>, keys: &ApiKeys) -> Refresh {
        let mut stats = account.get("stats").and_then(Value::as_object).cloned().unwrap_or_default();
        let mut errors = Map::new();
        let mut fields = Map::new();
        let game_name = text(account.get("gameName"));
        let tag_line = text(account.get("tagLine"));
        if game_name.is_empty() || tag_line.is_empty() {
            errors.insert("all".into(), Value::String("Add the Riot ID (Name#TAG) to fetch ranks".into()));
            stats.insert("errors".into(), Value::Object(errors.clone()));
            fields.insert("stats".into(), Value::Object(stats));
            return Refresh { fields, errors };
        }
        let cache = account.get("puuidCache").and_then(Value::as_object).filter(|cache| cache.get("puuid").is_none_or(Value::is_null)).cloned().unwrap_or_default();
        let region = text(account.get("region"));
        let mut lookup = Lookup { cache, checked: false, game_name: game_name.clone(), tag_line: tag_line.clone(), region: &region };
        let mut lol_failed = false;
        if !keys.riot.is_empty() {
            match self.fetch_lol(&mut lookup, &keys.riot) {
                Ok(lol) => {
                    stats.insert("lol".into(), lol);
                }
                Err(error) => {
                    lol_failed = true;
                    errors.insert("lol".into(), Value::String(riot_key_error(&error)));
                }
            }
        } else {
            lol_failed = true;
            errors.insert("lol".into(), Value::String("No Riot API key (Settings)".into()));
        }
        let tft_key = if keys.tft.is_empty() { &keys.riot } else { &keys.tft };
        if !tft_key.is_empty() {
            match self.fetch_tft(&mut lookup, tft_key) {
                Ok(tft) => {
                    stats.insert("tft".into(), tft);
                }
                Err(error) => {
                    let message = if keys.tft.is_empty() && !lol_failed && error.denied() { "This Riot key has no TFT access. Add a TFT key in Settings".to_string() } else { riot_key_error(&error) };
                    errors.insert("tft".into(), Value::String(message));
                }
            }
        } else {
            errors.insert("tft".into(), Value::String("No Riot API key (Settings)".into()));
        }
        fields.insert("puuidCache".into(), Value::Object(lookup.cache.clone()));
        if lookup.game_name != game_name || lookup.tag_line != tag_line {
            fields.insert("gameName".into(), Value::String(lookup.game_name.clone()));
            fields.insert("tagLine".into(), Value::String(lookup.tag_line.clone()));
        }
        if !keys.henrik.is_empty() {
            match self.fetch_valorant(account, &lookup.game_name, &lookup.tag_line, &keys.henrik) {
                Ok(val) => {
                    stats.insert("val".into(), val);
                }
                Err(error) => {
                    let message = if error.denied() { "HenrikDev API key is invalid".to_string() } else { error.message };
                    errors.insert("val".into(), Value::String(message));
                }
            }
        } else {
            errors.insert("val".into(), Value::String("No HenrikDev API key (Settings)".into()));
        }
        stats.insert("errors".into(), Value::Object(errors.clone()));
        fields.insert("stats".into(), Value::Object(stats));
        Refresh { fields, errors }
    }
}
