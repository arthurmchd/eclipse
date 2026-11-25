use std::sync::{Arc, Mutex};

use eclipse::integration::overlay::overlay_toggle::toggle_rect;
use eclipse::integration::overlay::riot_overlay::{
    cards_left, cards_rect, corner_insets, corner_radius, cover_rect, overlay_bounds, overlay_shape, top_edge, OverlayHooks, OverlayObserver, OverlayWindow, Rect, RiotOverlay, ShapeOptions, Size, CHECK_FRESH_MS, LAYOUT_MS, REST_AFTER_MS,
};
use eclipse::platform::windows::riot_window_observer::{Target, PANEL_POINT};
use eclipse::riot::riot_app_controls::CloseMode;
use eclipse::riot::riot_authentication::{AuthKind, AuthState};
use serde_json::json;

use super::ManualTimers;

#[derive(Default)]
struct Window {
    events: Mutex<Vec<String>>,
    size: Mutex<Option<Size>>,
    region: Mutex<Vec<Rect>>,
    regions: Mutex<usize>,
    placed: Mutex<usize>,
    visible: Mutex<bool>,
    shows: Mutex<usize>,
    hides: Mutex<usize>,
}

impl Window {
    fn push(&self, event: String) {
        self.events.lock().unwrap().push(event);
    }

    fn visible(&self) -> bool {
        *self.visible.lock().unwrap()
    }

    fn size(&self) -> Size {
        self.size.lock().unwrap().unwrap()
    }

    fn region(&self) -> Vec<Rect> {
        self.region.lock().unwrap().clone()
    }

    fn regions(&self) -> usize {
        *self.regions.lock().unwrap()
    }

    fn placed(&self) -> usize {
        *self.placed.lock().unwrap()
    }

    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }

    fn clear(&self) {
        self.events.lock().unwrap().clear();
    }
}

impl OverlayWindow for Window {
    fn set_size(&self, size: Size) {
        *self.size.lock().unwrap() = Some(size);
        *self.placed.lock().unwrap() += 1;
        self.push("size".into());
    }

    fn set_region(&self, parts: &[Rect]) {
        *self.region.lock().unwrap() = parts.to_vec();
        *self.regions.lock().unwrap() += 1;
        self.push("shape".into());
    }

    fn show_inactive(&self) {
        *self.visible.lock().unwrap() = true;
        *self.shows.lock().unwrap() += 1;
        self.push("show".into());
    }

    fn hide(&self) {
        *self.visible.lock().unwrap() = false;
        *self.hides.lock().unwrap() += 1;
        self.push("hide".into());
    }

    fn set_resting(&self, resting: bool) {
        self.push(format!("rest {resting}"));
    }

    fn set_cover_visible(&self, visible: bool) {
        self.push(format!("cover {visible}"));
    }

    fn set_toggle_visible(&self, visible: bool) {
        self.push(format!("toggle {visible}"));
    }

    fn set_toggle_language(&self, language: &str) {
        self.push(format!("language {language}"));
    }

    fn begin_drag(&self) {
        self.push("drag".into());
    }

    fn close(&self) {
        *self.visible.lock().unwrap() = false;
        self.push("close".into());
    }
}

#[derive(Default)]
struct Observer {
    commands: Mutex<Vec<String>>,
    stopped: Mutex<bool>,
}

impl OverlayObserver for Observer {
    fn command(&self, name: &str) -> bool {
        self.commands.lock().unwrap().push(name.into());
        true
    }

    fn stop(&self) {
        *self.stopped.lock().unwrap() = true;
    }
}

type Answer = Result<Option<AuthState>, ()>;

struct Riot {
    answer: Mutex<Answer>,
    calls: Mutex<usize>,
    close: Mutex<Result<CloseMode, ()>>,
    closes: Mutex<usize>,
    time: Mutex<f64>,
}

impl Riot {
    fn new() -> Arc<Self> {
        Arc::new(Self { answer: Mutex::new(Ok(Some(AuthState::of(AuthKind::Auth)))), calls: Mutex::new(0), close: Mutex::new(Ok(CloseMode::Background)), closes: Mutex::new(0), time: Mutex::new(1000.0) })
    }

    fn answer(&self, answer: Answer) {
        *self.answer.lock().unwrap() = answer;
    }

    fn calls(&self) -> usize {
        *self.calls.lock().unwrap()
    }

    fn advance(&self, ms: f64) {
        *self.time.lock().unwrap() += ms;
    }
}

struct Setup {
    overlay: RiotOverlay,
    window: Arc<Window>,
    observer: Arc<Observer>,
    riot: Arc<Riot>,
    timers: Arc<ManualTimers>,
}

impl Setup {
    fn new() -> Self {
        let window = Arc::new(Window::default());
        let observer = Arc::new(Observer::default());
        let riot = Riot::new();
        let timers = ManualTimers::new();
        let (read, close, now) = (riot.clone(), riot.clone(), riot.clone());
        let hooks = OverlayHooks {
            read_authentication_state: Box::new(move |cancel| {
                *read.calls.lock().unwrap() += 1;
                assert!(!cancel.is_cancelled());
                *read.answer.lock().unwrap()
            }),
            close_client: Box::new(move || {
                *close.closes.lock().unwrap() += 1;
                *close.close.lock().unwrap()
            }),
            now: Box::new(move || *now.time.lock().unwrap()),
        };
        let overlay = RiotOverlay::new(window.clone(), timers.clone(), hooks);
        Self { overlay, window, observer, riot, timers }
    }

    fn started() -> Self {
        let setup = Self::new();
        setup.overlay.start(setup.observer.clone());
        setup
    }

    fn checks(&self) {
        self.timers.run_all(0, 20);
    }

    fn tick(&self) {
        let timer = self.timers.take(|timer| timer.ms == LAYOUT_MS && !timer.cancelled).expect("the layout timer runs");
        ManualTimers::run(timer);
    }

    fn sample(&self, target: Option<Target>) {
        self.overlay.on_state(target);
    }
}

fn target(id: &str, x: i32, y: i32, width: i32, height: i32) -> Target {
    Target { id: id.into(), x, y, width, height, corner: None, minimized: false, dimmed: false, form_hidden: false }
}

fn cornered(corner: i32) -> Target {
    Target { corner: Some(corner), ..target("1", 0, 0, 1536, 864) }
}

fn shape(size: Size, change: impl FnOnce(&mut ShapeOptions)) -> Vec<Rect> {
    let mut options = ShapeOptions::default();
    change(&mut options);
    overlay_shape(size, options)
}

fn plain(size: Size) -> Vec<Rect> {
    overlay_shape(size, ShapeOptions::default())
}

fn inside(parts: &[Rect], x: i32, y: i32) -> bool {
    parts.iter().any(|part| part.contains(x, y))
}

fn area(parts: &[Rect]) -> i64 {
    parts.iter().map(|part| part.width as i64 * part.height as i64).sum()
}

const SIZES: [(i32, i32); 6] = [(640, 360), (1024, 576), (1280, 720), (1536, 864), (1920, 1080), (2560, 1440)];

#[test]
fn cards_follow_the_riot_window_in_physical_pixels_keep_the_login_column_free_and_reshape_only_when_needed() {
    let setup = Setup::new();
    setup.overlay.set_language("en");
    setup.overlay.start(setup.observer.clone());
    setup.overlay.set_language("pt");
    setup.overlay.set_language("xx");
    let languages: Vec<String> = setup.window.events().into_iter().filter(|event| event.starts_with("language")).collect();
    assert_eq!(languages, ["language en", "language pt", "language pt"]);
    setup.sample(Some(target("1", -1920, 0, 1600, 1000)));
    assert!(!setup.window.visible());
    setup.checks();
    assert!(setup.window.visible());
    assert_eq!(setup.window.size(), Size { width: 1600, height: 1000 });
    assert_eq!(cards_rect(setup.window.size()), Rect::new(cards_left(1600), 0, 1600 - cards_left(1600), 1000));
    assert_eq!(setup.window.region(), plain(setup.window.size()));
    let regions = setup.window.regions();
    setup.sample(Some(target("1", -1700, 120, 1600, 1000)));
    assert_eq!(setup.window.size(), Size { width: 1600, height: 1000 });
    assert_eq!(setup.window.regions(), regions);
    setup.sample(Some(Target { corner: Some(16), ..target("1", -1700, 120, 1600, 1000) }));
    assert_eq!(setup.window.region(), shape(setup.window.size(), |options| {
        options.top = 1;
        options.corner = 15.0;
    }));
    let rounded = setup.window.regions();
    setup.sample(Some(Target { corner: Some(16), ..target("1", -1600, 120, 1600, 1000) }));
    assert_eq!(setup.window.regions(), rounded);
    setup.sample(Some(target("1", -1920, 0, 1600, 1000)));
    assert_eq!(setup.window.region(), plain(setup.window.size()));
    setup.overlay.set_operation(&json!({ "status": "running" }));
    assert!(setup.window.visible());
    setup.overlay.set_operation(&json!({ "status": "running", "signedIn": true }));
    assert!(!setup.window.visible());
    setup.overlay.set_operation(&json!({ "status": "failed", "signedIn": true }));
    assert!(setup.window.visible());
    setup.sample(Some(target("1", -1920, 0, 1600, 1400)));
    assert!(setup.window.visible());
    assert_eq!(setup.window.region(), plain(setup.window.size()));
    setup.sample(Some(target("1", -1920, 0, 1600, 1000)));
    assert!(setup.overlay.set_hidden(true));
    assert_eq!(setup.window.region(), [toggle_rect(setup.window.size())]);
    setup.sample(Some(target("1", -1920, 0, 1600, 1400)));
    assert_eq!(setup.window.region(), [toggle_rect(setup.window.size())]);
    assert!(setup.window.visible());
    assert!(!setup.overlay.set_hidden(false));
    assert_eq!(setup.window.region(), plain(setup.window.size()));
    setup.sample(None);
    assert!(!setup.window.visible());
    setup.sample(Some(target("2", 0, 0, 1600, 1000)));
    setup.checks();
    assert!(setup.window.visible());
    setup.overlay.stop();
    assert!(*setup.observer.stopped.lock().unwrap());
    assert_eq!(setup.window.events().last().unwrap(), "close");
    assert!(setup.timers.all_cancelled());
}

#[test]
fn dragging_riot_asks_nothing_of_the_window_because_the_helper_moves_it_and_only_a_new_size_does() {
    let setup = Setup::started();
    setup.sample(Some(target("1", 100, 100, 1600, 1000)));
    setup.checks();
    assert!(setup.window.visible());
    assert_eq!(setup.window.placed(), 1);
    setup.window.clear();
    for step in 1..=50 {
        setup.sample(Some(target("1", 100 + step * 7, 100 - step * 3, 1600, 1000)));
    }
    assert!(setup.window.events().is_empty());
    setup.sample(Some(target("1", 450, -50, 1280, 720)));
    assert_eq!(setup.window.events(), ["size", "shape"]);
    assert_eq!(setup.window.size(), Size { width: 1280, height: 720 });
    assert_eq!(setup.window.placed(), 2);
    setup.sample(Some(target("1", 451, -50, 1280, 720)));
    assert_eq!(setup.window.placed(), 2);
}

#[test]
fn only_the_login_session_shows_cards_including_manual_login_logout_and_stale_replies() {
    let setup = Setup::started();
    let first = target("1", 0, 0, 1536, 864);
    assert_eq!(setup.riot.calls(), 0);
    setup.sample(Some(first.clone()));
    assert!(!setup.window.visible());
    setup.checks();
    assert!(setup.window.visible());
    for managed in [false, true] {
        if managed {
            setup.overlay.set_operation(&json!({ "status": "running" }));
        }
        setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Authenticated))));
        setup.tick();
        setup.checks();
        assert!(!setup.window.visible());
        setup.overlay.open();
        setup.checks();
        assert!(!setup.window.visible());
        setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Auth))));
        setup.tick();
        setup.checks();
        assert!(setup.window.visible());
    }
    for answer in [Ok(None), Ok(Some(AuthState::of(AuthKind::Multifactor))), Ok(Some(AuthState::of(AuthKind::Challenge))), Ok(Some(AuthState::failed(AuthKind::Auth, "rate_limited"))), Err(())] {
        setup.riot.answer(answer);
        setup.tick();
        setup.checks();
        assert!(!setup.window.visible());
    }
    setup.riot.answer(Ok(Some(AuthState::failed(AuthKind::Error, "auth_failure"))));
    setup.tick();
    setup.checks();
    assert!(setup.window.visible());
    setup.tick();
    let waiting = setup.timers.take(|timer| timer.ms == 0 && !timer.cancelled).expect("a session check is pending");
    let calls = setup.riot.calls();
    setup.riot.advance(3000.0);
    setup.tick();
    assert!(setup.timers.take(|timer| timer.ms == 0 && !timer.cancelled).is_none());
    assert_eq!(setup.riot.calls(), calls);
    assert!(!setup.window.visible());
    setup.sample(None);
    setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Authenticated))));
    setup.sample(Some(Target { id: "2".into(), ..first.clone() }));
    setup.checks();
    setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Auth))));
    ManualTimers::run(waiting);
    assert_eq!(setup.riot.calls(), calls + 1);
    assert!(!setup.window.visible());
    setup.tick();
    let late = setup.timers.take(|timer| timer.ms == 0 && !timer.cancelled).expect("a session check is pending");
    setup.overlay.stop();
    ManualTimers::run(late);
    assert_eq!(setup.riot.calls(), calls + 1);
    assert!(!setup.window.visible());
    assert_eq!(setup.window.events().last().unwrap(), "close");
}

#[test]
fn a_minimized_riot_hides_the_cards_keeps_the_session_stops_the_login_reads_and_shows_them_again_right_on_restore() {
    let setup = Setup::started();
    let first = target("1", 0, 0, 1536, 864);
    setup.sample(Some(first.clone()));
    setup.checks();
    assert!(setup.window.visible());
    let placed = setup.window.size();
    let checked = setup.riot.calls();
    *setup.window.shows.lock().unwrap() = 0;
    let minimized = Target { x: -32000, y: -32000, minimized: true, ..first.clone() };
    setup.sample(Some(minimized.clone()));
    assert!(!setup.window.visible());
    for _ in 0..5 {
        setup.riot.advance(1000.0);
        setup.tick();
        setup.checks();
        setup.overlay.open();
        setup.checks();
    }
    assert_eq!(setup.riot.calls(), checked);
    assert_eq!(*setup.window.shows.lock().unwrap(), 0);
    assert_eq!(setup.window.size(), placed);
    setup.sample(Some(first.clone()));
    assert_eq!(*setup.window.shows.lock().unwrap(), 1);
    assert!(setup.window.visible());
    setup.checks();
    assert_eq!(setup.riot.calls(), checked + 1);
    assert_eq!(*setup.window.shows.lock().unwrap(), 1);
    assert!(setup.window.visible());
    setup.sample(Some(minimized.clone()));
    setup.riot.advance(1000.0);
    setup.sample(Some(first.clone()));
    assert_eq!(*setup.window.shows.lock().unwrap(), 2);
    setup.checks();
    assert_eq!(setup.riot.calls(), checked + 2);
    assert!(!setup.window.events().iter().any(|event| event.starts_with("rest")));
    setup.sample(Some(Target { minimized: true, ..first.clone() }));
    setup.overlay.set_operation(&json!({ "status": "running", "signedIn": true }));
    setup.overlay.set_operation(&json!(null));
    assert!(!setup.window.visible());
    setup.overlay.set_operation(&json!({ "status": "running", "signedIn": true }));
    setup.sample(Some(first.clone()));
    assert!(!setup.window.visible());
    setup.overlay.set_operation(&json!(null));
    assert!(setup.window.visible());
    setup.overlay.stop();
}

#[test]
fn the_webviews_rest_while_riot_is_closed_signed_in_or_past_the_login_and_wake_right_before_the_cards_show() {
    let flow = |setup: &Setup| -> Vec<String> { setup.window.events().into_iter().filter(|event| event == "hide" || event == "show" || event.starts_with("rest")).collect() };
    let setup = Setup::started();
    setup.tick();
    assert_eq!(flow(&setup), ["rest true"]);
    let first = target("1", 0, 0, 1536, 864);
    setup.window.clear();
    setup.sample(Some(first.clone()));
    assert!(flow(&setup).is_empty());
    setup.checks();
    assert_eq!(flow(&setup), ["rest false", "show"]);
    setup.window.clear();
    setup.overlay.set_operation(&json!({ "status": "running", "signedIn": true }));
    assert_eq!(flow(&setup), ["hide", "rest true"]);
    setup.window.clear();
    setup.overlay.set_operation(&json!(null));
    assert_eq!(flow(&setup), ["rest false", "show"]);
    setup.window.clear();
    setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Authenticated))));
    setup.tick();
    setup.checks();
    assert_eq!(flow(&setup), ["hide", "rest true"]);
    setup.window.clear();
    setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Auth))));
    setup.tick();
    setup.checks();
    assert_eq!(flow(&setup), ["rest false", "show"]);
    setup.window.clear();
    setup.riot.answer(Err(()));
    setup.tick();
    setup.checks();
    assert_eq!(flow(&setup), ["hide"]);
    setup.window.clear();
    setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Auth))));
    setup.tick();
    setup.checks();
    assert_eq!(flow(&setup), ["show"]);
    setup.window.clear();
    setup.sample(Some(Target { minimized: true, ..first.clone() }));
    setup.riot.advance(5000.0);
    setup.tick();
    setup.sample(Some(first.clone()));
    setup.checks();
    setup.sample(Some(Target { dimmed: true, ..first.clone() }));
    setup.sample(Some(first.clone()));
    assert_eq!(flow(&setup), ["hide", "show", "hide", "show"]);
    setup.window.clear();
    setup.sample(None);
    assert_eq!(flow(&setup), ["hide"]);
    setup.riot.advance(REST_AFTER_MS - 1.0);
    setup.tick();
    assert_eq!(flow(&setup), ["hide"]);
    setup.riot.advance(1.0);
    setup.tick();
    assert_eq!(flow(&setup), ["hide", "rest true"]);
    setup.window.clear();
    setup.sample(Some(first.clone()));
    setup.checks();
    assert_eq!(flow(&setup), ["rest false", "show"]);
    setup.overlay.stop();
}

#[test]
fn losing_the_riot_window_for_a_moment_hides_the_cards_without_resting_so_an_open_dialog_survives() {
    let rests = |setup: &Setup| setup.window.events().into_iter().filter(|event| event.starts_with("rest")).count();
    let setup = Setup::started();
    let first = target("1", 0, 0, 1536, 864);
    setup.sample(Some(first.clone()));
    setup.checks();
    assert!(setup.window.visible());
    setup.window.clear();
    for _ in 0..3 {
        setup.sample(None);
        assert!(!setup.window.visible());
        setup.riot.advance(LAYOUT_MS as f64);
        setup.tick();
        setup.sample(Some(first.clone()));
        setup.checks();
        assert!(setup.window.visible());
    }
    assert_eq!(rests(&setup), 0);
    setup.sample(None);
    setup.riot.advance(REST_AFTER_MS / 2.0);
    setup.tick();
    setup.sample(None);
    setup.riot.advance(REST_AFTER_MS / 2.0);
    setup.tick();
    assert_eq!(setup.window.events().iter().filter(|event| event.as_str() == "rest true").count(), 1);
    setup.overlay.stop();
}

#[test]
fn a_restore_after_a_long_minimize_shows_the_last_known_login_at_once_and_the_fresh_read_corrects_it() {
    let setup = Setup::started();
    let first = target("1", 0, 0, 1536, 864);
    setup.sample(Some(first.clone()));
    setup.checks();
    setup.sample(Some(Target { minimized: true, ..first.clone() }));
    setup.riot.advance(CHECK_FRESH_MS * 4.0);
    setup.tick();
    setup.riot.answer(Ok(Some(AuthState::of(AuthKind::Authenticated))));
    setup.sample(Some(first.clone()));
    assert!(setup.window.visible());
    setup.checks();
    assert!(!setup.window.visible());
    assert_eq!(setup.window.events().last().map(String::as_str), Some("rest true"));
    setup.riot.answer(Err(()));
    setup.sample(Some(Target { minimized: true, ..first.clone() }));
    setup.riot.advance(CHECK_FRESH_MS * 4.0);
    setup.sample(Some(first.clone()));
    assert!(!setup.window.visible());
    setup.overlay.stop();
}

#[test]
fn a_riot_dialog_over_the_login_screen_hides_the_cards_until_it_closes_without_losing_the_session() {
    let setup = Setup::started();
    let first = cornered(8);
    setup.sample(Some(first.clone()));
    setup.checks();
    assert!(setup.window.visible());
    let region = setup.window.region();
    *setup.window.shows.lock().unwrap() = 0;
    setup.sample(Some(Target { dimmed: true, ..first.clone() }));
    assert!(!setup.window.visible());
    let checked = setup.riot.calls();
    for _ in 0..4 {
        setup.riot.advance(1000.0);
        setup.tick();
        setup.checks();
    }
    assert!(setup.riot.calls() > checked);
    assert!(!setup.window.visible());
    setup.sample(Some(Target { dimmed: true, minimized: true, ..first.clone() }));
    setup.sample(Some(Target { dimmed: true, ..first.clone() }));
    assert!(!setup.window.visible());
    setup.sample(Some(first));
    assert!(setup.window.visible());
    assert_eq!(*setup.window.shows.lock().unwrap(), 1);
    assert_eq!(setup.window.region(), region);
    setup.overlay.stop();
}

#[test]
fn in_the_login_column_only_the_toggle_area_paints_and_takes_clicks_at_every_client_size() {
    for (width, height) in SIZES {
        let bounds = overlay_bounds(&target("1", -100, 50, width, height));
        assert_eq!(bounds, Rect::new(-100, 50, width, height));
        let size = Size { width, height };
        let left = cards_left(width);
        assert_eq!(left, (width as f64 * 400.0 / 1536.0).round() as i32);
        let toggle = toggle_rect(size);
        let scale = width as f64 / 1536.0;
        assert!(toggle.x as f64 >= 178.0 * scale);
        assert!(toggle.x + toggle.width <= (344.0 * scale).ceil() as i32 && toggle.x + toggle.width < left);
        assert!(toggle.y as f64 <= 426.0 * height as f64 / 864.0 && (toggle.y + toggle.height) as f64 >= 442.0 * height as f64 / 864.0);
        for hidden in [false, true] {
            let parts = shape(size, |options| options.hidden = hidden);
            let login: Vec<Rect> = parts.iter().copied().filter(|part| part.x < left).collect();
            assert_eq!(login, [toggle]);
            for part in parts {
                assert!(part.x >= 0 && part.y >= 0 && part.width > 0 && part.height > 0 && part.x + part.width <= width && part.y + part.height <= height);
            }
        }
        assert_eq!(shape(size, |options| options.hidden = true), [toggle]);
        assert_eq!(plain(size), [toggle, Rect::new(left, 0, width - left, height)]);
        assert_eq!(shape(size, |options| options.toggle = false), [Rect::new(left, 0, width - left, height)]);
        assert_eq!(shape(size, |options| {
            options.hidden = true;
            options.toggle = false;
        }), []);
    }
}

#[test]
fn the_cards_take_the_whole_art_area_including_where_riot_draws_its_own_window_controls() {
    for height in [240, 480, 864, 1200] {
        let size = Size { width: 1536, height };
        let left = cards_left(1536);
        let parts = plain(size);
        for offset in [1, 16, 48, 80] {
            assert!(inside(&parts, 1536 - offset, 48.min(height - 1)));
        }
        assert!(inside(&parts, 1535, 0) && inside(&parts, 1535, height - 1) && inside(&parts, left, 0));
        assert!(!inside(&parts, left - 1, 0) && !inside(&parts, 0, height - 1));
        assert_eq!(parts[1].width, 1136);
        assert_eq!(parts.len(), 2);
    }
}

#[test]
fn the_copies_of_the_riot_controls_minimize_and_close_the_way_the_riot_button_would_and_nothing_else() {
    let setup = Setup::started();
    setup.sample(Some(target("1", 0, 0, 1536, 864)));
    setup.checks();
    assert!(setup.overlay.window_action("minimize"));
    assert_eq!(*setup.observer.commands.lock().unwrap(), ["minimize"]);
    assert!(setup.overlay.window_action("close"));
    assert_eq!(*setup.observer.commands.lock().unwrap(), ["minimize"]);
    *setup.riot.close.lock().unwrap() = Ok(CloseMode::Quit);
    assert!(setup.overlay.window_action("close"));
    *setup.riot.close.lock().unwrap() = Err(());
    assert!(setup.overlay.window_action("close"));
    assert_eq!(*setup.observer.commands.lock().unwrap(), ["minimize", "close", "close"]);
    assert_eq!(*setup.riot.closes.lock().unwrap(), 3);
    for action in ["reveal", "quit", "maximize", ""] {
        assert!(!setup.overlay.window_action(action));
    }
    assert_eq!(setup.window.region(), plain(setup.window.size()));
    setup.overlay.stop();
    assert!(!setup.overlay.window_action("minimize"));
    assert!(!setup.overlay.window_action("close"));
    assert_eq!(*setup.observer.commands.lock().unwrap(), ["minimize", "close", "close"]);
    assert_eq!(*setup.riot.closes.lock().unwrap(), 3);
}

#[test]
fn a_press_on_the_cards_area_asks_the_window_to_drag_only_while_the_cards_are_shown() {
    let setup = Setup::started();
    let drags = |setup: &Setup| setup.window.events().iter().filter(|event| *event == "drag").count();
    assert!(!setup.overlay.window_action("drag"));
    setup.sample(Some(target("1", 0, 0, 1536, 864)));
    setup.checks();
    assert!(setup.window.visible());
    assert!(setup.overlay.window_action("drag"));
    assert_eq!(drags(&setup), 1);
    assert!(setup.observer.commands.lock().unwrap().is_empty());
    setup.overlay.set_hidden(true);
    assert!(!setup.overlay.window_action("drag"));
    setup.overlay.set_hidden(false);
    assert!(setup.overlay.window_action("drag"));
    assert_eq!(drags(&setup), 2);
    setup.overlay.stop();
    assert!(!setup.overlay.window_action("drag"));
    assert_eq!(drags(&setup), 2);
}

#[test]
fn before_start_there_is_no_observer_to_command() {
    let setup = Setup::new();
    assert!(!setup.overlay.window_action("minimize"));
    assert!(setup.timers.delays().is_empty());
    setup.overlay.start(setup.observer.clone());
    assert_eq!(setup.timers.delays(), [LAYOUT_MS]);
    setup.overlay.start(setup.observer.clone());
    assert_eq!(setup.timers.delays(), [LAYOUT_MS]);
}

#[test]
fn while_a_sign_in_runs_the_login_column_is_covered_and_the_toggle_hidden_until_riot_needs_the_user_or_the_sign_in_ends() {
    let setup = Setup::new();
    setup.overlay.set_operation(&json!({ "status": "running" }));
    setup.overlay.start(setup.observer.clone());
    let visible: Vec<String> = setup.window.events().into_iter().filter(|event| event.starts_with("cover") || event.starts_with("toggle")).collect();
    assert_eq!(&visible[visible.len() - 2..], ["cover true", "toggle false"]);
    setup.sample(Some(cornered(8)));
    setup.checks();
    assert!(setup.window.visible());
    let size = setup.window.size();
    let base = |options: &mut ShapeOptions| {
        options.top = 1;
        options.corner = 7.0;
    };
    let open = shape(size, base);
    let covered = shape(size, |options| {
        base(options);
        options.covered = true;
    });
    assert_eq!(setup.window.region(), covered);
    setup.window.clear();
    setup.overlay.set_operation(&json!({ "status": "running", "needsAttention": true }));
    assert_eq!(setup.window.region(), open);
    assert_eq!(setup.window.events(), ["shape", "cover false", "toggle true"]);
    setup.window.clear();
    setup.overlay.set_operation(&json!({ "status": "running", "needsAttention": false }));
    assert_eq!(setup.window.region(), covered);
    assert_eq!(setup.window.events(), ["cover true", "toggle false", "shape"]);
    setup.overlay.set_hidden(true);
    assert_eq!(setup.window.region(), shape(size, |options| {
        base(options);
        options.covered = true;
        options.hidden = true;
    }));
    setup.overlay.set_hidden(false);
    assert_eq!(setup.window.region(), covered);
    setup.overlay.set_operation(&json!({ "status": "running", "signedIn": true }));
    assert!(!setup.window.visible());
    setup.window.clear();
    for status in ["succeeded", "failed", "cancelled"] {
        setup.overlay.set_operation(&json!({ "status": "running" }));
        assert_eq!(setup.window.region(), covered);
        setup.overlay.set_operation(&json!({ "status": status, "needsAttention": status == "failed" }));
        assert_eq!(setup.window.region(), open);
    }
    setup.overlay.set_operation(&json!(null));
    let events = setup.window.events();
    let covers: Vec<&String> = events.iter().filter(|event| event.starts_with("cover")).collect();
    let toggles: Vec<&String> = events.iter().filter(|event| event.starts_with("toggle")).collect();
    assert_eq!(covers, ["cover false", "cover true", "cover false", "cover true", "cover false"]);
    assert_eq!(toggles, ["toggle true", "toggle false", "toggle true", "toggle false", "toggle true"]);
    assert!(setup.window.visible());
    setup.overlay.stop();
}

#[test]
fn the_toggle_leaves_with_the_riot_sign_in_form_comes_back_with_it_and_with_the_accounts_hidden_nothing_is_left_to_click() {
    let setup = Setup::started();
    let first = cornered(8);
    setup.sample(Some(first.clone()));
    setup.checks();
    assert!(setup.window.visible());
    let size = setup.window.size();
    let left = cards_left(1536);
    let shape_of = |change: &dyn Fn(&mut ShapeOptions)| {
        shape(size, |options| {
            options.top = 1;
            options.corner = 7.0;
            change(options);
        })
    };
    assert_eq!(setup.window.region(), shape_of(&|_| {}));
    setup.window.clear();
    let gone = Target { form_hidden: true, ..first.clone() };
    setup.sample(Some(gone.clone()));
    assert_eq!(setup.window.events(), ["toggle false", "shape"]);
    assert_eq!(setup.window.region(), shape_of(&|options| options.toggle = false));
    assert!(!setup.window.region().iter().any(|part| part.x < left));
    assert!(setup.window.visible());
    setup.sample(Some(gone.clone()));
    setup.sample(Some(first.clone()));
    assert_eq!(setup.window.events(), ["toggle false", "shape", "shape", "toggle true"]);
    setup.overlay.set_hidden(true);
    assert_eq!(setup.window.region(), shape_of(&|options| options.hidden = true));
    setup.window.clear();
    setup.sample(Some(gone.clone()));
    assert!(!setup.window.visible());
    setup.sample(Some(gone.clone()));
    assert!(!setup.window.visible());
    assert_eq!(setup.window.events(), ["toggle false", "hide"]);
    setup.sample(Some(first.clone()));
    assert!(setup.window.visible());
    assert_eq!(setup.window.region(), shape_of(&|options| options.hidden = true));
    setup.overlay.set_hidden(false);
    setup.window.clear();
    setup.overlay.set_operation(&json!({ "status": "running" }));
    setup.sample(Some(gone.clone()));
    assert_eq!(setup.window.events(), ["cover true", "toggle false", "shape", "shape"]);
    assert_eq!(setup.window.region(), shape_of(&|options| {
        options.covered = true;
        options.toggle = false;
    }));
    setup.window.clear();
    setup.overlay.set_operation(&json!({ "status": "failed", "needsAttention": true }));
    assert_eq!(setup.window.events(), ["shape", "cover false"]);
    assert_eq!(setup.window.region(), shape_of(&|options| options.toggle = false));
    assert!(setup.window.visible());
    setup.window.clear();
    setup.sample(Some(first.clone()));
    assert_eq!(setup.window.events(), ["shape", "toggle true"]);
    assert_eq!(setup.window.region(), shape_of(&|_| {}));
    setup.overlay.set_hidden(true);
    setup.overlay.set_operation(&json!({ "status": "running" }));
    setup.sample(Some(gone));
    assert!(setup.window.visible());
    assert_eq!(setup.window.region(), shape_of(&|options| {
        options.hidden = true;
        options.covered = true;
        options.toggle = false;
    }));
    setup.overlay.set_operation(&json!({ "status": "failed" }));
    assert!(!setup.window.visible());
    setup.sample(Some(first));
    assert!(setup.window.visible());
    assert_eq!(setup.window.region(), shape_of(&|options| options.hidden = true));
    setup.overlay.stop();
}

#[test]
fn the_cover_fills_the_login_column_except_where_the_observer_reads_the_riot_panel() {
    for (width, height) in SIZES {
        let size = Size { width, height };
        let left = cards_left(width);
        assert_eq!(cover_rect(size), Rect::new(0, 0, left, height));
        let panel = ((width as f64 * PANEL_POINT.0).round() as i32, (height as f64 * PANEL_POINT.1).round() as i32);
        for hidden in [false, true] {
            let parts = shape(size, |options| {
                options.hidden = hidden;
                options.covered = true;
            });
            assert_eq!(parts[0], toggle_rect(size));
            for dy in -4..=4 {
                for dx in -4..=4 {
                    assert!(!inside(&parts, panel.0 + dx, panel.1 + dy), "hole {width} {dx},{dy}");
                }
            }
            for (x, y) in [(panel.0 - 6, panel.1), (panel.0 + 6, panel.1), (panel.0, panel.1 - 6), (panel.0, panel.1 + 6), (0, 0), (left - 1, 0), (0, height - 1), (left - 1, height - 1), (left / 2, (height as f64 * 0.34).round() as i32)] {
                assert!(inside(&parts, x, y), "{width} {x},{y}");
            }
            let column: Vec<Rect> = parts[1..].iter().copied().filter(|part| part.x < left).collect();
            for part in &column {
                assert!(part.x >= 0 && part.y >= 0 && part.width > 0 && part.height > 0 && part.x + part.width <= left && part.y + part.height <= height);
            }
            assert_eq!(area(&column), left as i64 * height as i64 - 121);
            let cards: Vec<Rect> = parts.iter().copied().filter(|part| part.x >= left).collect();
            let expected: Vec<Rect> = if hidden { Vec::new() } else { plain(size).into_iter().filter(|part| part.x >= left).collect() };
            assert_eq!(cards, expected);
            assert_eq!(shape(size, |options| {
                options.hidden = hidden;
                options.covered = true;
                options.toggle = false;
            }), parts[1..]);
        }
    }
    let size = Size { width: 1536, height: 864 };
    let left = cards_left(1536);
    let parts = shape(size, |options| {
        options.corner = 7.0;
        options.covered = true;
    });
    let outer = |x: i32, y: i32, cx: f64, cy: f64| ((x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2)).sqrt() <= 8.0;
    for y in 0..8 {
        for x in 0..8 {
            if inside(&parts, x, y) {
                assert!(outer(x, y, 7.0, 8.0), "top {x},{y}");
            }
            if inside(&parts, x, 863 - y) {
                assert!(outer(x, 863 - y, 7.0, 857.0), "bottom {x},{}", 863 - y);
            }
        }
    }
    assert!(inside(&parts, 4, 0) && !inside(&parts, 3, 0) && inside(&parts, 0, 4) && inside(&parts, 4, 863) && !inside(&parts, 3, 863) && inside(&parts, 0, 859));
    let column: Vec<Rect> = parts[1..].iter().copied().filter(|part| part.x < left).collect();
    assert_eq!(area(&column), left as i64 * 864 - 121 - 2 * (4 + 3 + 2 + 1));
    assert!(shape(Size { width: 3, height: 2 }, |options| {
        options.corner = 500.0;
        options.covered = true;
    })
    .iter()
    .all(|part| part.width > 0 && part.height > 0));
}

#[test]
fn the_cards_follow_the_rounded_corners_of_the_riot_window_on_the_right_and_never_paint_past_them() {
    assert_eq!(corner_insets(7.0), [4, 3, 2, 1]);
    assert!(corner_insets(0.0).is_empty());
    assert_eq!(corner_radius(&cornered(8)), 7.0);
    assert_eq!(corner_radius(&cornered(10)), 9.0);
    for corner in [None, Some(0), Some(1)] {
        assert_eq!(corner_radius(&Target { corner, ..cornered(8) }), 0.0);
    }
    let size = Size { width: 1536, height: 864 };
    let left = cards_left(1536);
    let parts = shape(size, |options| options.corner = 7.0);
    let outer = |x: i32, y: i32, cx: f64, cy: f64| ((x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2)).sqrt() <= 8.0;
    for y in 0..8 {
        for x in 1528..1536 {
            if inside(&parts, x, y) {
                assert!(outer(x, y, 1529.0, 8.0), "top {x},{y}");
            }
            if inside(&parts, x, 863 - y) {
                assert!(outer(x, 863 - y, 1529.0, 857.0), "bottom {x},{}", 863 - y);
            }
        }
    }
    assert!(inside(&parts, 1535, 4) && inside(&parts, 1535, 859) && inside(&parts, 1531, 0) && !inside(&parts, 1532, 0) && inside(&parts, 1531, 863) && !inside(&parts, 1532, 863));
    for (x, y) in [(left, 0), (left, 863), (1200, 0), (1200, 863), (1535, 432)] {
        assert!(inside(&parts, x, y), "{x},{y}");
    }
    assert_eq!(area(&parts[1..]), (1536 - left) as i64 * 864 - 2 * (4 + 3 + 2 + 1));
    assert_eq!(shape(size, |options| {
        options.corner = 7.0;
        options.hidden = true;
    }), [toggle_rect(size)]);
    assert!(shape(Size { width: 400, height: 300 }, |options| options.corner = 500.0).iter().all(|part| part.width > 0 && part.height > 0));
}

#[test]
fn the_top_row_stays_with_the_riot_border_so_nothing_paints_past_it_on_any_side() {
    let edges: Vec<i32> = [None, Some(0), Some(1), Some(2), Some(8), Some(16)].into_iter().map(|corner| top_edge(&Target { corner, ..cornered(8) })).collect();
    assert_eq!(edges, [0, 0, 0, 1, 1, 1]);
    let size = Size { width: 1536, height: 864 };
    let left = cards_left(1536);
    for covered in [false, true] {
        let parts = shape(size, |options| {
            options.corner = 7.0;
            options.top = 1;
            options.covered = covered;
        });
        let within = |x: i32, y: i32, cx: f64, cy: f64| ((x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2)).sqrt() <= 7.0;
        for x in 0..1536 {
            assert!(!inside(&parts, x, 0), "row 0 at {x}");
        }
        for y in 1..9 {
            for x in 1528..1536 {
                if inside(&parts, x, y) {
                    assert!(within(x, y, 1529.0, 8.0), "top right {x},{y}");
                }
            }
            if covered {
                for x in 0..8 {
                    if inside(&parts, x, y) {
                        assert!(within(x, y, 7.0, 8.0), "top left {x},{y}");
                    }
                }
            }
        }
        for y in 855..864 {
            for x in 1528..1536 {
                if inside(&parts, x, y) {
                    assert!(within(x, y, 1529.0, 857.0), "bottom right {x},{y}");
                }
            }
        }
        assert!(inside(&parts, 1531, 1) && !inside(&parts, 1532, 1) && inside(&parts, 1535, 5) && inside(&parts, left, 1) && inside(&parts, 1200, 1) && inside(&parts, 1531, 863));
        assert_eq!(inside(&parts, 4, 1), covered);
        let cards: Vec<Rect> = parts.iter().copied().filter(|part| part.x >= left).collect();
        assert_eq!(area(&cards), (1536 - left) as i64 * 863 - 2 * (4 + 3 + 2 + 1));
        assert_eq!(parts[0], toggle_rect(size));
    }
    assert_eq!(shape(size, |options| options.top = 1), [toggle_rect(size), Rect::new(left, 1, 1536 - left, 863)]);
    for top in [-1, 864] {
        assert_eq!(shape(size, |options| options.top = top), plain(size));
    }
}
