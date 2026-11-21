use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongW, IsIconic, IsWindowVisible, PostMessageW, SetForegroundWindow, ShowWindowAsync, GWL_EXSTYLE, SW_RESTORE, SW_SHOW, WM_CLOSE, WS_EX_TOOLWINDOW};

use super::win32::{class_name, cloaked, is_root, null_window, process_name, top_windows, window_rect, window_text};

pub const GAMES: [&str; 5] = ["lol", "tft", "val", "2xko", "lor"];

pub trait WindowOps: Send + Sync {
    fn reveal(&self) -> Result<(), &'static str>;
    fn close_client(&self) -> Result<(), &'static str>;
    fn game_window(&self, game: &str) -> Result<bool, &'static str>;
}

pub fn client_interface(process: &str) -> bool {
    process.eq_ignore_ascii_case("Riot Client") || process.eq_ignore_ascii_case("RiotClientUx")
}

pub fn activation_candidate(process: &str, class: &str, width: i32, height: i32, root: bool) -> bool {
    root && !class.eq_ignore_ascii_case("TrayIconClass") && width >= 320 && height >= 240 && client_interface(process)
}

pub fn game_processes(game: &str) -> &'static [&'static str] {
    match game {
        "val" => &["VALORANT-Win64-Shipping", "VALORANT"],
        "tft" => &["TFTClient-Win64-Shipping", "TFTClient"],
        "2xko" => &["Lion-Win64-Shipping", "Lion"],
        "lor" => &["LoR"],
        _ => &["LeagueClientUx", "League of Legends"],
    }
}

pub fn game_process(game: &str, process: &str) -> bool {
    game_processes(game).iter().any(|name| process.eq_ignore_ascii_case(name))
}

pub fn activation_score(width: i32, height: i32, title: &str) -> i64 {
    width as i64 * height as i64 + if title.eq_ignore_ascii_case("Riot Client") { 100_000_000 } else { 0 }
}

pub struct NativeWindows;

fn size(window: HWND) -> (i32, i32) {
    window_rect(window).map(|rect| (rect.right - rect.left, rect.bottom - rect.top)).unwrap_or((0, 0))
}

impl WindowOps for NativeWindows {
    fn reveal(&self) -> Result<(), &'static str> {
        let mut main = null_window();
        let mut best = 0i64;
        for window in top_windows() {
            let (width, height) = size(window);
            if !activation_candidate(&process_name(window), &class_name(window), width, height, is_root(window)) {
                continue;
            }
            let title = window_text(window);
            if title.is_empty() {
                continue;
            }
            let score = activation_score(width, height, &title);
            if score > best {
                best = score;
                main = window;
            }
        }
        if !main.is_null() {
            unsafe {
                ShowWindowAsync(main, if IsIconic(main) != 0 { SW_RESTORE } else { SW_SHOW });
                SetForegroundWindow(main);
            }
        }
        Ok(())
    }

    fn close_client(&self) -> Result<(), &'static str> {
        for window in top_windows() {
            if is_root(window) && client_interface(&process_name(window)) {
                unsafe {
                    PostMessageW(window, WM_CLOSE, 0, 0);
                }
            }
        }
        Ok(())
    }

    fn game_window(&self, game: &str) -> Result<bool, &'static str> {
        if !GAMES.contains(&game) {
            return Err("invalid-game");
        }
        for window in top_windows() {
            if !is_root(window) || unsafe { IsWindowVisible(window) } == 0 || unsafe { IsIconic(window) } != 0 {
                continue;
            }
            let (width, height) = size(window);
            if width < 160 || height < 120 {
                continue;
            }
            if unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW != 0 || cloaked(window) {
                continue;
            }
            if game_process(game, &process_name(window)) {
                return Ok(true);
            }
        }
        Ok(false)
    }
}
