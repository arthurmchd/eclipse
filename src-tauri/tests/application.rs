#[path = "application/language.rs"]
mod language;
#[path = "application/manager_service.rs"]
mod manager_service;
#[path = "application/store.rs"]
mod store;

use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use eclipse::application::store::Store;
use eclipse::platform::windows::safe_storage::Cipher;
use tempfile::TempDir;

pub const FAKE_PREFIX: &str = "test-encrypted:";

pub struct FakeCipher;

impl Cipher for FakeCipher {
    fn encrypt(&self, plain: &[u8]) -> Result<Vec<u8>, String> {
        Ok(format!("{FAKE_PREFIX}{}", STANDARD.encode(plain)).into_bytes())
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, String> {
        let text = String::from_utf8(blob.to_vec()).map_err(|error| error.to_string())?;
        let encoded = text.strip_prefix(FAKE_PREFIX).ok_or("not encrypted by this user")?;
        STANDARD.decode(encoded).map_err(|error| error.to_string())
    }
}

pub fn temporary_store() -> (TempDir, Store) {
    let dir = tempfile::Builder::new().prefix("eclipse-store-test-").tempdir().unwrap();
    let store = Store::open(dir.path(), Arc::new(FakeCipher));
    (dir, store)
}
