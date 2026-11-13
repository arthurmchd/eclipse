use std::fs;

use eclipse::integration::asar::Archive;
use serde_json::json;
use tempfile::TempDir;

use crate::write_archive;

fn folder() -> TempDir {
    tempfile::Builder::new().prefix(".asar-test-").tempdir().unwrap()
}

#[test]
fn a_packed_file_is_read_from_its_offset_and_the_archive_file_is_never_changed() {
    let dir = folder();
    let (first, second) = (b"first file".as_slice(), b"second file".as_slice());
    let header = json!({ "files": { "dist": { "files": {
        "a.txt": { "size": first.len(), "offset": "0" },
        "b.txt": { "size": second.len(), "offset": first.len().to_string() },
    } } } });
    let file = write_archive(dir.path(), "app.asar", &header, &[first, second]);
    let before = fs::read(&file).unwrap();
    let mut reader = Archive::open(&file).unwrap();
    assert_eq!(reader.read_file("dist/b.txt", 1024).unwrap(), second);
    assert_eq!(reader.read_file("dist/a.txt", 1024).unwrap(), first);
    drop(reader);
    assert_eq!(fs::read(&file).unwrap(), before);
}

#[test]
fn entries_outside_the_archive_with_traversal_or_with_a_bad_offset_are_refused_when_opening() {
    let dir = folder();
    let open = |name: &str, files: serde_json::Value, chunks: &[&[u8]]| Archive::open(&write_archive(dir.path(), name, &json!({ "files": files }), chunks)).err().unwrap();
    assert!(open("a.asar", json!({ "..": { "files": {} } }), &[]).contains("entry path"));
    assert!(open("b.asar", json!({ "broken.js": { "size": 100, "offset": "0" } }), &[]).contains("bounds"));
    assert!(open("c.asar", json!({ "odd.js": { "size": 1, "offset": "-1" } }), &[b"x"]).contains("offset"));
    let truncated = dir.path().join("short.asar");
    fs::write(&truncated, b"tiny").unwrap();
    assert!(Archive::open(&truncated).err().unwrap().contains("Invalid ASAR"));
}

#[test]
fn missing_unpacked_linked_and_oversized_entries_are_never_read() {
    let dir = folder();
    let bytes = b"payload".as_slice();
    let header = json!({ "files": {
        "packed.txt": { "size": bytes.len(), "offset": "0" },
        "native.node": { "size": 42, "unpacked": true },
        "linked.txt": { "link": "packed.txt" },
    } });
    let mut reader = Archive::open(&write_archive(dir.path(), "app.asar", &header, &[bytes])).unwrap();
    assert!(reader.read_file("missing.txt", 1024).unwrap_err().contains("not found"));
    assert!(reader.read_file("native.node", 1024).unwrap_err().contains("not a packed file"));
    assert!(reader.read_file("linked.txt", 1024).unwrap_err().contains("not a packed file"));
    assert!(reader.read_file("packed.txt", 3).unwrap_err().contains("read limit"));
    assert!(reader.read_file("../packed.txt", 1024).unwrap_err().contains("entry path"));
}
