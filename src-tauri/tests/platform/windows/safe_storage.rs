use std::env;
use std::fs;
use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use eclipse::platform::windows::dpapi::{Dpapi, KeyProtector};
use eclipse::platform::windows::safe_storage::{Cipher, SafeStorage, LOCAL_STATE_FILE};
use serde_json::{json, Value};

struct Plain;

impl KeyProtector for Plain {
    fn protect(&self, plain: &[u8]) -> Result<Vec<u8>, String> {
        Ok(plain.iter().map(|byte| byte ^ 0x5a).collect())
    }

    fn unprotect(&self, blob: &[u8]) -> Result<Vec<u8>, String> {
        Ok(blob.iter().map(|byte| byte ^ 0x5a).collect())
    }
}

fn folder() -> tempfile::TempDir {
    tempfile::Builder::new().prefix("eclipse-safe-storage-test-").tempdir().unwrap()
}

fn local_state(dir: &tempfile::TempDir) -> Value {
    serde_json::from_slice(&fs::read(dir.path().join(LOCAL_STATE_FILE)).unwrap()).unwrap()
}

#[test]
fn the_first_secret_creates_a_dpapi_protected_key_in_local_state() {
    let dir = folder();
    let storage = SafeStorage::new(dir.path(), Box::new(Dpapi));
    let blob = storage.encrypt("senha-de-teste-ç".as_bytes()).unwrap();
    assert!(blob.starts_with(b"v10"));
    assert_eq!(blob.len(), 3 + 12 + "senha-de-teste-ç".len() + 16);
    let wrapped = STANDARD.decode(local_state(&dir)["os_crypt"]["encrypted_key"].as_str().unwrap()).unwrap();
    assert!(wrapped.starts_with(b"DPAPI"));
    assert_eq!(Dpapi.unprotect(&wrapped[5..]).unwrap().len(), 32);
    assert_eq!(storage.decrypt(&blob).unwrap(), "senha-de-teste-ç".as_bytes());
    let reopened = SafeStorage::new(dir.path(), Box::new(Dpapi));
    assert_eq!(reopened.decrypt(&blob).unwrap(), "senha-de-teste-ç".as_bytes());
}

#[test]
fn every_secret_gets_its_own_nonce() {
    let dir = folder();
    let storage = SafeStorage::new(dir.path(), Box::new(Dpapi));
    assert_ne!(storage.encrypt(b"same").unwrap(), storage.encrypt(b"same").unwrap());
}

#[test]
fn a_secret_in_the_chromium_format_is_read_with_the_stored_key() {
    let dir = folder();
    let key = [7u8; 32];
    let mut wrapped = b"DPAPI".to_vec();
    wrapped.extend(Plain.protect(&key).unwrap());
    fs::write(dir.path().join(LOCAL_STATE_FILE), json!({ "os_crypt": { "audit_enabled": true, "encrypted_key": STANDARD.encode(wrapped) } }).to_string()).unwrap();
    let nonce = [3u8; 12];
    let sealed = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)).encrypt(Nonce::from_slice(&nonce), b"fictional-password".as_ref()).unwrap();
    let mut blob = b"v10".to_vec();
    blob.extend(nonce);
    blob.extend(sealed);
    let storage = SafeStorage::new(dir.path(), Box::new(Plain));
    assert_eq!(storage.decrypt(&blob).unwrap(), b"fictional-password");
    let fresh = storage.encrypt(b"other").unwrap();
    let (nonce, sealed) = fresh[3..].split_at(12);
    assert_eq!(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)).decrypt(Nonce::from_slice(nonce), sealed).unwrap(), b"other");
}

#[test]
fn an_existing_local_state_keeps_its_other_fields_when_the_key_is_added() {
    let dir = folder();
    fs::write(dir.path().join(LOCAL_STATE_FILE), json!({ "browser": { "enabled_labs_experiments": [] }, "os_crypt": { "audit_enabled": true } }).to_string()).unwrap();
    SafeStorage::new(dir.path(), Box::new(Plain)).encrypt(b"x").unwrap();
    let state = local_state(&dir);
    assert_eq!(state["browser"], json!({ "enabled_labs_experiments": [] }));
    assert_eq!(state["os_crypt"]["audit_enabled"], true);
    assert!(state["os_crypt"]["encrypted_key"].is_string());
}

#[test]
fn an_unreadable_local_state_is_never_replaced() {
    let dir = folder();
    fs::write(dir.path().join(LOCAL_STATE_FILE), "{ broken").unwrap();
    let storage = SafeStorage::new(dir.path(), Box::new(Plain));
    assert_eq!(storage.encrypt(b"x").unwrap_err(), "Windows encryption is not available");
    assert_eq!(fs::read_to_string(dir.path().join(LOCAL_STATE_FILE)).unwrap(), "{ broken");
}

#[test]
fn tampered_or_keyless_secrets_do_not_decrypt() {
    let dir = folder();
    let storage = SafeStorage::new(dir.path(), Box::new(Dpapi));
    assert!(storage.decrypt(b"v10short").is_err());
    assert!(!dir.path().join(LOCAL_STATE_FILE).exists());
    let mut blob = storage.encrypt(b"fictional").unwrap();
    let last = blob.len() - 1;
    blob[last] ^= 1;
    assert!(storage.decrypt(&blob).is_err());
}

#[test]
fn a_secret_without_the_version_prefix_falls_back_to_plain_dpapi() {
    let dir = folder();
    let legacy = Dpapi.protect(b"legacy-secret").unwrap();
    assert_eq!(SafeStorage::new(dir.path(), Box::new(Dpapi)).decrypt(&legacy).unwrap(), b"legacy-secret");
}

#[test]
#[ignore]
fn a_secret_written_by_electron_safe_storage_decrypts() {
    let sample = PathBuf::from(env::var("ECLIPSE_SAFE_STORAGE_SAMPLE").expect("set ECLIPSE_SAFE_STORAGE_SAMPLE"));
    let blob = STANDARD.decode(fs::read_to_string(sample.join("blob.b64")).unwrap().trim()).unwrap();
    let storage = SafeStorage::new(&sample.join("ud"), Box::new(Dpapi));
    assert_eq!(String::from_utf8(storage.decrypt(&blob).unwrap()).unwrap(), "senha-de-teste-ç");
}
