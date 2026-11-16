use std::collections::HashMap;

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Map, Value};

pub const ENDPOINT: &str = "https://mcp-api.op.gg/mcp";
pub const SOURCE: &str = "opgg";
const MAX_TEXT: usize = 256 * 1024;
const MAX_DEPTH: usize = 64;
const TIERS: [&str; 10] = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const APEX: [&str; 3] = ["MASTER", "GRANDMASTER", "CHALLENGER"];
const DIVISIONS: [&str; 4] = ["I", "II", "III", "IV"];
const QUEUES: [(&str, &str); 2] = [("solo", "SOLORANKED"), ("flex", "FLEXRANKED")];
const FIELDS: [&str; 4] = [
    "data.summoner.{level,profile_image_url,updated_at}",
    "data.summoner.league_stats[].{game_type,win,lose,is_hot_streak}",
    "data.summoner.league_stats[].tier_info.{tier,division,lp}",
    "data.summoner.league_stats[].high_leagues[].{key,lp_threshold}",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpggError {
    NotFound,
    Failed(&'static str),
}

pub fn profile_request(game_name: &str, tag_line: &str, region: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "lol_get_summoner_profile",
            "arguments": { "game_name": game_name, "tag_line": tag_line, "region": region, "lang": "en_US", "desired_output_fields": FIELDS },
        },
    })
}

fn not_found(text: &str) -> bool {
    text.to_ascii_lowercase().contains("not found")
}

pub fn tool_text(body: &Value) -> Result<String, OpggError> {
    if let Some(error) = body.get("error") {
        let message = error.get("message").and_then(Value::as_str).unwrap_or_default();
        return Err(if not_found(message) { OpggError::NotFound } else { OpggError::Failed("OP.GG could not read this profile") });
    }
    let result = body.get("result").ok_or(OpggError::Failed("OP.GG sent an invalid answer"))?;
    let text = result.pointer("/content/0/text").and_then(Value::as_str).ok_or(OpggError::Failed("OP.GG sent an invalid answer"))?;
    if result.get("isError") == Some(&Value::Bool(true)) {
        return Err(if not_found(text) { OpggError::NotFound } else { OpggError::Failed("OP.GG could not read this profile") });
    }
    Ok(text.to_string())
}

struct Parser<'a> {
    bytes: &'a [u8],
    text: &'a str,
    at: usize,
    classes: HashMap<&'a str, Vec<&'a str>>,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn skip_space(&mut self) {
        while self.peek().is_some_and(|byte| byte.is_ascii_whitespace()) {
            self.at += 1;
        }
    }

    fn eat(&mut self, byte: u8) -> bool {
        self.skip_space();
        if self.peek() == Some(byte) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn string(&mut self) -> Option<Value> {
        let start = self.at;
        self.at += 1;
        loop {
            match self.peek()? {
                b'\\' => self.at += 2,
                b'"' => break,
                _ => self.at += 1,
            }
        }
        self.at += 1;
        serde_json::from_str::<String>(self.text.get(start..self.at)?).ok().map(Value::String)
    }

    fn number(&mut self) -> Option<Value> {
        let start = self.at;
        while self.peek().is_some_and(|byte| byte.is_ascii_digit() || b"+-.eE".contains(&byte)) {
            self.at += 1;
        }
        serde_json::from_str::<serde_json::Number>(self.text.get(start..self.at)?).ok().map(Value::Number)
    }

    fn items(&mut self, close: u8, depth: usize) -> Option<Vec<Value>> {
        let mut items = Vec::new();
        if self.eat(close) {
            return Some(items);
        }
        loop {
            items.push(self.value(depth + 1)?);
            if self.eat(close) {
                return Some(items);
            }
            if !self.eat(b',') {
                return None;
            }
        }
    }

    fn value(&mut self, depth: usize) -> Option<Value> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.skip_space();
        match self.peek()? {
            b'"' => self.string(),
            b'[' => {
                self.at += 1;
                self.items(b']', depth).map(Value::Array)
            }
            byte if byte == b'-' || byte.is_ascii_digit() => self.number(),
            byte if byte.is_ascii_alphabetic() || byte == b'_' => {
                let start = self.at;
                while self.peek().is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_') {
                    self.at += 1;
                }
                let name = self.text.get(start..self.at)?;
                match name {
                    "null" | "None" => return Some(Value::Null),
                    "true" | "True" => return Some(Value::Bool(true)),
                    "false" | "False" => return Some(Value::Bool(false)),
                    _ => {}
                }
                if !self.eat(b'(') {
                    return None;
                }
                let values = self.items(b')', depth)?;
                let fields = self.classes.get(name)?;
                if fields.len() != values.len() {
                    return None;
                }
                Some(Value::Object(fields.iter().map(|field| field.to_string()).zip(values).collect()))
            }
            _ => None,
        }
    }
}

pub fn parse_text(text: &str) -> Option<Value> {
    if text.len() > MAX_TEXT {
        return None;
    }
    let text = text.replace("\r\n", "\n");
    let (header, body) = text.split_once("\n\n")?;
    let mut classes = HashMap::new();
    for line in header.lines().filter(|line| !line.trim().is_empty()) {
        let (name, fields) = line.strip_prefix("class ")?.split_once(':')?;
        let fields: Vec<&str> = fields.split(',').map(str::trim).filter(|field| !field.is_empty()).collect();
        classes.insert(name.trim(), fields);
    }
    let mut parser = Parser { bytes: body.as_bytes(), text: body, at: 0, classes };
    let value = parser.value(0)?;
    parser.skip_space();
    (parser.at == body.len()).then_some(value)
}

fn count(value: Option<&Value>) -> Value {
    value.and_then(Value::as_i64).filter(|number| (0..1_000_000).contains(number)).map(Value::from).unwrap_or(Value::Null)
}

fn icon_id(url: Option<&Value>) -> Value {
    let Some(url) = url.and_then(Value::as_str) else {
        return Value::Null;
    };
    let Some((_, rest)) = url.rsplit_once("profileIcon") else {
        return Value::Null;
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let valid = !digits.is_empty() && digits.len() <= 7 && rest[digits.len()..].starts_with('.');
    if valid {
        count(Some(&Value::from(digits.parse::<i64>().unwrap_or(-1))))
    } else {
        Value::Null
    }
}

fn division(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Number(number) => number.as_u64().filter(|number| (1..=4).contains(number)).map(|number| DIVISIONS[number as usize - 1].to_string()),
        Value::String(text) => DIVISIONS.contains(&text.as_str()).then(|| text.clone()),
        _ => None,
    }
}

fn cutoffs(stat: &Value) -> Option<Value> {
    let leagues = stat.get("high_leagues").and_then(Value::as_array)?;
    let threshold = |key: &str| leagues.iter().find(|league| league.get("key").and_then(Value::as_str) == Some(key)).map(|league| count(league.get("lp_threshold"))).unwrap_or(Value::Null);
    let (challenger, grandmaster) = (threshold("CHALLENGER"), threshold("GRANDMASTER"));
    (!challenger.is_null() || !grandmaster.is_null()).then(|| json!({ "challenger": challenger, "grandmaster": grandmaster }))
}

fn queue_entry(stat: Option<&Value>) -> Value {
    let Some(stat) = stat else {
        return Value::Null;
    };
    let info = stat.get("tier_info");
    let tier = info.and_then(|info| info.get("tier")).and_then(Value::as_str).unwrap_or_default().to_ascii_uppercase();
    if !TIERS.contains(&tier.as_str()) {
        return Value::Null;
    }
    let apex = APEX.contains(&tier.as_str());
    let division = if apex { Some(String::new()) } else { division(info.and_then(|info| info.get("division"))) };
    let (lp, wins, losses) = (count(info.and_then(|info| info.get("lp"))), count(stat.get("win")), count(stat.get("lose")));
    let Some(division) = division.filter(|_| !lp.is_null() && !wins.is_null() && !losses.is_null()) else {
        return Value::Null;
    };
    let mut entry = Map::new();
    entry.insert("tier".into(), Value::String(tier));
    entry.insert("division".into(), Value::String(division));
    entry.insert("lp".into(), lp);
    entry.insert("wins".into(), wins);
    entry.insert("losses".into(), losses);
    entry.insert("hotStreak".into(), Value::Bool(stat.get("is_hot_streak") == Some(&Value::Bool(true))));
    if apex {
        if let Some(cutoffs) = cutoffs(stat) {
            entry.insert("cutoffs".into(), cutoffs);
        }
    }
    Value::Object(entry)
}

pub fn profile_time(value: Option<&Value>) -> Option<String> {
    let date = DateTime::parse_from_rfc3339(value?.as_str()?).ok()?;
    Some(date.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true))
}

pub fn lol_from_profile(parsed: &Value, fetched_at: &str) -> Option<Value> {
    let summoner = parsed.pointer("/data/summoner").filter(|summoner| summoner.is_object())?;
    let stats = summoner.get("league_stats").and_then(Value::as_array).cloned().unwrap_or_default();
    let stat = |kind: &str| stats.iter().find(|stat| stat.get("game_type").and_then(Value::as_str) == Some(kind));
    let mut lol = Map::new();
    lol.insert("level".into(), count(summoner.get("level")));
    lol.insert("iconId".into(), icon_id(summoner.get("profile_image_url")));
    for (name, kind) in QUEUES {
        lol.insert(name.into(), queue_entry(stat(kind)));
    }
    lol.insert("updatedAt".into(), Value::String(profile_time(summoner.get("updated_at")).unwrap_or_else(|| fetched_at.to_string())));
    lol.insert("source".into(), Value::String(SOURCE.into()));
    Some(Value::Object(lol))
}

pub fn is_newer(block: &Value, saved: Option<&Value>) -> bool {
    let time = |value: Option<&Value>| value.and_then(|value| value.get("updatedAt")).and_then(Value::as_str).and_then(|text| DateTime::parse_from_rfc3339(text).ok());
    match (time(Some(block)), time(saved)) {
        (_, None) => true,
        (None, Some(_)) => false,
        (Some(fresh), Some(saved)) => fresh >= saved,
    }
}
