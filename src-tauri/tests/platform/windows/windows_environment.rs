use std::collections::HashMap;

use eclipse::platform::windows::windows_environment::{environment_for_riot_from, local_app_data_for_riot_in};

const SANDBOX: &str = "C:\\Users\\Example\\AppData\\Local\\Packages\\sandbox.{01234567-89ab-cdef-0123-456789abcdef}\\AC";

fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()
}

#[test]
fn normal_windows_local_app_data_and_other_profiles_remain_unchanged() {
    assert_eq!(local_app_data_for_riot_in(&env(&[("LOCALAPPDATA", "C:\\Users\\Example\\AppData\\Local"), ("USERPROFILE", "C:\\Users\\Example")])), "C:\\Users\\Example\\AppData\\Local");
    assert_eq!(local_app_data_for_riot_in(&env(&[("LOCALAPPDATA", "D:\\RiotProfile"), ("USERPROFILE", "C:\\Users\\Example")])), "D:\\RiotProfile");
    let other = "C:\\Users\\Example\\AppData\\Local\\Packages\\OtherApp\\AC";
    assert_eq!(local_app_data_for_riot_in(&env(&[("LOCALAPPDATA", other), ("USERPROFILE", "C:\\Users\\Example")])), other);
}

#[test]
fn a_temporary_app_container_local_app_data_resolves_to_the_same_windows_users_normal_profile() {
    assert_eq!(local_app_data_for_riot_in(&env(&[("LOCALAPPDATA", SANDBOX), ("USERPROFILE", "C:\\Users\\Example")])), "C:\\Users\\Example\\AppData\\Local");
    let trailing = format!("{SANDBOX}\\");
    assert_eq!(local_app_data_for_riot_in(&env(&[("LOCALAPPDATA", &trailing), ("USERPROFILE", "C:\\Users\\Example")])), "C:\\Users\\Example\\AppData\\Local");
}

#[test]
fn invalid_or_absent_profile_information_never_invents_a_normal_user_directory() {
    assert_eq!(local_app_data_for_riot_in(&env(&[("LOCALAPPDATA", SANDBOX)])), SANDBOX);
    assert_eq!(local_app_data_for_riot_in(&env(&[("LOCALAPPDATA", SANDBOX), ("USERPROFILE", "relative-user")])), SANDBOX);
    assert_eq!(local_app_data_for_riot_in(&env(&[("USERPROFILE", "C:\\Users\\Example")])), "");
}

#[test]
fn the_riot_child_process_environment_is_copied_and_preserves_all_unrelated_settings() {
    let source = env(&[("LOCALAPPDATA", SANDBOX), ("USERPROFILE", "C:\\Users\\Example"), ("PATH", "synthetic-path"), ("CUSTOM_SETTING", "retained")]);
    let result = environment_for_riot_from(&source);
    assert_eq!(result["LOCALAPPDATA"], "C:\\Users\\Example\\AppData\\Local");
    assert_eq!(result["PATH"], "synthetic-path");
    assert_eq!(result["CUSTOM_SETTING"], "retained");
    assert!(source["LOCALAPPDATA"].contains("sandbox."));
}
