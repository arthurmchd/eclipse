use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use eclipse::integration::backend::{parse_backend_lockfile, read_backend_certificate, read_backend_with, Backend};
use serde_json::json;

use crate::write_archive;

const TOKEN: &str = "synthetic-backend-token-only";

#[test]
fn backend_lockfile_parsing_accepts_a_bounded_https_connection() {
    assert_eq!(parse_backend_lockfile(&format!("RiotClient:1234:54321:{TOKEN}:https\r\n")).unwrap(), Backend { pid: 1234, port: 54321, token: TOKEN.into() });
    let invalid = [
        String::new(),
        "x".repeat(8193),
        format!("RiotClient:0:54321:{TOKEN}:https"),
        format!("RiotClient:1:65536:{TOKEN}:https"),
        format!("RiotClient:1:0:{TOKEN}:https"),
        format!("RiotClient:1:1:{TOKEN}:http"),
        "RiotClient:1:1::https".into(),
        "RiotClient:1:1:invalid token:https".into(),
        "RiotClient:1:1:line\nbreak:https".into(),
        format!("RiotClient:1:1:{}:https", "a".repeat(257)),
        format!("RiotClient:1:1:{TOKEN}:https:unexpected"),
    ];
    for value in invalid {
        assert_eq!(parse_backend_lockfile(&value).unwrap_err(), "Riot backend lockfile is invalid", "{value:?}");
    }
}

#[test]
fn backend_discovery_reads_only_the_supplied_normal_riot_profile_lockfile() {
    let local = "C:\\Synthetic\\Profile";
    let reads: RefCell<Vec<PathBuf>> = RefCell::new(Vec::new());
    let backend = read_backend_with(local, &|file| {
        reads.borrow_mut().push(file.to_path_buf());
        Ok(format!("RiotClient:1234:54321:{TOKEN}:https"))
    })
    .unwrap();
    assert_eq!(backend.port, 54321);
    assert_eq!(*reads.borrow(), [Path::new(local).join("Riot Games").join("Riot Client").join("Config").join("lockfile")]);
}

#[test]
fn missing_or_malformed_backend_discovery_returns_a_generic_error_without_the_lockfile_content() {
    let failures: [&dyn Fn(&Path) -> io::Result<String>; 2] = [&|_| Err(io::Error::other(format!("synthetic failure {TOKEN}"))), &|_| Ok(TOKEN.to_string())];
    for read in failures {
        assert_eq!(read_backend_with("C:\\Synthetic\\Profile", read).unwrap_err(), "The Riot background service is not ready");
    }
    let error = read_backend_with("relative-profile", &|_| panic!("must not read")).unwrap_err();
    assert!(error.contains("profile could not be located"));
}

#[test]
fn the_backend_certificate_comes_from_the_riot_archive_next_to_the_client() {
    let dir = tempfile::Builder::new().prefix(".backend-cert-").tempdir().unwrap();
    let certificate = b"synthetic PEM payload only".as_slice();
    let resources = dir.path().join("RiotClientElectron").join("resources");
    fs::create_dir_all(&resources).unwrap();
    let header = json!({ "files": { "dist": { "files": { "main": { "files": { "root.pem": { "size": certificate.len(), "offset": "0" } } } } } } });
    write_archive(&resources, "app.asar", &header, &[certificate]);
    assert_eq!(read_backend_certificate(&dir.path().join("RiotClientServices.exe")).unwrap(), certificate);
}
