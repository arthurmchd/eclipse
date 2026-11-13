#[path = "integration/asar.rs"]
mod asar;
#[path = "integration/asset_protocol.rs"]
mod asset_protocol;
#[path = "integration/backend.rs"]
mod backend;
#[path = "integration/manager/manager_host.rs"]
mod manager_host;
#[path = "integration/overlay/overlay_toggle.rs"]
mod overlay_toggle;
#[path = "integration/overlay/riot_overlay.rs"]
mod riot_overlay;
#[path = "support/manual_timers.rs"]
mod manual_timers;

pub use manual_timers::ManualTimers;

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

pub fn encode_header(header: &Value) -> Vec<u8> {
    let json = header.to_string().into_bytes();
    let payload_size = (4 + json.len()).div_ceil(4) * 4;
    let header_size = payload_size + 4;
    let mut out = vec![0u8; 8 + header_size];
    out[0..4].copy_from_slice(&4u32.to_le_bytes());
    out[4..8].copy_from_slice(&(header_size as u32).to_le_bytes());
    out[8..12].copy_from_slice(&(payload_size as u32).to_le_bytes());
    out[12..16].copy_from_slice(&(json.len() as u32).to_le_bytes());
    out[16..16 + json.len()].copy_from_slice(&json);
    out
}

pub fn write_archive(dir: &Path, name: &str, header: &Value, chunks: &[&[u8]]) -> PathBuf {
    let file = dir.join(name);
    let mut bytes = encode_header(header);
    for chunk in chunks {
        bytes.extend_from_slice(chunk);
    }
    fs::write(&file, bytes).unwrap();
    file
}
