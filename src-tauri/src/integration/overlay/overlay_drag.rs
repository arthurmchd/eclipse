use std::cell::RefCell;
use std::sync::Arc;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetCapture, ReleaseCapture, SetCapture, VK_LBUTTON, VK_RBUTTON};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BeginDeferWindowPos, DeferWindowPos, EndDeferWindowPos, GetCursorPos, GetGUIThreadInfo, GetSystemMetrics, GetWindow, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible, KillTimer, PostMessageW, RegisterWindowMessageW, SendMessageTimeoutW, SetTimer, GUITHREADINFO,
    GUI_INMOVESIZE, GW_OWNER, HTCAPTION, SMTO_ABORTIFHUNG, SM_SWAPBUTTON, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, WM_CAPTURECHANGED, WM_LBUTTONUP, WM_MOUSEMOVE, WM_NCDESTROY, WM_NCHITTEST, WM_RBUTTONUP, WM_TIMER,
};

pub const START_MESSAGE: &str = "Eclipse.RiotDragStart";
pub const BEAT_MS: u32 = 15;
pub const BEAT_ID: usize = 0x4543_4c44;
pub const MAX_RETAKES: u32 = 3;
pub const LOOP_BEATS: u32 = 3;
pub const HIT_TEST_MS: u32 = 100;
pub const FROM_CARDS: LPARAM = 1;
pub const UNAVAILABLE: &str = "riot drag: could not watch the cards window; the cards follow the Riot window as before";
const SUBCLASS_ID: usize = 0x4543_4c53;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

impl Point {
    pub const fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }

    fn minus(self, other: Point) -> Point {
        Point::new(self.x - other.x, self.y - other.y)
    }

    fn plus(self, other: Point) -> Point {
        Point::new(self.x + other.x, self.y + other.y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Taken,
    KeptByRiot,
    RiotKeptLoop,
    NotCaption,
    TakenFromCards,
    CardsKeptCapture,
}

impl Outcome {
    pub const ALL: [Outcome; 6] = [Outcome::Taken, Outcome::KeptByRiot, Outcome::RiotKeptLoop, Outcome::NotCaption, Outcome::TakenFromCards, Outcome::CardsKeptCapture];

    pub fn line(self) -> &'static str {
        match self {
            Outcome::Taken => "riot drag: Eclipse moved the Riot window and the cards together",
            Outcome::KeptByRiot => "riot drag: the Riot window kept the mouse capture; the cards follow it as before",
            Outcome::RiotKeptLoop => "riot drag: the Riot window stayed in its own drag; Eclipse let go",
            Outcome::NotCaption => "riot drag: the grabbed point was not the Riot title bar",
            Outcome::TakenFromCards => "riot drag: Eclipse moved the Riot window and the cards together from the cards area",
            Outcome::CardsKeptCapture => "riot drag: the cards area could not take the mouse capture; nothing moved",
        }
    }
}

pub trait DragPlatform {
    fn overlay(&self) -> isize;
    fn overlay_visible(&self) -> bool;
    fn overlay_owner(&self) -> isize;
    fn primary_down(&self) -> bool;
    fn cursor(&self) -> Option<Point>;
    fn caption_at(&self, riot: isize, at: Point) -> bool;
    fn window_origin(&self, riot: isize) -> Option<Point>;
    fn client_origin(&self, riot: isize) -> Option<Point>;
    fn take_capture(&self);
    fn shares_capture(&self, riot: isize) -> bool;
    fn has_capture(&self) -> bool;
    fn release_capture(&self);
    fn in_move_loop(&self, riot: isize) -> bool;
    fn move_both(&self, riot: isize, riot_at: Point, overlay_at: Point);
    fn start_beat(&self);
    fn stop_beat(&self);
    fn log(&self, line: &'static str);
}

#[derive(Debug, Clone, Copy)]
struct Drag {
    riot: isize,
    grab: Point,
    client: Point,
    retakes: u32,
    looped: u32,
}

#[derive(Default)]
pub struct OverlayDrag {
    drag: Option<Drag>,
    logged: [bool; 6],
}

impl OverlayDrag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn dragging(&self) -> bool {
        self.drag.is_some()
    }

    fn note(&mut self, platform: &dyn DragPlatform, outcome: Outcome) {
        let index = outcome as usize;
        if !self.logged[index] {
            self.logged[index] = true;
            platform.log(outcome.line());
        }
    }

    fn follow_cursor(&self, platform: &dyn DragPlatform) {
        let (Some(drag), Some(cursor)) = (self.drag, platform.cursor()) else {
            return;
        };
        let riot_at = cursor.minus(drag.grab);
        platform.move_both(drag.riot, riot_at, riot_at.plus(drag.client));
    }

    fn finish(&mut self, platform: &dyn DragPlatform) {
        if self.drag.take().is_none() {
            return;
        }
        platform.stop_beat();
        if platform.has_capture() {
            platform.release_capture();
        }
    }

    fn retake(&mut self, platform: &dyn DragPlatform) -> bool {
        let Some(drag) = self.drag.as_mut() else {
            return false;
        };
        if drag.retakes >= MAX_RETAKES {
            return false;
        }
        drag.retakes += 1;
        platform.take_capture();
        true
    }

    pub fn start(&mut self, platform: &dyn DragPlatform, riot: isize) -> bool {
        if self.drag.is_some() || riot == 0 || !platform.overlay_visible() || platform.overlay_owner() != riot || !platform.primary_down() {
            return false;
        }
        let Some(cursor) = platform.cursor() else {
            return false;
        };
        if !platform.caption_at(riot, cursor) {
            self.note(platform, Outcome::NotCaption);
            return false;
        }
        let (Some(origin), Some(client)) = (platform.window_origin(riot), platform.client_origin(riot)) else {
            return false;
        };
        platform.take_capture();
        if !platform.shares_capture(riot) {
            if platform.has_capture() {
                platform.release_capture();
            }
            self.note(platform, Outcome::KeptByRiot);
            return false;
        }
        self.drag = Some(Drag { riot, grab: cursor.minus(origin), client: client.minus(origin), retakes: 0, looped: 0 });
        platform.start_beat();
        self.note(platform, Outcome::Taken);
        self.follow_cursor(platform);
        true
    }

    pub fn grab(&mut self, platform: &dyn DragPlatform) -> bool {
        let riot = platform.overlay_owner();
        if self.drag.is_some() || riot == 0 || !platform.overlay_visible() || !platform.primary_down() {
            return false;
        }
        let (Some(cursor), Some(origin), Some(client)) = (platform.cursor(), platform.window_origin(riot), platform.client_origin(riot)) else {
            return false;
        };
        platform.take_capture();
        if !platform.has_capture() {
            self.note(platform, Outcome::CardsKeptCapture);
            return false;
        }
        self.drag = Some(Drag { riot, grab: cursor.minus(origin), client: client.minus(origin), retakes: 0, looped: 0 });
        platform.start_beat();
        self.note(platform, Outcome::TakenFromCards);
        self.follow_cursor(platform);
        true
    }

    pub fn moved(&mut self, platform: &dyn DragPlatform) {
        if self.drag.is_none() {
            return;
        }
        self.follow_cursor(platform);
        if !platform.primary_down() {
            self.finish(platform);
        }
    }

    pub fn released(&mut self, platform: &dyn DragPlatform) {
        if self.drag.is_none() || platform.primary_down() {
            return;
        }
        self.follow_cursor(platform);
        self.finish(platform);
    }

    pub fn capture_changed(&mut self, platform: &dyn DragPlatform, to: isize) {
        if self.drag.is_none() || to == platform.overlay() {
            return;
        }
        if to == 0 && platform.primary_down() && self.retake(platform) {
            return;
        }
        self.finish(platform);
    }

    pub fn beat(&mut self, platform: &dyn DragPlatform) {
        let Some(drag) = self.drag else {
            platform.stop_beat();
            return;
        };
        if !platform.primary_down() {
            self.follow_cursor(platform);
            self.finish(platform);
            return;
        }
        if platform.in_move_loop(drag.riot) {
            let looped = drag.looped + 1;
            if looped >= LOOP_BEATS {
                self.note(platform, Outcome::RiotKeptLoop);
                self.finish(platform);
                return;
            }
            if let Some(current) = self.drag.as_mut() {
                current.looped = looped;
            }
        } else if !platform.has_capture() && !self.retake(platform) {
            self.finish(platform);
            return;
        }
        self.follow_cursor(platform);
    }
}

fn hwnd(value: isize) -> HWND {
    value as HWND
}

fn thread_info(window: isize) -> Option<GUITHREADINFO> {
    unsafe {
        let thread = GetWindowThreadProcessId(hwnd(window), std::ptr::null_mut());
        if thread == 0 {
            return None;
        }
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        (GetGUIThreadInfo(thread, &mut info) != 0).then_some(info)
    }
}

fn screen_lparam(at: Point) -> LPARAM {
    ((at.x as u16 as u32) | ((at.y as u16 as u32) << 16)) as i32 as LPARAM
}

pub struct WindowsDrag {
    overlay: isize,
    log: Arc<dyn Fn(&str) + Send + Sync>,
}

impl WindowsDrag {
    pub fn new(overlay: isize, log: Arc<dyn Fn(&str) + Send + Sync>) -> Self {
        Self { overlay, log }
    }
}

impl DragPlatform for WindowsDrag {
    fn overlay(&self) -> isize {
        self.overlay
    }

    fn overlay_visible(&self) -> bool {
        unsafe { IsWindowVisible(hwnd(self.overlay)) != 0 }
    }

    fn overlay_owner(&self) -> isize {
        unsafe { GetWindow(hwnd(self.overlay), GW_OWNER) as isize }
    }

    fn primary_down(&self) -> bool {
        unsafe {
            let key = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
            GetAsyncKeyState(key as i32) < 0
        }
    }

    fn cursor(&self) -> Option<Point> {
        let mut at = POINT { x: 0, y: 0 };
        (unsafe { GetCursorPos(&mut at) } != 0).then_some(Point::new(at.x, at.y))
    }

    fn caption_at(&self, riot: isize, at: Point) -> bool {
        let mut result: usize = 0;
        let answered = unsafe { SendMessageTimeoutW(hwnd(riot), WM_NCHITTEST, 0, screen_lparam(at), SMTO_ABORTIFHUNG, HIT_TEST_MS, &mut result) };
        answered != 0 && result == HTCAPTION as usize
    }

    fn window_origin(&self, riot: isize) -> Option<Point> {
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        (unsafe { GetWindowRect(hwnd(riot), &mut rect) } != 0).then_some(Point::new(rect.left, rect.top))
    }

    fn client_origin(&self, riot: isize) -> Option<Point> {
        let mut at = POINT { x: 0, y: 0 };
        (unsafe { ClientToScreen(hwnd(riot), &mut at) } != 0).then_some(Point::new(at.x, at.y))
    }

    fn take_capture(&self) {
        unsafe {
            SetCapture(hwnd(self.overlay));
        }
    }

    fn shares_capture(&self, riot: isize) -> bool {
        thread_info(riot).is_some_and(|info| info.hwndCapture as isize == self.overlay)
    }

    fn has_capture(&self) -> bool {
        unsafe { GetCapture() as isize == self.overlay }
    }

    fn release_capture(&self) {
        unsafe {
            ReleaseCapture();
        }
    }

    fn in_move_loop(&self, riot: isize) -> bool {
        thread_info(riot).is_some_and(|info| info.flags & GUI_INMOVESIZE != 0)
    }

    fn move_both(&self, riot: isize, riot_at: Point, overlay_at: Point) {
        let flags = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
        unsafe {
            let batch = BeginDeferWindowPos(2);
            if batch.is_null() {
                return;
            }
            let batch = DeferWindowPos(batch, hwnd(riot), std::ptr::null_mut(), riot_at.x, riot_at.y, 0, 0, flags);
            if batch.is_null() {
                return;
            }
            let batch = DeferWindowPos(batch, hwnd(self.overlay), std::ptr::null_mut(), overlay_at.x, overlay_at.y, 0, 0, flags);
            if batch.is_null() {
                return;
            }
            EndDeferWindowPos(batch);
        }
    }

    fn start_beat(&self) {
        unsafe {
            SetTimer(hwnd(self.overlay), BEAT_ID, BEAT_MS, None);
        }
    }

    fn stop_beat(&self) {
        unsafe {
            KillTimer(hwnd(self.overlay), BEAT_ID);
        }
    }

    fn log(&self, line: &'static str) {
        let log = self.log.clone();
        std::thread::spawn(move || log(line));
    }
}

struct Installed {
    platform: WindowsDrag,
    drag: OverlayDrag,
    start: u32,
}

impl Installed {
    fn handle(&mut self, message: u32, wparam: WPARAM, lparam: LPARAM) -> Option<LRESULT> {
        let platform = &self.platform;
        if message == self.start {
            if lparam == FROM_CARDS {
                self.drag.grab(platform);
            } else {
                self.drag.start(platform, wparam as isize);
            }
            return Some(0);
        }
        if message == WM_TIMER && wparam == BEAT_ID {
            self.drag.beat(platform);
            return Some(0);
        }
        if !self.drag.dragging() {
            return None;
        }
        match message {
            WM_MOUSEMOVE => {
                self.drag.moved(platform);
                Some(0)
            }
            WM_LBUTTONUP | WM_RBUTTONUP => {
                self.drag.released(platform);
                Some(0)
            }
            WM_CAPTURECHANGED => {
                self.drag.capture_changed(platform, lparam);
                None
            }
            _ => None,
        }
    }
}

thread_local! {
    static INSTALLED: RefCell<Option<Installed>> = const { RefCell::new(None) };
}

unsafe extern "system" fn subclass(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
    if message == WM_NCDESTROY {
        RemoveWindowSubclass(window, Some(subclass), SUBCLASS_ID);
        let _ = INSTALLED.try_with(|cell| {
            if let Ok(mut slot) = cell.try_borrow_mut() {
                *slot = None;
            }
        });
        return DefSubclassProc(window, message, wparam, lparam);
    }
    let handled = INSTALLED.try_with(|cell| cell.try_borrow_mut().ok().and_then(|mut slot| slot.as_mut().and_then(|installed| installed.handle(message, wparam, lparam)))).ok().flatten();
    match handled {
        Some(result) => result,
        None => DefSubclassProc(window, message, wparam, lparam),
    }
}

pub fn request_from_cards(overlay: isize) -> bool {
    let message = start_message();
    message != 0 && unsafe { PostMessageW(hwnd(overlay), message, 0, FROM_CARDS) } != 0
}

pub fn start_message() -> u32 {
    let name: Vec<u16> = START_MESSAGE.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { RegisterWindowMessageW(name.as_ptr()) }
}

pub fn install(overlay: isize, log: Arc<dyn Fn(&str) + Send + Sync>) -> bool {
    let start = start_message();
    if start == 0 {
        return false;
    }
    let installed = Installed { platform: WindowsDrag::new(overlay, log), drag: OverlayDrag::new(), start };
    if INSTALLED.try_with(|cell| cell.try_borrow_mut().map(|mut slot| *slot = Some(installed)).is_ok()) != Ok(true) {
        return false;
    }
    unsafe { SetWindowSubclass(hwnd(overlay), Some(subclass), SUBCLASS_ID, 0) != 0 }
}
