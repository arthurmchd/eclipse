use std::sync::{Arc, Mutex};

use chrono::DateTime;
use eclipse::application::opgg::{is_newer, lol_from_profile, parse_text, profile_request, tool_text, OpggError, ENDPOINT};
use eclipse::application::rank_api::{event_stream_data, ApiHooks, HttpAnswer, HttpFailure, RankApi, RankHttp, OPGG_BUSY};
use eclipse::application::rank_watcher::merge_reading;
use eclipse::application::store::ApiKeys;
use eclipse::riot::{game_ranks::Reading, RiotId};
use serde_json::{json, Map, Value};

const PROFILE: &str = "class LolGetSummonerProfile: data\nclass Data: summoner\nclass Summoner: level,profile_image_url,updated_at,league_stats\nclass LeagueStat: game_type,win,lose,is_hot_streak,tier_info,high_leagues\nclass TierInfo: tier,division,lp\nclass HighLeague: key,lp_threshold\nclass LeagueStat1: game_type,win,lose,is_hot_streak,tier_info\n\nLolGetSummonerProfile(Data(Summoner(412,\"https://opgg-static.akamaized.net/meta/images/profile_icons/profileIcon6.jpg\",\"2026-11-16T08:04:31+09:00\",[LeagueStat(\"SOLORANKED\",448,371,true,TierInfo(\"MASTER\",1,1056),[HighLeague(\"CHALLENGER\",1856),HighLeague(\"GRANDMASTER\",1365)]),LeagueStat1(\"FLEXRANKED\",20,17,false,TierInfo(\"EMERALD\",2,40)),LeagueStat1(\"ARENA\",null,null,false,TierInfo(null,null,null))])))";

fn tool_answer(text: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": text }] } })
}

struct Http {
    reply: Box<dyn Fn() -> Result<HttpAnswer, HttpFailure> + Send + Sync>,
    posts: Mutex<Vec<(String, Value)>>,
    gets: Mutex<Vec<String>>,
}

impl RankHttp for Http {
    fn get(&self, url: &str, _headers: &[(&str, &str)], _timeout_ms: u64) -> Result<HttpAnswer, HttpFailure> {
        self.gets.lock().unwrap().push(url.to_string());
        Ok(HttpAnswer { status: 401, retry_after: None, body: Some(json!({})) })
    }

    fn post(&self, url: &str, _headers: &[(&str, &str)], body: &str, _timeout_ms: u64) -> Result<HttpAnswer, HttpFailure> {
        self.posts.lock().unwrap().push((url.to_string(), serde_json::from_str(body).unwrap()));
        (self.reply)()
    }
}

fn with_answer(status: u16, body: Value) -> (RankApi, Arc<Http>, Arc<Mutex<Vec<u64>>>) {
    let http = Arc::new(Http { reply: Box::new(move || Ok(HttpAnswer { status, retry_after: None, body: Some(body.clone()) })), posts: Mutex::new(Vec::new()), gets: Mutex::new(Vec::new()) });
    let waits = Arc::new(Mutex::new(Vec::new()));
    let now = DateTime::parse_from_rfc3339("2026-11-16T00:00:00Z").unwrap().timestamp_millis();
    let hooks = ApiHooks {
        wait: Box::new({
            let waits = waits.clone();
            move |ms| waits.lock().unwrap().push(ms)
        }),
        now: Box::new(move || now),
        timeout_ms: 1000,
    };
    (RankApi::new(http.clone(), hooks), http, waits)
}

fn account(stats: Value) -> Map<String, Value> {
    json!({ "id": "a1", "gameName": "Synthetic Name", "tagLine": "BR1", "region": "br1", "stats": stats }).as_object().unwrap().clone()
}

fn no_keys() -> ApiKeys {
    ApiKeys::default()
}

#[test]
fn a_profile_in_the_opgg_text_format_becomes_the_same_league_block_the_riot_api_writes() {
    let parsed = parse_text(PROFILE).unwrap();
    let lol = lol_from_profile(&parsed, "2026-11-16T00:00:00.000Z").unwrap();
    assert_eq!(
        lol,
        json!({
            "level": 412,
            "iconId": 6,
            "solo": { "tier": "MASTER", "division": "", "lp": 1056, "wins": 448, "losses": 371, "hotStreak": true, "cutoffs": { "challenger": 1856, "grandmaster": 1365 } },
            "flex": { "tier": "EMERALD", "division": "II", "lp": 40, "wins": 20, "losses": 17, "hotStreak": false },
            "updatedAt": "2026-11-15T23:04:31.000Z",
            "source": "opgg",
        })
    );
}

#[test]
fn divisions_tiers_and_numbers_outside_their_range_leave_the_queue_unranked() {
    let profile = |tier: &str, division: &str, lp: &str| {
        let text = format!("class P: data\nclass D: summoner\nclass S: level,profile_image_url,updated_at,league_stats\nclass L: game_type,win,lose,is_hot_streak,tier_info\nclass T: tier,division,lp\n\nP(D(S(-3,\"https://x/profileIcon12a.png\",null,[L(\"SOLORANKED\",1,2,false,T({tier},{division},{lp}))])))");
        lol_from_profile(&parse_text(&text).unwrap(), "2026-11-16T00:00:00.000Z").unwrap()
    };
    let lol = profile("\"gold\"", "4", "0");
    assert_eq!(lol["solo"]["tier"], "GOLD");
    assert_eq!(lol["solo"]["division"], "IV");
    assert_eq!(lol["flex"], Value::Null);
    assert_eq!(lol["level"], Value::Null);
    assert_eq!(lol["iconId"], Value::Null);
    assert_eq!(lol["updatedAt"], "2026-11-16T00:00:00.000Z");
    assert_eq!(profile("\"GOLD\"", "5", "10")["solo"], Value::Null);
    assert_eq!(profile("\"GOLD\"", "0", "10")["solo"], Value::Null);
    assert_eq!(profile("\"WOOD\"", "1", "10")["solo"], Value::Null);
    assert_eq!(profile("\"GOLD\"", "1", "-1")["solo"], Value::Null);
    assert_eq!(profile("\"GOLD\"", "\"III\"", "10")["solo"]["division"], "III");
}

#[test]
fn the_reader_accepts_escapes_and_rejects_unknown_classes_wrong_sizes_trailing_text_deep_nesting_and_huge_answers() {
    let parsed = parse_text("class A: x,y\n\nA(\"Ana \\\"Lu\\\" \\u00e9 \u{e1}\", [1, -2.5, true, None])").unwrap();
    assert_eq!(parsed, json!({ "x": "Ana \"Lu\" \u{e9} \u{e1}", "y": [1, -2.5, true, null] }));
    assert!(parse_text("class A: x\n\nB(1)").is_none());
    assert!(parse_text("class A: x,y\n\nA(1)").is_none());
    assert!(parse_text("class A: x\n\nA(1) extra").is_none());
    assert!(parse_text("A(1)").is_none());
    assert!(parse_text("class A: x\n\nA(\"open)").is_none());
    let deep = format!("class A: x\n\n{}1{}", "[".repeat(80), "]".repeat(80));
    assert!(parse_text(&deep).is_none());
    let huge = format!("class A: x\n\nA(\"{}\")", "a".repeat(300 * 1024));
    assert!(parse_text(&huge).is_none());
}

#[test]
fn the_json_rpc_envelope_tells_a_missing_profile_from_other_failures() {
    assert_eq!(tool_text(&tool_answer("hello")), Ok("hello".to_string()));
    assert_eq!(tool_text(&json!({ "error": { "code": -32600, "message": "Summoner not found" } })), Err(OpggError::NotFound));
    assert_eq!(tool_text(&json!({ "error": { "code": -32000, "message": "boom" } })), Err(OpggError::Failed("OP.GG could not read this profile")));
    assert_eq!(tool_text(&json!({ "result": { "isError": true, "content": [{ "type": "text", "text": "Summoner not found" }] } })), Err(OpggError::NotFound));
    assert_eq!(tool_text(&json!({ "result": {} })), Err(OpggError::Failed("OP.GG sent an invalid answer")));
    assert_eq!(event_stream_data("event: message\ndata: {\"a\":1}\n\n"), "{\"a\":1}");
    assert_eq!(event_stream_data("{\"a\":1}"), "{\"a\":1}");
    let request = profile_request("Name", "TAG", "EUW");
    assert_eq!(request["method"], "tools/call");
    assert_eq!(request["params"]["name"], "lol_get_summoner_profile");
    assert_eq!(request["params"]["arguments"]["region"], "EUW");
}

#[test]
fn only_a_newer_block_replaces_the_saved_one() {
    let at = |time: &str| json!({ "updatedAt": time });
    assert!(is_newer(&at("2026-11-16T00:00:00Z"), None));
    assert!(is_newer(&at("2026-11-16T00:00:00Z"), Some(&json!({}))));
    assert!(is_newer(&at("2026-11-16T00:00:00Z"), Some(&at("2026-11-15T23:00:00.000Z"))));
    assert!(is_newer(&at("2026-11-16T09:00:00+09:00"), Some(&at("2026-11-16T00:00:00Z"))));
    assert!(!is_newer(&at("2026-11-15T22:00:00Z"), Some(&at("2026-11-15T23:00:00.000Z"))));
    assert!(!is_newer(&json!({}), Some(&at("2026-11-15T23:00:00.000Z"))));
}

#[test]
fn without_a_riot_key_the_league_rank_comes_from_opgg_with_the_account_riot_id_and_server() {
    let (api, http, _) = with_answer(200, tool_answer(PROFILE));
    let refresh = api.refresh_account(&account(json!({})), &no_keys());
    let posts = http.posts.lock().unwrap().clone();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].0, ENDPOINT);
    assert_eq!(posts[0].1["params"]["arguments"]["game_name"], "Synthetic Name");
    assert_eq!(posts[0].1["params"]["arguments"]["tag_line"], "BR1");
    assert_eq!(posts[0].1["params"]["arguments"]["region"], "BR");
    assert_eq!(refresh.fields["stats"]["lol"]["source"], "opgg");
    assert_eq!(refresh.fields["stats"]["lol"]["solo"]["lp"], 1056);
    assert!(refresh.errors.get("lol").is_none());
    assert_eq!(refresh.errors["tft"], "No Riot API key (Settings)");
    assert!(http.gets.lock().unwrap().is_empty());
}

#[test]
fn a_newer_rank_read_from_the_game_is_kept_over_an_older_opgg_profile() {
    let (api, _, _) = with_answer(200, tool_answer(PROFILE));
    let game = json!({ "lol": { "level": 413, "solo": { "tier": "GRANDMASTER", "division": "", "lp": 1400, "wins": 450, "losses": 371 }, "updatedAt": "2026-11-15T23:30:00.000Z" } });
    let refresh = api.refresh_account(&account(game.clone()), &no_keys());
    assert_eq!(refresh.fields["stats"]["lol"], game["lol"]);
    assert!(refresh.errors.get("lol").is_none());
    let older = json!({ "lol": { "level": 400, "solo": Value::Null, "updatedAt": "2026-11-15T20:00:00.000Z" } });
    let refresh = api.refresh_account(&account(older), &no_keys());
    assert_eq!(refresh.fields["stats"]["lol"]["level"], 412);
}

#[test]
fn a_rejected_riot_key_falls_back_to_opgg_and_a_busy_opgg_keeps_the_saved_rank() {
    let (api, http, _) = with_answer(200, tool_answer(PROFILE));
    let refresh = api.refresh_account(&account(json!({})), &ApiKeys { riot: "expired".into(), ..ApiKeys::default() });
    assert!(!http.gets.lock().unwrap().is_empty());
    assert_eq!(http.posts.lock().unwrap().len(), 1);
    assert_eq!(refresh.fields["stats"]["lol"]["source"], "opgg");
    assert!(refresh.errors.get("lol").is_none());
    let saved = json!({ "lol": { "level": 5, "updatedAt": "2026-11-01T00:00:00.000Z" } });
    let (busy, _, _) = with_answer(429, json!({}));
    let refresh = busy.api_refresh(&saved);
    assert_eq!(refresh.fields["stats"]["lol"], saved["lol"]);
    assert_eq!(refresh.errors["lol"], OPGG_BUSY);
    let (missing, _, _) = with_answer(200, json!({ "jsonrpc": "2.0", "id": 1, "error": { "code": -32600, "message": "Summoner not found" } }));
    assert_eq!(missing.api_refresh(&saved).errors["lol"], "Riot ID Synthetic Name#BR1 not found on OP.GG (BR)");
    let (garbled, _, _) = with_answer(200, tool_answer("not the format"));
    assert_eq!(garbled.api_refresh(&saved).errors["lol"], "OP.GG sent an answer Eclipse cannot read");
}

#[test]
fn consecutive_opgg_requests_wait_one_second_between_accounts() {
    let (api, http, waits) = with_answer(200, tool_answer(PROFILE));
    api.refresh_account(&account(json!({})), &no_keys());
    api.refresh_account(&account(json!({})), &no_keys());
    assert_eq!(http.posts.lock().unwrap().len(), 2);
    assert_eq!(*waits.lock().unwrap(), [1000]);
}

#[test]
fn a_reading_from_the_game_drops_the_opgg_mark() {
    let stats = json!({ "lol": { "level": 412, "solo": Value::Null, "flex": Value::Null, "updatedAt": "2026-11-15T23:04:31.000Z", "source": "opgg" } });
    let reading = Reading { riot_id: RiotId { game_name: "Synthetic Name".into(), tag_line: "BR1".into() }, lol: Some(json!({ "level": 413, "iconId": 6, "solo": Value::Null, "flex": Value::Null })), tft: None, val: None };
    let merged = merge_reading(Some(&stats), &reading, "2026-11-16T00:00:00.000Z");
    assert!(merged["lol"].get("source").is_none());
    assert_eq!(merged["lol"]["level"], 413);
}

trait Refresh {
    fn api_refresh(&self, stats: &Value) -> eclipse::application::rank_api::Refresh;
}

impl Refresh for RankApi {
    fn api_refresh(&self, stats: &Value) -> eclipse::application::rank_api::Refresh {
        self.refresh_account(&account(stats.clone()), &no_keys())
    }
}
