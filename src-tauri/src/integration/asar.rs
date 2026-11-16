use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Map, Value};

const MAX_HEADER: u32 = 64 * 1024 * 1024;
pub const MAX_READ: u64 = 32 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub fn archive_path(name: &str) -> Result<&str, String> {
    static FORBIDDEN: OnceLock<Regex> = OnceLock::new();
    let forbidden = FORBIDDEN.get_or_init(|| Regex::new(r"[\x00-\x1f:]").unwrap());
    if name.is_empty() || name.starts_with('/') || name.contains('\\') || forbidden.is_match(name) || name.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err("Invalid ASAR entry path".into());
    }
    Ok(name)
}

fn read_exact_at(file: &mut File, buffer: &mut [u8], position: u64) -> Result<(), String> {
    file.seek(SeekFrom::Start(position)).map_err(|_| "Truncated ASAR archive".to_string())?;
    file.read_exact(buffer).map_err(|_| "Truncated ASAR archive".to_string())
}

fn files_of(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()?.get("files")?.as_object()
}

fn unpacked(entry: &Map<String, Value>) -> bool {
    match entry.get("unpacked") {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Number(number)) => number.as_f64() != Some(0.0),
        Some(_) => true,
    }
}

fn walk(files: &Map<String, Value>, prefix: &str, depth: usize, payload_size: u64) -> Result<(), String> {
    if depth > 128 {
        return Err("ASAR directory is too deep".into());
    }
    for (name, entry) in files {
        let full = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        archive_path(&full)?;
        let entry = match entry.as_object() {
            Some(entry) if !name.contains('/') => entry,
            _ => return Err("Invalid ASAR entry".into()),
        };
        if let Some(children) = entry.get("files") {
            let children = children.as_object().ok_or("Invalid ASAR directory")?;
            walk(children, &full, depth + 1, payload_size)?;
        } else if let Some(link) = entry.get("link") {
            archive_path(link.as_str().ok_or("Invalid ASAR entry path")?)?;
        } else {
            let size = entry.get("size").and_then(Value::as_u64).filter(|size| *size <= MAX_SAFE_INTEGER).ok_or("Invalid ASAR file size")?;
            if unpacked(entry) {
                continue;
            }
            let offset = entry
                .get("offset")
                .and_then(Value::as_str)
                .filter(|offset| !offset.is_empty() && offset.bytes().all(|byte| byte.is_ascii_digit()))
                .ok_or("Invalid ASAR file offset")?;
            let offset: u64 = offset.parse().ok().filter(|offset| *offset <= MAX_SAFE_INTEGER).ok_or("ASAR file exceeds archive bounds")?;
            if offset + size > payload_size {
                return Err("ASAR file exceeds archive bounds".into());
            }
        }
    }
    Ok(())
}

pub struct Archive {
    file: File,
    pub header: Value,
    pub data_offset: u64,
    pub size: u64,
}

impl Archive {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        let meta = file.metadata().map_err(|error| error.to_string())?;
        if !meta.is_file() || meta.len() < 16 {
            return Err("Invalid ASAR file".into());
        }
        let mut first = [0u8; 16];
        read_exact_at(&mut file, &mut first, 0)?;
        let word = |index: usize| u32::from_le_bytes(first[index..index + 4].try_into().unwrap());
        let (marker, header_size, payload_size, json_size) = (word(0), word(4), word(8), word(12));
        if marker != 4 || !(8..=MAX_HEADER).contains(&header_size) || header_size % 4 != 0 || payload_size != header_size - 4 || json_size < 2 || json_size > payload_size - 4 || 8 + header_size as u64 > meta.len() {
            return Err("Invalid ASAR header".into());
        }
        let mut raw = vec![0u8; json_size as usize];
        read_exact_at(&mut file, &mut raw, 16)?;
        let text = String::from_utf8(raw).map_err(|_| "Invalid ASAR header".to_string())?;
        let header: Value = serde_json::from_str(&text).map_err(|_| "Invalid ASAR header".to_string())?;
        let data_offset = 8 + header_size as u64;
        let files = files_of(&header).ok_or("Invalid ASAR directory")?;
        walk(files, "", 0, meta.len() - data_offset)?;
        Ok(Self { file, header, data_offset, size: meta.len() })
    }

    pub fn entry(&self, name: &str) -> Result<&Value, String> {
        archive_path(name)?;
        let mut current = &self.header;
        for part in name.split('/') {
            current = files_of(current).and_then(|files| files.get(part)).ok_or_else(|| format!("ASAR entry not found: {name}"))?;
        }
        Ok(current)
    }

    pub fn read_file(&mut self, name: &str, limit: u64) -> Result<Vec<u8>, String> {
        let meta = self.entry(name)?.as_object().cloned().unwrap_or_default();
        if meta.contains_key("files") || meta.contains_key("link") || unpacked(&meta) {
            return Err(format!("ASAR entry is not a packed file: {name}"));
        }
        let size = meta.get("size").and_then(Value::as_u64).unwrap_or(0);
        if size > limit {
            return Err(format!("ASAR entry exceeds read limit: {name}"));
        }
        let offset: u64 = meta.get("offset").and_then(Value::as_str).and_then(|offset| offset.parse().ok()).unwrap_or(0);
        let mut bytes = vec![0u8; size as usize];
        let position = self.data_offset + offset;
        read_exact_at(&mut self.file, &mut bytes, position)?;
        Ok(bytes)
    }
}
