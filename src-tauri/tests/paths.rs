#[path = "support/bundle.rs"]
mod bundle;

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use bundle::{bundled_files, same_file};
use eclipse::paths::{data_dir_from, project_root, root_from};

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
fn the_project_folder_is_the_root_in_development_and_the_folder_of_the_executable_once_installed() {
    let manifest = Path::new("C:/Projects/eclipse/src-tauri");
    let exe = Some(PathBuf::from("C:/Users/synthetic/AppData/Local/Eclipse/Eclipse.exe"));
    assert_eq!(root_from(true, manifest, exe.clone()), PathBuf::from("C:/Projects/eclipse"));
    assert_eq!(root_from(false, manifest, exe), PathBuf::from("C:/Users/synthetic/AppData/Local/Eclipse"));
    assert_eq!(root_from(false, manifest, None), PathBuf::new());
}

#[test]
fn the_setup_carries_no_script_and_the_app_never_starts_powershell() {
    let scripts: Vec<String> = bundled_files().into_iter().map(|file| file.target).filter(|target| [".ps1", ".bat", ".cmd", ".vbs"].iter().any(|kind| target.ends_with(kind))).collect();
    assert!(scripts.is_empty(), "{scripts:?}");
    for file in bundled_files() {
        assert!(same_file(&file.source, &project_root().join(&file.target)), "{}", file.target);
    }
    assert!(!project_root().join("src/platform/windows").exists());
    let mut sources = vec![project_root().join("src-tauri/src")];
    while let Some(folder) = sources.pop() {
        for entry in std::fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                sources.push(path);
            } else if path.extension().is_some_and(|kind| kind == "rs") {
                let text = std::fs::read_to_string(&path).unwrap().to_lowercase();
                for launch in ["powershell.exe", "\"powershell", "pwsh", ".ps1", "-executionpolicy"] {
                    assert!(!text.contains(launch), "{} {launch}", path.display());
                }
            }
        }
    }
}
