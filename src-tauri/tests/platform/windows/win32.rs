use eclipse::platform::windows::win32::{file_version, image_path, process_ids, process_names, processes, wide};

#[test]
fn the_process_list_comes_straight_from_windows_and_finds_this_test() {
    let own = std::process::id();
    let listed = processes();
    let name = listed.iter().find(|(pid, _)| *pid == own).map(|(_, name)| name.clone()).unwrap();
    assert!(name.to_lowercase().ends_with(".exe"), "{name}");
    assert!(process_names().contains(&name.to_lowercase()));
    let stem = name.trim_end_matches(".exe").to_string();
    assert!(process_ids(&[stem.as_str()]).contains(&own));
    assert!(process_ids(&[stem.to_uppercase().as_str()]).contains(&own));
    assert!(process_ids(&["eclipse-no-such-process"]).is_empty());
    assert!(image_path(own).to_lowercase().ends_with(&name.to_lowercase()));
    assert_eq!(image_path(0), "");
}

#[test]
fn wide_text_ends_with_one_zero() {
    assert_eq!(wide("ab"), [97, 98, 0]);
    assert_eq!(wide(""), [0]);
}

#[test]
fn the_file_version_comes_from_the_version_resource_and_a_file_without_one_has_none() {
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:/Windows".into());
    let kernel = std::path::Path::new(&system).join("System32").join("kernel32.dll");
    let version = file_version(&kernel).unwrap();
    assert!(version[0] >= 6, "{version:?}");
    assert_eq!(file_version(std::path::Path::new("C:/eclipse-no-such-file.exe")), None);
    assert_eq!(file_version(&std::env::temp_dir()), None);
}
