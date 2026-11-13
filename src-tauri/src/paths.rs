use std::env;
use std::ffi::OsString;
use std::path::PathBuf;

pub const DATA_FOLDER_NAME: &str = "riot-account-manager";

pub fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default()
}

pub fn source_dir() -> PathBuf {
    project_root().join("src")
}

pub fn renderer_dir() -> PathBuf {
    source_dir().join("renderer")
}

pub fn windows_helpers_dir() -> PathBuf {
    source_dir().join("platform").join("windows")
}

pub fn user_data_dir() -> Option<PathBuf> {
    env::var_os("APPDATA")
        .filter(|value| !value.is_empty())
        .map(|value| PathBuf::from(value).join(DATA_FOLDER_NAME))
}

pub const DATA_DIR_VARIABLE: &str = "ECLIPSE_DATA_DIR";

pub fn data_dir_from(debug: bool, chosen: Option<OsString>, user: Option<PathBuf>) -> Option<PathBuf> {
    if !debug {
        return user;
    }
    chosen.map(PathBuf::from).filter(|path| path.is_absolute())
}

pub fn data_dir() -> Option<PathBuf> {
    data_dir_from(cfg!(debug_assertions), env::var_os(DATA_DIR_VARIABLE), user_data_dir())
}

pub fn observer_script() -> PathBuf {
    windows_helpers_dir().join("riotWindowObserver.ps1")
}
