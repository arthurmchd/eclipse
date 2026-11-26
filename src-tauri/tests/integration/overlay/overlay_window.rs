use eclipse::integration::overlay::overlay_window::{memory_target, shown_webviews, BROWSER_ARGS};
use webview2_com::Microsoft::Web::WebView2::Win32::{COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL};

#[test]
fn the_webviews_ask_for_little_memory_while_the_overlay_is_hidden_and_normal_memory_while_it_shows() {
    assert_eq!(memory_target(false), COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
    assert_eq!(memory_target(true), COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
}

#[test]
fn resting_hides_the_three_webviews_and_waking_brings_back_only_what_the_overlay_asked_to_show() {
    for cover in [false, true] {
        for toggle in [false, true] {
            assert_eq!(shown_webviews(true, cover, toggle), [false, false, false]);
            assert_eq!(shown_webviews(false, cover, toggle), [true, cover, toggle]);
        }
    }
}

#[test]
fn the_three_pages_share_one_renderer_process_and_keep_the_native_occlusion_off() {
    let args: Vec<&str> = BROWSER_ARGS.split(' ').collect();
    assert_eq!(args, ["--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion", "--renderer-process-limit=1"]);
}
