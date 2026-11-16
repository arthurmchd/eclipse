use std::cell::RefCell;
use std::io;
use std::path::{Path, PathBuf};

use eclipse::platform::windows::electron_instance::{electron_running, lock_file, running_with, SHARING_VIOLATION};

#[test]
fn the_old_eclipse_counts_as_open_only_while_it_holds_its_lock_file() {
    let data = Path::new("C:/Users/synthetic/AppData/Roaming/riot-account-manager");
    let asked = RefCell::new(Vec::<PathBuf>::new());
    let held = |path: &Path| {
        asked.borrow_mut().push(path.to_path_buf());
        Err(io::Error::from_raw_os_error(SHARING_VIOLATION))
    };
    assert!(running_with(&held, data));
    assert_eq!(asked.borrow().as_slice(), [data.join("lockfile")]);
    assert_eq!(lock_file(data), data.join("lockfile"));
    let free = |_: &Path| Ok(());
    assert!(!running_with(&free, data));
    for code in [2, 3, 5] {
        let other = move |_: &Path| Err(io::Error::from_raw_os_error(code));
        assert!(!running_with(&other, data), "{code}");
    }
}

#[test]
fn a_real_lock_held_without_write_sharing_is_detected_and_a_free_or_missing_one_is_not() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::Builder::new().prefix("eclipse-lock-test-").tempdir().unwrap();
    assert!(!electron_running(dir.path()));
    std::fs::write(lock_file(dir.path()), b"").unwrap();
    assert!(!electron_running(dir.path()));
    let held = std::fs::OpenOptions::new().write(true).share_mode(1).open(lock_file(dir.path())).unwrap();
    assert!(electron_running(dir.path()));
    drop(held);
    assert!(!electron_running(dir.path()));
}
