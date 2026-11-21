use eclipse::integration::app_updater::{ENDPOINT, TIMEOUT_SECS};
use eclipse::paths::project_root;
use serde_json::{json, Value};

#[test]
fn the_setup_carries_the_github_endpoint_the_public_key_and_signed_update_files() {
    let config: Value = serde_json::from_str(&std::fs::read_to_string(project_root().join("src-tauri/tauri.conf.json")).unwrap()).unwrap();
    let updater = &config["plugins"]["updater"];
    assert_eq!(updater["endpoints"], json!([ENDPOINT]));
    assert!(ENDPOINT.starts_with("https://github.com/arthurmchd/eclipse/releases/latest/download/"));
    assert_eq!(updater["windows"]["installMode"], "passive");
    let key = updater["pubkey"].as_str().unwrap();
    assert!(key.len() > 100);
    let decoded = String::from_utf8(base64::Engine::decode(&base64::engine::general_purpose::STANDARD, key).unwrap()).unwrap();
    assert!(decoded.starts_with("untrusted comment: minisign public key"), "{decoded}");
    assert!(!decoded.to_lowercase().contains("secret"));
    assert_eq!(config["bundle"]["createUpdaterArtifacts"], true);
    assert_eq!(TIMEOUT_SECS, 30);
}
