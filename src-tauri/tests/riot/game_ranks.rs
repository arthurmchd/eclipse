use std::cell::RefCell;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use eclipse::integration::backend::Backend;
use eclipse::riot::game_ranks::{background_skin, champion_route, chosen_banner, chosen_companion, inventory_banner, skin_splash, league_banner, league_border, league_folders_with, parse_league, parse_valorant, prestige_theme, read_league_lockfile_with, val_tier_name, GameRanks};
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
    assert_eq!(league.routes().len() + riot.routes().len(), 7);
    assert!(ranks.league().unwrap().lol.unwrap().get("border").is_none());

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

#[test]
fn the_level_border_follows_the_league_thresholds() {
    let themes: Vec<i64> = [1, 29, 30, 49, 50, 74, 75, 143, 301, 499, 500, 2000].into_iter().map(prestige_theme).collect();
    assert_eq!(themes, vec![1, 1, 2, 2, 3, 3, 4, 6, 13, 20, 21, 21]);
}

#[test]
fn the_equipped_league_border_is_the_chosen_level_border_or_the_ranked_one_and_anything_else_is_no_border() {
    let level = json!(301);
    assert_eq!(league_border(&json!({ "crestType": "prestige", "selectedPrestigeCrest": 6 }), &level), json!({ "kind": "level", "theme": 6 }));
    assert_eq!(league_border(&json!({ "crestType": "prestige", "selectedPrestigeCrest": 0 }), &level), json!({ "kind": "level", "theme": 13 }));
    assert_eq!(league_border(&json!({ "crestType": "prestige", "selectedPrestigeCrest": 99, "summonerLevel": 40 }), &Value::Null), json!({ "kind": "level", "theme": 2 }));
    assert_eq!(league_border(&json!({ "crestType": "ranked", "lastSeasonHighestRank": "gold", "highestRankedEntry": { "tier": "DIAMOND" } }), &level), json!({ "kind": "ranked", "tier": "DIAMOND" }));
    assert_eq!(league_border(&json!({ "crestType": "ranked", "lastSeasonHighestRank": "", "highestRankedEntry": { "tier": "EMERALD" } }), &level), json!({ "kind": "ranked", "tier": "EMERALD" }));
    assert_eq!(league_border(&json!({ "crestType": "ranked", "lastSeasonHighestRank": "gold", "highestRankedEntry": { "tier": "NONE" } }), &level), json!({ "kind": "ranked", "tier": "GOLD" }));
    assert_eq!(league_border(&json!({ "crestType": "ranked", "lastSeasonHighestRank": "../x" }), &level), Value::Null);
    assert_eq!(league_border(&json!({ "crestType": "none" }), &level), Value::Null);
    assert_eq!(league_border(&json!({}), &level), Value::Null);
}

#[test]
fn the_league_reading_carries_the_equipped_border_with_one_more_get() {
    let league = answering(map(json!({
        "/lol-summoner/v1/current-summoner": { "status": 200, "json": summoner() },
        "/lol-ranked/v1/current-ranked-stats": { "status": 200, "json": ranked() },
        "/lol-regalia/v2/current-summoner/regalia": { "status": 200, "json": { "crestType": "prestige", "selectedPrestigeCrest": 9 } },
    })));
    let ranks = GameRanks::new(league.clone(), answering(Map::new()));
    let lol = ranks.league().unwrap().lol.unwrap();
    assert_eq!(lol["border"], json!({ "kind": "level", "theme": 9 }));
    assert_eq!(lol["banner"], json!("default"));
    assert!(league.routes().iter().all(|(method, _)| method == "GET"));
    assert_eq!(league.routes().len(), 6);
    assert!(lol.get("splash").is_none() && lol.get("companion").is_none());
}

#[test]
fn the_valorant_border_is_the_chosen_one_or_the_level_one_and_absent_when_the_presence_does_not_say() {
    let border = "AABBCCDD-0000-1111-2222-333344445555";
    let read = |data: Value| parse_valorant(&session(), &json!({ "presences": [presence(data, json!({}))] })).unwrap().val.unwrap();
    assert_eq!(read(json!({ "competitiveTier": 9, "preferredLevelBorderId": border }))["border"], "aabbccdd-0000-1111-2222-333344445555");
    assert_eq!(read(json!({ "playerPresenceData": { "competitiveTier": 9, "preferredLevelBorderId": "" } }))["border"], "level");
    assert_eq!(read(json!({ "competitiveTier": 9, "preferredLevelBorderId": "00000000-0000-0000-0000-000000000000" }))["border"], "level");
    assert_eq!(read(json!({ "competitiveTier": 9, "preferredLevelBorderId": "../../x" }))["border"], "level");
    assert!(read(json!({ "competitiveTier": 9 })).get("border").is_none());
}

#[test]
fn the_league_banner_is_the_chosen_one_the_last_season_rank_only_when_chosen_and_the_default_otherwise() {
    let regalia = json!({ "lastSeasonHighestRank": "GOLD", "bannerType": "lastSeasonHighestRank" });
    assert_eq!(league_banner(&regalia, None, None), json!("default"));
    assert_eq!(league_banner(&json!({ "lastSeasonHighestRank": "grandmaster" }), Some("2"), None), json!("grandmaster"));
    assert_eq!(league_banner(&json!({ "lastSeasonHighestRank": "GOLD", "bannerType": "blank" }), None, None), json!("default"));
    assert_eq!(league_banner(&json!({ "lastSeasonHighestRank": "../x" }), Some("2"), None), json!("default"));
    assert_eq!(league_banner(&json!({}), None, None), json!("default"));
    assert_eq!(league_banner(&regalia, Some("1"), None), json!("default"));
    assert_eq!(league_banner(&regalia, Some("2"), None), json!("gold"));
    let inventory = json!({ "3": { "items": [{ "isSelectable": false, "assetPath": "/lol-game-data/assets/ASSETS/Regalia/BannerSkins/other.png" }, { "isSelectable": true, "assetPath": "/lol-game-data/assets/ASSETS/Regalia/BannerSkins/LNY2023.png" }] } });
    assert_eq!(league_banner(&regalia, Some("3"), Some(&inventory)), json!("lny2023"));
    assert_eq!(league_banner(&regalia, Some("9"), Some(&inventory)), json!("default"));
    assert_eq!(league_banner(&regalia, Some("3"), None), json!("default"));
}

#[test]
fn only_a_numeric_banner_id_with_a_challenge_level_and_a_known_banner_path_are_accepted() {
    assert_eq!(chosen_banner(&json!({ "overallChallengeLevel": "GOLD", "bannerId": "12" })), Some("12".to_string()));
    for odd in [json!({ "bannerId": "12" }), json!({ "overallChallengeLevel": "", "bannerId": "12" }), json!({ "overallChallengeLevel": "GOLD", "bannerId": "../1" }), json!({ "overallChallengeLevel": "GOLD", "bannerId": 12 }), json!({ "overallChallengeLevel": "GOLD", "bannerId": "" })] {
        assert_eq!(chosen_banner(&odd), None);
    }
    for path in ["https://evil.example/x.png", "/lol-game-data/assets/ASSETS/Regalia/BannerSkins/../x.png", "/lol-game-data/assets/ASSETS/Regalia/Crests/x.png", "/lol-game-data/assets/"] {
        assert_eq!(inventory_banner(&json!({ "5": { "items": [{ "isSelectable": true, "assetPath": path }] } }), "5"), None);
    }
    assert_eq!(inventory_banner(&json!({ "5": { "items": "x" } }), "5"), None);
}

#[test]
fn the_league_reading_asks_for_the_banner_inventory_only_when_a_custom_banner_is_chosen() {
    let routes = |summary: Value| map(json!({
        "/lol-summoner/v1/current-summoner": { "status": 200, "json": summoner() },
        "/lol-ranked/v1/current-ranked-stats": { "status": 200, "json": ranked() },
        "/lol-regalia/v2/current-summoner/regalia": { "status": 200, "json": { "crestType": "none", "lastSeasonHighestRank": "SILVER" } },
        "/lol-challenges/v1/summary-player-data/local-player": { "status": 200, "json": summary },
        "/lol-regalia/v3/inventory/REGALIA_BANNER": { "status": 200, "json": { "7": { "items": [{ "isSelectable": true, "assetPath": "/lol-game-data/assets/ASSETS/Regalia/BannerSkins/worlds2026_banner.png" }] } } },
    }));
    let custom = answering(routes(json!({ "overallChallengeLevel": "GOLD", "bannerId": "7" })));
    assert_eq!(GameRanks::new(custom.clone(), answering(Map::new())).league().unwrap().lol.unwrap()["banner"], json!("worlds2026_banner"));
    assert_eq!(custom.routes().len(), 7);
    assert!(custom.routes().iter().all(|(method, _)| method == "GET"));
    let rank = answering(routes(json!({ "overallChallengeLevel": "GOLD", "bannerId": "2" })));
    assert_eq!(GameRanks::new(rank.clone(), answering(Map::new())).league().unwrap().lol.unwrap()["banner"], json!("silver"));
    assert_eq!(rank.routes().len(), 6);
}

#[test]
fn the_league_reading_carries_the_profile_splash_and_the_tft_companion_with_get_only() {
    let league = answering(map(json!({
        "/lol-summoner/v1/current-summoner": { "status": 200, "json": summoner() },
        "/lol-ranked/v1/current-ranked-stats": { "status": 200, "json": ranked() },
        "/lol-summoner/v1/current-summoner/summoner-profile": { "status": 200, "json": { "backgroundSkinId": 103001 } },
        "/lol-game-data/assets/v1/champions/103.json": { "status": 200, "json": { "skins": [
            { "id": 103000, "splashPath": "/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Base/Images/ahri_splash_centered_0.jpg" },
            { "id": 103001, "splashPath": "/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Skin01/Images/ahri_splash_centered_1.jpg" },
        ] } },
        "/lol-cosmetics/v1/inventories/tft/companions": { "status": 200, "json": { "selectedLoadoutItem": { "loadoutsIcon": "/lol-game-data/assets/ASSETS/Loadouts/Companions/Tooltip_ChibiAhri_Base_Classic_Tier1.png" } } },
    })));
    let lol = GameRanks::new(league.clone(), answering(Map::new())).league().unwrap().lol.unwrap();
    assert_eq!(lol["splash"], json!("characters/ahri/skins/skin01/images/ahri_splash_centered_1.jpg"));
    assert_eq!(lol["companion"], json!("tooltip_chibiahri_base_classic_tier1"));
    assert!(league.routes().iter().all(|(method, _)| method == "GET"));
}

#[test]
fn only_a_known_skin_with_a_game_data_splash_path_and_a_known_companion_path_are_kept() {
    assert_eq!(background_skin(&json!({ "backgroundSkinId": 222037 })), Some(222037));
    for odd in [json!({}), json!({ "backgroundSkinId": 0 }), json!({ "backgroundSkinId": 999 }), json!({ "backgroundSkinId": "103000" }), json!({ "backgroundSkinId": 10_000_000 })] {
        assert_eq!(background_skin(&odd), None);
    }
    assert_eq!(champion_route(222037), "/lol-game-data/assets/v1/champions/222.json");
    let champion = |path: &str| json!({ "skins": [{ "id": 103000, "splashPath": path }] });
    for path in ["https://evil.example/x.jpg", "/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/../x.jpg", "/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Base/Images/x.png", "/lol-game-data/assets/v1/champion-splashes/103/103000.jpg"] {
        assert_eq!(skin_splash(&champion(path), 103000), None);
    }
    assert_eq!(skin_splash(&champion("/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Base/Images/ahri_splash_centered_0.jpg"), 103001), None);
    assert_eq!(skin_splash(&json!({ "skins": "x" }), 103000), None);
    for odd in [json!({}), json!({ "selectedLoadoutItem": { "loadoutsIcon": "https://evil.example/x.png" } }), json!({ "selectedLoadoutItem": { "loadoutsIcon": "/lol-game-data/assets/ASSETS/Loadouts/Companions/../x.png" } }), json!({ "selectedLoadoutItem": { "loadoutsIcon": 5 } })] {
        assert_eq!(chosen_companion(&odd), None);
    }
}
