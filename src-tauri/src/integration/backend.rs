use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use super::asar::Archive;
use crate::platform::windows::windows_environment::local_app_data_for_riot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backend {
    pub pid: u32,
    pub port: u16,
    pub token: String,
}

pub fn parse_backend_lockfile(text: &str) -> Result<Backend, String> {
    let invalid = || "Riot backend lockfile is invalid".to_string();
    if text.encode_utf16().count() > 8192 {
        return Err(invalid());
    }
    let parts: Vec<&str> = text.trim().split(':').collect();
    if parts.len() != 5 {
        return Err(invalid());
    }
    let pid: u32 = parts[1].parse().ok().filter(|pid| *pid > 0).ok_or_else(invalid)?;
    let port: u16 = parts[2].parse().ok().filter(|port| *port > 0).ok_or_else(invalid)?;
    let token = parts[3];
    if token.is_empty() || token.chars().count() > 256 || token.chars().any(|c| (c as u32) <= 0x20 || c as u32 == 0x7f) || parts[4] != "https" {
        return Err(invalid());
    }
    Ok(Backend { pid, port, token: token.to_string() })
}

pub fn lockfile_path(local_app_data: &Path) -> PathBuf {
    local_app_data.join("Riot Games").join("Riot Client").join("Config").join("lockfile")
}

pub fn read_backend_with(local_app_data: &str, read_file: &dyn Fn(&Path) -> std::io::Result<String>) -> Result<Backend, String> {
    let base = Path::new(local_app_data);
    if local_app_data.is_empty() || !base.is_absolute() {
        return Err("The Windows Riot profile could not be located".into());
    }
    read_file(&lockfile_path(base))
        .ok()
        .and_then(|text| parse_backend_lockfile(&text).ok())
        .ok_or_else(|| "The Riot background service is not ready".to_string())
}

pub fn read_backend() -> Result<Backend, String> {
    read_backend_with(&local_app_data_for_riot(), &|file| fs::read_to_string(file))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stamp {
    pub size: u64,
    pub modified: Option<SystemTime>,
}

pub type StampReader = Box<dyn Fn(&Path) -> Option<Stamp> + Send + Sync>;
pub type ArchiveReader = Box<dyn Fn(&Path) -> Result<Vec<u8>, String> + Send + Sync>;

pub fn certificate_archive(client_path: &Path) -> PathBuf {
    client_path.parent().unwrap_or(Path::new("")).join("RiotClientElectron").join("resources").join("app.asar")
}

pub fn archive_stamp(file: &Path) -> Option<Stamp> {
    let meta = fs::metadata(file).ok().filter(|meta| meta.is_file())?;
    Some(Stamp { size: meta.len(), modified: meta.modified().ok() })
}

fn read_archive_certificate(file: &Path) -> Result<Vec<u8>, String> {
    Archive::open(file)?.read_file("dist/main/root.pem", 64 * 1024)
}

pub fn read_backend_certificate(client_path: &Path) -> Result<Vec<u8>, String> {
    read_archive_certificate(&certificate_archive(client_path))
}

pub struct CertificateCache {
    stamp: StampReader,
    read: ArchiveReader,
    kept: Mutex<Option<(PathBuf, Stamp, Vec<u8>)>>,
}

impl CertificateCache {
    pub fn new(stamp: StampReader, read: ArchiveReader) -> Self {
        Self { stamp, read, kept: Mutex::new(None) }
    }

    pub fn get(&self, client_path: &Path) -> Result<Vec<u8>, String> {
        let file = certificate_archive(client_path);
        let stamp = (self.stamp)(&file).ok_or_else(|| "The Riot certificate could not be read".to_string())?;
        let mut kept = self.kept.lock().unwrap();
        if let Some((path, known, pem)) = kept.as_ref() {
            if *path == file && *known == stamp {
                return Ok(pem.clone());
            }
        }
        *kept = None;
        let pem = (self.read)(&file)?;
        *kept = Some((file, stamp, pem.clone()));
        Ok(pem)
    }
}

pub fn cached_backend_certificate(client_path: &Path) -> Result<Vec<u8>, String> {
    static CACHE: OnceLock<CertificateCache> = OnceLock::new();
    CACHE.get_or_init(|| CertificateCache::new(Box::new(archive_stamp), Box::new(read_archive_certificate))).get(client_path)
}
