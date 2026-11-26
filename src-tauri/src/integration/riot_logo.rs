use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use regex::Regex;

use crate::integration::asar::{Archive, MAX_READ};
use crate::integration::backend::{certificate_archive, ArchiveReader, Stamp, StampReader};

pub const BUNDLE: &str = "dist/renderer/renderer.js";
pub const MARKER: &str = "riotLogo=\"data:image/svg+xml,";
pub const LOGO_LIMIT: usize = 64 * 1024;
const FORBIDDEN: [&str; 7] = ["<script", "javascript:", "<foreignobject", "<iframe", "<image", "href=\"http", "href='http"];

fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(pair, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn has_handler(svg: &str) -> bool {
    static HANDLER: OnceLock<Regex> = OnceLock::new();
    HANDLER.get_or_init(|| Regex::new(r"(?i)\son[a-z]+\s*=").unwrap()).is_match(svg)
}

pub fn find_logo(bundle: &[u8]) -> Option<String> {
    let named = |at: &usize| at.checked_sub(1).is_none_or(|before| !(bundle[before].is_ascii_alphanumeric() || bundle[before] == b'_' || bundle[before] == b'$'));
    let start = bundle.windows(MARKER.len()).enumerate().filter(|(_, window)| *window == MARKER.as_bytes()).map(|(at, _)| at).find(named)? + MARKER.len();
    let length = bundle[start..].iter().take(LOGO_LIMIT * 3 + 1).position(|byte| *byte == b'"')?;
    let svg = decode(std::str::from_utf8(&bundle[start..start + length]).ok()?)?;
    let trimmed = svg.trim();
    let lower = trimmed.to_ascii_lowercase();
    let valid = trimmed.len() <= LOGO_LIMIT && lower.starts_with("<svg") && lower.ends_with("</svg>") && !FORBIDDEN.iter().any(|word| lower.contains(word)) && !has_handler(trimmed);
    valid.then(|| trimmed.to_string())
}

pub fn read_logo(archive: &Path) -> Result<Vec<u8>, String> {
    let bundle = Archive::open(archive)?.read_file(BUNDLE, MAX_READ)?;
    find_logo(&bundle).map(String::into_bytes).ok_or_else(|| "The Riot logo was not found".to_string())
}

type KeptLogo = (PathBuf, Stamp, Option<Vec<u8>>);

pub struct LogoCache {
    stamp: StampReader,
    read: ArchiveReader,
    kept: Mutex<Option<KeptLogo>>,
}

impl LogoCache {
    pub fn new(stamp: StampReader, read: ArchiveReader) -> Self {
        Self { stamp, read, kept: Mutex::new(None) }
    }

    pub fn get(&self, client_path: &Path) -> Option<Vec<u8>> {
        let file = certificate_archive(client_path);
        let stamp = (self.stamp)(&file)?;
        let mut kept = self.kept.lock().unwrap();
        if let Some((path, known, logo)) = kept.as_ref() {
            if *path == file && *known == stamp {
                return logo.clone();
            }
        }
        let logo = (self.read)(&file).ok();
        *kept = Some((file, stamp, logo.clone()));
        logo
    }
}
