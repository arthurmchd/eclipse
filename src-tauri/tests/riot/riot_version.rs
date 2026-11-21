use eclipse::platform::windows::login_form::FillFailure;
use eclipse::riot::riot_version::{layout_failure, newer_riot_message, version_line, RiotVersion, LAST_TESTED_MAJOR, NEWER_RIOT};

#[test]
fn the_sign_in_log_names_the_riot_version_and_says_when_it_is_newer_than_the_last_tested() {
    assert_eq!(LAST_TESTED_MAJOR, 143);
    assert_eq!(version_line(Some(RiotVersion([143, 0, 14, 5311]))), "Riot Client 143.0.14.5311");
    assert_eq!(version_line(Some(RiotVersion([141, 2, 0, 1]))), "Riot Client 141.2.0.1");
    assert_eq!(version_line(Some(RiotVersion([144, 0, 1, 2]))), "Riot Client 144.0.1.2 (newer than the last tested, 143)");
    assert_eq!(version_line(None), "Riot Client version unknown");
}

#[test]
fn only_a_form_failure_on_a_newer_riot_becomes_the_update_warning() {
    let newer = Some(RiotVersion([144, 0, 0, 0]));
    for failure in [FillFailure::FormNotReady, FillFailure::InputFailed, FillFailure::Failed] {
        assert!(layout_failure(failure));
        assert_eq!(newer_riot_message(newer, failure), Some(format!("{NEWER_RIOT}144")));
        assert_eq!(newer_riot_message(Some(RiotVersion([143, 9, 9, 9])), failure), None);
        assert_eq!(newer_riot_message(None, failure), None);
    }
    for failure in [FillFailure::WindowNotFound, FillFailure::InvalidCredentials, FillFailure::Cancelled] {
        assert!(!layout_failure(failure));
        assert_eq!(newer_riot_message(newer, failure), None);
    }
}
