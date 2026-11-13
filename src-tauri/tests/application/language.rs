use std::collections::HashSet;
use std::fs;

use eclipse::application::language::{localize, main_text, normalize_language, DEFAULT_LANGUAGE, LANGUAGES, MESSAGES};
use eclipse::paths::source_dir;
use regex::Regex;

#[test]
fn portuguese_is_the_default_and_only_portuguese_or_english_are_accepted() {
    assert_eq!(LANGUAGES, ["pt", "en"]);
    assert_eq!(DEFAULT_LANGUAGE, "pt");
    for value in [None, Some(""), Some("fr"), Some("EN"), Some("1")] {
        assert_eq!(normalize_language(value), "pt");
    }
    assert_eq!(normalize_language(Some("en")), "en");
}

#[test]
fn every_message_translates_both_ways_without_ambiguity() {
    let mut english = HashSet::new();
    let mut portuguese = HashSet::new();
    for (en, pt) in MESSAGES {
        assert!(!english.contains(en) && !portuguese.contains(en), "{en}");
        assert!(!portuguese.contains(pt) && !english.contains(pt), "{pt}");
        english.insert(*en);
        portuguese.insert(*pt);
        assert_eq!(localize(en, Some("pt")), *pt);
        assert_eq!(localize(pt, Some("en")), *en);
        assert_eq!(localize(en, Some("en")), *en);
        assert_eq!(localize(pt, Some("pt")), *pt);
    }
}

#[test]
fn messages_with_a_variable_part_keep_it_in_both_languages() {
    assert_eq!(localize("Riot sign-in error: invalid_session", Some("pt")), "Erro de login da Riot: invalid_session");
    assert_eq!(localize("Erro de login da Riot: invalid_session", Some("en")), "Riot sign-in error: invalid_session");
    assert_eq!(localize("Riot Client window script failed: 5", Some("pt")), "O script da janela do Riot Client falhou: 5");
}

#[test]
fn the_messages_match_the_electron_version() {
    let full = fs::read_to_string(source_dir().join("core").join("language.js")).unwrap();
    let start = full.find("const MESSAGES").unwrap();
    let source = &full[start..start + full[start..].find("\n];").unwrap()];
    let pair = Regex::new(r"\[\s*'((?:[^'\\]|\\.)+)',\s*'((?:[^'\\]|\\.)+)'\s*\]").unwrap();
    let electron: Vec<(String, String)> = pair.captures_iter(source).map(|found| (found[1].to_string(), found[2].to_string())).collect();
    let rust: Vec<(String, String)> = MESSAGES.iter().map(|(en, pt)| (en.to_string(), pt.to_string())).collect();
    assert_eq!(rust, electron);
}

#[test]
fn unknown_texts_pass_through_unchanged() {
    assert_eq!(localize("Something new from Riot", Some("pt")), "Something new from Riot");
    assert_eq!(localize("Game opened", Some("xx")), "Jogo aberto");
}

#[test]
fn tray_and_dialog_texts_exist_in_both_languages() {
    assert_eq!(main_text(None).tray_quit, "Sair");
    assert_eq!(main_text(Some("en")).tray_quit, "Quit");
    for text in [main_text(Some("en")), main_text(Some("pt"))] {
        for value in [text.tray_accounts, text.tray_open_riot, text.tray_cancel, text.tray_start_with_windows, text.tray_quit, text.game_failed, text.needs_attention, text.open_failed, text.open_failed_detail, text.understood, text.old_eclipse_open] {
            assert!(!value.is_empty());
        }
    }
}

#[test]
fn every_sign_in_status_and_error_of_the_rust_flow_is_written_in_english_and_translates() {
    let source = fs::read_to_string(eclipse::paths::project_root().join("src-tauri").join("src").join("riot").join("sign_in_flow.rs")).unwrap();
    let literal = Regex::new(r#""([A-Z][^"{}]* [^"{}]*)""#).unwrap();
    let log_only = ["Riot has not renewed the restored session yet"];
    let texts: Vec<String> = literal.captures_iter(&source).map(|found| found[1].to_string()).filter(|text| !log_only.contains(&text.as_str())).collect();
    assert!(texts.len() >= 20, "{texts:?}");
    for text in texts.iter().map(String::as_str).chain([eclipse::riot::CANCELLED]) {
        assert_ne!(localize(text, Some("pt")), text, "{text}");
        assert_eq!(localize(text, Some("en")), text, "{text}");
    }
}
