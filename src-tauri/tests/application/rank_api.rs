use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use chrono::DateTime;
use eclipse::application::rank_api::{encode_component, key_hash, ladder_cutoffs, retry_delay, ApiHooks, Cutoffs, HttpAnswer, HttpFailure, RankApi, RankHttp, UreqHttp, TOO_SLOW};
use eclipse::application::store::ApiKeys;
use serde_json::{json, Map, Value};

type Reply = Box<dyn Fn(&str) -> Result<HttpAnswer, HttpFailure> + Send + Sync>;

fn answer(status: u16, body: Value) -> Result<HttpAnswer, HttpFailure> {
    Ok(HttpAnswer { status, retry_after: None, body: Some(body) })
}

fn ok(body: Value) -> Reply {
    Box::new(move |_| answer(200, body.clone()))
}

fn status(code: u16, body: Value) -> Reply {
    Box::new(move |_| answer(code, body.clone()))
}

struct Http {
    routes: Vec<(String, Reply)>,
    calls: Mutex<Vec<(String, String)>>,
}

impl RankHttp for Http {
    fn get(&self, url: &str, headers: &[(&str, &str)], _timeout_ms: u64) -> Result<HttpAnswer, HttpFailure> {
        let token = headers.iter().find(|(name, _)| *name == "X-Riot-Token" || *name == "Authorization").map(|(_, value)| value.to_string()).unwrap_or_default();
        self.calls.lock().unwrap().push((url.to_string(), token));
        match self.routes.iter().find(|(pattern, _)| url.contains(pattern.as_str())) {
            Some((_, reply)) => reply(url),
            None => answer(404, json!({})),
        }
    }
}

struct Fixture {
    api: RankApi,
    http: Arc<Http>,
    clock: Arc<AtomicI64>,
    waits: Arc<Mutex<Vec<u64>>>,
}

fn start_time() -> i64 {
    DateTime::parse_from_rfc3339("2026-11-05T12:00:00Z").unwrap().timestamp_millis()
}

fn fixture(routes: Vec<(&str, Reply)>) -> Fixture {
    let http = Arc::new(Http { routes: routes.into_iter().map(|(pattern, reply)| (pattern.to_string(), reply)).collect(), calls: Mutex::new(Vec::new()) });
    let clock = Arc::new(AtomicI64::new(start_time()));
    let waits = Arc::new(Mutex::new(Vec::new()));
    let hooks = ApiHooks {
        wait: Box::new({
            let waits = waits.clone();
            move |ms| {
                if ms != 80 {
                    waits.lock().unwrap().push(ms);
                }
            }
        }),
        now: Box::new({
            let clock = clock.clone();
            move || clock.load(Ordering::SeqCst)
        }),
        timeout_ms: 15_000,
    };
    Fixture { api: RankApi::new(http.clone(), hooks), http, clock, waits }
}

impl Fixture {
    fn count(&self, pattern: &str) -> usize {
        self.http.calls.lock().unwrap().iter().filter(|(url, _)| url.contains(pattern)).count()
    }

    fn called(&self, pattern: &str, token: &str) -> bool {
        self.http.calls.lock().unwrap().iter().any(|(url, used)| url.contains(pattern) && used == token)
    }

    fn advance(&self, ms: i64) {
        self.clock.fetch_add(ms, Ordering::SeqCst);
    }
}

fn keys(riot: &str, tft: &str, henrik: &str) -> ApiKeys {
    ApiKeys { riot: riot.into(), tft: tft.into(), henrik: henrik.into() }
}

fn account(overrides: Value) -> Map<String, Value> {
    let mut account = json!({
        "id": "a1", "gameName": "Old Name", "tagLine": "BR1", "region": "br1",
        "puuidCache": { key_hash("riot-key"): { "riotId": "Old Name#BR1", "puuid": "p-1" } },
    });
    for (key, value) in overrides.as_object().cloned().unwrap_or_default() {
        account[key] = value;
    }
    account.as_object().cloned().unwrap()
}

fn profile(puuid: &str) -> Vec<(String, Reply)> {
    vec![(format!("/summoners/by-puuid/{puuid}"), ok(json!({ "summonerLevel": 300, "profileIconId": 7 }))), (format!("/tft/league/v1/by-puuid/{puuid}"), ok(json!([])))]
}

fn routes(list: Vec<(String, Reply)>) -> Vec<(&'static str, Reply)> {
    list.into_iter().map(|(pattern, reply)| (&*Box::leak(pattern.into_boxed_str()), reply)).collect()
}

fn with_profile(mut list: Vec<(String, Reply)>, puuid: &str) -> Vec<(String, Reply)> {
    list.extend(profile(puuid));
    list
}

fn s(text: &str) -> String {
    text.to_string()
}

#[test]
fn the_key_hash_and_the_url_encoding_match_the_electron_version() {
    assert_eq!(key_hash("riot-key"), "a4c3f8b11c39");
    assert_eq!(key_hash("tft-key"), "cb7fe3254359");
    assert_eq!(encode_component("New Name"), "New%20Name");
    assert_eq!(encode_component("Ação#1/?(ok)"), "A%C3%A7%C3%A3o%231%2F%3F(ok)");
}

#[test]
fn a_riot_id_renamed_on_the_riot_site_follows_the_saved_puuid_and_updates_the_account() {
    let f = fixture(routes(with_profile(
        vec![
            (s("/accounts/by-puuid/p-1"), ok(json!({ "puuid": "p-1", "gameName": "New Name", "tagLine": "NEW" }))),
            (s("/entries/by-puuid/p-1"), ok(json!([]))),
            (s("/v3/mmr/br/pc/New%20Name/NEW"), ok(json!({ "data": { "current": { "tier": { "id": 10, "name": "Silver 2" }, "rr": 40 } } }))),
            (s("/v1/account/New%20Name/NEW"), ok(json!({ "data": { "account_level": 50 } }))),
        ],
        "p-1",
    )));
    let refresh = f.api.refresh_account(&account(json!({})), &keys("riot-key", "", "henrik-key"));
    assert_eq!(refresh.fields["gameName"], "New Name");
    assert_eq!(refresh.fields["tagLine"], "NEW");
    assert_eq!(refresh.fields["puuidCache"][key_hash("riot-key")], json!({ "riotId": "New Name#NEW", "puuid": "p-1" }));
    assert_eq!(refresh.fields["stats"]["lol"]["level"], 300);
    assert_eq!(refresh.fields["stats"]["val"]["tierName"], "Silver 2");
    assert_eq!(refresh.fields["stats"]["val"]["rr"], 40);
    assert_eq!(refresh.fields["stats"]["val"]["level"], 50);
    assert!(refresh.errors.is_empty());
    assert_eq!(f.count("/riot/account/v1/"), 1);
    assert_eq!(f.count("/by-riot-id/"), 0);
    assert!(f.called("/v3/mmr/br/pc/New%20Name/NEW", "henrik-key"));
}

#[test]
fn an_unchanged_riot_id_costs_one_account_lookup_and_leaves_the_name_alone() {
    let f = fixture(routes(with_profile(vec![(s("/accounts/by-puuid/p-1"), ok(json!({ "puuid": "p-1", "gameName": "Old Name", "tagLine": "BR1" }))), (s("/entries/by-puuid/p-1"), ok(json!([])))], "p-1")));
    let refresh = f.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    assert!(refresh.fields.get("gameName").is_none());
    assert!(refresh.fields.get("tagLine").is_none());
    assert_eq!(f.count("/riot/account/v1/"), 1);
    assert!(refresh.errors.get("lol").is_none());
    assert!(refresh.errors.get("tft").is_none());
    assert_eq!(refresh.errors["val"], "No HenrikDev API key (Settings)");
}

#[test]
fn a_failed_rename_check_keeps_the_saved_puuid_and_still_refreshes_the_ranks() {
    let f = fixture(routes(with_profile(vec![(s("/accounts/by-puuid/p-1"), status(500, json!({ "status": { "message": "Internal error" } }))), (s("/entries/by-puuid/p-1"), ok(json!([])))], "p-1")));
    let refresh = f.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    assert!(refresh.errors.get("lol").is_none());
    assert_eq!(refresh.fields["stats"]["lol"]["level"], 300);
    assert!(refresh.fields.get("gameName").is_none());
    assert_eq!(refresh.fields["puuidCache"][key_hash("riot-key")], json!({ "riotId": "Old Name#BR1", "puuid": "p-1" }));
    assert_eq!(f.count("/by-riot-id/"), 0);
}

#[test]
fn a_riot_id_edited_in_eclipse_looks_up_the_typed_name_instead_of_the_saved_puuid() {
    let f = fixture(routes(with_profile(vec![(s("/by-riot-id/Other/BR1"), ok(json!({ "puuid": "p-2", "gameName": "Other", "tagLine": "BR1" }))), (s("/entries/by-puuid/p-2"), ok(json!([])))], "p-2")));
    let refresh = f.api.refresh_account(&account(json!({ "gameName": "Other" })), &keys("riot-key", "", ""));
    assert_eq!(f.count("/accounts/by-puuid/"), 0);
    assert_eq!(refresh.fields["puuidCache"][key_hash("riot-key")], json!({ "riotId": "Other#BR1", "puuid": "p-2" }));
    assert_eq!(refresh.fields["stats"]["lol"]["level"], 300);
}

#[test]
fn an_old_cache_with_a_single_puuid_is_dropped() {
    let f = fixture(routes(with_profile(vec![(s("/by-riot-id/Old%20Name/BR1"), ok(json!({ "puuid": "p-1", "gameName": "Old Name", "tagLine": "BR1" }))), (s("/entries/by-puuid/p-1"), ok(json!([])))], "p-1")));
    let refresh = f.api.refresh_account(&account(json!({ "puuidCache": { "puuid": "legacy" } })), &keys("riot-key", "", ""));
    assert_eq!(Value::Object(refresh.fields["puuidCache"].as_object().unwrap().clone()), json!({ key_hash("riot-key"): { "riotId": "Old Name#BR1", "puuid": "p-1" } }));
}

#[test]
fn a_separate_tft_key_looks_up_the_new_name_found_by_the_league_key_in_the_same_refresh() {
    let f = fixture(routes(with_profile(
        vec![
            (s("/accounts/by-puuid/p-1"), ok(json!({ "puuid": "p-1", "gameName": "New Name", "tagLine": "NEW" }))),
            (s("/by-riot-id/New%20Name/NEW"), ok(json!({ "puuid": "t-1", "gameName": "New Name", "tagLine": "NEW" }))),
            (s("/entries/by-puuid/p-1"), ok(json!([]))),
            (s("/tft/league/v1/by-puuid/t-1"), ok(json!([{ "queueType": "RANKED_TFT", "tier": "GOLD", "rank": "II", "leaguePoints": 30, "wins": 5, "losses": 4 }]))),
        ],
        "p-1",
    )));
    let refresh = f.api.refresh_account(&account(json!({})), &keys("riot-key", "tft-key", ""));
    assert_eq!(Value::Object(refresh.errors.clone()), json!({ "val": "No HenrikDev API key (Settings)" }));
    assert_eq!(refresh.fields["stats"]["tft"]["ranked"], json!({ "tier": "GOLD", "division": "II", "lp": 30, "wins": 5, "losses": 4, "hotStreak": false }));
    assert_eq!(refresh.fields["puuidCache"][key_hash("tft-key")], json!({ "riotId": "New Name#NEW", "puuid": "t-1" }));
    assert!(f.called("/by-riot-id/New%20Name/NEW", "tft-key"));
    assert_eq!(f.count("/by-riot-id/Old"), 0);
}

fn entries(points: &[i64]) -> Vec<Value> {
    points.iter().map(|lp| json!({ "leaguePoints": lp })).collect()
}

#[test]
fn the_cutoffs_come_from_the_whole_master_plus_ladder_counting_masters_above_the_lowest_grandmasters() {
    assert_eq!(ladder_cutoffs(&entries(&[1000, 900, 800]), &entries(&[700, 600, 500, 450]), &entries(&[650, 300])), Cutoffs { challenger: Some(800), grandmaster: Some(500) });
    assert_eq!(ladder_cutoffs(&entries(&[1000, 900]), &[], &entries(&[650])), Cutoffs { challenger: Some(900), grandmaster: None });
    assert_eq!(ladder_cutoffs(&[], &[], &[]), Cutoffs { challenger: None, grandmaster: None });
}

fn apex_routes(failing: bool) -> Vec<(String, Reply)> {
    vec![
        (s("/challengerleagues/by-queue/RANKED_SOLO_5x5"), if failing { status(503, json!({})) } else { ok(json!({ "entries": [{ "leaguePoints": 1100 }, { "leaguePoints": 950 }] })) }),
        (s("/grandmasterleagues/by-queue/RANKED_SOLO_5x5"), ok(json!({ "entries": [{ "leaguePoints": 640 }, { "leaguePoints": 500 }, { "leaguePoints": 410 }] }))),
        (s("/masterleagues/by-queue/RANKED_SOLO_5x5"), ok(json!({ "entries": [{ "leaguePoints": 520 }, { "leaguePoints": 215 }, { "leaguePoints": 40 }] }))),
    ]
}

fn league(puuid: &str, tier: &str, lp: i64) -> (String, Reply) {
    (
        format!("/entries/by-puuid/{puuid}"),
        ok(json!([
            { "queueType": "RANKED_SOLO_5x5", "tier": tier, "rank": "I", "leaguePoints": lp, "wins": 80, "losses": 60 },
            { "queueType": "RANKED_FLEX_SR", "tier": "DIAMOND", "rank": "II", "leaguePoints": 10, "wins": 4, "losses": 3 },
        ])),
    )
}

fn named(puuid: &str, game_name: &str) -> (String, Reply) {
    (format!("/accounts/by-puuid/{puuid}"), ok(json!({ "puuid": puuid, "gameName": game_name, "tagLine": "BR1" })))
}

#[test]
fn master_and_above_get_the_grandmaster_and_challenger_cutoffs_fetched_once_per_region_and_queue() {
    let mut list = apex_routes(false);
    list.extend([named("p-1", "Old Name"), named("p-2", "Second"), league("p-1", "MASTER", 215), league("p-2", "GRANDMASTER", 480)]);
    list.extend(profile("p-1"));
    list.extend(profile("p-2"));
    let f = fixture(routes(list));
    let second = account(json!({ "id": "a2", "gameName": "Second", "puuidCache": { key_hash("riot-key"): { "riotId": "Second#BR1", "puuid": "p-2" } } }));
    let first = f.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    let other = f.api.refresh_account(&second, &keys("riot-key", "", ""));
    assert_eq!(first.fields["stats"]["lol"]["solo"]["cutoffs"], json!({ "challenger": 950, "grandmaster": 500 }));
    assert_eq!(other.fields["stats"]["lol"]["solo"]["cutoffs"], json!({ "challenger": 950, "grandmaster": 500 }));
    assert_eq!(first.fields["stats"]["lol"]["solo"]["division"], "");
    assert!(first.fields["stats"]["lol"]["flex"].get("cutoffs").is_none());
    assert_eq!(f.count("/challengerleagues/"), 1);
    assert_eq!(f.count("/grandmasterleagues/"), 1);
    assert_eq!(f.count("/masterleagues/"), 1);
    assert_eq!(f.count("RANKED_FLEX_SR"), 0);
    f.advance(11 * 60_000);
    f.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    assert_eq!(f.count("/challengerleagues/"), 2);
}

#[test]
fn accounts_below_master_never_download_the_apex_ladders() {
    let f = fixture(routes(with_profile(vec![named("p-1", "Old Name"), league("p-1", "DIAMOND", 90)], "p-1")));
    let refresh = f.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    assert_eq!(refresh.fields["stats"]["lol"]["solo"]["tier"], "DIAMOND");
    assert!(refresh.fields["stats"]["lol"]["solo"].get("cutoffs").is_none());
    assert_eq!(f.count("leagues/by-queue/"), 0);
}

#[test]
fn a_ladder_that_fails_to_load_leaves_the_ranks_intact_and_is_tried_again_on_the_next_refresh() {
    let mut list = apex_routes(true);
    list.extend(with_profile(vec![named("p-1", "Old Name"), league("p-1", "MASTER", 215)], "p-1"));
    let f = fixture(routes(list));
    let refresh = f.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    assert!(refresh.errors.get("lol").is_none());
    assert_eq!(refresh.fields["stats"]["lol"]["solo"]["lp"], 215);
    assert!(refresh.fields["stats"]["lol"]["solo"].get("cutoffs").is_none());
    f.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    assert_eq!(f.count("/challengerleagues/"), 2);
}

#[test]
fn a_rank_answer_that_never_comes_fails_with_a_fixed_text() {
    let f = fixture(routes(vec![(s("/by-riot-id/"), Box::new(|_: &str| Err(HttpFailure::TimedOut)))]));
    let refresh = f.api.refresh_account(&account(json!({ "puuidCache": {} })), &keys("riot-key", "", "henrik-key"));
    assert_eq!(refresh.errors["lol"], TOO_SLOW);
    assert_eq!(refresh.errors["tft"], TOO_SLOW);
    assert!(refresh.errors["val"].as_str().unwrap().contains("No VALORANT profile"));
}

#[test]
fn a_rate_limit_waits_what_riot_asks_in_seconds_or_as_a_date_and_gives_up_on_long_waits() {
    let run = |retry_after: Option<&'static str>| {
        let limited = Arc::new(AtomicBool::new(false));
        let reply: Reply = Box::new(move |_| {
            if !limited.swap(true, Ordering::SeqCst) {
                return Ok(HttpAnswer { status: 429, retry_after: retry_after.map(str::to_string), body: Some(json!({ "status": { "message": "Rate limit exceeded" } })) });
            }
            answer(200, json!({ "puuid": "p-1", "gameName": "Old Name", "tagLine": "BR1" }))
        });
        let mut list = vec![(s("/by-riot-id/"), reply)];
        list.extend(profile("p-1"));
        let f = fixture(routes(list));
        let refresh = f.api.refresh_account(&account(json!({ "puuidCache": {} })), &keys("riot-key", "", ""));
        let waits = f.waits.lock().unwrap().clone();
        (waits, refresh.errors)
    };
    assert_eq!(run(Some("3")).0, [3000]);
    assert_eq!(run(Some("Thu, 05 Nov 2026 12:00:07 GMT")).0, [7000]);
    assert_eq!(run(Some("Thu, 05 Nov 2026 11:59:00 GMT")).0, [0]);
    assert_eq!(run(Some("soon")).0, [5000]);
    assert_eq!(run(None).0, [5000]);
    let (waits, errors) = run(Some("3600"));
    assert!(waits.is_empty());
    assert_eq!(errors["lol"], "Rate limit exceeded");
    assert!(errors.get("tft").is_none());
    assert_eq!(retry_delay(Some(" 61 "), 0), None);
}

#[test]
fn requests_close_together_are_spaced_by_eighty_milliseconds() {
    let spacing = Arc::new(Mutex::new(Vec::new()));
    let http = Arc::new(Http { routes: Vec::new(), calls: Mutex::new(Vec::new()) });
    let hooks = ApiHooks {
        wait: Box::new({
            let spacing = spacing.clone();
            move |ms| spacing.lock().unwrap().push(ms)
        }),
        now: Box::new(start_time),
        timeout_ms: 1000,
    };
    let api = RankApi::new(http, hooks);
    api.refresh_account(&account(json!({ "puuidCache": {} })), &keys("riot-key", "", ""));
    let waits = spacing.lock().unwrap().clone();
    assert!(!waits.is_empty());
    assert!(waits.iter().all(|ms| *ms == 80));
}

#[test]
fn missing_riot_id_or_keys_and_rejected_keys_become_fixed_errors() {
    let f = fixture(Vec::new());
    let refresh = f.api.refresh_account(&account(json!({ "tagLine": "" })), &keys("riot-key", "", "henrik-key"));
    assert_eq!(Value::Object(refresh.errors.clone()), json!({ "all": "Add the Riot ID (Name#TAG) to fetch ranks" }));
    assert_eq!(refresh.fields["stats"]["errors"], json!({ "all": "Add the Riot ID (Name#TAG) to fetch ranks" }));
    assert!(f.http.calls.lock().unwrap().is_empty());
    let none = f.api.refresh_account(&account(json!({})), &keys("", "", ""));
    assert_eq!(Value::Object(none.errors), json!({ "lol": "POST is not supported", "tft": "No Riot API key (Settings)", "val": "No HenrikDev API key (Settings)" }));
    let denied = fixture(routes(vec![(s("/accounts/by-puuid/p-1"), ok(json!({ "puuid": "p-1", "gameName": "Old Name", "tagLine": "BR1" }))), (s("/summoners/"), ok(json!({ "summonerLevel": 1 }))), (s("/entries/"), ok(json!([]))), (s("/tft/"), status(403, json!({}))), (s("henrikdev"), status(401, json!({})))]));
    let refresh = denied.api.refresh_account(&account(json!({})), &keys("riot-key", "", "henrik-key"));
    assert_eq!(refresh.errors["tft"], "This Riot key has no TFT access. Add a TFT key in Settings");
    assert_eq!(refresh.errors["val"], "HenrikDev API key is invalid");
    let expired = fixture(routes(vec![(s("riotgames"), status(401, json!({})))]));
    let refresh = expired.api.refresh_account(&account(json!({})), &keys("riot-key", "", ""));
    assert_eq!(refresh.errors["lol"], "Riot API key is invalid or expired (dev keys expire every 24h)");
    assert_eq!(refresh.errors["tft"], "Riot API key is invalid or expired (dev keys expire every 24h)");
    let unknown = f.api.refresh_account(&account(json!({ "region": "xx1" })), &keys("riot-key", "", ""));
    assert_eq!(unknown.errors["lol"], "Unknown region xx1");
}

#[test]
fn valorant_reads_peak_last_season_and_a_card_id_from_henrikdev() {
    let f = fixture(routes(vec![
        (s("/v3/mmr/eu/pc/"), ok(json!({ "data": {
            "current": { "tier": { "id": 21, "name": "Ascendant 1" }, "rr": 12, "last_change": -18 },
            "peak": { "season": { "short": "e9a3" }, "tier": { "id": 22, "name": "Ascendant 2" } },
            "seasonal": [{ "season": { "short": "e9a1" }, "end_tier": { "id": 19, "name": "Diamond 2" } }, { "season": { "short": "e9a2" }, "end_tier": { "id": 0, "name": "Unrated" } }],
        } }))),
        (s("/v1/account/"), ok(json!({ "data": { "account_level": 140, "card": "card-uuid" } }))),
    ]));
    let refresh = f.api.refresh_account(&account(json!({ "region": "euw1", "puuidCache": {} })), &keys("", "", "henrik-key"));
    let val = &refresh.fields["stats"]["val"];
    assert_eq!(val["tier"], 21);
    assert_eq!(val["lastChange"], -18);
    assert_eq!(val["peak"], json!({ "tier": 22, "name": "Ascendant 2", "season": "e9a3" }));
    assert_eq!(val["lastSeason"], json!({ "tier": 19, "name": "Diamond 2", "season": "e9a1" }));
    assert_eq!(val["level"], 140);
    assert_eq!(val["card"], "https://media.valorant-api.com/playercards/card-uuid/smallart.png");
    assert_eq!(val["region"], "eu");
    assert_eq!(val["updatedAt"], "2026-11-05T12:00:00.000Z");
}

fn serve(reply: &'static [u8]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(reply);
            thread::sleep(Duration::from_secs(3));
        }
    });
    format!("http://{address}/rank")
}

#[test]
fn the_real_client_gives_up_on_an_answer_that_never_comes_or_whose_body_never_arrives() {
    for reply in [&b""[..], &b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"[..]] {
        let url = serve(reply);
        let started = Instant::now();
        assert_eq!(UreqHttp.get(&url, &[("X-Riot-Token", "riot-key")], 200), Err(HttpFailure::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}

#[test]
fn the_real_client_reads_the_status_the_retry_header_and_the_body_of_an_error() {
    let url = serve(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 3\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
    assert_eq!(UreqHttp.get(&url, &[], 2000), Ok(HttpAnswer { status: 429, retry_after: Some("3".into()), body: Some(json!({})) }));
}
