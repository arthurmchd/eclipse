use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::null_mut;
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::Graphics::Gdi::{CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
use windows_sys::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows_sys::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, PostMessageW, WM_CHAR, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE};

use super::win32::{client_origin, client_rect, is_root, null_window, process_ids, process_of, top_windows, window_rect, window_text};
use crate::riot::Cancel;

pub const USERNAME: (f64, f64) = (0.130, 0.303);
pub const PASSWORD: (f64, f64) = (0.130, 0.377);
pub const REMEMBER: (f64, f64) = (0.0417, 0.5023);
pub const SUBMIT: (f64, f64) = (0.1302, 0.7894);
pub const PANEL: (f64, f64) = (0.026, 0.5);
pub const RIOT_INTERFACE: [&str; 2] = ["Riot Client", "RiotClientUx"];
pub const FORM_WAIT_MS: u64 = 60_000;
pub const FORM_POLL_MS: u64 = 250;
pub const READY_READS: u32 = 4;
pub const FIELDS_WAIT_MS: u64 = 3000;
pub const SETTLE_MS: u64 = 1500;
pub const CHAR_DELAY_MS: u64 = 35;
pub const MAX_CREDENTIAL: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Remember {
    On,
    Off,
    Unknown,
}

impl Remember {
    pub fn name(self) -> &'static str {
        match self {
            Remember::On => "on",
            Remember::Off => "off",
            Remember::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputMethod {
    Automation,
    Keys,
}

impl InputMethod {
    pub fn name(self) -> &'static str {
        match self {
            InputMethod::Automation => "uia",
            InputMethod::Keys => "keys",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FillReport {
    pub input: InputMethod,
    pub remember: Remember,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillFailure {
    InvalidCredentials,
    WindowNotFound,
    FormNotReady,
    InputFailed,
    Failed,
    Cancelled,
}

impl FillFailure {
    pub fn code(self) -> &'static str {
        match self {
            FillFailure::InvalidCredentials => "invalid-credentials",
            FillFailure::WindowNotFound => "window-not-found",
            FillFailure::FormNotReady => "form-not-ready",
            FillFailure::InputFailed => "input-failed",
            FillFailure::Failed => "window-script-failed",
            FillFailure::Cancelled => "cancelled",
        }
    }
}

pub trait LoginForm: Send + Sync {
    fn fill(&self, username: &str, password: &str, remember: bool, cancel: Option<&Cancel>) -> Result<FillReport, FillFailure>;
}

pub fn valid_credential(text: &str) -> bool {
    !text.is_empty() && text.encode_utf16().count() <= MAX_CREDENTIAL && !text.contains(['\r', '\n', '\0'])
}

pub fn point(x: i32, y: i32) -> isize {
    ((y << 16) | (x & 0xFFFF)) as isize
}

pub fn scaled(size: i32, fraction: f64) -> i32 {
    (size as f64 * fraction).round_ties_even() as i32
}

pub type Rgb = (u8, u8, u8);

pub fn light(color: Rgb, min: u8) -> bool {
    color.0 >= min && color.1 >= min && color.2 >= min
}

pub fn remember_state(samples: &[Rgb]) -> Remember {
    if samples.len() < 25 {
        return Remember::Unknown;
    }
    let (mut red, mut gray) = (0, 0);
    for &(r, g, b) in samples {
        let high = r.max(g).max(b);
        let low = r.min(g).min(b);
        if high <= 140 {
            return Remember::Unknown;
        }
        if r >= 150 && g <= 110 && b <= 110 {
            red += 1;
        } else if low >= 205 && high <= 243 && high - low <= 12 {
            gray += 1;
        }
    }
    if red >= 10 && gray == 0 {
        Remember::On
    } else if gray >= 20 && red == 0 {
        Remember::Off
    } else {
        Remember::Unknown
    }
}

pub fn form_ready(width: i32, height: i32, panel: Rgb, username: Rgb, password: Rgb) -> bool {
    if width <= 0 || height <= 0 {
        return false;
    }
    let ratio = width as f64 / height as f64;
    (1.6..=1.95).contains(&ratio) && light(panel, 240) && light(username, 220) && light(password, 220)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Field {
    pub password: bool,
    pub usable: bool,
}

pub fn select_fields(fields: &[Field]) -> Option<(usize, usize)> {
    let usable = |want: bool| fields.iter().enumerate().filter(|(_, field)| field.usable && field.password == want).map(|(index, _)| index).collect::<Vec<_>>();
    match (usable(false).as_slice(), usable(true).as_slice()) {
        ([user], [pass]) => Some((*user, *pass)),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

pub fn client_frame(window: (i32, i32, i32, i32), origin: (i32, i32), client: (i32, i32)) -> Option<Frame> {
    let (left, top, right, bottom) = window;
    let (width, height) = (right - left, bottom - top);
    if width <= 0 || height <= 0 || width > 10_000 || height > 10_000 {
        return None;
    }
    let frame = Frame { left: origin.0 - left, top: origin.1 - top, width: client.0, height: client.1 };
    let fits = frame.width > 0 && frame.height > 0 && frame.left >= 0 && frame.top >= 0 && frame.left + frame.width <= width && frame.top + frame.height <= height;
    fits.then_some(frame)
}

pub struct Shot {
    pub frame: Frame,
    pub width: i32,
    pub height: i32,
    pub pixels: Vec<u8>,
}

impl Shot {
    pub fn at(&self, x: i32, y: i32) -> Option<Rgb> {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return None;
        }
        let index = ((y * self.width + x) * 4) as usize;
        Some((self.pixels[index + 2], self.pixels[index + 1], self.pixels[index]))
    }

    pub fn sample(&self, fraction: (f64, f64)) -> Option<Rgb> {
        self.at(self.frame.left + scaled(self.frame.width, fraction.0), self.frame.top + scaled(self.frame.height, fraction.1))
    }

    pub fn remember_samples(&self) -> Vec<Rgb> {
        let x = self.frame.left + scaled(self.frame.width, REMEMBER.0);
        let y = self.frame.top + scaled(self.frame.height, REMEMBER.1);
        let mut samples = Vec::with_capacity(25);
        for dx in [-4, -2, 0, 2, 4] {
            for dy in [-4, -2, 0, 2, 4] {
                if let Some(color) = self.at(x + dx, y + dy) {
                    samples.push(color);
                }
            }
        }
        samples
    }

    pub fn ready(&self) -> bool {
        match (self.sample(PANEL), self.sample(USERNAME), self.sample(PASSWORD)) {
            (Some(panel), Some(user), Some(pass)) => form_ready(self.frame.width, self.frame.height, panel, user, pass),
            _ => false,
        }
    }
}

fn capture(window: HWND) -> Option<Shot> {
    let rect = window_rect(window)?;
    let client = client_rect(window)?;
    let origin = client_origin(window)?;
    let frame = client_frame((rect.left, rect.top, rect.right, rect.bottom), (origin.x, origin.y), (client.right, client.bottom))?;
    let (width, height) = (rect.right - rect.left, rect.bottom - rect.top);
    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return None;
        }
        let memory = CreateCompatibleDC(screen);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER { biSize: size_of::<BITMAPINFOHEADER>() as u32, biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB, ..std::mem::zeroed() };
        let mut bits: *mut c_void = null_mut();
        let bitmap = if memory.is_null() { null_mut() } else { CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0) };
        let mut shot = None;
        if !bitmap.is_null() && !bits.is_null() {
            let previous = SelectObject(memory, bitmap);
            if PrintWindow(window, memory, 2 as PRINT_WINDOW_FLAGS) != 0 {
                let length = (width * height * 4) as usize;
                let pixels = std::slice::from_raw_parts(bits as *const u8, length).to_vec();
                shot = Some(Shot { frame, width, height, pixels });
            }
            SelectObject(memory, previous);
        }
        if !bitmap.is_null() {
            DeleteObject(bitmap);
        }
        if !memory.is_null() {
            DeleteDC(memory);
        }
        ReleaseDC(null_mut(), screen);
        shot
    }
}

fn find_form_window() -> HWND {
    let pids = process_ids(&RIOT_INTERFACE);
    if pids.is_empty() {
        return null_window();
    }
    let mut found = null_window();
    let mut best = 0i64;
    for window in top_windows() {
        if !is_root(window) || !pids.contains(&process_of(window)) {
            continue;
        }
        let Some(client) = client_rect(window) else { continue };
        if client.right < 500 || client.bottom < 300 {
            continue;
        }
        let score = client.right as i64 * client.bottom as i64 + if window_text(window).is_empty() { 0 } else { 100_000_000 };
        if score > best {
            found = window;
            best = score;
        }
    }
    found
}

fn post(window: HWND, message: u32, w: usize, l: isize) -> Result<(), FillFailure> {
    if unsafe { IsWindow(window) } == 0 || unsafe { PostMessageW(window, message, w, l) } == 0 {
        return Err(FillFailure::InputFailed);
    }
    Ok(())
}

fn sleep(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

fn click(window: HWND, fraction: (f64, f64)) -> Result<(), FillFailure> {
    let client = client_rect(window).filter(|rect| rect.right > 0 && rect.bottom > 0).ok_or(FillFailure::WindowNotFound)?;
    let at = point((client.right as f64 * fraction.0) as i32, (client.bottom as f64 * fraction.1) as i32);
    post(window, WM_MOUSEMOVE, 0, at)?;
    post(window, WM_LBUTTONDOWN, 1, at)?;
    sleep(40);
    post(window, WM_LBUTTONUP, 0, at)?;
    sleep(300);
    Ok(())
}

fn key(window: HWND, code: usize, scan: u32) -> Result<(), FillFailure> {
    post(window, WM_KEYDOWN, code, (1 | (scan << 16)) as isize)?;
    if code == 8 {
        post(window, WM_CHAR, 8, (1 | (scan << 16)) as isize)?;
    }
    post(window, WM_KEYUP, code, (0xC000_0001u32 | (scan << 16)) as i32 as isize)
}

fn clear_field(window: HWND) -> Result<(), FillFailure> {
    key(window, 0x23, 0x4F)?;
    sleep(100);
    for _ in 0..256 {
        key(window, 8, 0x0E)?;
        sleep(3);
    }
    sleep(200);
    Ok(())
}

fn type_text(window: HWND, text: &str) -> Result<(), FillFailure> {
    for unit in text.encode_utf16() {
        post(window, WM_CHAR, unit as usize, 1)?;
        sleep(CHAR_DELAY_MS);
    }
    Ok(())
}

fn type_by_keys(window: HWND, username: &str, password: &str) -> Result<(), FillFailure> {
    click(window, USERNAME)?;
    clear_field(window)?;
    type_text(window, username)?;
    click(window, PASSWORD)?;
    clear_field(window)?;
    type_text(window, password)
}

mod automation {
    use std::thread;
    use std::time::{Duration, Instant};

    use windows::core::BSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationValuePattern, TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_EditControlTypeId, UIA_ValuePatternId};

    use super::{select_fields, Field, FIELDS_WAIT_MS, SETTLE_MS};

    fn read_fields(automation: &IUIAutomation, window: *mut core::ffi::c_void, pids: &[u32]) -> windows::core::Result<Option<(IUIAutomationElement, IUIAutomationElement)>> {
        unsafe {
            let root = automation.ElementFromHandle(HWND(window))?;
            let condition = automation.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_EditControlTypeId.0))?;
            let found = root.FindAll(TreeScope_Descendants, &condition)?;
            let mut elements = Vec::new();
            let mut fields = Vec::new();
            for index in 0..found.Length()? {
                let element = found.GetElement(index)?;
                if !pids.contains(&(element.CurrentProcessId()? as u32)) {
                    continue;
                }
                let usable = element.CurrentIsEnabled()?.as_bool() && element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId).and_then(|pattern| pattern.CurrentIsReadOnly()).is_ok_and(|read_only| !read_only.as_bool());
                fields.push(Field { password: element.CurrentIsPassword()?.as_bool(), usable });
                elements.push(element);
            }
            Ok(select_fields(&fields).map(|(user, pass)| (elements[user].clone(), elements[pass].clone())))
        }
    }

    fn wait_fields(automation: &IUIAutomation, window: *mut core::ffi::c_void, pids: &[u32]) -> Option<(IUIAutomationElement, IUIAutomationElement)> {
        let started = Instant::now();
        loop {
            if let Ok(Some(fields)) = read_fields(automation, window, pids) {
                return Some(fields);
            }
            if started.elapsed() >= Duration::from_millis(FIELDS_WAIT_MS) {
                return None;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    pub fn fields_found(window: *mut core::ffi::c_void, pids: &[u32]) -> bool {
        let automation: windows::core::Result<IUIAutomation> = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) };
        automation.ok().is_some_and(|automation| wait_fields(&automation, window, pids).is_some())
    }

    pub fn fill(window: *mut core::ffi::c_void, pids: &[u32], username: &str, password: &str) -> bool {
        let attempt = || -> windows::core::Result<bool> {
            let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)? };
            let Some((user, pass)) = wait_fields(&automation, window, pids) else { return Ok(false) };
            unsafe {
                pass.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?.SetValue(&BSTR::from(password))?;
                let user = user.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?;
                user.SetValue(&BSTR::from(username))?;
                let settle = Instant::now();
                while user.CurrentValue()? != username {
                    if settle.elapsed() >= Duration::from_millis(SETTLE_MS) {
                        return Ok(false);
                    }
                    thread::sleep(Duration::from_millis(50));
                }
            }
            Ok(true)
        };
        attempt().unwrap_or(false)
    }
}

fn cancelled(cancel: Option<&Cancel>) -> Result<(), FillFailure> {
    if cancel.is_some_and(Cancel::is_cancelled) {
        Err(FillFailure::Cancelled)
    } else {
        Ok(())
    }
}

fn wait_for_form(cancel: Option<&Cancel>) -> Result<HWND, FillFailure> {
    let deadline = Instant::now() + Duration::from_millis(FORM_WAIT_MS);
    let (mut window, mut last, mut ready) = (null_window(), null_window(), 0u32);
    while Instant::now() < deadline {
        cancelled(cancel)?;
        window = find_form_window();
        if !window.is_null() && window == last && capture(window).is_some_and(|shot| shot.ready()) {
            ready += 1;
        } else {
            ready = 0;
        }
        last = window;
        if ready >= READY_READS {
            return Ok(window);
        }
        sleep(FORM_POLL_MS);
    }
    Err(if window.is_null() { FillFailure::WindowNotFound } else { FillFailure::FormNotReady })
}

fn read_remember(window: HWND) -> Remember {
    capture(window).map(|shot| remember_state(&shot.remember_samples())).unwrap_or(Remember::Unknown)
}

fn fill_on_this_thread(username: &str, password: &str, remember: bool, cancel: Option<&Cancel>) -> Result<FillReport, FillFailure> {
    unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let window = wait_for_form(cancel)?;
    cancelled(cancel)?;
    let pids = process_ids(&RIOT_INTERFACE);
    let input = if !pids.is_empty() && automation::fill(window, &pids, username, password) {
        InputMethod::Automation
    } else {
        cancelled(cancel)?;
        type_by_keys(window, username, password)?;
        InputMethod::Keys
    };
    let wanted = if remember { Remember::On } else { Remember::Off };
    let mut state = read_remember(window);
    if state != Remember::Unknown && state != wanted {
        click(window, REMEMBER)?;
        state = read_remember(window);
    }
    click(window, SUBMIT)?;
    Ok(FillReport { input, remember: state })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FormCheck {
    pub window: bool,
    pub ready: bool,
    pub fields: bool,
    pub remember: Remember,
}

fn inspect_on_this_thread() -> FormCheck {
    unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let window = find_form_window();
    if window.is_null() {
        return FormCheck { window: false, ready: false, fields: false, remember: Remember::Unknown };
    }
    let shot = capture(window);
    let ready = shot.as_ref().is_some_and(Shot::ready);
    let remember = shot.map(|shot| remember_state(&shot.remember_samples())).unwrap_or(Remember::Unknown);
    let pids = process_ids(&RIOT_INTERFACE);
    let fields = ready && !pids.is_empty() && automation::fields_found(window, &pids);
    FormCheck { window: true, ready, fields, remember }
}

pub fn inspect_form() -> FormCheck {
    let worker = thread::Builder::new().name("eclipse-form-check".into()).spawn(|| {
        let com = unsafe { windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED) };
        let check = inspect_on_this_thread();
        if com.is_ok() {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
        check
    });
    worker.ok().and_then(|handle| handle.join().ok()).unwrap_or(FormCheck { window: false, ready: false, fields: false, remember: Remember::Unknown })
}

pub struct NativeLoginForm;

impl LoginForm for NativeLoginForm {
    fn fill(&self, username: &str, password: &str, remember: bool, cancel: Option<&Cancel>) -> Result<FillReport, FillFailure> {
        if !valid_credential(username) || !valid_credential(password) {
            return Err(FillFailure::InvalidCredentials);
        }
        let (username, password, cancel) = (username.to_string(), password.to_string(), cancel.cloned());
        let worker = thread::Builder::new().name("eclipse-login-form".into()).spawn(move || {
            let com = unsafe { windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED) };
            let result = fill_on_this_thread(&username, &password, remember, cancel.as_ref());
            if com.is_ok() {
                unsafe { windows::Win32::System::Com::CoUninitialize() };
            }
            result
        });
        match worker {
            Ok(handle) => handle.join().unwrap_or(Err(FillFailure::Failed)),
            Err(_) => Err(FillFailure::Failed),
        }
    }
}
