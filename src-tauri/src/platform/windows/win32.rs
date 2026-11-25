use std::collections::HashSet;
use std::ffi::c_void;
use std::mem::size_of;
use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, BOOL, ERROR_INSUFFICIENT_BUFFER, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, POINT, RECT, TRUE};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetAncestor, GetClassNameW, GetClientRect, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, GA_ROOT};

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

fn from_wide(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

pub fn processes() -> Vec<(u32, String)> {
    let mut found = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
            return found;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                found.push((entry.th32ProcessID, from_wide(&entry.szExeFile)));
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
    }
    found
}

pub fn process_names() -> HashSet<String> {
    processes().into_iter().map(|(_, name)| name.to_lowercase()).collect()
}

pub fn process_ids(names: &[&str]) -> Vec<u32> {
    processes()
        .into_iter()
        .filter(|(_, exe)| {
            let stem = exe.strip_suffix(".exe").or_else(|| exe.strip_suffix(".EXE")).unwrap_or(exe);
            names.iter().any(|name| stem.eq_ignore_ascii_case(name))
        })
        .map(|(pid, _)| pid)
        .collect()
}

unsafe extern "system" fn collect(window: HWND, state: LPARAM) -> BOOL {
    let list = &mut *(state as *mut Vec<HWND>);
    list.push(window);
    TRUE
}

pub fn top_windows() -> Vec<HWND> {
    let mut list: Vec<HWND> = Vec::new();
    unsafe {
        EnumWindows(Some(collect), &mut list as *mut Vec<HWND> as LPARAM);
    }
    list
}

pub(crate) fn process_of(window: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(window, &mut pid);
    }
    pid
}

pub fn image_path(pid: u32) -> String {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return String::new();
        }
        let mut small = [0u16; 1024];
        let mut path = query_image(process, &mut small);
        if path.is_none() && GetLastError() == ERROR_INSUFFICIENT_BUFFER {
            path = query_image(process, &mut vec![0u16; 32768]);
        }
        CloseHandle(process);
        path.unwrap_or_default()
    }
}

unsafe fn query_image(process: HANDLE, buffer: &mut [u16]) -> Option<String> {
    let mut length = buffer.len() as u32;
    (QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) != 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
}

pub(crate) fn process_name(window: HWND) -> String {
    let path = image_path(process_of(window));
    Path::new(&path).file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default()
}

pub(crate) fn window_text(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

pub(crate) fn class_name(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(window, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

pub(crate) fn is_root(window: HWND) -> bool {
    !window.is_null() && unsafe { GetAncestor(window, GA_ROOT) } == window
}

pub(crate) fn window_rect(window: HWND) -> Option<RECT> {
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    (unsafe { GetWindowRect(window, &mut rect) } != 0).then_some(rect)
}

pub(crate) fn client_rect(window: HWND) -> Option<RECT> {
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    (unsafe { GetClientRect(window, &mut rect) } != 0).then_some(rect)
}

pub(crate) fn client_origin(window: HWND) -> Option<POINT> {
    let mut origin = POINT { x: 0, y: 0 };
    (unsafe { ClientToScreen(window, &mut origin) } != 0).then_some(origin)
}

pub(crate) fn cloaked(window: HWND) -> bool {
    let mut value = 0i32;
    let result = unsafe { DwmGetWindowAttribute(window, DWMWA_CLOAKED as u32, &mut value as *mut i32 as *mut c_void, size_of::<i32>() as u32) };
    result == 0 && value != 0
}

pub fn null_window() -> HWND {
    null_mut()
}

pub fn file_version(path: &Path) -> Option<[u32; 4]> {
    let name = wide(&path.to_string_lossy());
    let mut handle = 0u32;
    let size = unsafe { GetFileVersionInfoSizeW(name.as_ptr(), &mut handle) };
    if size == 0 || size > 1 << 20 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    if unsafe { GetFileVersionInfoW(name.as_ptr(), 0, size, data.as_mut_ptr() as *mut c_void) } == 0 {
        return None;
    }
    let root = wide("\\");
    let mut info: *mut c_void = null_mut();
    let mut length = 0u32;
    if unsafe { VerQueryValueW(data.as_ptr() as *const c_void, root.as_ptr(), &mut info, &mut length) } == 0 || info.is_null() || (length as usize) < size_of::<VS_FIXEDFILEINFO>() {
        return None;
    }
    let fixed = unsafe { std::ptr::read_unaligned(info as *const VS_FIXEDFILEINFO) };
    if fixed.dwSignature != 0xFEEF_04BD {
        return None;
    }
    Some([fixed.dwFileVersionMS >> 16, fixed.dwFileVersionMS & 0xFFFF, fixed.dwFileVersionLS >> 16, fixed.dwFileVersionLS & 0xFFFF])
}
