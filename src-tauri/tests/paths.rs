use std::ffi::OsString;
use std::path::PathBuf;

use eclipse::paths::{data_dir_from, observer_script, windows_helpers_dir};

#[test]
fn a_development_build_only_runs_on_a_data_folder_chosen_by_hand_and_the_installed_app_always_uses_the_real_one() {
    let user = Some(PathBuf::from("C:/Users/synthetic/AppData/Roaming/riot-account-manager"));
    let chosen = Some(OsString::from("C:/Temp/eclipse-fake-data"));
    assert_eq!(data_dir_from(true, chosen.clone(), user.clone()), Some(PathBuf::from("C:/Temp/eclipse-fake-data")));
    assert_eq!(data_dir_from(false, chosen, user.clone()), user);
    assert_eq!(data_dir_from(true, None, user.clone()), None);
    assert_eq!(data_dir_from(false, None, user.clone()), user);
    for unsafe_choice in ["", "eclipse-fake-data", "../data"] {
        assert_eq!(data_dir_from(true, Some(OsString::from(unsafe_choice)), user.clone()), None, "{unsafe_choice}");
    }
}

#[test]
fn the_window_observer_helper_is_found_next_to_the_other_windows_helpers() {
    assert_eq!(observer_script(), windows_helpers_dir().join("riotWindowObserver.ps1"));
    assert!(observer_script().is_file());
}
