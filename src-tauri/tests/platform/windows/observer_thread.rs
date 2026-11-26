use eclipse::platform::windows::observer_thread::{box_state, client_windows, command_code, corner_size, format_target, parse_request, same_path, shade, Request, Verdicts, CLR_INVALID, DRAG_MESSAGE, POLL_MS};
use windows_sys::Win32::Foundation::RECT;

#[test]
fn a_dark_panel_means_a_riot_dialog_and_anything_mixed_or_unreadable_says_nothing() {
    let mut sample = [0x535353u32; 9];
    assert_eq!(shade(Some(&sample)), 1);
    sample = [0xFCFCFC; 9];
    assert_eq!(shade(Some(&sample)), -1);
    sample[4] = 0x535353;
    assert_eq!(shade(Some(&sample)), 0);
    assert_eq!(shade(None), 0);
    assert_eq!(shade(Some(&[])), 0);
    sample[4] = CLR_INVALID;
    assert_eq!(shade(Some(&sample)), 0);
}

#[test]
fn the_stay_signed_in_box_tells_whether_the_login_form_is_still_on_screen() {
    let mut sample = [0xE9E9E9u32; 9];
    assert_eq!(box_state(Some(&sample)), 1);
    for (index, slot) in sample.iter_mut().enumerate() {
        *slot = if index % 2 == 0 { 0x3532D5 } else { 0xF9F9F9 };
    }
    assert_eq!(box_state(Some(&sample)), 1);
    sample = [0xFCFCFC; 9];
    assert_eq!(box_state(Some(&sample)), -1);
    sample[0] = 0xDCDCDC;
    sample[1] = 0xDCDCDC;
    assert_eq!(box_state(Some(&sample)), 0);
    sample[2] = 0x2A25BC;
    assert_eq!(box_state(Some(&sample)), 1);
    sample[3] = 0x292929;
    assert_eq!(box_state(Some(&sample)), 0);
    assert_eq!(box_state(None), 0);
    sample[3] = CLR_INVALID;
    assert_eq!(box_state(Some(&sample)), 0);
}

#[test]
fn only_minimize_and_close_are_commands_and_long_lines_are_ignored() {
    assert_eq!(command_code("minimize"), 1);
    assert_eq!(command_code(" close "), 2);
    for other in ["quit", "", "reveal", "minimize minimize minimize"] {
        assert_eq!(command_code(other), 0, "{other}");
    }
}

#[test]
fn corners_follow_the_windows_preference_and_the_screen_scale() {
    assert_eq!(corner_size(0, 96), 8);
    assert_eq!(corner_size(2, 144), 12);
    assert_eq!(corner_size(3, 120), 5);
    assert_eq!(corner_size(3, 0), 4);
    assert_eq!(corner_size(1, 192), 0);
}

#[test]
fn the_target_line_has_the_shape_the_observer_reads() {
    let rect = RECT { left: -20, top: 10, right: 1516, bottom: 874 };
    assert_eq!(format_target(42, &rect, false, 8, false, false), "{\"target\":{\"id\":\"42\",\"x\":-20,\"y\":10,\"width\":1536,\"height\":864,\"corner\":8}}");
    assert_eq!(format_target(42, &rect, true, 0, true, true), "{\"target\":{\"id\":\"42\",\"x\":-20,\"y\":10,\"width\":1536,\"height\":864,\"corner\":0,\"minimized\":true,\"dimmed\":true,\"formHidden\":true}}");
}

#[test]
fn the_request_needs_an_owner_an_absolute_riot_path_and_a_numeric_overlay() {
    assert_eq!(
        parse_request("{\"ownerPid\":12,\"clientPath\":\"C:/Riot/RiotClientServices.exe\",\"overlayWindow\":\"4567\",\"follow\":true}"),
        Some(Request { owner_pid: 12, client_path: "C:/Riot/RiotClientServices.exe".into(), overlay: 4567, follow: true })
    );
    assert_eq!(parse_request("{\"ownerPid\":12,\"clientPath\":\"C:/Riot/RiotClientServices.exe\",\"overlayWindow\":null,\"follow\":true}").map(|request| (request.overlay, request.follow)), Some((0, false)));
    for bad in [
        "",
        "{}",
        "{\"ownerPid\":0,\"clientPath\":\"C:/Riot/x.exe\"}",
        "{\"ownerPid\":-1,\"clientPath\":\"C:/Riot/x.exe\"}",
        "{\"ownerPid\":12,\"clientPath\":\"x.exe\"}",
        "{\"ownerPid\":12,\"clientPath\":\"C:/Riot/x.exe\",\"overlayWindow\":\"12a\"}",
        "{\"ownerPid\":12,\"clientPath\":\"C:/Riot/x.exe\",\"overlayWindow\":123}",
        "{\"ownerPid\":12,\"clientPath\":\"C:/Riot/x.exe\",\"overlayWindow\":\"123456789012345678901\"}",
    ] {
        assert_eq!(parse_request(bad), None, "{bad}");
    }
    assert_eq!(POLL_MS, 180);
    assert_eq!(DRAG_MESSAGE, "Eclipse.RiotDragStart");
}

#[test]
fn the_riot_window_is_recognized_whatever_slashes_riot_wrote_in_its_installs_file() {
    let real = r"C:\Riot Games\Riot Client\RiotClientElectron\Riot Client.exe";
    for client in ["C:/Riot Games/Riot Client/RiotClientServices.exe", r"C:\Riot Games\Riot Client\RiotClientServices.exe", r"c:/riot games/riot client\RiotClientServices.exe"] {
        let (modern, legacy) = client_windows(client).unwrap();
        assert!(same_path(real, &modern), "{client} -> {modern}");
        assert!(same_path(r"C:\Riot Games\Riot Client\UX\RiotClientUx.exe", &legacy), "{client} -> {legacy}");
        assert!(!same_path(r"C:\Other\RiotClientElectron\Riot Client.exe", &modern));
    }
    assert!(!same_path("", ""));
    assert_eq!(client_windows("RiotClientServices.exe"), None);
    assert_eq!(client_windows(""), None);
}

#[test]
fn each_window_is_checked_against_the_riot_path_once_and_again_when_its_process_changes_or_it_leaves() {
    let mut verdicts = Verdicts::default();
    let mut reads = Vec::new();
    let mut check = |verdicts: &mut Verdicts, window: isize, pid: u32, answer: Option<bool>| verdicts.check(window, pid, |pid| {
        reads.push(pid);
        answer
    });
    assert!(check(&mut verdicts, 100, 7, Some(true)));
    assert!(check(&mut verdicts, 100, 7, Some(false)));
    assert!(!check(&mut verdicts, 200, 8, Some(false)));
    assert!(!check(&mut verdicts, 200, 8, Some(true)));
    assert!(!check(&mut verdicts, 100, 9, Some(false)));
    assert!(!check(&mut verdicts, 300, 10, None));
    assert!(check(&mut verdicts, 300, 10, Some(true)));
    assert_eq!(verdicts.len(), 3);
    verdicts.keep(&[300]);
    assert_eq!(verdicts.len(), 1);
    assert!(check(&mut verdicts, 100, 9, Some(true)));
    assert!(!check(&mut verdicts, 400, 11, None));
    assert_eq!(verdicts.len(), 2);
    drop(check);
    assert_eq!(reads, [7, 8, 9, 10, 10, 9, 11]);
}
