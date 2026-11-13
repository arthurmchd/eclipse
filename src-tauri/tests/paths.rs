#[path = "support/bundle.rs"]
mod bundle;

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use bundle::{bundled_files, same_file};
use eclipse::paths::{data_dir_from, observer_script, project_root, root_from, windows_helpers_dir};

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

#[test]
fn the_project_folder_is_the_root_in_development_and_the_folder_of_the_executable_once_installed() {
    let manifest = Path::new("C:/Projects/eclipse/src-tauri");
    let exe = Some(PathBuf::from("C:/Users/synthetic/AppData/Local/Eclipse/Eclipse.exe"));
    assert_eq!(root_from(true, manifest, exe.clone()), PathBuf::from("C:/Projects/eclipse"));
    assert_eq!(root_from(false, manifest, exe), PathBuf::from("C:/Users/synthetic/AppData/Local/Eclipse"));
    assert_eq!(root_from(false, manifest, None), PathBuf::new());
}

#[test]
fn the_setup_carries_the_three_windows_helpers_at_the_same_paths_and_no_other_script() {
    let root = project_root();
    let helpers: Vec<_> = bundled_files().into_iter().filter(|file| file.target.ends_with(".ps1")).collect();
    let targets: Vec<&str> = helpers.iter().map(|file| file.target.as_str()).collect();
    assert_eq!(targets.len(), 3);
    for name in ["login.ps1", "windowGuard.ps1", "riotWindowObserver.ps1"] {
        let target = format!("src/platform/windows/{name}");
        let file = helpers.iter().find(|file| file.target == target).unwrap_or_else(|| panic!("{target}"));
        assert!(same_file(&file.source, &windows_helpers_dir().join(name)));
        assert!(same_file(&root.join(&target), &windows_helpers_dir().join(name)));
    }
}
