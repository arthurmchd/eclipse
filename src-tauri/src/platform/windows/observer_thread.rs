use std::cell::RefCell;
use std::ffi::c_void;
use std::io::{self, Write};
use std::mem::size_of;
use std::path::Path;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use serde_json::Value;
use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DwmSetWindowAttribute};
use windows_sys::Win32::Graphics::Gdi::{BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetPixel, ReleaseDC, SelectObject, SRCCOPY};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows_sys::Win32::UI::HiDpi::{GetDpiForWindow, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, GetAncestor, GetForegroundWindow, GetGUIThreadInfo, GetMessageW, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, IsZoomed, KillTimer, PeekMessageW,
    PostMessageW, PostThreadMessageW, RegisterWindowMessageW, SetTimer, SetWindowLongPtrW, SetWindowPos, ShowWindow, ShowWindowAsync, TranslateMessage, WindowFromPoint, GUITHREADINFO, MSG, PM_NOREMOVE, PM_REMOVE,
};

use super::riot_window_observer::{ObserverChild, ObserverSpawn, Output};
use super::win32::{client_origin, client_rect, cloaked, image_path, top_windows, wide};

const EVENT_OBJECT_LOCATIONCHANGE: u32 = 0x800B;
const EVENT_SYSTEM_MOVESIZESTART: u32 = 0x000A;
const WM_TIMER: u32 = 0x0113;
const WM_CLOSE: u32 = 0x0010;
const WM_RIOT_COMMAND: u32 = 0x8001;
const GW_OWNER: u32 = 4;
const GW_HWNDNEXT: u32 = 2;
const GW_HWNDPREV: u32 = 3;
const SWP_NOSIZE: u32 = 0x1;
const SWP_NOMOVE: u32 = 0x2;
const SWP_NOZORDER: u32 = 0x4;
const SWP_NOACTIVATE: u32 = 0x10;
const SWP_NOOWNERZORDER: u32 = 0x200;
const SWP_ASYNCWINDOWPOS: u32 = 0x4000;
const GWLP_HWNDPARENT: i32 = -8;
const GWL_EXSTYLE: i32 = -20;
const WS_EX_TOPMOST: isize = 0x8;
const SW_HIDE: i32 = 0;
const SW_MINIMIZE: i32 = 6;
const SW_SHOWNOACTIVATE: i32 = 4;
const DWMWA_TRANSITIONS_FORCEDISABLED: i32 = 3;
const DWMWA_WINDOW_CORNER_PREFERENCE: i32 = 33;
const GA_ROOT: u32 = 2;
pub const CLR_INVALID: u32 = 0xFFFF_FFFF;
pub const PANEL: (f64, f64) = (0.026, 0.5);
pub const BOX: (f64, f64) = (0.0417, 0.5023);
pub const POLL_MS: u32 = 180;
pub const DRAG_MESSAGE: &str = "Eclipse.RiotDragStart";
const MINIMIZE: usize = 1;
const CLOSE: usize = 2;

fn topmost_window() -> HWND {
    -1isize as HWND
}

fn not_topmost() -> HWND {
    -2isize as HWND
}

fn zero() -> RECT {
    RECT { left: 0, top: 0, right: 0, bottom: 0 }
}

fn same(a: &RECT, b: &RECT) -> bool {
    a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom
}

pub fn shade(colors: Option<&[u32]>) -> i32 {
    let Some(colors) = colors.filter(|colors| !colors.is_empty()) else { return 0 };
    let (mut dark, mut light) = (0, 0);
    for &color in colors {
        if color == CLR_INVALID {
            return 0;
        }
        let (red, green, blue) = ((color & 0xFF) as i32, ((color >> 8) & 0xFF) as i32, ((color >> 16) & 0xFF) as i32);
        if red.max(green).max(blue) <= 140 {
            dark += 1;
        } else if red.min(green).min(blue) >= 230 {
            light += 1;
        }
    }
    if dark == colors.len() {
        1
    } else if light == colors.len() {
        -1
    } else {
        0
    }
}

pub fn box_state(colors: Option<&[u32]>) -> i32 {
    let Some(colors) = colors.filter(|colors| !colors.is_empty()) else { return 0 };
    let (mut boxed, mut light) = (0, 0);
    for &color in colors {
        if color == CLR_INVALID {
            return 0;
        }
        let (red, green, blue) = ((color & 0xFF) as i32, ((color >> 8) & 0xFF) as i32, ((color >> 16) & 0xFF) as i32);
        let (high, low) = (red.max(green).max(blue), red.min(green).min(blue));
        if high <= 140 {
            return 0;
        }
        if low >= 246 {
            light += 1;
        } else if (low >= 205 && high <= 243 && high - low <= 12) || (red >= 150 && green <= 110 && blue <= 110) {
            boxed += 1;
        }
    }
    if light == colors.len() {
        -1
    } else if boxed >= 3 {
        1
    } else {
        0
    }
}

pub fn command_code(line: &str) -> usize {
    if line.len() > 16 {
        return 0;
    }
    match line.trim() {
        "minimize" => MINIMIZE,
        "close" => CLOSE,
        _ => 0,
    }
}

pub fn corner_size(preference: i32, dpi: u32) -> i32 {
    let size = match preference {
        0 | 2 => 8.0,
        3 => 4.0,
        _ => 0.0,
    };
    (size * if dpi == 0 { 96.0 } else { dpi as f64 } / 96.0).round_ties_even() as i32
}

pub fn format_target(id: i64, rect: &RECT, minimized: bool, corner: i32, dimmed: bool, form_hidden: bool) -> String {
    format!(
        "{{\"target\":{{\"id\":\"{id}\",\"x\":{},\"y\":{},\"width\":{},\"height\":{},\"corner\":{corner}{}{}{}}}}}",
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
        if minimized { ",\"minimized\":true" } else { "" },
        if dimmed { ",\"dimmed\":true" } else { "" },
        if form_hidden { ",\"formHidden\":true" } else { "" },
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub owner_pid: u32,
    pub client_path: String,
    pub overlay: isize,
    pub follow: bool,
}

pub fn same_path(left: &str, right: &str) -> bool {
    let clean = |path: &str| path.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    !left.is_empty() && clean(left) == clean(right)
}

pub fn client_windows(client_path: &str) -> Option<(String, String)> {
    let normal = client_path.replace('/', "\\");
    let root = Path::new(&normal).parent().filter(|root| !root.as_os_str().is_empty())?;
    Some((root.join("RiotClientElectron").join("Riot Client.exe").to_string_lossy().into_owned(), root.join("UX").join("RiotClientUx.exe").to_string_lossy().into_owned()))
}

pub fn parse_request(line: &str) -> Option<Request> {
    let data: Value = serde_json::from_str(line).ok()?;
    let owner_pid = data.get("ownerPid")?.as_u64().filter(|pid| *pid > 0 && *pid <= u32::MAX as u64)? as u32;
    let client_path = data.get("clientPath")?.as_str()?.to_string();
    if !Path::new(&client_path).is_absolute() {
        return None;
    }
    let overlay = match data.get("overlayWindow") {
        None | Some(Value::Null) => 0,
        Some(Value::String(text)) if (1..=20).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_digit()) => text.parse::<i64>().ok()? as isize,
        Some(_) => return None,
    };
    let follow = data.get("follow") == Some(&Value::Bool(true)) && overlay != 0;
    Some(Request { owner_pid, client_path, overlay, follow })
}

struct Tracker {
    dimmed: bool,
    box_seen: bool,
    form_hidden: bool,
    follow: bool,
    lost: bool,
    settled_seen: bool,
    settled: RECT,
    stilled: HWND,
    sensed: HWND,
    last_corner: i32,
    chosen: HWND,
    hook: HWINEVENTHOOK,
    start_hook: HWINEVENTHOOK,
    overlay: HWND,
    measured: HWND,
    drag_start: u32,
    last: RECT,
    hooked_pid: u32,
    modern: String,
    legacy: String,
    last_line: Option<String>,
    output: Option<Output>,
}

impl Default for Tracker {
    fn default() -> Self {
        Self {
            dimmed: false,
            box_seen: false,
            form_hidden: false,
            follow: false,
            lost: false,
            settled_seen: false,
            settled: zero(),
            stilled: null_mut(),
            sensed: null_mut(),
            last_corner: 0,
            chosen: null_mut(),
            hook: null_mut(),
            start_hook: null_mut(),
            overlay: null_mut(),
            measured: null_mut(),
            drag_start: 0,
            last: zero(),
            hooked_pid: 0,
            modern: String::new(),
            legacy: String::new(),
            last_line: None,
            output: None,
        }
    }
}

thread_local! {
    static TRACKER: RefCell<Tracker> = RefCell::new(Tracker::default());
}

fn visible(window: HWND) -> bool {
    unsafe { IsWindowVisible(window) != 0 }
}

fn iconic(window: HWND) -> bool {
    unsafe { IsIconic(window) != 0 }
}

fn pid_of(window: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    pid
}

fn measure(window: HWND) -> Option<RECT> {
    if window.is_null() || !visible(window) || iconic(window) {
        return None;
    }
    let client = client_rect(window)?;
    if client.right - client.left < 320 || client.bottom - client.top < 240 {
        return None;
    }
    let origin = client_origin(window)?;
    if cloaked(window) {
        return None;
    }
    Some(RECT { left: client.left + origin.x, top: client.top + origin.y, right: client.right + origin.x, bottom: client.bottom + origin.y })
}

fn topmost(window: HWND) -> bool {
    unsafe { GetWindowLongPtrW(window, GWL_EXSTYLE) & WS_EX_TOPMOST != 0 }
}

fn corner(window: HWND) -> i32 {
    let mut preference = 0i32;
    if unsafe { IsZoomed(window) } != 0 {
        return 0;
    }
    let result = unsafe { DwmGetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE as _, &mut preference as *mut i32 as *mut c_void, 4) };
    if result != 0 {
        return 0;
    }
    corner_size(preference, unsafe { GetDpiForWindow(window) })
}

fn transitions(window: HWND, disabled: bool) -> i32 {
    let value: i32 = if disabled { 1 } else { 0 };
    unsafe { DwmSetWindowAttribute(window, DWMWA_TRANSITIONS_FORCEDISABLED as _, &value as *const i32 as *const c_void, 4) }
}

fn set_position(window: HWND, after: HWND, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> bool {
    unsafe { SetWindowPos(window, after, x, y, cx, cy, flags) != 0 }
}

unsafe extern "system" fn on_event(_hook: HWINEVENTHOOK, event: u32, window: HWND, object: i32, child: i32, _thread: u32, _time: u32) {
    let _ = TRACKER.try_with(|cell| {
        if let Ok(mut tracker) = cell.try_borrow_mut() {
            tracker.event(event, window, object, child);
        }
    });
}

impl Tracker {
    fn official(&self, window: HWND) -> bool {
        let image = image_path(pid_of(window));
        same_path(&image, &self.modern) || same_path(&image, &self.legacy)
    }

    fn minimized(&self, window: HWND) -> bool {
        !window.is_null() && window == self.measured && visible(window) && iconic(window) && self.official(window)
    }

    fn candidate(&self, window: HWND) -> Option<RECT> {
        measure(window).filter(|_| !topmost(window))
    }

    fn find(&self) -> HWND {
        if self.minimized(self.chosen) {
            return self.chosen;
        }
        let foreground = unsafe { GetForegroundWindow() };
        let (mut found, mut best) = (null_mut(), 0i64);
        for window in top_windows() {
            let Some(rect) = self.candidate(window) else { continue };
            if !self.official(window) {
                continue;
            }
            let score = (rect.right - rect.left) as i64 * (rect.bottom - rect.top) as i64 + if window == foreground { 100_000_000 } else { 0 };
            if score > best {
                best = score;
                found = window;
            }
        }
        found
    }

    fn format(&self, window: HWND, rect: &RECT, minimized: bool, corner: i32) -> String {
        format_target(window as i64, rect, minimized, corner, self.dimmed, self.form_hidden)
    }

    fn sample(&self, window: HWND, rect: &RECT, x: f64, y: f64) -> Option<[u32; 9]> {
        let point = POINT { x: rect.left + ((rect.right - rect.left) as f64 * x).round_ties_even() as i32, y: rect.top + ((rect.bottom - rect.top) as f64 * y).round_ties_even() as i32 };
        let root = unsafe { GetAncestor(WindowFromPoint(point), GA_ROOT) };
        if root.is_null() || (root != window && (self.overlay.is_null() || root != self.overlay)) {
            return None;
        }
        unsafe {
            let screen = GetDC(null_mut());
            if screen.is_null() {
                return None;
            }
            let memory = CreateCompatibleDC(screen);
            let bitmap = CreateCompatibleBitmap(screen, 7, 7);
            let mut colors = None;
            if !memory.is_null() && !bitmap.is_null() {
                let previous = SelectObject(memory, bitmap);
                if BitBlt(memory, 0, 0, 7, 7, screen, point.x - 3, point.y - 3, SRCCOPY) != 0 {
                    let mut read = [0u32; 9];
                    for (index, slot) in read.iter_mut().enumerate() {
                        *slot = GetPixel(memory, (index as i32 % 3) * 3, (index as i32 / 3) * 3);
                    }
                    colors = Some(read);
                }
                if !previous.is_null() {
                    SelectObject(memory, previous);
                }
            }
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            if !memory.is_null() {
                DeleteDC(memory);
            }
            ReleaseDC(null_mut(), screen);
            colors
        }
    }

    fn settle(&mut self, rect: RECT) -> bool {
        let unchanged = self.settled_seen && same(&rect, &self.settled);
        self.settled = rect;
        self.settled_seen = true;
        unchanged
    }

    fn notice(&mut self, state: i32) {
        if state > 0 {
            self.box_seen = true;
            self.form_hidden = false;
        } else if state < 0 && self.box_seen {
            self.form_hidden = true;
        }
    }

    fn sense(&mut self, window: HWND) {
        if window != self.sensed {
            self.sensed = window;
            self.dimmed = false;
            self.box_seen = false;
            self.form_hidden = false;
            self.settled_seen = false;
        }
        let Some(rect) = measure(window) else { return };
        if !self.settle(rect) {
            return;
        }
        let panel = shade(self.sample(window, &rect, PANEL.0, PANEL.1).as_ref().map(|colors| colors.as_slice()));
        if panel != 0 {
            self.dimmed = panel > 0;
        }
        if !self.dimmed {
            let state = box_state(self.sample(window, &rect, BOX.0, BOX.1).as_ref().map(|colors| colors.as_slice()));
            self.notice(state);
        }
    }

    fn held(&self) -> bool {
        let mut pid = 0u32;
        let thread = unsafe { GetWindowThreadProcessId(self.overlay, &mut pid) };
        if thread == 0 {
            return false;
        }
        let mut info: GUITHREADINFO = unsafe { std::mem::zeroed() };
        info.cbSize = size_of::<GUITHREADINFO>() as u32;
        unsafe { GetGUIThreadInfo(thread, &mut info) != 0 && info.hwndCapture == self.overlay }
    }

    fn announce(&self, window: HWND) {
        if !self.follow || self.overlay.is_null() || self.drag_start == 0 || window.is_null() || window != self.chosen {
            return;
        }
        unsafe { PostMessageW(self.overlay, self.drag_start, window as usize, 0) };
    }

    fn follow_to(&mut self, rect: &RECT) {
        if !self.follow || self.overlay.is_null() || self.held() {
            return;
        }
        if !set_position(self.overlay, null_mut(), rect.left, rect.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE) {
            self.lost = true;
        }
    }

    fn describe(&mut self, window: HWND) -> String {
        if let Some(rect) = measure(window) {
            self.follow_to(&rect);
            self.last = rect;
            self.measured = window;
            self.last_corner = corner(window);
            return self.format(window, &rect, false, self.last_corner);
        }
        if self.minimized(window) {
            let last = self.last;
            return self.format(window, &last, true, self.last_corner);
        }
        "{\"target\":null}".to_string()
    }

    fn write(&mut self, line: String) {
        if let Some(output) = &self.output {
            output(Some(format!("{line}\n").as_bytes()));
        }
        self.last_line = Some(line);
    }

    fn attach(&self, window: HWND) -> Result<(), &'static str> {
        if self.overlay.is_null() || window.is_null() || unsafe { GetWindow(self.overlay, GW_OWNER) } == window {
            return Ok(());
        }
        unsafe { SetWindowLongPtrW(self.overlay, GWLP_HWNDPARENT, window as isize) };
        if unsafe { GetWindow(self.overlay, GW_OWNER) } != window {
            return Err("owner-unavailable");
        }
        Ok(())
    }

    fn beneath(&self, window: HWND) -> bool {
        let mut next = unsafe { GetWindow(window, GW_HWNDNEXT) };
        while !next.is_null() {
            if next == self.overlay {
                return true;
            }
            next = unsafe { GetWindow(next, GW_HWNDNEXT) };
        }
        false
    }

    fn raise(&self, window: HWND) {
        if self.overlay.is_null() || window.is_null() || !visible(self.overlay) || iconic(window) {
            return;
        }
        let pinned = topmost(self.overlay) && !topmost(window);
        if !pinned && !self.beneath(window) {
            return;
        }
        if pinned {
            set_position(self.overlay, not_topmost(), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
        }
        let above = unsafe { GetWindow(window, GW_HWNDPREV) };
        if above == self.overlay {
            return;
        }
        set_position(self.overlay, above, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
    }

    fn still(&mut self, window: HWND) {
        if self.overlay.is_null() || window == self.stilled {
            return;
        }
        if !self.stilled.is_null() && unsafe { IsWindow(self.stilled) } != 0 {
            transitions(self.stilled, false);
        }
        self.stilled = window;
        if !window.is_null() {
            transitions(window, true);
        }
    }

    fn release_stilled(&mut self) {
        if !self.stilled.is_null() && unsafe { IsWindow(self.stilled) } != 0 {
            transitions(self.stilled, false);
        }
        self.stilled = null_mut();
    }

    fn hook(&mut self, window: HWND) {
        let pid = if window.is_null() { 0 } else { pid_of(window) };
        if pid == self.hooked_pid {
            return;
        }
        unsafe {
            if !self.hook.is_null() {
                UnhookWinEvent(self.hook);
            }
            if !self.start_hook.is_null() {
                UnhookWinEvent(self.start_hook);
            }
        }
        self.hook = null_mut();
        self.start_hook = null_mut();
        self.hooked_pid = pid;
        if pid == 0 {
            return;
        }
        self.hook = unsafe { SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, null_mut(), Some(on_event), pid, 0, 0) };
        if self.follow {
            self.start_hook = unsafe { SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZESTART, null_mut(), Some(on_event), pid, 0, 0) };
        }
    }

    fn event(&mut self, event: u32, window: HWND, object: i32, child: i32) {
        if window != self.chosen || object != 0 || child != 0 {
            return;
        }
        if event == EVENT_SYSTEM_MOVESIZESTART {
            self.announce(window);
            return;
        }
        let line = self.describe(window);
        if self.last_line.as_deref() != Some(line.as_str()) {
            self.write(line);
        }
    }

    fn poll(&mut self) -> Result<(), &'static str> {
        self.chosen = self.find();
        let chosen = self.chosen;
        self.attach(chosen)?;
        self.still(chosen);
        self.raise(chosen);
        self.hook(chosen);
        self.sense(chosen);
        let line = self.describe(chosen);
        self.write(line);
        Ok(())
    }

    fn act(&self, code: usize) {
        let window = self.chosen;
        if window.is_null() || !visible(window) || iconic(window) || !self.official(window) {
            return;
        }
        apply(window, code);
    }
}

fn apply(window: HWND, code: usize) {
    unsafe {
        if code == MINIMIZE {
            ShowWindowAsync(window, SW_MINIMIZE);
        } else if code == CLOSE {
            PostMessageW(window, WM_CLOSE, 0, 0);
        }
    }
}

fn with<T>(action: impl FnOnce(&mut Tracker) -> T) -> T {
    TRACKER.with(|cell| action(&mut cell.borrow_mut()))
}

fn pump() {
    let mut message: MSG = unsafe { std::mem::zeroed() };
    unsafe {
        while PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) != 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

fn drag_message() -> u32 {
    let name = wide(DRAG_MESSAGE);
    unsafe { RegisterWindowMessageW(name.as_ptr()) }
}

struct Shared {
    lines: mpsc::Receiver<String>,
    released: Arc<AtomicBool>,
}

fn run(request: Request, shared: &Shared) -> Result<(), &'static str> {
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let (modern, legacy) = client_windows(&request.client_path).ok_or("invalid-request")?;
    with(|tracker| {
        tracker.modern = modern;
        tracker.legacy = legacy;
    });
    if request.overlay != 0 {
        let overlay = request.overlay as HWND;
        if pid_of(overlay) != request.owner_pid {
            return Err("invalid-overlay");
        }
        with(|tracker| {
            tracker.overlay = overlay;
            tracker.follow = request.follow;
            if request.follow {
                tracker.drag_start = drag_message();
            }
        });
    }
    let timer = unsafe { SetTimer(null_mut(), 0, POLL_MS, None) };
    let result = (|| {
        with(|tracker| tracker.poll())?;
        let mut message: MSG = unsafe { std::mem::zeroed() };
        loop {
            if with(|tracker| tracker.lost) {
                return Err("follow-unavailable");
            }
            if unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } <= 0 {
                return Ok(());
            }
            if message.hwnd.is_null() && (message.message == WM_RIOT_COMMAND || message.message == WM_TIMER) {
                loop {
                    match shared.lines.try_recv() {
                        Ok(line) => {
                            let code = command_code(&line);
                            if code != 0 {
                                with(|tracker| tracker.act(code));
                            }
                        }
                        Err(mpsc::TryRecvError::Empty) => break,
                        Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
                    }
                }
                if shared.released.load(Ordering::SeqCst) {
                    return Ok(());
                }
                if message.message == WM_TIMER {
                    with(|tracker| tracker.poll())?;
                }
                continue;
            }
            unsafe {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    })();
    unsafe { KillTimer(null_mut(), timer) };
    with(|tracker| {
        tracker.release_stilled();
        tracker.hook(null_mut());
    });
    result
}

struct CommandWriter {
    buffer: Vec<u8>,
    lines: Option<mpsc::Sender<String>>,
    thread: Arc<AtomicU32>,
}

fn wake(thread: &AtomicU32) {
    let id = thread.load(Ordering::SeqCst);
    if id != 0 {
        unsafe { PostThreadMessageW(id, WM_RIOT_COMMAND, 0, 0) };
    }
}

impl Write for CommandWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let lines = self.lines.as_ref().ok_or_else(|| io::Error::other("observer closed"))?;
        self.buffer.extend_from_slice(bytes);
        if self.buffer.len() > 65536 {
            self.buffer.clear();
            return Err(io::Error::other("line too long"));
        }
        while let Some(end) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=end).collect();
            let text = String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n']).to_string();
            lines.send(text).map_err(|_| io::Error::other("observer closed"))?;
            wake(&self.thread);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for CommandWriter {
    fn drop(&mut self) {
        self.lines = None;
        wake(&self.thread);
    }
}

pub struct NativeObserver;

impl ObserverSpawn for NativeObserver {
    fn spawn(&self, output: Output) -> io::Result<ObserverChild> {
        let (sender, lines) = mpsc::channel::<String>();
        let thread_id = Arc::new(AtomicU32::new(0));
        let released = Arc::new(AtomicBool::new(false));
        let (published, flag) = (thread_id.clone(), released.clone());
        thread::Builder::new().name("eclipse-riot-observer".into()).spawn(move || {
            let mut message: MSG = unsafe { std::mem::zeroed() };
            unsafe { PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE) };
            published.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);
            let shared = Shared { lines, released: flag };
            let request = shared.lines.recv_timeout(Duration::from_secs(10)).ok().and_then(|line| parse_request(&line));
            with(|tracker| tracker.output = Some(output.clone()));
            let result = match request {
                Some(request) => run(request, &shared),
                None => Err("invalid-request"),
            };
            if result.is_err() {
                output(Some(b"{\"error\":\"observer-unavailable\"}\n"));
            }
            with(|tracker| tracker.output = None);
            output(None);
        })?;
        let writer = CommandWriter { buffer: Vec::new(), lines: Some(sender), thread: thread_id.clone() };
        Ok(ObserverChild {
            input: Box::new(writer),
            kill: Box::new(move || {
                released.store(true, Ordering::SeqCst);
                wake(&thread_id);
            }),
        })
    }
}

fn test_window() -> Result<HWND, &'static str> {
    let class = wide("STATIC");
    let empty = wide("");
    let window = unsafe { CreateWindowExW(0x0800_0080, class.as_ptr(), empty.as_ptr(), 0x9000_0000, -20000, -20000, 16, 16, null_mut(), null_mut(), null_mut(), null_mut()) };
    if window.is_null() {
        Err("self-test-window")
    } else {
        Ok(window)
    }
}

fn rect_of(window: HWND) -> Option<RECT> {
    let mut rect = zero();
    (unsafe { GetWindowRect(window, &mut rect) } != 0).then_some(rect)
}

fn check(ok: bool, reason: &'static str) -> Result<(), &'static str> {
    if ok {
        Ok(())
    } else {
        Err(reason)
    }
}

fn below(tracker: &Tracker, cards: HWND, riot: HWND) -> Result<(), &'static str> {
    set_position(cards, riot, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    check(tracker.beneath(riot), "self-test-order")
}

fn pin(window: HWND, on: bool) {
    set_position(window, if on { topmost_window() } else { not_topmost() }, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
}

fn self_test_steps(t: &mut Tracker, riot: HWND, cards: &mut HWND) -> Result<(), &'static str> {
    let card = *cards;
    t.overlay = card;
    unsafe { ShowWindow(card, SW_HIDE) };
    below(t, card, riot)?;
    t.raise(riot);
    check(t.beneath(riot), "self-test-hidden")?;
    unsafe { ShowWindow(card, SW_SHOWNOACTIVATE) };
    below(t, card, riot)?;
    t.raise(riot);
    check(!t.beneath(riot) && unsafe { GetWindow(riot, GW_HWNDPREV) } == card, "self-test-raise")?;
    t.raise(riot);
    check(unsafe { GetWindow(riot, GW_HWNDPREV) } == card, "self-test-stable")?;
    pin(riot, true);
    pin(riot, false);
    below(t, card, riot)?;
    unsafe { SetWindowLongPtrW(card, GWLP_HWNDPARENT, riot as isize) };
    check(t.beneath(riot) && topmost(unsafe { GetWindow(riot, GW_HWNDPREV) }), "self-test-top-setup")?;
    t.raise(riot);
    check(!topmost(card) && unsafe { GetWindow(riot, GW_HWNDPREV) } == card, "self-test-top")?;
    pin(card, true);
    check(topmost(card), "self-test-pin-setup")?;
    t.raise(riot);
    check(!topmost(card) && !topmost(riot) && unsafe { GetWindow(riot, GW_HWNDPREV) } == card, "self-test-unpin")?;
    pin(riot, true);
    check(topmost(card), "self-test-owner-pin-setup")?;
    t.raise(riot);
    check(topmost(riot) && topmost(card), "self-test-owner-pinned")?;
    pin(riot, false);
    unsafe { SetWindowLongPtrW(card, GWLP_HWNDPARENT, 0) };
    check(command_code("minimize") == MINIMIZE && command_code("close") == CLOSE && command_code("quit") == 0 && command_code("") == 0, "self-test-commands")?;
    set_position(riot, null_mut(), -20000, -20000, 400, 300, SWP_NOZORDER | SWP_NOACTIVATE);
    check(t.candidate(riot).is_some(), "self-test-candidate")?;
    pin(riot, true);
    check(t.candidate(riot).is_none(), "self-test-splash")?;
    set_position(riot, not_topmost(), -20000, -20000, 16, 16, SWP_NOACTIVATE);
    check(!topmost(riot) && t.candidate(riot).is_none(), "self-test-splash-reset")?;
    apply(riot, MINIMIZE);
    pump();
    check(iconic(riot), "self-test-minimize")?;
    unsafe { ShowWindow(riot, SW_SHOWNOACTIVATE) };
    check(!iconic(riot), "self-test-restore")?;
    t.still(riot);
    check(t.stilled == riot && transitions(riot, true) == 0, "self-test-transitions")?;
    t.still(riot);
    check(t.stilled == riot, "self-test-still")?;
    let dpi = unsafe { GetDpiForWindow(riot) };
    let (small, square) = (3i32, 1i32);
    if unsafe { DwmSetWindowAttribute(riot, DWMWA_WINDOW_CORNER_PREFERENCE as _, &small as *const i32 as *const c_void, 4) } == 0 {
        check(corner(riot) == corner_size(3, dpi), "self-test-corner")?;
    }
    if unsafe { DwmSetWindowAttribute(riot, DWMWA_WINDOW_CORNER_PREFERENCE as _, &square as *const i32 as *const c_void, 4) } == 0 {
        check(corner(riot) == 0, "self-test-square")?;
    }
    t.still(null_mut());
    check(t.stilled.is_null(), "self-test-release")?;
    let away = RECT { left: -20000, top: -20000, right: -19500, bottom: -19600 };
    check(t.sample(riot, &away, PANEL.0, PANEL.1).is_none() && t.sample(riot, &away, BOX.0, BOX.1).is_none(), "self-test-unseen")?;
    let moved = RECT { left: away.left + 40, top: away.top, right: away.right + 40, bottom: away.bottom };
    t.settled_seen = false;
    check(!t.settle(away) && t.settle(away) && !t.settle(moved) && t.settle(moved) && !t.settle(away), "self-test-settle")?;
    t.notice(-1);
    check(!t.form_hidden, "self-test-form-unseen")?;
    t.notice(1);
    t.notice(0);
    check(t.box_seen && !t.form_hidden, "self-test-form-seen")?;
    t.notice(-1);
    t.notice(0);
    check(t.form_hidden && t.format(riot, &away, false, 0).ends_with(",\"formHidden\":true}}"), "self-test-form-hidden")?;
    t.notice(1);
    check(!t.form_hidden && !t.format(riot, &away, false, 0).contains("formHidden"), "self-test-form-back")?;
    t.dimmed = true;
    check(t.format(riot, &away, false, 0).contains(",\"dimmed\":true}"), "self-test-format")?;
    t.form_hidden = true;
    t.settled_seen = true;
    t.sense(riot);
    check(!t.dimmed && !t.box_seen && !t.form_hidden && !t.settled_seen && t.sensed == riot, "self-test-sense")?;
    t.dimmed = true;
    t.box_seen = true;
    t.form_hidden = true;
    t.sense(riot);
    check(t.dimmed && t.box_seen && t.form_hidden, "self-test-keep")?;
    t.dimmed = false;
    t.box_seen = false;
    t.form_hidden = false;
    check(!t.format(riot, &away, false, 0).contains("dimmed"), "self-test-plain")?;
    let mut spot = RECT { left: -20300, top: -20200, right: -19800, bottom: -19900 };
    t.follow_to(&spot);
    let at = rect_of(card).ok_or("self-test-follow-off")?;
    check(!t.lost && at.left == -20000 && at.top == -20000, "self-test-follow-off")?;
    t.follow = true;
    t.follow_to(&spot);
    let at = rect_of(card).ok_or("self-test-follow")?;
    check(!t.lost && at.left == -20300 && at.top == -20200 && at.right - at.left == 16 && at.bottom - at.top == 16, "self-test-follow")?;
    let at = rect_of(riot).ok_or("self-test-follow-riot")?;
    check(at.left == -20000 && at.top == -20000, "self-test-follow-riot")?;
    unsafe { SetCapture(card) };
    if t.held() {
        spot.left = -20100;
        spot.top = -20100;
        t.follow_to(&spot);
        let at = rect_of(card).ok_or("self-test-follow-held")?;
        check(!t.lost && at.left == -20300 && at.top == -20200, "self-test-follow-held")?;
    }
    unsafe { ReleaseCapture() };
    check(!t.held(), "self-test-follow-released")?;
    spot.left = -20100;
    spot.top = -20100;
    t.follow_to(&spot);
    let at = rect_of(card).ok_or("self-test-follow-after")?;
    check(!t.lost && at.left == -20100 && at.top == -20100, "self-test-follow-after")?;
    t.drag_start = drag_message();
    let mut drag: MSG = unsafe { std::mem::zeroed() };
    t.chosen = null_mut();
    t.announce(riot);
    check(unsafe { PeekMessageW(&mut drag, card, t.drag_start, t.drag_start, PM_REMOVE) } == 0, "self-test-drag-other")?;
    t.chosen = riot;
    t.announce(riot);
    check(unsafe { PeekMessageW(&mut drag, card, t.drag_start, t.drag_start, PM_REMOVE) } != 0 && drag.wParam == riot as usize, "self-test-drag")?;
    t.follow = false;
    t.announce(riot);
    check(unsafe { PeekMessageW(&mut drag, card, t.drag_start, t.drag_start, PM_REMOVE) } == 0, "self-test-drag-off")?;
    t.follow = true;
    t.hook(riot);
    check(!t.hook.is_null() && !t.start_hook.is_null(), "self-test-hooks")?;
    t.hook(null_mut());
    check(t.hook.is_null() && t.start_hook.is_null() && t.hooked_pid == 0, "self-test-unhook")?;
    t.follow = false;
    t.hook(riot);
    check(!t.hook.is_null() && t.start_hook.is_null(), "self-test-hooks-off")?;
    t.hook(null_mut());
    t.chosen = null_mut();
    apply(card, CLOSE);
    pump();
    check(unsafe { IsWindow(card) } == 0, "self-test-close")?;
    t.follow = true;
    t.follow_to(&spot);
    check(t.lost, "self-test-follow-lost")?;
    *cards = null_mut();
    Ok(())
}

pub fn self_test() -> Result<(), &'static str> {
    let riot = test_window()?;
    let mut cards = match test_window() {
        Ok(cards) => cards,
        Err(reason) => {
            unsafe { DestroyWindow(riot) };
            return Err(reason);
        }
    };
    let mut tracker = Tracker::default();
    let result = self_test_steps(&mut tracker, riot, &mut cards);
    tracker.release_stilled();
    tracker.hook(null_mut());
    unsafe {
        ReleaseCapture();
        if !cards.is_null() {
            DestroyWindow(cards);
        }
        DestroyWindow(riot);
    }
    result
}
