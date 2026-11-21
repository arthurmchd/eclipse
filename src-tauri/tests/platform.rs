#[path = "platform/windows/electron_instance.rs"]
mod electron_instance;
#[path = "platform/windows/login_form.rs"]
mod login_form;
#[path = "platform/windows/observer_thread.rs"]
mod observer_thread;
#[path = "platform/windows/riot_window_observer.rs"]
mod riot_window_observer;
#[path = "platform/windows/safe_storage.rs"]
mod safe_storage;
#[path = "platform/windows/start_with_windows.rs"]
mod start_with_windows;
#[path = "platform/windows/toasts.rs"]
mod toasts;
#[path = "platform/windows/window_controller.rs"]
mod window_controller;
#[path = "platform/windows/window_guard.rs"]
mod window_guard;
#[path = "platform/windows/win32.rs"]
mod win32;
#[path = "platform/windows/windows_environment.rs"]
mod windows_environment;
#[path = "support/manual_timers.rs"]
mod manual_timers;

pub use manual_timers::ManualTimers;
