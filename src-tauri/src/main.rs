#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

use eclipse::application::language::main_text;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let text = main_text(None);
            let quit = MenuItem::with_id(app, "quit", text.tray_quit, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let mut tray = TrayIconBuilder::with_id("eclipse").tooltip("Eclipse").menu(&menu).on_menu_event(|app, event| {
                if event.id.as_ref() == "quit" {
                    app.exit(0);
                }
            });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Eclipse could not start")
        .run(|_, event| {
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                api.prevent_exit();
            }
        });
}
