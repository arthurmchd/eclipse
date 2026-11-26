#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::{Map, Value};
use tauri::http::{header, Response, StatusCode};
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, Webview};
use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

use eclipse::application::app_ports::{save_leaving_session, AppPorts, Leaving};
use eclipse::application::language::{localize, main_text, normalize_language};
use eclipse::application::manager_service::{ManagerEvents, ManagerService};
use eclipse::application::notices::{error_notice, operation_notice, status_notice, Notice, Notifier, APP_NAME};
use eclipse::application::rank_api::RankApi;
use eclipse::application::rank_watcher::{RankHooks, RankWatcher, POLL_MS, RESAVE_MS};
use eclipse::application::refresher::{RefreshHooks, Refresher};
use eclipse::application::riot_wakeup::{RiotWakeup, WakeupTiming};
use eclipse::application::session_keeper::{KeeperHooks, KeeperTiming, SessionKeeper};
use eclipse::application::sign_in_service::{SignInObservers, SignInService};
use eclipse::application::store::{client_path, ServiceStore, Store};
use eclipse::application::timers::ThreadTimers;
use eclipse::application::updates::{checks_enabled, InstallOutcome, UpdateHooks, Updates, UPDATE_CHECKS};
use eclipse::integration::app_updater::AppUpdater;
use eclipse::integration::asset_protocol::{is_page, is_riot_logo, resolve, SCHEME, TOGGLE_PAGE};
use eclipse::integration::backend::archive_stamp;
use eclipse::integration::riot_logo::{read_logo, LogoCache};
use eclipse::integration::manager::manager_host::{Caller, ManagerHost, FAILED};
use eclipse::integration::overlay::overlay_window::{create, TOGGLE_LABEL};
use eclipse::integration::overlay::riot_overlay::{OverlayHooks, RiotOverlay};
use eclipse::paths::{data_dir, project_root, user_data_dir};
use eclipse::platform::windows::dpapi::Dpapi;
use eclipse::platform::windows::electron_instance::electron_running;
use eclipse::platform::windows::observer_thread::NativeObserver;
use eclipse::platform::windows::riot_window_observer::{ObserverHooks, RiotWindowObserver};
use eclipse::platform::windows::safe_storage::SafeStorage;
use eclipse::platform::windows::start_with_windows::{StartWithWindows, UserRegistry};
use eclipse::platform::windows::toasts::{app_id, WindowsToasts};
use eclipse::platform::windows::window_controller::CREATE_NO_WINDOW;
use eclipse::riot::riot_client::{detect_client_path, running_games, RiotClient};
use eclipse::riot::{Cancel, RiotId};

const OPENING_BLOCKED: &str = "The game is opening. Wait or cancel from the tray.";
const NO_CLIENT: &str = "Riot Client not found. Install the official client before starting Eclipse.";
const NO_DATA: &str = "Eclipse could not find its data folder.";
const NO_DEVELOPMENT_DATA: &str = "Set ECLIPSE_DATA_DIR to an absolute folder to run Eclipse from the project.";

struct Eclipse {
    store: Arc<Mutex<Store>>,
    riot: Arc<RiotClient>,
    sign_in: Arc<SignInService>,
    refresher: Arc<Refresher>,
    keeper: Arc<SessionKeeper>,
    wakeup: RiotWakeup,
    watcher: Arc<RankWatcher>,
    host: Arc<ManagerHost>,
    overlay: Arc<OnceLock<RiotOverlay>>,
    opening: Mutex<()>,
    startup: Arc<StartWithWindows>,
    updates: Updates,
    ready: Arc<AtomicBool>,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

fn alert(title: &str, text: &str) {
    unsafe {
        MessageBoxW(std::ptr::null_mut(), wide(text).as_ptr(), wide(title).as_ptr(), MB_OK | MB_ICONERROR);
    }
}

fn open_link(url: &str) -> Result<(), String> {
    Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]).creation_flags(CREATE_NO_WINDOW).spawn().map(|_| ()).map_err(|error| error.to_string())
}

impl Eclipse {
    fn language(&self) -> &'static str {
        normalize_language(self.store.lock().unwrap().data.settings.get("language").and_then(Value::as_str))
    }

    fn log(&self, line: &str) {
        self.store.lock().unwrap().sign_in_log(line);
    }

    fn open_riot(&self, accounts: bool) {
        let Ok(_opening) = self.opening.try_lock() else {
            return;
        };
        let operation = self.sign_in.get_state();
        let running = operation.get("status").and_then(Value::as_str) == Some("running");
        let attention = operation.get("needsAttention") == Some(&Value::Bool(true));
        let result = if running && !attention { Err(OPENING_BLOCKED.to_string()) } else { self.riot.open_client(&client_path(&*self.store)).map_err(|error| error.message) };
        match result {
            Ok(()) => {
                if accounts && !attention {
                    if let Some(overlay) = self.overlay.get() {
                        overlay.open();
                    }
                }
            }
            Err(reason) => {
                self.log(&reason);
                let language = Some(self.language());
                let text = main_text(language);
                alert(APP_NAME, &format!("{}\n\n{}\n\n{}", text.open_failed, localize(&reason, language), text.open_failed_detail));
            }
        }
    }

    fn quit(&self) {
        self.updates.stop();
        self.refresher.stop();
        self.sign_in.cancel();
        self.keeper.stop();
        self.wakeup.stop();
        self.watcher.stop();
        if let Some(overlay) = self.overlay.get() {
            overlay.stop();
        }
        self.riot.dispose();
    }
}

fn build_menu(app: &AppHandle, language: &'static str, startup: Option<bool>, update: Option<String>, checks: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let text = main_text(Some(language));
    let accounts = MenuItem::with_id(app, "accounts", text.tray_accounts, true, None::<&str>)?;
    let riot = MenuItem::with_id(app, "riot", text.tray_open_riot, true, None::<&str>)?;
    let cancel = MenuItem::with_id(app, "cancel", text.tray_cancel, true, None::<&str>)?;
    let first = PredefinedMenuItem::separator(app)?;
    let second = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", text.tray_quit, true, None::<&str>)?;
    let install = update.map(|version| MenuItem::with_id(app, "update", format!("{}{version}", text.tray_update_to), true, None::<&str>)).transpose()?;
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&accounts, &riot, &cancel];
    if let Some(item) = &install {
        items.push(item);
    }
    items.push(&first);
    let start_with_windows = startup.map(|checked| CheckMenuItem::with_id(app, "startup", text.tray_start_with_windows, true, checked, None::<&str>)).transpose()?;
    if let Some(item) = &start_with_windows {
        items.push(item);
    }
    let update_checks = CheckMenuItem::with_id(app, "update-checks", text.tray_update_checks, true, checks, None::<&str>)?;
    items.push(&update_checks);
    items.push(&second);
    items.push(&quit);
    Menu::with_items(app, &items)
}

fn refresh_menu(app: &AppHandle, language: &'static str) {
    let Some(eclipse) = app.try_state::<Arc<Eclipse>>().map(|eclipse| eclipse.inner().clone()) else { return };
    let startup = eclipse.startup.available().then(|| eclipse.startup.enabled());
    let checks = checks_enabled(&eclipse.store.lock().unwrap().data.settings);
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("eclipse"), build_menu(app, language, startup, eclipse.updates.available(), checks)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn in_background(app: &AppHandle, task: impl FnOnce(Arc<Eclipse>) + Send + 'static) {
    if let Some(eclipse) = app.try_state::<Arc<Eclipse>>() {
        let eclipse = eclipse.inner().clone();
        std::thread::spawn(move || task(eclipse));
    }
}

fn open_accounts_when_ready(app: &AppHandle) {
    in_background(app, |eclipse| {
        if eclipse.ready.load(Ordering::SeqCst) {
            eclipse.open_riot(true);
        }
    });
}

#[tauri::command]
async fn manager(webview: Webview, eclipse: State<'_, Arc<Eclipse>>, method: String, args: Value) -> Result<Value, String> {
    let label = webview.label().to_string();
    let url = webview.url().ok().map(|url| url.to_string());
    let host = eclipse.host.clone();
    tauri::async_runtime::spawn_blocking(move || host.invoke(&Caller { label: &label, url: url.as_deref() }, &method, &args)).await.unwrap_or_else(|_| Err(FAILED.into()))
}

#[tauri::command]
async fn overlay_toggle(webview: Webview, eclipse: State<'_, Arc<Eclipse>>, hidden: bool) -> Result<bool, String> {
    let url = webview.url().ok().map(|url| url.to_string()).unwrap_or_default();
    let overlay = eclipse.overlay.get().cloned();
    match overlay {
        Some(overlay) if webview.label() == TOGGLE_LABEL && is_page(TOGGLE_PAGE, &url) => tauri::async_runtime::spawn_blocking(move || overlay.set_hidden(hidden)).await.map_err(|_| "Invalid toggle command".to_string()),
        _ => Err("Invalid toggle command".into()),
    }
}

static LOGO_CLIENT: OnceLock<String> = OnceLock::new();

fn riot_logo() -> Option<Vec<u8>> {
    static CACHE: OnceLock<LogoCache> = OnceLock::new();
    let client = LOGO_CLIENT.get()?;
    CACHE.get_or_init(|| LogoCache::new(Box::new(archive_stamp), Box::new(read_logo))).get(std::path::Path::new(client))
}

fn serve(uri: &str) -> Response<Vec<u8>> {
    let found = if is_riot_logo(uri) {
        riot_logo().map(|body| (body, "image/svg+xml"))
    } else {
        resolve(&project_root(), uri).and_then(|(file, kind)| fs::read(file).ok().map(|body| (body, kind)))
    };
    match found {
        Some((body, kind)) => Response::builder().header(header::CONTENT_TYPE, kind).header("X-Content-Type-Options", "nosniff").body(body),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()),
    }
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn start(app: &AppHandle) -> Result<(), String> {
    let dir = data_dir().ok_or(if cfg!(debug_assertions) { NO_DEVELOPMENT_DATA } else { NO_DATA })?;
    fs::create_dir_all(&dir).map_err(|_| NO_DATA.to_string())?;
    let store = Arc::new(Mutex::new(Store::open(&dir, Arc::new(SafeStorage::new(&dir, Box::new(Dpapi))))));
    let saved_path = client_path(&*store);
    let client = detect_client_path(&saved_path).ok_or(NO_CLIENT)?;
    let _ = LOGO_CLIENT.set(client.clone());
    let timers = Arc::new(ThreadTimers::new());
    let events = Arc::new(ManagerEvents::default());
    let riot = Arc::new(RiotClient::new());
    let overlay: Arc<OnceLock<RiotOverlay>> = Arc::new(OnceLock::new());
    let keeper_slot: Arc<OnceLock<Arc<SessionKeeper>>> = Arc::new(OnceLock::new());
    let watcher_slot: Arc<OnceLock<Arc<RankWatcher>>> = Arc::new(OnceLock::new());
    let seen_account: Arc<Mutex<Option<RiotId>>> = Arc::new(Mutex::new(None));
    let sign_in_slot: Arc<OnceLock<Arc<SignInService>>> = Arc::new(OnceLock::new());
    let publish = {
        let events = events.clone();
        move |channel: &str, payload: &Value| events.publish(channel, payload)
    };
    let sign_in_log = {
        let store = store.clone();
        move |line: &str| store.lock().unwrap().sign_in_log(line)
    };
    let language = {
        let store = store.clone();
        move || normalize_language(store.lock().unwrap().data.settings.get("language").and_then(Value::as_str))
    };
    let notifier: Arc<dyn Notifier> = Arc::new(WindowsToasts::new(app_id(cfg!(debug_assertions), &app.config().identifier), {
        let app = app.clone();
        Arc::new(move || open_accounts_when_ready(&app))
    }));
    let observers = SignInObservers {
        status: Box::new({
            let (publish, notifier, language) = (publish.clone(), notifier.clone(), language.clone());
            move |payload| {
                publish("sign-in-status", payload);
                if let Some(notice) = status_notice(payload, Some(language())) {
                    notifier.show(&notice);
                }
            }
        }),
        operation_updated: Box::new({
            let (publish, overlay, keeper, notifier, language) = (publish.clone(), overlay.clone(), keeper_slot.clone(), notifier.clone(), language.clone());
            move |operation| {
                publish("sign-in-operation", operation);
                if let Some(notice) = operation_notice(operation, Some(language())) {
                    notifier.show(&notice);
                }
                if let Some(overlay) = overlay.get() {
                    overlay.set_operation(operation);
                }
                if operation.get("status").and_then(Value::as_str) != Some("running") {
                    if let Some(keeper) = keeper.get() {
                        keeper.check();
                    }
                }
            }
        }),
        account_updated: Box::new({
            let publish = publish.clone();
            move |account| publish("account-updated", &Value::Object(account.clone()))
        }),
        log: Box::new(sign_in_log.clone()),
        on_closed: Box::new({
            let (store, keeper, publish, log) = (store.clone(), keeper_slot.clone(), publish.clone(), sign_in_log.clone());
            move |closed| {
                let keep = |yaml: &str| keeper.get().map(|keeper| keeper.keep(yaml)).unwrap_or(Ok(None));
                let current = store.lock().unwrap().data.current_account_id.clone();
                let published = |account: Map<String, Value>| publish("account-updated", &Value::Object(account));
                save_leaving_session(closed, Leaving { keep: &keep, store: &*store, current, publish: &published, log: &log })
            }
        }),
        translate: Box::new({
            let language = language.clone();
            move |text| localize(text, Some(language()))
        }),
        ..SignInObservers::default()
    };
    let sign_in = Arc::new(SignInService::new(store.clone(), riot.clone(), timers.clone(), observers));
    let _ = sign_in_slot.set(sign_in.clone());
    let busy = {
        let sign_in = sign_in.clone();
        move || sign_in.is_busy()
    };
    let api = Arc::new(RankApi::live());
    let refresher = Arc::new(Refresher::new(
        store.clone(),
        timers.clone(),
        RefreshHooks {
            refresh_account: Box::new(move |account, keys| api.refresh_account(account, keys).fields),
            check_game: Box::new({
                let watcher = watcher_slot.clone();
                move || watcher.get().is_some_and(|watcher| watcher.check())
            }),
            publish: Box::new(publish.clone()),
            now: Box::new(|| chrono::Utc::now().timestamp_millis()),
        },
    ));
    let startup = Arc::new(StartWithWindows::new(Arc::new(UserRegistry), std::env::current_exe().unwrap_or_default(), APP_NAME, !cfg!(debug_assertions), {
        let store = store.clone();
        Box::new(move |line| store.lock().unwrap().log(line))
    }));
    let updates = Updates::new(
        Arc::new(AppUpdater::new(
            app.clone(),
            Arc::new({
                let app = app.clone();
                move || {
                    if let Some(eclipse) = app.try_state::<Arc<Eclipse>>() {
                        eclipse.quit();
                    }
                }
            }),
        )),
        timers.clone(),
        UpdateHooks {
            enabled: Box::new({
                let store = store.clone();
                move || checks_enabled(&store.lock().unwrap().data.settings)
            }),
            busy: Box::new({
                let sign_in = sign_in.clone();
                move || sign_in.is_busy()
            }),
            on_available: Box::new({
                let (app, notifier, language) = (app.clone(), notifier.clone(), language.clone());
                move |version| {
                    let language = language();
                    let text = main_text(Some(language));
                    notifier.show(&Notice { title: text.update_title.to_string(), text: format!("{}{version}", text.update_available) });
                    refresh_menu(&app, language);
                }
            }),
            log: Box::new({
                let store = store.clone();
                move |line| store.lock().unwrap().log(line)
            }),
            spawn: Box::new(|task| {
                std::thread::spawn(task);
            }),
        },
    );
    let app_handle = app.clone();
    let ports = AppPorts {
        sign_in: sign_in.clone(),
        refresher: refresher.clone(),
        running_games: Box::new(|| running_games().map_err(|error| error.message)),
        open_external: Box::new(open_link),
        settings_changed: Box::new({
            let overlay = overlay.clone();
            move |settings| {
                let language = normalize_language(settings.get("language").and_then(Value::as_str));
                refresh_menu(&app_handle, language);
                if let Some(overlay) = overlay.get() {
                    overlay.set_language(language);
                }
            }
        }),
        seen_account: Box::new({
            let seen = seen_account.clone();
            move || seen.lock().unwrap().clone()
        }),
        startup: Box::new({
            let startup = startup.clone();
            move |turn| {
                if !startup.available() {
                    return None;
                }
                Some(match turn {
                    Some(on) => startup.set(on),
                    None => startup.enabled(),
                })
            }
        }),
        version: app.package_info().version.to_string(),
    };
    let service = Arc::new(ManagerService::new(store.clone(), Arc::new(ports), events.clone()));
    let host = Arc::new(ManagerHost::new(
        Box::new(move |method, args| service.dispatch(method, args).map_err(|failure| failure.message)),
        Box::new({
            let overlay = overlay.clone();
            move |action| overlay.get().is_some_and(|overlay| overlay.window_action(action))
        }),
    ));
    let keeper = Arc::new(SessionKeeper::new(
        riot.clone(),
        store.clone(),
        timers.clone(),
        KeeperHooks {
            busy: Box::new(busy.clone()),
            log: Box::new(sign_in_log.clone()),
            on_saved: Box::new({
                let (store, publish) = (store.clone(), publish.clone());
                move |id| {
                    if let Some(account) = store.public_account(id) {
                        publish("account-updated", &Value::Object(account));
                    }
                }
            }),
        },
        KeeperTiming::default(),
    ));
    let _ = keeper_slot.set(keeper.clone());
    keeper.start();
    let wakeup = RiotWakeup::new(riot.clone(), Box::new(busy.clone()), Box::new(sign_in_log.clone()), timers.clone(), WakeupTiming::default());
    wakeup.start();
    let watcher = Arc::new(RankWatcher::new(
        riot.clone(),
        store.clone(),
        timers.clone(),
        RankHooks {
            busy: Box::new(busy),
            log: Box::new({
                let store = store.clone();
                move |line| store.lock().unwrap().log(line)
            }),
            on_updated: Box::new({
                let publish = publish.clone();
                move |account| publish("account-updated", &Value::Object(account.clone()))
            }),
            on_unsaved: Box::new({
                let seen = seen_account.clone();
                move |riot_id| *seen.lock().unwrap() = Some(riot_id.clone())
            }),
            now: Box::new(|| chrono::Utc::now().timestamp_millis()),
        },
        POLL_MS,
        RESAVE_MS,
    ));
    let _ = watcher_slot.set(watcher.clone());
    watcher.start();
    let ready = Arc::new(AtomicBool::new(false));
    let eclipse = Arc::new(Eclipse { store, riot: riot.clone(), sign_in, refresher: refresher.clone(), keeper, wakeup, watcher, host: host.clone(), overlay: overlay.clone(), opening: Mutex::new(()), startup, updates: updates.clone(), ready: ready.clone() });
    app.manage(eclipse.clone());
    let window = Arc::new(create(app, host, Arc::new(sign_in_log.clone())).map_err(|error| error.to_string())?);
    let handle = window.handle();
    let (reader, closer) = (riot.clone(), riot.clone());
    let riot_overlay = RiotOverlay::new(
        window,
        timers.clone(),
        OverlayHooks {
            read_authentication_state: Box::new(move |cancel: &Cancel| reader.read_login_screen_state(Some(cancel)).map_err(|_| ())),
            close_client: Box::new(move || closer.close_client().map_err(|_| ())),
            now: Box::new(|| chrono::Utc::now().timestamp_millis() as f64),
        },
    );
    riot_overlay.set_language(language());
    let _ = overlay.set(riot_overlay.clone());
    let observer = Arc::new(RiotWindowObserver::new(
        Arc::new(NativeObserver),
        std::process::id(),
        timers.clone(),
        ObserverHooks {
            on_state: Box::new({
                let overlay = riot_overlay.clone();
                move |target| overlay.on_state(target)
            }),
            on_error: Box::new({
                let (log, notifier, language) = (sign_in_log.clone(), notifier.clone(), language.clone());
                move |message| {
                    log(message);
                    notifier.show(&error_notice(message, Some(language())));
                }
            }),
            now: Box::new(|| chrono::Utc::now().timestamp_millis() as f64),
        },
    ));
    let startup_state = eclipse.startup.available().then(|| eclipse.startup.enabled());
    let checks = checks_enabled(&eclipse.store.lock().unwrap().data.settings);
    let menu = build_menu(app, eclipse.language(), startup_state, None, checks).map_err(|error| error.to_string())?;
    let mut tray = TrayIconBuilder::with_id("eclipse")
        .tooltip(APP_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "accounts" => in_background(app, |eclipse| eclipse.open_riot(true)),
            "riot" => in_background(app, |eclipse| eclipse.open_riot(false)),
            "cancel" => in_background(app, |eclipse| {
                eclipse.sign_in.cancel();
            }),
            "startup" => {
                let app = app.clone();
                in_background(&app.clone(), move |eclipse| {
                    eclipse.startup.set(!eclipse.startup.enabled());
                    refresh_menu(&app, eclipse.language());
                });
            }
            "update" => in_background(app, |eclipse| {
                let text = main_text(Some(eclipse.language()));
                match eclipse.updates.install() {
                    InstallOutcome::Busy => alert(APP_NAME, text.update_busy),
                    InstallOutcome::Failed => alert(APP_NAME, text.update_failed),
                    InstallOutcome::Started | InstallOutcome::NoUpdate => {}
                }
            }),
            "update-checks" => {
                let app = app.clone();
                in_background(&app.clone(), move |eclipse| {
                    let enabled = {
                        let mut store = eclipse.store.lock().unwrap();
                        let enabled = !checks_enabled(&store.data.settings);
                        store.data.settings.insert(UPDATE_CHECKS.to_string(), Value::Bool(enabled));
                        let _ = store.save();
                        enabled
                    };
                    refresh_menu(&app, eclipse.language());
                    if enabled {
                        eclipse.updates.check_now();
                    }
                });
            }
            "quit" => {
                let app = app.clone();
                in_background(&app.clone(), move |eclipse| {
                    eclipse.quit();
                    app.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
                in_background(tray.app_handle(), |eclipse| eclipse.open_riot(true));
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app).map_err(|error| error.to_string())?;
    std::thread::spawn(move || {
        riot_overlay.start(observer.clone());
        observer.start(&client, Some(&handle));
        refresher.start();
        updates.start();
        ready.store(true, Ordering::SeqCst);
    });
    Ok(())
}

fn main() {
    if user_data_dir().is_some_and(|dir| electron_running(&dir)) {
        alert(APP_NAME, main_text(None).old_eclipse_open);
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| open_accounts_when_ready(app)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol(SCHEME, |_context, request| serve(&request.uri().to_string()))
        .invoke_handler(tauri::generate_handler![manager, overlay_toggle])
        .setup(|app| {
            if let Err(reason) = start(app.handle()) {
                alert(APP_NAME, &localize(&reason, None));
                app.handle().exit(1);
            }
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
