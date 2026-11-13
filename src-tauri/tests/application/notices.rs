use eclipse::application::notices::{clip, error_notice, operation_notice, status_notice, Notice, APP_NAME, MAX_CHARS};
use serde_json::json;

#[test]
fn a_failed_operation_becomes_a_notice_with_the_translated_title_and_its_own_text() {
    let failed = json!({ "status": "failed", "text": "O jogo não abriu" });
    assert_eq!(operation_notice(&failed, Some("pt")), Some(Notice { title: "Não foi possível abrir o jogo".into(), text: "O jogo não abriu".into() }));
    assert_eq!(operation_notice(&failed, Some("en")).unwrap().title, "Could not open the game");
    for other in [json!({ "status": "running", "text": "x" }), json!({ "status": "done", "text": "x" }), json!({}), json!(null)] {
        assert_eq!(operation_notice(&other, Some("pt")), None, "{other}");
    }
    assert_eq!(operation_notice(&json!({ "status": "failed" }), Some("pt")).unwrap().text, "");
}

#[test]
fn only_a_status_that_needs_attention_becomes_a_notice() {
    let attention = json!({ "needsAttention": true, "text": "Termine o login no Riot Client" });
    assert_eq!(status_notice(&attention, Some("pt")), Some(Notice { title: "O login precisa de sua atenção".into(), text: "Termine o login no Riot Client".into() }));
    for other in [json!({ "needsAttention": false, "text": "x" }), json!({ "needsAttention": "true", "text": "x" }), json!({ "text": "x" })] {
        assert_eq!(status_notice(&other, Some("pt")), None, "{other}");
    }
}

#[test]
fn an_error_carries_the_app_name_and_the_message_in_the_chosen_language() {
    let message = "Could not follow the Riot window. Restart Eclipse.";
    assert_eq!(error_notice(message, Some("pt")), Notice { title: APP_NAME.into(), text: "Não foi possível acompanhar a janela do Riot. Reinicie o gerenciador.".into() });
    assert_eq!(error_notice(message, Some("en")).text, message);
}

#[test]
fn every_text_is_cut_at_240_characters_without_breaking_a_character() {
    let long = "é".repeat(300);
    assert_eq!(clip(&long).chars().count(), MAX_CHARS);
    assert_eq!(operation_notice(&json!({ "status": "failed", "text": long }), None).unwrap().text.chars().count(), MAX_CHARS);
    assert_eq!(status_notice(&json!({ "needsAttention": true, "text": long }), None).unwrap().text.chars().count(), MAX_CHARS);
    assert_eq!(error_notice(&long, None).text.chars().count(), MAX_CHARS);
    assert_eq!(clip("curto"), "curto");
}
