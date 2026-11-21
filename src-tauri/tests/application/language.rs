use std::collections::HashSet;
use std::fs;

use eclipse::application::language::{localize, main_text, normalize_language, DEFAULT_LANGUAGE, LANGUAGES, MESSAGES};
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
    assert_eq!(localize("Riot Client sign-in form failed: input-failed", Some("pt")), "O formulário de login do Riot Client falhou: input-failed");
    assert_eq!(localize("O formulário de login do Riot Client falhou: input-failed", Some("en")), "Riot Client sign-in form failed: input-failed");
    let newer = "Eclipse does not recognize this newer Riot Client yet. Finish signing in there and check for an Eclipse update. Riot Client 144";
    let mais_novo = "O Eclipse ainda não reconhece este Riot Client mais novo. Termine o login por lá e procure uma atualização do Eclipse. Riot Client 144";
    assert_eq!(localize(newer, Some("pt")), mais_novo);
    assert_eq!(localize(mais_novo, Some("en")), newer);
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
    assert!(main_text(Some("pt")).update_available.ends_with(main_text(Some("pt")).tray_update_to));
    assert!(main_text(Some("en")).update_available.ends_with(main_text(Some("en")).tray_update_to));
    for text in [main_text(Some("en")), main_text(Some("pt"))] {
        for value in [text.tray_accounts, text.tray_open_riot, text.tray_cancel, text.tray_start_with_windows, text.tray_quit, text.game_failed, text.needs_attention, text.open_failed, text.open_failed_detail, text.understood, text.old_eclipse_open, text.tray_update_checks, text.tray_update_to, text.update_title, text.update_available, text.update_busy, text.update_failed] {
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
