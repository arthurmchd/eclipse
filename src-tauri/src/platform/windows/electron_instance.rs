use std::fs::OpenOptions;
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

pub const LOCK_FILE: &str = "lockfile";
pub const SHARING_VIOLATION: i32 = 32;
const FILE_SHARE_READ: u32 = 1;

pub fn lock_file(data_dir: &Path) -> PathBuf {
    data_dir.join(LOCK_FILE)
}

pub fn running_with(open: &dyn Fn(&Path) -> io::Result<()>, data_dir: &Path) -> bool {
    matches!(open(&lock_file(data_dir)), Err(error) if error.raw_os_error() == Some(SHARING_VIOLATION))
}

fn open_for_reading(path: &Path) -> io::Result<()> {
    OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(path).map(|_| ())
}

pub fn electron_running(data_dir: &Path) -> bool {
    running_with(&open_for_reading, data_dir)
}
