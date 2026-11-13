use std::fs;
use std::os::windows::fs::OpenOptionsExt;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use eclipse::platform::windows::safe_storage::Cipher;
use eclipse::application::store::{clean_name, AccountInput, SettingsInput, Store, RETIRED_SETTINGS};
use serde_json::{json, Map, Value};

use super::{temporary_store, FakeCipher, FAKE_PREFIX};

fn add_account(store: &mut Store) -> String {
    let saved = store
        .upsert_account(AccountInput {
            game_name: "Test".into(),
            tag_line: "TEST".into(),
            username: "fictional-login".into(),
            password: Some("fictional-password".into()),
            ..AccountInput::default()
        })
        .unwrap();
    saved["id"].as_str().unwrap().to_string()
}

fn fields(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[test]
fn session_operations_reject_traversal_and_unknown_accounts() {
    let (dir, mut store) = temporary_store();
    add_account(&mut store);
    let outside = dir.path().join("outside.bin");
    fs::write(&outside, "sentinel").unwrap();
    let long = "a".repeat(129);
    for id in ["../outside", "..\\outside", "a/b", "a:b", "", long.as_str(), "CON", "nul", "COM1", "LPT9", "outside.bin", "a.b"] {
        assert_eq!(store.session_file(id).unwrap_err(), "Invalid account ID");
        assert_eq!(store.forget_session(id).unwrap_err(), "Invalid account ID");
        assert_eq!(store.save_session(id, "fictional-session").unwrap_err(), "Invalid account ID");
        assert_eq!(store.session_saved_at(id).unwrap_err(), "Invalid account ID");
    }
    assert_eq!(fs::read_to_string(&outside).unwrap(), "sentinel");
    assert_eq!(store.save_session("unknown-account", "fictional-session").unwrap_err(), "Account not found");
    assert_eq!(store.forget_session("unknown-account").unwrap_err(), "Account not found");
}

#[test]
fn sessions_round_trip_using_encrypted_bytes_for_uuid_and_legacy_ids() {
    let (_dir, mut store) = temporary_store();
    let id = add_account(&mut store);
    store.save_session(&id, "fictional-session").unwrap();
    assert_eq!(store.load_session(&id).as_deref(), Some("fictional-session"));
    let raw = fs::read_to_string(store.session_file(&id).unwrap()).unwrap();
    assert!(raw.starts_with(FAKE_PREFIX));
    assert!(!raw.contains("fictional-session"));
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64;
    let saved_at = store.session_saved_at(&id).unwrap();
    assert!(saved_at > now - 60_000.0 && saved_at <= now + 1_000.0);
    store.forget_session(&id).unwrap();
    assert!(!store.has_session(&id).unwrap());
    assert_eq!(store.session_saved_at(&id).unwrap(), 0.0);
    store.data.accounts[0].insert("id".into(), json!("legacy-account_01"));
    store.save_session("legacy-account_01", "legacy-fictional-session").unwrap();
    assert_eq!(store.load_session("legacy-account_01").as_deref(), Some("legacy-fictional-session"));
}

#[test]
fn failed_session_replacement_preserves_the_previous_session_and_removes_temporary_files() {
    let (_dir, mut store) = temporary_store();
    let id = add_account(&mut store);
    store.save_session(&id, "old-fictional-session").unwrap();
    let file = store.session_file(&id).unwrap();
    let lock = fs::OpenOptions::new().read(true).share_mode(0).open(&file).unwrap();
    assert!(store.save_session(&id, "new-fictional-session").is_err());
    drop(lock);
    assert_eq!(store.load_session(&id).as_deref(), Some("old-fictional-session"));
    let names: Vec<String> = fs::read_dir(&store.sessions_dir).unwrap().map(|entry| entry.unwrap().file_name().into_string().unwrap()).collect();
    assert_eq!(names, vec![format!("{id}.bin")]);
}

#[test]
fn backups_track_account_and_settings_edits_without_rank_or_launch_churn() {
    let (_dir, mut store) = temporary_store();
    let id = add_account(&mut store);
    let initial = store.list_backups().len();
    store.update_account_fields(&id, fields(json!({ "note": "Edited note" }))).unwrap();
    assert_eq!(store.list_backups().len(), initial + 1);
    store.update_settings(SettingsInput { refresh_minutes: Some(15.0), ..SettingsInput::default() }).unwrap();
    assert_eq!(store.list_backups().len(), initial + 2);
    store
        .update_account_fields(&id, fields(json!({ "stats": { "lol": { "tier": "GOLD" } }, "puuidCache": { "fictional": "cache" }, "lastPlayed": "2026-11-13T00:00:00.000Z", "lastGame": "lol" })))
        .unwrap();
    store.set_current_account(&id).unwrap();
    assert_eq!(store.list_backups().len(), initial + 2);
    let newest: Value = serde_json::from_slice(&fs::read(store.backups_dir.join(&store.list_backups()[0])).unwrap()).unwrap();
    assert_eq!(newest["accounts"][0]["note"], "Edited note");
    assert_eq!(newest["settings"]["refreshMinutes"], 15);
}

#[test]
fn only_the_thirty_newest_backups_are_kept() {
    let (_dir, mut store) = temporary_store();
    let id = add_account(&mut store);
    for index in 0..35 {
        store.update_account_fields(&id, fields(json!({ "note": format!("note {index}") }))).unwrap();
    }
    let backups = store.list_backups();
    assert_eq!(backups.len(), 30);
    let newest: Value = serde_json::from_slice(&fs::read(store.backups_dir.join(&backups[0])).unwrap()).unwrap();
    assert_eq!(newest["accounts"][0]["note"], "note 34");
}

#[test]
fn stay_signed_in_is_on_by_default_and_can_be_turned_off() {
    let (_dir, mut store) = temporary_store();
    assert_eq!(store.public_settings()["staySignedIn"], true);
    let settings = store.update_settings(SettingsInput { stay_signed_in: Some(false), ..SettingsInput::default() }).unwrap();
    assert_eq!(settings["staySignedIn"], false);
    assert_eq!(store.data.settings["staySignedIn"], false);
}

#[test]
fn language_is_portuguese_by_default_and_only_switches_when_saved() {
    let (_dir, mut store) = temporary_store();
    assert_eq!(store.data.settings["language"], "pt");
    assert_eq!(store.public_settings()["language"], "pt");
    let settings = store.update_settings(SettingsInput { refresh_minutes: Some(10.0), ..SettingsInput::default() }).unwrap();
    assert_eq!(settings["language"], "pt");
    let settings = store.update_settings(SettingsInput { language: Some("en".into()), ..SettingsInput::default() }).unwrap();
    assert_eq!(settings["language"], "en");
    store.data.settings.insert("language".into(), json!("fr"));
    assert_eq!(store.public_settings()["language"], "pt");
}

#[test]
fn an_unreadable_api_key_is_skipped_while_the_others_still_work() {
    let (dir, mut store) = temporary_store();
    store
        .update_settings(SettingsInput { riot_api_key: Some(" fictional-riot-key ".into()), henrik_api_key: Some("fictional-henrik-key".into()), ..SettingsInput::default() })
        .unwrap();
    store.data.settings.insert("riotTftApiKey".into(), json!(STANDARD.encode("not-from-this-windows-user")));
    let keys = store.get_keys();
    assert_eq!((keys.riot.as_str(), keys.tft.as_str(), keys.henrik.as_str()), ("fictional-riot-key", "", "fictional-henrik-key"));
    let settings = store.public_settings();
    assert_eq!(settings["riotTftApiKeyMasked"], "(unreadable, paste it again)");
    assert_eq!(settings["riotApiKeyMasked"], "fictiona…-key");
    let log = fs::read_to_string(dir.path().join("data.log")).unwrap();
    assert!(log.contains("could not decrypt the saved riotTftApiKey, skipped it"));
    assert!(!log.contains("not-from-this-windows-user"));
    assert!(!log.contains("fictional-riot-key"));
}

#[test]
fn an_empty_api_key_removes_the_saved_one() {
    let (_dir, mut store) = temporary_store();
    store.update_settings(SettingsInput { riot_api_key: Some("fictional-riot-key".into()), ..SettingsInput::default() }).unwrap();
    store.update_settings(SettingsInput { riot_api_key: Some("  ".into()), ..SettingsInput::default() }).unwrap();
    assert_eq!(store.data.settings["riotApiKey"], Value::Null);
    assert_eq!(store.public_settings()["riotApiKeyMasked"], "");
}

#[test]
fn options_of_the_removed_legacy_mode_are_dropped_from_an_old_data_file() {
    let (_dir, mut store) = temporary_store();
    fs::write(&store.file, json!({ "accounts": [], "settings": { "refreshMinutes": 10, "minimizeOnLaunch": false, "hideRiotClient": false, "closeRiotClient": false, "streamerMode": true } }).to_string()).unwrap();
    store.data = store.load();
    assert_eq!(store.data.settings["refreshMinutes"], 10);
    for key in RETIRED_SETTINGS {
        assert!(!store.data.settings.contains_key(key));
        assert!(!store.public_settings().contains_key(key));
    }
    store.save().unwrap();
    let saved: Value = serde_json::from_slice(&fs::read(&store.file).unwrap()).unwrap();
    for key in RETIRED_SETTINGS {
        assert!(saved["settings"].get(key).is_none());
    }
}

#[test]
fn a_data_file_written_by_the_electron_version_loads_and_keeps_every_field() {
    let dir = tempfile::Builder::new().prefix("eclipse-store-test-").tempdir().unwrap();
    let original = json!({
        "accounts": [{
            "id": "6d0f1f8e-1111-4c2b-9b55-000000000001",
            "createdAt": "2026-10-20T10:00:00.000Z",
            "stats": { "lol": { "solo": { "tier": "GOLD", "rank": "II" } }, "errors": {} },
            "lastPlayed": null,
            "gameName": "Exemplo\u{2066}",
            "tagLine": "BR1",
            "region": "br1",
            "valRegion": "br",
            "username": "fictional-login",
            "note": "",
            "lastSeason": { "lol": "", "tft": "" },
            "ban": null,
            "password": STANDARD.encode(FakeCipher.encrypt(b"fictional-password").unwrap()),
            "puuidCache": { "fictional": "cache" },
            "pinned": true
        }],
        "settings": { "riotApiKey": null, "riotTftApiKey": null, "henrikApiKey": null, "refreshMinutes": 30, "staySignedIn": true, "riotClientPath": "", "language": "en" },
        "lastRefresh": "2026-11-01T00:00:00.000Z",
        "currentAccountId": "6d0f1f8e-1111-4c2b-9b55-000000000001"
    });
    fs::write(dir.path().join("data.json"), serde_json::to_string_pretty(&original).unwrap()).unwrap();
    let mut store = Store::open(dir.path(), Arc::new(FakeCipher));
    assert_eq!(store.data.accounts[0]["gameName"], "Exemplo");
    assert_eq!(store.get_password("6d0f1f8e-1111-4c2b-9b55-000000000001").unwrap(), "fictional-password");
    assert_eq!(store.data.current_account_id.as_deref(), Some("6d0f1f8e-1111-4c2b-9b55-000000000001"));
    store.save().unwrap();
    let saved: Value = serde_json::from_slice(&fs::read(&store.file).unwrap()).unwrap();
    let mut expected = original.clone();
    expected["accounts"][0]["gameName"] = json!("Exemplo");
    assert_eq!(saved, expected);
    let keys: Vec<&String> = saved["accounts"][0].as_object().unwrap().keys().collect();
    let original_keys: Vec<&String> = original["accounts"][0].as_object().unwrap().keys().collect();
    assert_eq!(keys, original_keys);
    let text = fs::read_to_string(&store.file).unwrap();
    assert!(text.starts_with("{\n  \"accounts\": [\n    {\n      \"id\""));
    let public = store.public_account(&store.data.accounts[0]);
    assert!(public.get("password").is_none());
    assert_eq!(public["hasPassword"], true);
    assert_eq!(public["hasSession"], false);
}

#[test]
fn an_unreadable_data_file_is_kept_and_the_newest_backup_is_restored() {
    let dir = tempfile::Builder::new().prefix("eclipse-store-test-").tempdir().unwrap();
    {
        let mut store = Store::open(dir.path(), Arc::new(FakeCipher));
        add_account(&mut store);
    }
    fs::write(dir.path().join("data.json"), "{ broken").unwrap();
    let store = Store::open(dir.path(), Arc::new(FakeCipher));
    assert_eq!(store.data.accounts.len(), 1);
    let corrupt: Vec<String> = fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.starts_with("data.json.corrupt-"))
        .collect();
    assert_eq!(corrupt.len(), 1);
    assert_eq!(fs::read_to_string(dir.path().join(&corrupt[0])).unwrap(), "{ broken");
    let log = fs::read_to_string(dir.path().join("data.log")).unwrap();
    assert!(log.contains("data.json unreadable"));
    assert!(log.contains("restored 1 accounts from backup data-"));
}

#[test]
fn a_new_password_or_username_drops_the_saved_session() {
    let (_dir, mut store) = temporary_store();
    let id = add_account(&mut store);
    let edit = |username: &str, password: Option<&str>| AccountInput {
        id: Some(id.clone()),
        game_name: "Test".into(),
        tag_line: "#TEST".into(),
        username: username.into(),
        password: password.map(str::to_string),
        ..AccountInput::default()
    };
    store.save_session(&id, "fictional-session").unwrap();
    let saved = store.upsert_account(edit("fictional-login", None)).unwrap();
    assert_eq!(saved["tagLine"], "TEST");
    assert!(store.has_session(&id).unwrap());
    store.upsert_account(edit("other-login", None)).unwrap();
    assert!(!store.has_session(&id).unwrap());
    store.save_session(&id, "fictional-session").unwrap();
    store.upsert_account(edit("other-login", Some("new-password"))).unwrap();
    assert!(!store.has_session(&id).unwrap());
    assert_eq!(store.get_password(&id).unwrap(), "new-password");
}

#[test]
fn deleting_the_current_account_clears_it_and_its_session() {
    let (_dir, mut store) = temporary_store();
    let id = add_account(&mut store);
    store.save_session(&id, "fictional-session").unwrap();
    store.set_current_account(&id).unwrap();
    store.delete_account(&id).unwrap();
    assert!(store.data.accounts.is_empty());
    assert_eq!(store.data.current_account_id, None);
    assert!(!store.session_file(&id).unwrap().exists());
}

#[test]
fn names_lose_invisible_direction_marks() {
    assert_eq!(clean_name("\u{2066}Nome\u{2069}\u{200B} "), "Nome");
    assert_eq!(clean_name("\u{FEFF}A\u{202A}B\u{200F}"), "AB");
}
