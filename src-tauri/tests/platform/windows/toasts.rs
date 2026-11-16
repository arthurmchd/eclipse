use eclipse::platform::windows::toasts::app_id;

#[test]
fn the_installed_app_signs_its_notices_with_its_own_identifier_and_development_borrows_powershell() {
    assert_eq!(app_id(false, "Eclipse.AccountManager"), "Eclipse.AccountManager");
    let development = app_id(true, "Eclipse.AccountManager");
    assert_ne!(development, "Eclipse.AccountManager");
    assert!(development.ends_with("powershell.exe"), "{development}");
}
