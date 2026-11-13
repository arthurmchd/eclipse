use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{Map, Value};

use super::dpapi::KeyProtector;

pub const LOCAL_STATE_FILE: &str = "Local State";
const VERSION: &[u8] = b"v10";
const KEY_PREFIX: &[u8] = b"DPAPI";
const NONCE_LENGTH: usize = 12;
const KEY_LENGTH: usize = 32;
const UNAVAILABLE: &str = "Windows encryption is not available";

pub trait Cipher: Send + Sync {
    fn encrypt(&self, plain: &[u8]) -> Result<Vec<u8>, String>;
    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, String>;
}

pub struct SafeStorage {
    local_state: PathBuf,
    protector: Box<dyn KeyProtector>,
    key: Mutex<Option<[u8; KEY_LENGTH]>>,
}

impl SafeStorage {
    pub fn new(data_dir: &Path, protector: Box<dyn KeyProtector>) -> Self {
        Self { local_state: data_dir.join(LOCAL_STATE_FILE), protector, key: Mutex::new(None) }
    }

    fn read_state(&self) -> Result<Option<Map<String, Value>>, String> {
        let raw = match fs::read(&self.local_state) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(UNAVAILABLE.to_string()),
        };
        match serde_json::from_slice::<Value>(&raw) {
            Ok(Value::Object(state)) => Ok(Some(state)),
            _ => Err(UNAVAILABLE.to_string()),
        }
    }

    fn stored_key(&self, state: &Map<String, Value>) -> Result<Option<[u8; KEY_LENGTH]>, String> {
        let Some(encoded) = state.get("os_crypt").and_then(|crypt| crypt.get("encrypted_key")).and_then(Value::as_str) else {
            return Ok(None);
        };
        let wrapped = STANDARD.decode(encoded).map_err(|_| UNAVAILABLE.to_string())?;
        let protected = wrapped.strip_prefix(KEY_PREFIX).ok_or_else(|| UNAVAILABLE.to_string())?;
        let plain = self.protector.unprotect(protected)?;
        let key: [u8; KEY_LENGTH] = plain.try_into().map_err(|_| UNAVAILABLE.to_string())?;
        Ok(Some(key))
    }

    fn create_key(&self, state: Option<Map<String, Value>>) -> Result<[u8; KEY_LENGTH], String> {
        let fresh = Aes256Gcm::generate_key(OsRng);
        let mut wrapped = KEY_PREFIX.to_vec();
        wrapped.extend(self.protector.protect(fresh.as_slice())?);
        let mut state = state.unwrap_or_default();
        let crypt = state.entry("os_crypt").or_insert_with(|| Value::Object(Map::new()));
        if !crypt.is_object() {
            *crypt = Value::Object(Map::new());
        }
        crypt.as_object_mut().unwrap().insert("encrypted_key".into(), Value::String(STANDARD.encode(wrapped)));
        let json = serde_json::to_vec(&Value::Object(state)).map_err(|_| UNAVAILABLE.to_string())?;
        if let Some(parent) = self.local_state.parent() {
            fs::create_dir_all(parent).map_err(|_| UNAVAILABLE.to_string())?;
        }
        let temporary = self.local_state.with_file_name(format!("{LOCAL_STATE_FILE}.{}.tmp", uuid::Uuid::new_v4()));
        let written = fs::write(&temporary, json).and_then(|_| fs::rename(&temporary, &self.local_state));
        let _ = fs::remove_file(&temporary);
        written.map_err(|_| UNAVAILABLE.to_string())?;
        let mut key = [0u8; KEY_LENGTH];
        key.copy_from_slice(fresh.as_slice());
        Ok(key)
    }

    fn key(&self, create: bool) -> Result<[u8; KEY_LENGTH], String> {
        let mut cached = self.key.lock().map_err(|_| UNAVAILABLE.to_string())?;
        if let Some(key) = *cached {
            return Ok(key);
        }
        let state = self.read_state()?;
        let key = match state.as_ref().map(|state| self.stored_key(state)).transpose()?.flatten() {
            Some(key) => key,
            None if create => self.create_key(state)?,
            None => return Err(UNAVAILABLE.to_string()),
        };
        *cached = Some(key);
        Ok(key)
    }
}

impl Cipher for SafeStorage {
    fn encrypt(&self, plain: &[u8]) -> Result<Vec<u8>, String> {
        let key = self.key(true)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let sealed = cipher.encrypt(&nonce, plain).map_err(|_| UNAVAILABLE.to_string())?;
        let mut blob = Vec::with_capacity(VERSION.len() + NONCE_LENGTH + sealed.len());
        blob.extend_from_slice(VERSION);
        blob.extend_from_slice(nonce.as_slice());
        blob.extend(sealed);
        Ok(blob)
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, String> {
        let Some(rest) = blob.strip_prefix(VERSION) else {
            return self.protector.unprotect(blob).map_err(|_| "Error while decrypting the ciphertext provided to safeStorage.decryptString.".to_string());
        };
        if rest.len() < NONCE_LENGTH {
            return Err("Error while decrypting the ciphertext provided to safeStorage.decryptString.".to_string());
        }
        let key = self.key(false)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let (nonce, sealed) = rest.split_at(NONCE_LENGTH);
        cipher
            .decrypt(Nonce::from_slice(nonce), sealed)
            .map_err(|_| "Error while decrypting the ciphertext provided to safeStorage.decryptString.".to_string())
    }
}
