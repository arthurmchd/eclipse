use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use base64::alphabet;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use regex::Regex;
use serde_json::{json, Map, Value};

use super::{LocalApi, RiotId};
use crate::integration::backend::{parse_backend_lockfile, Backend};

pub const INSTALLS_FILE: &str = "C:/ProgramData/Riot Games/RiotClientInstalls.json";
const LOL_TIERS: [&str; 10] = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const APEX: [&str; 3] = ["MASTER", "GRANDMASTER", "CHALLENGER"];
const DIVISIONS: [&str; 4] = ["I", "II", "III", "IV"];
const VAL_GROUPS: [&str; 8] = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"];
const MAX_PRIVATE: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub riot_id: RiotId,
    pub lol: Option<Value>,
    pub tft: Option<Value>,
    pub val: Option<Value>,
}

fn count(value: Option<&Value>) -> Value {
    let number = match value {
        Some(Value::Number(number)) => number.as_i64().or_else(|| number.as_f64().filter(|value| value.fract() == 0.0).map(|value| value as i64)),
        _ => None,
    };
    number.filter(|number| (0..1_000_000).contains(number)).map(Value::from).unwrap_or(Value::Null)
}

fn name(value: Option<&Value>, max: usize) -> Option<String> {
    let text = value?.as_str()?.trim();
    let valid = !text.is_empty() && text.encode_utf16().count() <= max && !text.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f);
    valid.then(|| text.to_string())
}

pub fn league_folders_with(read_file: &dyn Fn(&Path) -> std::io::Result<String>, installs_file: &Path) -> Vec<String> {
    static LEAGUE: OnceLock<Regex> = OnceLock::new();
    let league = LEAGUE.get_or_init(|| Regex::new(r"(?i)league of legends|teamfight tactics").unwrap());
    let Some(installs) = read_file(installs_file).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()) else {
        return Vec::new();
    };
    installs
        .get("associated_client")
        .and_then(Value::as_object)
        .map(|clients| clients.keys().filter(|folder| league.is_match(folder) && Path::new(folder.as_str()).is_absolute()).cloned().collect())
        .unwrap_or_default()
}

pub fn read_league_lockfile_with(read_file: &dyn Fn(&Path) -> std::io::Result<String>, installs_file: &Path) -> Result<Backend, String> {
    for folder in league_folders_with(read_file, installs_file) {
        let lockfile = PathBuf::from(folder).join("lockfile");
        if let Some(backend) = read_file(&lockfile).ok().and_then(|text| parse_backend_lockfile(&text).ok()) {
            return Ok(backend);
        }
    }
    Err("The League client is not running".into())
}

pub fn read_league_lockfile() -> Result<Backend, String> {
    read_league_lockfile_with(&|file| fs::read_to_string(file), Path::new(INSTALLS_FILE))
}

fn league_entry(entry: Option<&Value>) -> Value {
    let Some(entry) = entry else {
        return Value::Null;
    };
    let tier = entry.get("tier").and_then(Value::as_str).unwrap_or_default().to_uppercase();
    if !LOL_TIERS.contains(&tier.as_str()) {
        return Value::Null;
    }
    let division = if APEX.contains(&tier.as_str()) {
        Some(String::new())
    } else {
        entry.get("division").and_then(Value::as_str).filter(|division| DIVISIONS.contains(division)).map(str::to_string)
    };
    let (lp, wins, losses) = (count(entry.get("leaguePoints")), count(entry.get("wins")), count(entry.get("losses")));
    let Some(division) = division.filter(|_| !lp.is_null() && !wins.is_null() && !losses.is_null()) else {
        return Value::Null;
    };
    json!({ "tier": tier, "division": division, "lp": lp, "wins": wins, "losses": losses, "hotStreak": entry.get("hotStreak") == Some(&Value::Bool(true)) })
}

pub fn parse_league(summoner: &Value, ranked: &Value) -> Option<Reading> {
    let game_name = name(summoner.get("gameName"), 64)?;
    let tag_line = name(summoner.get("tagLine"), 16)?;
    let queues: Vec<Value> = if let Some(list) = ranked.get("queues").and_then(Value::as_array) {
        list.clone()
    } else {
        ranked
            .get("queueMap")
            .and_then(Value::as_object)?
            .iter()
            .map(|(queue_type, entry)| {
                let mut entry = entry.as_object().cloned().unwrap_or_default();
                entry.insert("queueType".into(), Value::String(queue_type.clone()));
                Value::Object(entry)
            })
            .collect()
    };
    let queue = |kind: &str| league_entry(queues.iter().find(|entry| entry.get("queueType").and_then(Value::as_str) == Some(kind)));
    Some(Reading {
        riot_id: RiotId { game_name, tag_line },
        lol: Some(json!({ "level": count(summoner.get("summonerLevel")), "iconId": count(summoner.get("profileIconId")), "solo": queue("RANKED_SOLO_5x5"), "flex": queue("RANKED_FLEX_SR") })),
        tft: Some(json!({ "ranked": queue("RANKED_TFT"), "doubleUp": queue("RANKED_TFT_DOUBLE_UP") })),
        val: None,
    })
}

pub fn prestige_theme(level: i64) -> i64 {
    match level {
        ..30 => 1,
        30..50 => 2,
        _ => (3 + (level - 50) / 25).min(21),
    }
}

pub fn league_border(regalia: &Value, level: &Value) -> Value {
    match regalia.get("crestType").and_then(Value::as_str).map(str::to_lowercase).as_deref() {
        Some("prestige") => {
            let chosen = regalia.get("selectedPrestigeCrest").and_then(Value::as_i64).filter(|crest| (1..=21).contains(crest));
            let level = level.as_i64().or_else(|| regalia.get("summonerLevel").and_then(Value::as_i64)).filter(|level| *level >= 1);
            match chosen.or_else(|| level.map(prestige_theme)) {
                Some(theme) => json!({ "kind": "level", "theme": theme }),
                None => Value::Null,
            }
        }
        Some("ranked") => {
            let last = regalia.get("lastSeasonHighestRank").and_then(Value::as_str);
            let highest = regalia.get("highestRankedEntry").and_then(|entry| entry.get("tier")).and_then(Value::as_str);
            [last, highest]
                .into_iter()
                .flatten()
                .map(str::to_uppercase)
                .find(|tier| LOL_TIERS.contains(&tier.as_str()))
                .map(|tier| json!({ "kind": "ranked", "tier": tier }))
                .unwrap_or(Value::Null)
        }
        _ => Value::Null,
    }
}

fn val_border(player: &Value) -> Option<Value> {
    let chosen = player.get("preferredLevelBorderId")?;
    let id = chosen.as_str().filter(|id| uuid_like(id) && !id.chars().all(|c| c == '0' || c == '-'));
    Some(Value::String(id.map(str::to_lowercase).unwrap_or_else(|| "level".into())))
}

pub fn val_tier_name(tier: i64) -> String {
    if tier == 27 {
        return "Radiant".into();
    }
    if (3..=26).contains(&tier) {
        return format!("{} {}", VAL_GROUPS[((tier - 3) / 3) as usize], (tier - 3) % 3 + 1);
    }
    "Unrated".into()
}

fn uuid_like(value: &str) -> bool {
    static UUID: OnceLock<Regex> = OnceLock::new();
    UUID.get_or_init(|| Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()).is_match(value)
}

pub fn parse_valorant(session: &Value, presences: &Value) -> Option<Reading> {
    let puuid = name(session.get("puuid"), 100)?;
    let game_name = name(session.get("game_name"), 64)?;
    let tag_line = name(session.get("game_tag"), 16)?;
    let list = presences.get("presences").and_then(Value::as_array).cloned().unwrap_or_default();
    let own = list.iter().find(|presence| {
        presence.get("puuid").and_then(Value::as_str) == Some(puuid.as_str()) && presence.get("product").and_then(Value::as_str) == Some("valorant") && presence.get("private").is_some_and(Value::is_string)
    })?;
    let private = own.get("private").and_then(Value::as_str).filter(|text| !text.is_empty() && text.len() <= MAX_PRIVATE)?;
    let lenient = GeneralPurpose::new(&alphabet::STANDARD, GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent));
    let data: Value = serde_json::from_slice(&lenient.decode(private.trim()).ok()?).ok()?;
    let player = data.get("playerPresenceData").filter(|value| value.is_object()).unwrap_or(&data);
    let tier = player.get("competitiveTier").and_then(Value::as_i64).filter(|tier| (0..=27).contains(tier))?;
    let card = player
        .get("playerCardId")
        .and_then(Value::as_str)
        .filter(|card| uuid_like(card))
        .map(|card| Value::String(format!("https://media.valorant-api.com/playercards/{}/smallart.png", card.to_lowercase())))
        .unwrap_or(Value::Null);
    let mut val = json!({ "tier": tier, "tierName": val_tier_name(tier), "level": count(player.get("accountLevel")), "card": card });
    if let Some(border) = val_border(player) {
        val["border"] = border;
    }
    Some(Reading { riot_id: RiotId { game_name, tag_line }, lol: None, tft: None, val: Some(val) })
}

pub struct GameRanks {
    league_api: Arc<dyn LocalApi>,
    riot_api: Arc<dyn LocalApi>,
}

fn answer(api: &dyn LocalApi, route: &str) -> Option<Value> {
    let response = api.get(route).ok()?;
    (response.status == 200 && (response.json.is_object() || response.json.is_array())).then_some(response.json)
}

impl GameRanks {
    pub fn new(league_api: Arc<dyn LocalApi>, riot_api: Arc<dyn LocalApi>) -> Self {
        Self { league_api, riot_api }
    }

    pub fn league(&self) -> Option<Reading> {
        let summoner = answer(self.league_api.as_ref(), "/lol-summoner/v1/current-summoner")?;
        let ranked = answer(self.league_api.as_ref(), "/lol-ranked/v1/current-ranked-stats")?;
        let mut reading = parse_league(&summoner, &ranked)?;
        if let (Some(regalia), Some(lol)) = (answer(self.league_api.as_ref(), "/lol-regalia/v2/current-summoner/regalia"), reading.lol.as_mut()) {
            let border = league_border(&regalia, &lol["level"]);
            lol["border"] = border;
        }
        Some(reading)
    }

    pub fn valorant(&self) -> Option<Reading> {
        let session = answer(self.riot_api.as_ref(), "/chat/v1/session")?;
        let presences = answer(self.riot_api.as_ref(), "/chat/v4/presences")?;
        parse_valorant(&session, &presences)
    }
}

pub fn reading_to_map(reading: &Reading) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in [("lol", &reading.lol), ("tft", &reading.tft), ("val", &reading.val)] {
        if let Some(value) = value {
            map.insert(key.into(), value.clone());
        }
    }
    map
}
