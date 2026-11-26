use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

pub const SCHEME: &str = "eclipse";
pub const CARDS_PAGE: &str = "src/renderer/cards.html";
pub const TOGGLE_PAGE: &str = "src/integration/overlay/toggle.html";
pub const COVER_PAGE: &str = "src/integration/overlay/cover.html";
pub const RIOT_LOGO: &str = "riot/logo.svg";
const RENDERER: &str = "src/renderer/";
const RENDERER_TYPES: [&str; 5] = ["html", "css", "js", "png", "svg"];
const OVERLAY_FILES: [&str; 7] = [
    "src/integration/overlay/toggle.html",
    "src/integration/overlay/toggle.css",
    "src/integration/overlay/toggle.js",
    "src/integration/overlay/toggle-check.svg",
    "src/integration/overlay/cover.html",
    "src/integration/overlay/cover.css",
    "src/integration/overlay/cover.js",
];
const FONTS: [(&str, &str); 6] = [("inter", "400"), ("inter", "500"), ("inter", "600"), ("inter", "700"), ("teko", "500"), ("teko", "600")];

pub fn page_url(page: &str) -> String {
    format!("{SCHEME}://localhost/{page}")
}

pub fn served_url(page: &str) -> String {
    format!("http://{SCHEME}.localhost/{page}")
}

pub fn is_page(page: &str, url: &str) -> bool {
    url == page_url(page) || url == served_url(page)
}

pub fn mime(path: &str) -> Option<&'static str> {
    Some(match path.rsplit_once('.')?.1 {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => return None,
    })
}

fn clean(path: &str) -> Option<&str> {
    static SEGMENT: OnceLock<Regex> = OnceLock::new();
    let segment = SEGMENT.get_or_init(|| Regex::new(r"^[A-Za-z0-9_@-][A-Za-z0-9_.@-]{0,127}$").unwrap());
    let path = path.strip_prefix('/').unwrap_or(path);
    if path.is_empty() || path.len() > 512 || path.split('/').any(|part| !segment.is_match(part) || part.contains("..")) {
        return None;
    }
    Some(path)
}

fn font(path: &str) -> bool {
    FONTS.iter().any(|(family, weight)| {
        let folder = format!("node_modules/@fontsource/{family}/");
        let Some(rest) = path.strip_prefix(&folder) else {
            return false;
        };
        if rest == format!("{weight}.css") {
            return true;
        }
        let Some(file) = rest.strip_prefix("files/").and_then(|file| file.strip_prefix(&format!("{family}-"))) else {
            return false;
        };
        let Some(stem) = file.strip_suffix(".woff2").or_else(|| file.strip_suffix(".woff")) else {
            return false;
        };
        stem.strip_suffix(&format!("-{weight}-normal")).is_some_and(|subset| !subset.is_empty() && subset.chars().all(|c| c.is_ascii_lowercase() || c == '-'))
    })
}

pub fn allowed(path: &str) -> Option<&str> {
    let path = clean(path)?;
    let renderer = path.strip_prefix(RENDERER).is_some_and(|rest| path.rsplit_once('.').is_some_and(|(_, kind)| RENDERER_TYPES.contains(&kind)) && (!rest.contains('/') || rest.starts_with("assets/") && rest.matches('/').count() == 1));
    (renderer || OVERLAY_FILES.contains(&path) || font(path)).then_some(path)
}

pub fn is_riot_logo(uri: &str) -> bool {
    let rest = uri.strip_prefix(&format!("{SCHEME}://localhost")).or_else(|| uri.strip_prefix(&format!("http://{SCHEME}.localhost")));
    rest.and_then(|rest| rest.split(['?', '#']).next()).is_some_and(|path| path.strip_prefix('/') == Some(RIOT_LOGO))
}

pub fn resolve(root: &Path, uri: &str) -> Option<(PathBuf, &'static str)> {
    let rest = uri.strip_prefix(&format!("{SCHEME}://localhost")).or_else(|| uri.strip_prefix(&format!("http://{SCHEME}.localhost")))?;
    let path = rest.split(['?', '#']).next().unwrap_or_default();
    let path = allowed(path)?;
    let kind = mime(path)?;
    Some((root.join(path.replace('/', "\\")), kind))
}
