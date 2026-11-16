use std::cell::RefCell;
use std::collections::HashMap;
use std::io;

use eclipse::riot::riot_process::{launch_with, plan, LaunchPlan};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

#[test]
fn background_launch_uses_riot_headless_mode_without_a_window() {
    let launch = plan("synthetic.exe", false, HashMap::new());
    assert_eq!(launch.args, ["--headless"]);
    assert!(launch.hidden);
    assert_eq!(launch.flags & CREATE_NO_WINDOW, CREATE_NO_WINDOW);
    assert_eq!(launch.flags & DETACHED_PROCESS, DETACHED_PROCESS);
}

#[test]
fn a_visible_launch_opens_the_official_interface_never_a_hidden_one() {
    let launch = plan("synthetic.exe", true, HashMap::new());
    assert!(launch.args.is_empty());
    assert!(!launch.hidden);
    assert_eq!(launch.flags & CREATE_NO_WINDOW, 0);
}

#[test]
fn the_riot_client_starts_with_the_local_app_data_riot_expects() {
    let seen: RefCell<Option<LaunchPlan>> = RefCell::new(None);
    launch_with("synthetic.exe", true, &|launch| {
        *seen.borrow_mut() = Some(launch.clone());
        Ok(())
    })
    .unwrap();
    let launch = seen.into_inner().unwrap();
    assert_eq!(launch.exe, "synthetic.exe");
    assert!(launch.environment.contains_key("LOCALAPPDATA"));
}

#[test]
fn spawn_failures_are_reported_without_exposing_os_command_details() {
    let error = launch_with("synthetic.exe", false, &|_| Err(io::Error::other("synthetic-private-argument"))).unwrap_err();
    assert_eq!(error.message, "Could not start the Riot Client. Check its path and Windows permissions");
}
