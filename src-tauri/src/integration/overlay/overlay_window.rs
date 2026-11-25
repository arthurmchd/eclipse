use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder};
use tauri::window::{Color, WindowBuilder};
use tauri::{AppHandle, PhysicalPosition, PhysicalSize, Runtime, Webview, WebviewUrl, Window, WindowEvent};
use url::Url;
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL};
use windows::core::Interface;
use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
use windows_sys::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR};
use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOZORDER, SW_HIDE, SW_SHOWNOACTIVATE};

use super::overlay_drag::{install, request_from_cards, UNAVAILABLE};
use super::overlay_toggle::{language_script, toggle_rect, INIT_SCRIPT};
use super::riot_overlay::{cards_rect, cover_rect, OverlayWindow, Rect, Size};
use crate::integration::asset_protocol::{is_page, page_url, CARDS_PAGE, COVER_PAGE, TOGGLE_PAGE};
use crate::integration::manager::manager_host::{bridge_script, ManagerHost, CARDS_LABEL};

pub const WINDOW_LABEL: &str = "overlay";
pub const COVER_LABEL: &str = "cover";
pub const TOGGLE_LABEL: &str = "toggle";
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --renderer-process-limit=1";
const START: Size = Size { width: 900, height: 650 };

pub struct TauriOverlayWindow<R: Runtime> {
    window: Window<R>,
    cards: Webview<R>,
    cover: Webview<R>,
    toggle: Webview<R>,
    hwnd: isize,
    language: Arc<Mutex<&'static str>>,
    resting: AtomicBool,
    cover_on: AtomicBool,
    toggle_on: AtomicBool,
}

fn url(page: &str) -> Url {
    Url::parse(&page_url(page)).expect("fixed page address")
}

fn place<R: Runtime>(webview: &Webview<R>, rect: Rect) {
    let _ = webview.set_bounds(tauri::Rect { position: PhysicalPosition::new(rect.x, rect.y).into(), size: PhysicalSize::new(rect.width.max(1) as u32, rect.height.max(1) as u32).into() });
}

pub fn shown_webviews(resting: bool, cover: bool, toggle: bool) -> [bool; 3] {
    [!resting, !resting && cover, !resting && toggle]
}

fn set_shown<R: Runtime>(webview: &Webview<R>, shown: bool) {
    let _ = if shown { webview.show() } else { webview.hide() };
}

pub fn memory_target(visible: bool) -> COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL {
    if visible {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    }
}

fn set_memory<R: Runtime>(webview: &Webview<R>, visible: bool) {
    let _ = webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_19>()) {
            let _ = core.SetMemoryUsageTargetLevel(memory_target(visible));
        }
    });
}

fn sealed<R: Runtime>(builder: WebviewBuilder<R>, page: &'static str) -> WebviewBuilder<R> {
    builder
        .additional_browser_args(BROWSER_ARGS)
        .zoom_hotkeys_enabled(false)
        .on_navigation(move |target| is_page(page, target.as_str()))
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_download(|_, _| false)
}

pub fn create<R: Runtime>(app: &AppHandle<R>, host: Arc<ManagerHost>, log: Arc<dyn Fn(&str) + Send + Sync>) -> tauri::Result<TauriOverlayWindow<R>> {
    let window = WindowBuilder::new(app, WINDOW_LABEL)
        .title("Eclipse")
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .always_on_top(false)
        .inner_size(START.width as f64, START.height as f64)
        .build()?;
    window.on_window_event(|event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
    let hwnd = window.hwnd()?.0 as isize;
    let disabled: i32 = 1;
    unsafe {
        DwmSetWindowAttribute(hwnd as _, DWMWA_TRANSITIONS_FORCEDISABLED as u32, &disabled as *const i32 as _, std::mem::size_of::<i32>() as u32);
    }
    let _ = window.run_on_main_thread(move || {
        if !install(hwnd, log.clone()) {
            log(UNAVAILABLE);
        }
    });
    let cards_area = cards_rect(START);
    let cards = window.add_child(
        sealed(WebviewBuilder::new(CARDS_LABEL, WebviewUrl::CustomProtocol(url(CARDS_PAGE))), CARDS_PAGE)
            .initialization_script(bridge_script())
            .background_color(Color(0xf2, 0xf1, 0xee, 0xff))
            .on_new_window(move |target, _| {
                if target.scheme() == "https" {
                    let host = host.clone();
                    let link = target.to_string();
                    std::thread::spawn(move || host.open_external(&link));
                }
                NewWindowResponse::Deny
            }),
        PhysicalPosition::new(cards_area.x, cards_area.y),
        PhysicalSize::new(cards_area.width as u32, cards_area.height as u32),
    )?;
    let cover_area = cover_rect(START);
    let cover = window.add_child(
        sealed(WebviewBuilder::new(COVER_LABEL, WebviewUrl::CustomProtocol(url(COVER_PAGE))), COVER_PAGE)
            .disable_javascript()
            .background_color(Color(0xfc, 0xfc, 0xfc, 0xff))
            .on_new_window(|_, _| NewWindowResponse::Deny),
        PhysicalPosition::new(cover_area.x, cover_area.y),
        PhysicalSize::new(cover_area.width as u32, cover_area.height as u32),
    )?;
    let _ = cover.hide();
    let toggle_area = toggle_rect(START);
    let language: Arc<Mutex<&'static str>> = Arc::new(Mutex::new("pt"));
    let current = language.clone();
    let toggle = window.add_child(
        sealed(WebviewBuilder::new(TOGGLE_LABEL, WebviewUrl::CustomProtocol(url(TOGGLE_PAGE))), TOGGLE_PAGE)
            .initialization_script(INIT_SCRIPT)
            .transparent(true)
            .on_page_load(move |webview, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    let _ = webview.eval(language_script(*current.lock().unwrap()));
                }
            })
            .on_new_window(|_, _| NewWindowResponse::Deny),
        PhysicalPosition::new(toggle_area.x, toggle_area.y),
        PhysicalSize::new(toggle_area.width as u32, toggle_area.height as u32),
    )?;
    let overlay = TauriOverlayWindow { window, cards, cover, toggle, hwnd, language, resting: AtomicBool::new(false), cover_on: AtomicBool::new(false), toggle_on: AtomicBool::new(true) };
    overlay.set_memory(false);
    Ok(overlay)
}

impl<R: Runtime> TauriOverlayWindow<R> {
    pub fn handle(&self) -> String {
        self.hwnd.to_string()
    }

    fn set_memory(&self, visible: bool) {
        for webview in [&self.cards, &self.cover, &self.toggle] {
            set_memory(webview, visible);
        }
    }

    fn on_main(&self, task: impl FnOnce(isize) + Send + 'static) {
        let hwnd = self.hwnd;
        let _ = self.window.run_on_main_thread(move || task(hwnd));
    }
}

impl<R: Runtime> OverlayWindow for TauriOverlayWindow<R> {
    fn set_size(&self, size: Size) {
        self.on_main(move |hwnd| unsafe {
            SetWindowPos(hwnd as _, std::ptr::null_mut(), 0, 0, size.width, size.height, SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER);
        });
        place(&self.cards, cards_rect(size));
        place(&self.cover, cover_rect(size));
        place(&self.toggle, toggle_rect(size));
    }

    fn set_region(&self, parts: &[Rect]) {
        let parts = parts.to_vec();
        self.on_main(move |hwnd| unsafe {
            let region = CreateRectRgn(0, 0, 0, 0);
            for part in parts {
                let piece = CreateRectRgn(part.x, part.y, part.x + part.width, part.y + part.height);
                CombineRgn(region, region, piece, RGN_OR);
                DeleteObject(piece);
            }
            if SetWindowRgn(hwnd as _, region, 1) == 0 {
                DeleteObject(region);
            }
        });
    }

    fn show_inactive(&self) {
        self.set_memory(true);
        self.on_main(|hwnd| unsafe {
            ShowWindow(hwnd as _, SW_SHOWNOACTIVATE);
        });
    }

    fn hide(&self) {
        self.on_main(|hwnd| unsafe {
            ShowWindow(hwnd as _, SW_HIDE);
        });
        self.set_memory(false);
    }

    fn set_resting(&self, resting: bool) {
        self.resting.store(resting, Ordering::SeqCst);
        let [cards, cover, toggle] = shown_webviews(resting, self.cover_on.load(Ordering::SeqCst), self.toggle_on.load(Ordering::SeqCst));
        set_shown(&self.cards, cards);
        set_shown(&self.cover, cover);
        set_shown(&self.toggle, toggle);
    }

    fn set_cover_visible(&self, visible: bool) {
        self.cover_on.store(visible, Ordering::SeqCst);
        set_shown(&self.cover, shown_webviews(self.resting.load(Ordering::SeqCst), visible, false)[1]);
    }

    fn set_toggle_visible(&self, visible: bool) {
        self.toggle_on.store(visible, Ordering::SeqCst);
        set_shown(&self.toggle, shown_webviews(self.resting.load(Ordering::SeqCst), false, visible)[2]);
    }

    fn set_toggle_language(&self, language: &str) {
        *self.language.lock().unwrap() = if language == "en" { "en" } else { "pt" };
        let _ = self.toggle.eval(language_script(language));
    }

    fn begin_drag(&self) {
        request_from_cards(self.hwnd);
    }

    fn close(&self) {
        let _ = self.window.destroy();
    }
}
