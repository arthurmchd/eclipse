use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::application::updates::{UpdateFailure, UpdateSource};

pub const ENDPOINT: &str = "https://github.com/arthurmchd/eclipse/releases/latest/download/latest.json";
pub const TIMEOUT_SECS: u64 = 30;

pub struct AppUpdater<R: Runtime> {
    app: AppHandle<R>,
    before_exit: Arc<dyn Fn() + Send + Sync>,
    pending: Mutex<Option<Update>>,
}

impl<R: Runtime> AppUpdater<R> {
    pub fn new(app: AppHandle<R>, before_exit: Arc<dyn Fn() + Send + Sync>) -> Self {
        Self { app, before_exit, pending: Mutex::new(None) }
    }
}

impl<R: Runtime> UpdateSource for AppUpdater<R> {
    fn check(&self) -> Result<Option<String>, UpdateFailure> {
        let before_exit = self.before_exit.clone();
        let updater = self.app.updater_builder().timeout(Duration::from_secs(TIMEOUT_SECS)).on_before_exit(move || before_exit()).build().map_err(|_| UpdateFailure)?;
        let found = tauri::async_runtime::block_on(updater.check()).map_err(|_| UpdateFailure)?;
        let version = found.as_ref().map(|update| update.version.clone());
        *self.pending.lock().map_err(|_| UpdateFailure)? = found;
        Ok(version)
    }

    fn install(&self) -> Result<(), UpdateFailure> {
        let update = self.pending.lock().map_err(|_| UpdateFailure)?.take().ok_or(UpdateFailure)?;
        tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {})).map_err(|_| UpdateFailure)
    }
}
