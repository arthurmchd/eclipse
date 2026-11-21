use eclipse::platform::windows::login_form::{
    client_frame, form_ready, point, remember_state, scaled, select_fields, valid_credential, Field, FillFailure, Frame, InputMethod, LoginForm, NativeLoginForm, Remember, Rgb, Shot, PANEL, PASSWORD, REMEMBER, RIOT_INTERFACE, SUBMIT, USERNAME,
};

const BACKGROUND: Rgb = (252, 252, 252);
const GRAY: Rgb = (233, 233, 233);
const GRAY_HOVER: Rgb = (220, 220, 220);
const RED: Rgb = (213, 50, 53);
const RED_HOVER: Rgb = (188, 37, 42);
const MARK: Rgb = (249, 249, 249);
const DARK: Rgb = (40, 40, 40);
const UNCLEAR: Rgb = (150, 150, 150);

fn mix(parts: &[(Rgb, usize)]) -> Vec<Rgb> {
    parts.iter().flat_map(|(color, count)| std::iter::repeat_n(*color, *count)).collect()
}

#[test]
fn the_stay_signed_in_box_of_riot_v142_is_recognized_by_its_colors_and_anything_unclear_is_unknown() {
    assert_eq!(remember_state(&mix(&[(GRAY, 25)])), Remember::Off);
    assert_eq!(remember_state(&mix(&[(GRAY_HOVER, 25)])), Remember::Off);
    assert_eq!(remember_state(&mix(&[(RED, 20), (MARK, 5)])), Remember::On);
    assert_eq!(remember_state(&mix(&[(RED_HOVER, 20), (MARK, 5)])), Remember::On);
    assert_eq!(remember_state(&mix(&[(BACKGROUND, 25)])), Remember::Unknown);
    assert_eq!(remember_state(&mix(&[(GRAY, 19), (BACKGROUND, 6)])), Remember::Unknown);
    assert_eq!(remember_state(&mix(&[(RED, 9), (MARK, 16)])), Remember::Unknown);
    assert_eq!(remember_state(&mix(&[(RED, 12), (GRAY, 13)])), Remember::Unknown);
    assert_eq!(remember_state(&mix(&[(DARK, 20), (MARK, 5)])), Remember::Unknown);
    assert_eq!(remember_state(&mix(&[(GRAY, 24), (DARK, 1)])), Remember::Unknown);
    assert_eq!(remember_state(&mix(&[(UNCLEAR, 25)])), Remember::Unknown);
    assert_eq!(remember_state(&mix(&[(GRAY, 24)])), Remember::Unknown);
    assert_eq!([Remember::On.name(), Remember::Off.name(), Remember::Unknown.name()], ["on", "off", "unknown"]);
}

fn shot(width: i32, height: i32, frame: Frame, paint: impl Fn(i32, i32) -> Rgb) -> Shot {
    let mut pixels = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let (r, g, b) = paint(x, y);
            pixels.extend_from_slice(&[b, g, r, 255]);
        }
    }
    Shot { frame, width, height, pixels }
}

#[test]
fn pixels_are_read_inside_the_client_area_the_same_frame_the_clicks_use() {
    let frame = Frame { left: 8, top: 0, width: 400, height: 300 };
    let (x, y) = (frame.left + scaled(frame.width, REMEMBER.0), frame.top + scaled(frame.height, REMEMBER.1));
    let painted = shot(416, 308, frame, |px, py| if (px - x).abs() <= 6 && (py - y).abs() <= 6 { RED } else { BACKGROUND });
    assert_eq!(remember_state(&painted.remember_samples()), Remember::On);
    let window_frame = Shot { frame: Frame { left: 0, top: 0, width: 416, height: 308 }, ..painted };
    assert_eq!(remember_state(&window_frame.remember_samples()), Remember::Unknown);
}

#[test]
fn the_client_frame_must_fit_inside_the_window_bitmap() {
    assert_eq!(client_frame((100, 50, 1652, 922), (108, 50), (1536, 864)), Some(Frame { left: 8, top: 0, width: 1536, height: 864 }));
    assert_eq!(client_frame((100, 50, 1652, 922), (90, 50), (1536, 864)), None);
    assert_eq!(client_frame((100, 50, 1652, 922), (108, 50), (1600, 864)), None);
    assert_eq!(client_frame((0, 0, 0, 10), (0, 0), (0, 10)), None);
    assert_eq!(client_frame((0, 0, 20_000, 10), (0, 0), (100, 10)), None);
}

#[test]
fn the_form_is_ready_only_with_the_riot_proportions_a_light_panel_and_both_fields_drawn() {
    let light = (250, 250, 250);
    assert!(form_ready(1536, 864, light, (225, 225, 225), (225, 225, 225)));
    assert!(!form_ready(1536, 1000, light, light, light));
    assert!(!form_ready(2000, 864, light, light, light));
    assert!(!form_ready(1536, 864, (239, 250, 250), light, light));
    assert!(!form_ready(1536, 864, light, (219, 250, 250), light));
    assert!(!form_ready(1536, 864, light, light, (40, 40, 40)));
    assert!(!form_ready(0, 0, light, light, light));
    let frame = Frame { left: 8, top: 0, width: 1536, height: 864 };
    assert!(shot(1552, 872, frame, |_, _| light).ready());
    assert!(!shot(1552, 872, frame, |_, _| DARK).ready());
}

#[test]
fn ui_automation_only_fills_one_username_and_one_password_field() {
    let user = Field { password: false, usable: true };
    let pass = Field { password: true, usable: true };
    let off = |password| Field { password, usable: false };
    assert_eq!(select_fields(&[pass, user]), Some((1, 0)));
    assert_eq!(select_fields(&[user, pass, off(false), off(true)]), Some((0, 1)));
    assert_eq!(select_fields(&[user, pass, user]), None);
    assert_eq!(select_fields(&[user, pass, pass]), None);
    assert_eq!(select_fields(&[user]), None);
    assert_eq!(select_fields(&[pass]), None);
    assert_eq!(select_fields(&[user, off(true)]), None);
    assert_eq!(select_fields(&[]), None);
}

#[test]
fn credentials_are_checked_before_touching_any_window() {
    assert!(valid_credential("player"));
    assert!(valid_credential(&"é".repeat(256)));
    for bad in ["", "a\rb", "a\nb", "a\0b"] {
        assert!(!valid_credential(bad), "{bad:?}");
    }
    assert!(!valid_credential(&"a".repeat(257)));
    assert!(!valid_credential(&"😀".repeat(129)));
    assert_eq!(NativeLoginForm.fill("", "secret", true, None), Err(FillFailure::InvalidCredentials));
    assert_eq!(NativeLoginForm.fill("player", "line\nbreak", true, None), Err(FillFailure::InvalidCredentials));
}

#[test]
fn positions_codes_and_names_stay_fixed() {
    assert_eq!(point(123, 456), (456 << 16) | 123);
    assert_eq!(point(-1, 2), (2 << 16) | 0xFFFF);
    assert_eq!(scaled(400, 0.5023), 201);
    assert_eq!(scaled(5, 0.5), 2);
    assert_eq!((USERNAME, PASSWORD, REMEMBER, SUBMIT, PANEL), ((0.130, 0.303), (0.130, 0.377), (0.0417, 0.5023), (0.1302, 0.7894), (0.026, 0.5)));
    assert_eq!(RIOT_INTERFACE, ["Riot Client", "RiotClientUx"]);
    assert_eq!([InputMethod::Automation.name(), InputMethod::Keys.name()], ["uia", "keys"]);
    let codes: Vec<&str> = [FillFailure::InvalidCredentials, FillFailure::WindowNotFound, FillFailure::FormNotReady, FillFailure::InputFailed, FillFailure::Failed, FillFailure::Cancelled].iter().map(|failure| failure.code()).collect();
    assert_eq!(codes, ["invalid-credentials", "window-not-found", "form-not-ready", "input-failed", "window-script-failed", "cancelled"]);
}
