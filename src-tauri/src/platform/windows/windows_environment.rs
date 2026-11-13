use std::collections::HashMap;
use std::env;
use std::sync::OnceLock;

use regex::Regex;

pub fn local_app_data_for_riot_in(environment: &HashMap<String, String>) -> String {
    static SANDBOX: OnceLock<Regex> = OnceLock::new();
    static DRIVE: OnceLock<Regex> = OnceLock::new();
    let value = environment.get("LOCALAPPDATA").cloned().unwrap_or_default();
    let sandbox = SANDBOX.get_or_init(|| Regex::new(r"(?i)\\AppData\\Local\\Packages\\sandbox\.\{[\da-f-]+\}\\AC(?:\\)?$").unwrap());
    let drive = DRIVE.get_or_init(|| Regex::new(r"(?i)^[a-z]:\\").unwrap());
    match environment.get("USERPROFILE") {
        Some(profile) if sandbox.is_match(&value) && drive.is_match(profile) => format!("{}\\AppData\\Local", profile.trim_end_matches('\\')),
        _ => value,
    }
}

pub fn current_environment() -> HashMap<String, String> {
    env::vars().collect()
}

pub fn local_app_data_for_riot() -> String {
    local_app_data_for_riot_in(&current_environment())
}

pub fn environment_for_riot_from(environment: &HashMap<String, String>) -> HashMap<String, String> {
    let mut result = environment.clone();
    result.insert("LOCALAPPDATA".into(), local_app_data_for_riot_in(environment));
    result
}

pub fn environment_for_riot() -> HashMap<String, String> {
    environment_for_riot_from(&current_environment())
}
