use std::sync::Arc;

use tauri_winrt_notification::Toast;

use crate::application::notices::{Notice, Notifier};

pub fn app_id(debug: bool, identifier: &str) -> String {
    if debug {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        identifier.to_string()
    }
}

pub struct WindowsToasts {
    app_id: String,
    on_click: Arc<dyn Fn() + Send + Sync>,
}

impl WindowsToasts {
    pub fn new(app_id: String, on_click: Arc<dyn Fn() + Send + Sync>) -> Self {
        Self { app_id, on_click }
    }
}

impl Notifier for WindowsToasts {
    fn show(&self, notice: &Notice) {
        let (click, app_id, notice) = (self.on_click.clone(), self.app_id.clone(), notice.clone());
        std::thread::spawn(move || {
            let toast = Toast::new(&app_id).title(&notice.title).text1(&notice.text).sound(None).on_activated(move |_| {
                let click = click.clone();
                std::thread::spawn(move || click());
                Ok(())
            });
            let _ = toast.show();
        });
    }
}
