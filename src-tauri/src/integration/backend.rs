use std::fs;
use std::path::{Path, PathBuf};

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

pub fn read_backend_certificate(client_path: &Path) -> Result<Vec<u8>, String> {
    let file = client_path.parent().unwrap_or(Path::new("")).join("RiotClientElectron").join("resources").join("app.asar");
    Archive::open(&file)?.read_file("dist/main/root.pem", 64 * 1024)
}
