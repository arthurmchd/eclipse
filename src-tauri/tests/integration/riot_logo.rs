use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use eclipse::integration::asset_protocol::{is_riot_logo, RIOT_LOGO};
use eclipse::integration::backend::Stamp;
use eclipse::integration::riot_logo::{find_logo, read_logo, LogoCache, BUNDLE};
use serde_json::json;

use crate::write_archive;

const SVG: &str = "<svg width='113' height='32' viewBox='0 0 113 32' xmlns='http://www.w3.org/2000/svg'><path d='M19 0L0 9Z' fill='#D53235'/></svg>";

fn encoded(svg: &str) -> String {
    svg.replace('%', "%25").replace(' ', "%20").replace('<', "%3c").replace('>', "%3e").replace('#', "%23")
}

fn bundle_with(svg: &str) -> Vec<u8> {
    format!("const altRiotLogo=\"data:image/svg+xml,%3csvg%3eother%3c/svg%3e\",riotLogo$1=\"data:image/svg+xml,%3csvg%3ewhite%3c/svg%3e\",riotLogo=\"data:image/svg+xml,{}\",next=1;", encoded(svg)).into_bytes()
}

#[test]
fn the_red_logo_is_decoded_from_the_riot_bundle_and_look_alike_names_are_skipped() {
    assert_eq!(find_logo(&bundle_with(SVG)).as_deref(), Some(SVG));
    assert_eq!(find_logo(b"riotLogo=\"data:image/png;base64,AAAA\""), None);
    assert_eq!(find_logo(b"no logo here"), None);
    assert_eq!(find_logo(b"riotLogo=\"data:image/svg+xml,%3csvg%3e"), None);
    assert_eq!(find_logo(b"riotLogo=\"data:image/svg+xml,%zz\""), None);
}

#[test]
fn an_svg_that_could_run_code_load_something_or_is_too_big_is_refused() {
    for svg in [
        "<svg><script>alert(1)</script></svg>",
        "<svg onload='x()'><path/></svg>",
        "<svg><foreignObject><div/></foreignObject></svg>",
        "<svg><image href='http://example.invalid/a.png'/></svg>",
        "<svg><a href='javascript:x()'><path/></a></svg>",
        "<div>not an svg</div>",
    ] {
        assert_eq!(find_logo(&bundle_with(svg)), None, "{svg}");
    }
    let big = format!("<svg>{}</svg>", "a".repeat(70 * 1024));
    assert_eq!(find_logo(&bundle_with(&big)), None);
}

#[test]
fn the_logo_is_read_from_the_bundle_inside_the_archive_without_changing_it() {
    let dir = tempfile::Builder::new().prefix(".riot-logo-test-").tempdir().unwrap();
    let bundle = bundle_with(SVG);
    let (folder, name) = BUNDLE.rsplit_once('/').unwrap();
    let parts: Vec<&str> = folder.split('/').collect();
    assert_eq!(parts, ["dist", "renderer"]);
    let header = json!({ "files": { "dist": { "files": { "renderer": { "files": { name: { "size": bundle.len(), "offset": "0" } } } } } } });
    let file = write_archive(dir.path(), "app.asar", &header, &[&bundle]);
    let before = fs::read(&file).unwrap();
    assert_eq!(read_logo(&file).unwrap(), SVG.as_bytes());
    assert_eq!(fs::read(&file).unwrap(), before);
    let empty = write_archive(dir.path(), "empty.asar", &json!({ "files": { "dist": { "files": { "renderer": { "files": { name: { "size": 4, "offset": "0" } } } } } } }), &[b"none"]);
    assert!(read_logo(&empty).is_err());
}

#[test]
fn the_logo_is_read_once_per_archive_version_and_a_missing_logo_is_not_retried_until_it_changes() {
    let at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    let stamp = Arc::new(Mutex::new(Some(Stamp { size: 10, modified: Some(at) })));
    let answer: Arc<Mutex<Result<Vec<u8>, String>>> = Arc::new(Mutex::new(Err("missing".into())));
    let reads: Arc<Mutex<Vec<PathBuf>>> = Arc::default();
    let (s, a, r) = (stamp.clone(), answer.clone(), reads.clone());
    let cache = LogoCache::new(Box::new(move |_| s.lock().unwrap().clone()), Box::new(move |file| {
        r.lock().unwrap().push(file.to_path_buf());
        a.lock().unwrap().clone()
    }));
    let client = Path::new(r"C:\Synthetic\Riot Client\RiotClientServices.exe");
    assert_eq!(cache.get(client), None);
    *answer.lock().unwrap() = Ok(SVG.as_bytes().to_vec());
    assert_eq!(cache.get(client), None);
    assert_eq!(reads.lock().unwrap().len(), 1);
    assert_eq!(reads.lock().unwrap()[0], Path::new(r"C:\Synthetic\Riot Client\RiotClientElectron\resources\app.asar"));
    *stamp.lock().unwrap() = Some(Stamp { size: 11, modified: Some(at) });
    for _ in 0..3 {
        assert_eq!(cache.get(client).as_deref(), Some(SVG.as_bytes()));
    }
    assert_eq!(reads.lock().unwrap().len(), 2);
    *stamp.lock().unwrap() = None;
    assert_eq!(cache.get(client), None);
    assert_eq!(reads.lock().unwrap().len(), 2);
}

#[test]
fn only_the_exact_logo_address_is_answered_with_the_riot_logo() {
    assert_eq!(RIOT_LOGO, "riot/logo.svg");
    for uri in ["eclipse://localhost/riot/logo.svg", "http://eclipse.localhost/riot/logo.svg", "http://eclipse.localhost/riot/logo.svg?v=1"] {
        assert!(is_riot_logo(uri), "{uri}");
    }
    for uri in ["eclipse://localhost/riot/logo.svg/x", "eclipse://localhost/src/riot/logo.svg", "https://eclipse.localhost/riot/logo.svg", "eclipse://example.com/riot/logo.svg", "eclipse://localhost/riot/../riot/logo.svg"] {
        assert!(!is_riot_logo(uri), "{uri}");
    }
}
