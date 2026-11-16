use eclipse::integration::overlay::overlay_toggle::{hidden_script, language_script, toggle_rect, COMMAND, INIT_SCRIPT};
use eclipse::integration::overlay::riot_overlay::{Rect, Size};

#[test]
fn the_toggle_area_sits_right_of_the_stay_signed_in_label_and_scales_with_the_riot_window() {
    assert_eq!(toggle_rect(Size { width: 1536, height: 864 }), Rect::new(200, 418, 144, 32));
    assert_eq!(toggle_rect(Size { width: 768, height: 432 }), Rect::new(100, 209, 72, 16));
    let small = toggle_rect(Size { width: 1, height: 1 });
    assert!(small.width >= 1 && small.height >= 1);
}

#[test]
fn the_toggle_page_only_reports_a_boolean_and_receives_fixed_language_and_hidden_scripts() {
    assert_eq!(COMMAND, "overlay_toggle");
    assert!(INIT_SCRIPT.contains("invoke('overlay_toggle', { hidden: hidden === true })"));
    assert!(INIT_SCRIPT.contains("value === 'en' ? 'en' : 'pt'"));
    assert_eq!(language_script("en"), "window.__eclipseToggle && window.__eclipseToggle.language('en')");
    for language in ["pt", "xx", "en');alert(1);('"] {
        assert_eq!(language_script(language), "window.__eclipseToggle && window.__eclipseToggle.language('pt')");
    }
    assert_eq!(hidden_script(true), "window.__eclipseToggle && window.__eclipseToggle.hidden(true)");
    assert_eq!(hidden_script(false), "window.__eclipseToggle && window.__eclipseToggle.hidden(false)");
}
