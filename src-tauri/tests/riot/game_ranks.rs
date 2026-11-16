use std::cell::RefCell;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use eclipse::integration::backend::Backend;
use eclipse::riot::game_ranks::{league_folders_with, parse_league, parse_valorant, read_league_lockfile_with, val_tier_name, GameRanks};
use eclipse::riot::{RiotError, RiotId};
use serde_json::{json, Map, Value};

use crate::{reply, FakeApi};

fn summoner() -> Value {
    json!({ "gameName": "Synthetic", "tagLine": "BR1", "summonerLevel": 321, "profileIconId": 29, "puuid": "synthetic-puuid" })
}

fn ranked() -> Value {
    json!({ "queues": [
        { "queueType": "RANKED_SOLO_5x5", "tier": "GOLD", "division": "II", "leaguePoints": 45, "wins": 30, "losses": 25 },
        { "queueType": "RANKED_FLEX_SR", "tier": "MASTER", "division": "NA", "leaguePoints": 120, "wins": 40, "losses": 33, "hotStreak": true },
        { "queueType": "RANKED_TFT", "tier": "PLATINUM", "division": "IV", "leaguePoints": 0, "wins": 8, "losses": 12 },
        { "queueType": "RANKED_TFT_DOUBLE_UP", "tier": "NONE", "division": "NA", "leaguePoints": 0, "wins": 0, "losses": 0 },
    ] })
}

fn session() -> Value {
    json!({ "puuid": "own-puuid", "game_name": "Synthetic", "game_tag": "VAL" })
}

fn presence(data: Value, extra: Value) -> Value {
    let mut presence = json!({ "puuid": "own-puuid", "product": "valorant", "private": STANDARD.encode(data.to_string()) });
    presence.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
    presence
}

fn with(base: Value, extra: Value) -> Value {
    let mut base = base;
    base.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
    base
}

#[test]
fn the_league_client_gives_the_riot_id_level_icon_and_every_ranked_queue_in_the_shape_the_cards_use() {
    let reading = parse_league(&summoner(), &ranked()).unwrap();
    assert_eq!(reading.riot_id, RiotId::new("Synthetic", "BR1"));
    assert_eq!(
        reading.lol,
        Some(json!({
            "level": 321, "iconId": 29,
            "solo": { "tier": "GOLD", "division": "II", "lp": 45, "wins": 30, "losses": 25, "hotStreak": false },
            "flex": { "tier": "MASTER", "division": "", "lp": 120, "wins": 40, "losses": 33, "hotStreak": true },
        }))
    );
    assert_eq!(reading.tft, Some(json!({ "ranked": { "tier": "PLATINUM", "division": "IV", "lp": 0, "wins": 8, "losses": 12, "hotStreak": false }, "doubleUp": null })));
    assert_eq!(reading.val, None);
    let from_map = parse_league(&summoner(), &json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "IRON", "division": "IV", "leaguePoints": 3, "wins": 1, "losses": 9 } } })).unwrap();
    let lol = from_map.lol.unwrap();
    assert_eq!(lol["solo"], json!({ "tier": "IRON", "division": "IV", "lp": 3, "wins": 1, "losses": 9, "hotStreak": false }));
    assert_eq!(lol["flex"], Value::Null);
}

#[test]
fn league_answers_in_an_unknown_shape_give_nothing_so_the_saved_ranks_are_kept() {
    assert_eq!(parse_league(&json!({ "displayName": "Old shape" }), &ranked()), None);
    assert_eq!(parse_league(&with(summoner(), json!({ "gameName": "x".repeat(65) })), &ranked()), None);
    assert_eq!(parse_league(&with(summoner(), json!({ "tagLine": "BR\n1" })), &ranked()), None);
    assert_eq!(parse_league(&summoner(), &json!({ "something": [] })), None);
    let odd = parse_league(
        &with(summoner(), json!({ "summonerLevel": -1, "profileIconId": 1.5 })),
        &json!({ "queues": [
            { "queueType": "RANKED_SOLO_5x5", "tier": "GOLD", "division": "V", "leaguePoints": 1, "wins": 1, "losses": 1 },
            { "queueType": "RANKED_FLEX_SR", "tier": "WOOD", "division": "I", "leaguePoints": 1, "wins": 1, "losses": 1 },
            { "queueType": "RANKED_TFT", "tier": "GOLD", "division": "I", "leaguePoints": "50", "wins": 1, "losses": 1 },
        ] }),
    )
    .unwrap();
    let (lol, tft) = (odd.lol.unwrap(), odd.tft.unwrap());
    assert_eq!([&lol["level"], &lol["iconId"], &lol["solo"], &lol["flex"], &tft["ranked"]], [&Value::Null; 5]);
}

#[test]
fn valorant_tiers_are_named_like_the_ones_the_cards_translate() {
    let names: Vec<String> = [0, 2, 3, 5, 12, 20, 21, 23, 24, 26, 27, 28].into_iter().map(val_tier_name).collect();
    assert_eq!(names, ["Unrated", "Unrated", "Iron 1", "Iron 3", "Gold 1", "Diamond 3", "Ascendant 1", "Ascendant 3", "Immortal 1", "Immortal 3", "Radiant", "Unrated"]);
}

#[test]
fn the_own_valorant_presence_gives_tier_level_and_card_in_the_flat_and_the_nested_shape_and_other_presences_are_ignored() {
    let card = "9FB348BC-41A0-91AD-8A3E-818035C4E561";
    let expected = json!({ "tier": 16, "tierName": "Platinum 2", "level": 88, "card": format!("https://media.valorant-api.com/playercards/{}/smallart.png", card.to_lowercase()) });
    let friend = presence(json!({ "competitiveTier": 27, "accountLevel": 500 }), json!({ "puuid": "friend-puuid" }));
    let lol = presence(json!({ "competitiveTier": 3 }), json!({ "product": "league_of_legends" }));
    let flat = parse_valorant(&session(), &json!({ "presences": [friend, lol, presence(json!({ "competitiveTier": 16, "accountLevel": 88, "playerCardId": card }), json!({}))] })).unwrap();
    assert_eq!(flat.riot_id, RiotId::new("Synthetic", "VAL"));
    assert_eq!(flat.val, Some(expected.clone()));
    let nested = parse_valorant(&session(), &json!({ "presences": [presence(json!({ "isValid": true, "playerPresenceData": { "competitiveTier": 16, "accountLevel": 88, "playerCardId": card } }), json!({}))] })).unwrap();
    assert_eq!(nested.val, Some(expected));
}

#[test]
fn a_missing_odd_or_oversized_valorant_presence_gives_nothing() {
    assert_eq!(parse_valorant(&session(), &json!({ "presences": [] })), None);
    assert_eq!(parse_valorant(&json!({ "puuid": "own-puuid" }), &json!({ "presences": [presence(json!({ "competitiveTier": 10 }), json!({}))] })), None);
    assert_eq!(parse_valorant(&session(), &json!({ "presences": [presence(json!({ "competitiveTier": 30 }), json!({}))] })), None);
    assert_eq!(parse_valorant(&session(), &json!({ "presences": [presence(json!({ "competitiveTier": "10" }), json!({}))] })), None);
    assert_eq!(parse_valorant(&session(), &json!({ "presences": [presence(json!({}), json!({ "private": "not base64 json" }))] })), None);
    assert_eq!(parse_valorant(&session(), &json!({ "presences": [presence(json!({}), json!({ "private": "A".repeat(64 * 1024 + 1) }))] })), None);
    let no_card = parse_valorant(&session(), &json!({ "presences": [presence(json!({ "competitiveTier": 0, "playerCardId": "../../x" }), json!({}))] })).unwrap();
    assert_eq!(no_card.val, Some(json!({ "tier": 0, "tierName": "Unrated", "level": null, "card": null })));
}

#[test]
fn the_league_lockfile_comes_from_the_league_and_tft_folders_the_riot_lists_and_nowhere_else() {
    let installs = json!({ "associated_client": {
        "C:/Riot Games/VALORANT/live/": "C:/Riot Games/Riot Client/RiotClientServices.exe",
        "C:/Riot Games/League of Legends/": "C:/Riot Games/Riot Client/RiotClientServices.exe",
        "C:/Riot Games/Teamfight Tactics/Live/": "C:/Riot Games/Riot Client/RiotClientServices.exe",
        "League of Legends/": "relative",
    } })
    .to_string();
    let read: RefCell<Vec<PathBuf>> = RefCell::new(Vec::new());
    let read_file = |file: &Path| -> io::Result<String> {
        read.borrow_mut().push(file.to_path_buf());
        if file == Path::new("installs.json") {
            return Ok(installs.clone());
        }
        if file == Path::new("C:\\Riot Games\\Teamfight Tactics\\Live\\lockfile") {
            return Ok("LeagueClient:4321:50123:synthetic-password:https".into());
        }
        Err(io::Error::from(io::ErrorKind::NotFound))
    };
    let installs_file = Path::new("installs.json");
    assert_eq!(league_folders_with(&read_file, installs_file), ["C:/Riot Games/League of Legends/", "C:/Riot Games/Teamfight Tactics/Live/"]);
    assert_eq!(read_league_lockfile_with(&read_file, installs_file).unwrap(), Backend { pid: 4321, port: 50123, token: "synthetic-password".into() });
    assert!(!read.borrow().iter().any(|file| file.to_string_lossy().contains("VALORANT")));
    assert_eq!(read_league_lockfile_with(&|_| Err(io::Error::from(io::ErrorKind::NotFound)), installs_file).unwrap_err(), "The League client is not running");
    assert!(league_folders_with(&|_| Ok("{bad json".into()), installs_file).is_empty());
}

fn answering(routes: Map<String, Value>) -> Arc<FakeApi> {
    FakeApi::new(move |_, path, _| match routes.get(path) {
        Some(Value::String(error)) => Err(RiotError::new(error.clone())),
        Some(answer) => reply(answer["status"].as_u64().unwrap() as u16, answer["json"].clone()),
        None => Err(RiotError::new("unexpected route")),
    })
}

fn map(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap()
}

#[test]
fn the_reader_only_sends_get_requests_stops_at_the_first_failing_answer_and_reads_each_game_from_its_own_service() {
    let league = answering(map(json!({
        "/lol-summoner/v1/current-summoner": { "status": 200, "json": summoner() },
        "/lol-ranked/v1/current-ranked-stats": { "status": 200, "json": ranked() },
    })));
    let riot = answering(map(json!({
        "/chat/v1/session": { "status": 200, "json": session() },
        "/chat/v4/presences": { "status": 200, "json": { "presences": [presence(json!({ "competitiveTier": 9 }), json!({}))] } },
    })));
    let ranks = GameRanks::new(league.clone(), riot.clone());
    assert_eq!(ranks.league().unwrap().lol.unwrap()["solo"]["tier"], "GOLD");
    assert_eq!(ranks.valorant().unwrap().val.unwrap()["tierName"], "Silver 1");
    assert!(league.routes().iter().chain(riot.routes().iter()).all(|(method, _)| method == "GET"));
    assert_eq!(league.routes().len() + riot.routes().len(), 4);

    let league = answering(map(json!({ "/lol-summoner/v1/current-summoner": { "status": 404, "json": { "message": "nope" } } })));
    let riot = answering(map(json!({ "/chat/v1/session": "not ready" })));
    let failing = GameRanks::new(league.clone(), riot.clone());
    assert_eq!(failing.league(), None);
    assert_eq!(failing.valorant(), None);
    assert_eq!(league.routes().len(), 1);
    assert_eq!(riot.routes().len(), 1);
}

#[test]
fn the_league_answer_in_the_shape_the_client_sent_on_2026_11_08_with_queues_and_queue_map_together() {
    let queue = |queue_type: &str, tier: &str, division: &str, lp: i64, wins: i64, losses: i64, provisional: bool| {
        json!({
            "queueType": queue_type, "tier": tier, "division": division, "leaguePoints": lp, "wins": wins, "losses": losses, "isProvisional": provisional,
            "highestTier": tier, "highestDivision": division, "previousSeasonEndTier": "", "miniSeriesProgress": "", "ratedTier": "NONE", "ratedRating": 0,
            "provisionalGameThreshold": 5, "provisionalGamesRemaining": 0, "warnings": {},
        })
    };
    let queues = vec![
        queue("RANKED_SOLO_5x5", "PLATINUM", "III", 12, 31, 28, false),
        queue("RANKED_FLEX_SR", "SILVER", "I", 90, 7, 9, false),
        queue("RANKED_TFT", "BRONZE", "I", 35, 3, 1, true),
        queue("JADE_RANKED_SOLO_5x5", "", "NA", 0, 0, 0, false),
        queue("RANKED_TFT_DOUBLE_UP", "", "NA", 0, 0, 0, true),
        queue("RANKED_PREMADE_5x5", "", "NA", 0, 0, 0, true),
    ];
    let queue_map: Map<String, Value> = queues.iter().map(|queue| (queue["queueType"].as_str().unwrap().to_string(), queue.clone())).collect();
    let ranked = json!({ "queues": queues, "queueMap": queue_map, "highestRankedEntry": {}, "seasons": {}, "splitsProgress": {}, "earnedRegaliaRewardIds": [] });
    let summoner = with(summoner(), json!({ "accountId": 1, "summonerId": 2, "displayName": "", "internalName": "", "privacy": "PUBLIC", "unnamed": false, "nameChangeFlag": false, "rerollPoints": {} }));
    let reading = parse_league(&summoner, &ranked).unwrap();
    assert_eq!(
        reading.lol,
        Some(json!({
            "level": 321, "iconId": 29,
            "solo": { "tier": "PLATINUM", "division": "III", "lp": 12, "wins": 31, "losses": 28, "hotStreak": false },
            "flex": { "tier": "SILVER", "division": "I", "lp": 90, "wins": 7, "losses": 9, "hotStreak": false },
        }))
    );
    assert_eq!(reading.tft, Some(json!({ "ranked": { "tier": "BRONZE", "division": "I", "lp": 35, "wins": 3, "losses": 1, "hotStreak": false }, "doubleUp": null })));
}
