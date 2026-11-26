use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use eclipse::integration::backend::{archive_stamp, cached_backend_certificate, certificate_archive, parse_backend_lockfile, read_backend_certificate, read_backend_with, Backend, CertificateCache, Stamp};
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

fn synthetic_archive(dir: &Path, certificate: &[u8]) {
    let resources = dir.join("RiotClientElectron").join("resources");
    fs::create_dir_all(&resources).unwrap();
    let header = json!({ "files": { "dist": { "files": { "main": { "files": { "root.pem": { "size": certificate.len(), "offset": "0" } } } } } } });
    write_archive(&resources, "app.asar", &header, &[certificate]);
}

struct Disk {
    stamp: Mutex<Option<Stamp>>,
    answer: Mutex<Result<Vec<u8>, String>>,
    reads: Mutex<Vec<PathBuf>>,
}

fn cache(disk: &Arc<Disk>) -> CertificateCache {
    let (stamp, read) = (disk.clone(), disk.clone());
    CertificateCache::new(
        Box::new(move |_| stamp.stamp.lock().unwrap().clone()),
        Box::new(move |file| {
            read.reads.lock().unwrap().push(file.to_path_buf());
            read.answer.lock().unwrap().clone()
        }),
    )
}

#[test]
fn the_certificate_is_read_from_the_archive_once_and_again_only_when_the_archive_changes() {
    let at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    let disk = Arc::new(Disk { stamp: Mutex::new(Some(Stamp { size: 100, modified: Some(at) })), answer: Mutex::new(Ok(b"synthetic PEM one".to_vec())), reads: Mutex::new(Vec::new()) });
    let certificates = cache(&disk);
    let client = Path::new(r"C:\Synthetic\Riot Client\RiotClientServices.exe");
    for _ in 0..3 {
        assert_eq!(certificates.get(client).unwrap(), b"synthetic PEM one");
    }
    assert_eq!(*disk.reads.lock().unwrap(), [certificate_archive(client)]);
    *disk.answer.lock().unwrap() = Ok(b"synthetic PEM two".to_vec());
    *disk.stamp.lock().unwrap() = Some(Stamp { size: 100, modified: Some(at + Duration::from_secs(1)) });
    assert_eq!(certificates.get(client).unwrap(), b"synthetic PEM two");
    *disk.stamp.lock().unwrap() = Some(Stamp { size: 101, modified: Some(at + Duration::from_secs(1)) });
    assert_eq!(certificates.get(client).unwrap(), b"synthetic PEM two");
    assert_eq!(disk.reads.lock().unwrap().len(), 3);
    let other = Path::new(r"D:\Other\Riot Client\RiotClientServices.exe");
    certificates.get(other).unwrap();
    assert_eq!(disk.reads.lock().unwrap().last().unwrap(), &certificate_archive(other));
    assert_eq!(disk.reads.lock().unwrap().len(), 4);
}

#[test]
fn a_failed_or_missing_archive_is_never_kept_and_is_read_again_on_the_next_request() {
    let disk = Arc::new(Disk { stamp: Mutex::new(Some(Stamp { size: 100, modified: None })), answer: Mutex::new(Err("Invalid ASAR header".into())), reads: Mutex::new(Vec::new()) });
    let certificates = cache(&disk);
    let client = Path::new(r"C:\Synthetic\Riot Client\RiotClientServices.exe");
    assert!(certificates.get(client).is_err());
    assert!(certificates.get(client).is_err());
    assert_eq!(disk.reads.lock().unwrap().len(), 2);
    *disk.answer.lock().unwrap() = Ok(b"synthetic PEM one".to_vec());
    assert_eq!(certificates.get(client).unwrap(), b"synthetic PEM one");
    *disk.stamp.lock().unwrap() = None;
    assert!(certificates.get(client).is_err());
    assert_eq!(disk.reads.lock().unwrap().len(), 3);
    *disk.stamp.lock().unwrap() = Some(Stamp { size: 100, modified: None });
    assert_eq!(certificates.get(client).unwrap(), b"synthetic PEM one");
    assert_eq!(disk.reads.lock().unwrap().len(), 3);
}

#[test]
fn the_archive_stamp_is_the_size_and_date_of_a_real_file_and_nothing_for_folders_or_missing_files() {
    let dir = tempfile::Builder::new().prefix(".backend-stamp-").tempdir().unwrap();
    let file = dir.path().join("app.asar");
    fs::write(&file, b"synthetic archive bytes").unwrap();
    let stamp = archive_stamp(&file).unwrap();
    assert_eq!(stamp.size, 23);
    assert!(stamp.modified.is_some());
    assert_eq!(archive_stamp(dir.path()), None);
    assert_eq!(archive_stamp(&dir.path().join("missing.asar")), None);
}

#[test]
fn the_kept_certificate_follows_a_new_riot_archive_next_to_the_client() {
    let dir = tempfile::Builder::new().prefix(".backend-kept-").tempdir().unwrap();
    let client = dir.path().join("RiotClientServices.exe");
    synthetic_archive(dir.path(), b"synthetic PEM payload only");
    assert_eq!(cached_backend_certificate(&client).unwrap(), b"synthetic PEM payload only");
    assert_eq!(cached_backend_certificate(&client).unwrap(), b"synthetic PEM payload only");
    synthetic_archive(dir.path(), b"synthetic PEM payload after an update");
    assert_eq!(cached_backend_certificate(&client).unwrap(), b"synthetic PEM payload after an update");
    fs::remove_file(certificate_archive(&client)).unwrap();
    assert!(cached_backend_certificate(&client).is_err());
}
