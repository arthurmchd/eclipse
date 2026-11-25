use std::sync::{Arc, Mutex, Weak};

use serde_json::Value;

use super::overlay_toggle::toggle_rect;
use crate::application::timers::Timers;
use crate::platform::windows::riot_window_observer::{RiotWindowObserver, Target, PANEL_POINT};
use crate::riot::riot_app_controls::CloseMode;
use crate::riot::riot_authentication::{AuthKind, AuthState};
use crate::riot::Cancel;

pub const PANEL_HOLE: i32 = 5;
pub const LAYOUT_MS: u64 = 750;
pub const CHECK_FRESH_MS: f64 = 2500.0;
pub const REST_AFTER_MS: f64 = 2000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self { x, y, width, height }
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Size {
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShapeOptions {
    pub hidden: bool,
    pub corner: f64,
    pub top: i32,
    pub covered: bool,
    pub toggle: bool,
}

impl Default for ShapeOptions {
    fn default() -> Self {
        Self { hidden: false, corner: 0.0, top: 0, covered: false, toggle: true }
    }
}

pub fn round(value: f64) -> i32 {
    (value + 0.5).floor() as i32
}

pub fn overlay_bounds(target: &Target) -> Rect {
    Rect::new(target.x, target.y, target.width.max(1), target.height.max(1))
}

pub fn cards_left(width: i32) -> i32 {
    round(width as f64 * 400.0 / 1536.0).min((width - 1).max(0))
}

pub fn corner_insets(radius: f64) -> Vec<i32> {
    let mut insets = Vec::new();
    let mut row = 0.0;
    while row < radius.ceil() {
        let inset = round(radius - (radius * radius - (radius - row - 0.5).powi(2)).max(0.0).sqrt());
        if inset <= 0 {
            break;
        }
        insets.push(inset);
        row += 1.0;
    }
    insets
}

pub fn corner_radius(target: &Target) -> f64 {
    match target.corner {
        Some(corner) if corner > 1 => (corner - 1) as f64,
        _ => 0.0,
    }
}

pub fn top_edge(target: &Target) -> i32 {
    i32::from(target.corner.is_some_and(|corner| corner > 1))
}

pub fn cover_rect(size: Size) -> Rect {
    Rect::new(0, 0, cards_left(size.width).max(1), size.height.max(1))
}

pub fn cards_rect(size: Size) -> Rect {
    let left = cards_left(size.width);
    Rect::new(left, 0, (size.width - left).max(1), size.height.max(1))
}

pub fn panel_hole(size: Size) -> Rect {
    let x = round(size.width as f64 * PANEL_POINT.0);
    let y = round(size.height as f64 * PANEL_POINT.1);
    Rect::new(x - PANEL_HOLE, y - PANEL_HOLE, PANEL_HOLE * 2 + 1, PANEL_HOLE * 2 + 1)
}

pub fn without(rect: Rect, hole: Rect) -> Vec<Rect> {
    let left = rect.x.max(hole.x);
    let top = rect.y.max(hole.y);
    let right = (rect.x + rect.width).min(hole.x + hole.width);
    let bottom = (rect.y + rect.height).min(hole.y + hole.height);
    if left >= right || top >= bottom {
        return vec![rect];
    }
    vec![
        Rect::new(rect.x, rect.y, rect.width, top - rect.y),
        Rect::new(rect.x, top, left - rect.x, bottom - top),
        Rect::new(right, top, rect.x + rect.width - right, bottom - top),
        Rect::new(rect.x, bottom, rect.width, rect.y + rect.height - bottom),
    ]
}

fn rounded_rows(insets: &[i32], x: i32, top: i32, bottom: i32, width: i32, from_left: bool) -> (Vec<Rect>, Vec<Rect>) {
    let row = |inset: i32, y: i32| if from_left { Rect::new(x + inset, y, width - inset, 1) } else { Rect::new(x, y, width - inset, 1) };
    let upper = insets.iter().enumerate().map(|(index, inset)| row(*inset, top + index as i32)).collect();
    let lower = insets.iter().enumerate().map(|(index, inset)| row(*inset, bottom - 1 - index as i32)).collect();
    (upper, lower)
}

pub fn cover_shape(size: Size, corner: f64, top: i32) -> Vec<Rect> {
    let area = cards_left(size.width);
    let inner = size.height - top;
    if area <= 0 {
        return Vec::new();
    }
    let insets = corner_insets(corner.min(area as f64 / 2.0).min(inner as f64 / 2.0));
    let rows = insets.len() as i32;
    let (upper, lower) = rounded_rows(&insets, 0, top, size.height, area, true);
    let middle = without(Rect::new(0, top + rows, area, inner - rows * 2), panel_hole(size));
    upper.into_iter().chain(middle).chain(lower).filter(|part| part.width > 0 && part.height > 0).collect()
}

pub fn overlay_shape(size: Size, options: ShapeOptions) -> Vec<Rect> {
    let edge = if options.top > 0 && options.top < size.height { options.top } else { 0 };
    let inner = size.height - edge;
    let mut parts = Vec::new();
    if options.toggle {
        parts.push(toggle_rect(size));
    }
    if options.covered {
        parts.extend(cover_shape(size, options.corner, edge));
    }
    if options.hidden {
        return parts;
    }
    let left = cards_left(size.width);
    let area = size.width - left;
    let insets = corner_insets(options.corner.min(area as f64 / 2.0).min(inner as f64 / 2.0));
    if insets.is_empty() {
        parts.push(Rect::new(left, edge, area, inner));
        return parts;
    }
    let rows = insets.len() as i32;
    let (upper, lower) = rounded_rows(&insets, left, edge, size.height, area, false);
    parts.extend(upper);
    parts.push(Rect::new(left, edge + rows, area, inner - rows * 2));
    parts.extend(lower);
    parts
}

pub fn login_visible(state: &Result<Option<AuthState>, ()>) -> bool {
    matches!(state, Ok(Some(AuthState { kind: AuthKind::Auth, error: None, .. })) | Ok(Some(AuthState { kind: AuthKind::Error, error: Some("auth_failure"), .. })))
}

pub trait OverlayWindow: Send + Sync {
    fn set_size(&self, size: Size);
    fn set_region(&self, parts: &[Rect]);
    fn show_inactive(&self);
    fn hide(&self);
    fn set_resting(&self, resting: bool);
    fn set_cover_visible(&self, visible: bool);
    fn set_toggle_visible(&self, visible: bool);
    fn set_toggle_language(&self, language: &str);
    fn begin_drag(&self);
    fn close(&self);
}

pub trait OverlayObserver: Send + Sync {
    fn command(&self, name: &str) -> bool;
    fn stop(&self);
}

impl OverlayObserver for RiotWindowObserver {
    fn command(&self, name: &str) -> bool {
        RiotWindowObserver::command(self, name)
    }

    fn stop(&self) {
        RiotWindowObserver::stop(self);
    }
}

pub type AuthReader = Box<dyn Fn(&Cancel) -> Result<Option<AuthState>, ()> + Send + Sync>;

pub struct OverlayHooks {
    pub read_authentication_state: AuthReader,
    pub close_client: Box<dyn Fn() -> Result<CloseMode, ()> + Send + Sync>,
    pub now: Box<dyn Fn() -> f64 + Send + Sync>,
}

struct State {
    disposed: bool,
    loaded: bool,
    target: Option<Target>,
    missing_since: Option<f64>,
    login_visible: bool,
    outside: bool,
    checked_at: f64,
    pending: Option<Cancel>,
    generation: u64,
    signed_in: bool,
    hidden: bool,
    covered: bool,
    form_hidden: bool,
    language: &'static str,
    corner: f64,
    edge: i32,
    size: Option<Size>,
    visible: bool,
    resting: bool,
    timer: Option<u64>,
    observer: Option<Arc<dyn OverlayObserver>>,
}

struct Inner {
    window: Arc<dyn OverlayWindow>,
    timers: Arc<dyn Timers>,
    hooks: OverlayHooks,
    state: Mutex<State>,
}

impl Inner {
    fn options(state: &State) -> ShapeOptions {
        ShapeOptions { hidden: state.hidden, corner: state.corner, top: state.edge, covered: state.covered, toggle: !state.form_hidden }
    }

    fn hide(&self, state: &mut State, rest: bool) {
        if state.visible {
            state.visible = false;
            self.window.hide();
        }
        if rest && !state.resting {
            state.resting = true;
            self.window.set_resting(true);
        }
    }

    fn reshape(&self, state: &mut State) {
        if state.disposed {
            return;
        }
        let Some(size) = state.size else {
            return;
        };
        let parts = overlay_shape(size, Self::options(state));
        if parts.is_empty() {
            self.hide(state, false);
        } else {
            self.window.set_region(&parts);
        }
    }

    fn set_covered(&self, state: &mut State, value: bool) {
        if state.covered == value {
            return;
        }
        state.covered = value;
        if value {
            self.window.set_cover_visible(true);
            self.window.set_toggle_visible(false);
        }
        self.reshape(state);
        if !value {
            self.window.set_cover_visible(false);
            if !state.form_hidden {
                self.window.set_toggle_visible(true);
            }
        }
    }

    fn set_form_hidden(&self, state: &mut State, value: bool) {
        if state.form_hidden == value {
            return;
        }
        state.form_hidden = value;
        if value && !state.covered {
            self.window.set_toggle_visible(false);
        }
        self.reshape(state);
        if !value && !state.covered {
            self.window.set_toggle_visible(true);
        }
    }

    fn reset_session(state: &mut State) {
        state.generation += 1;
        state.login_visible = false;
        state.outside = false;
        if let Some(pending) = state.pending.take() {
            pending.cancel();
        }
    }

    fn layout(&self, state: &mut State) {
        if state.disposed {
            return;
        }
        let now = (self.hooks.now)();
        let fresh = now - state.checked_at <= CHECK_FRESH_MS;
        let Some(target) = state.target.clone().filter(|target| state.loaded && !target.minimized && !target.dimmed && state.login_visible && !state.signed_in && fresh) else {
            let gone = state.target.is_none() && state.missing_since.is_none_or(|since| now - since >= REST_AFTER_MS);
            let rest = gone || state.signed_in || state.outside;
            self.hide(state, rest);
            return;
        };
        let bounds = overlay_bounds(&target);
        let size = Size { width: bounds.width, height: bounds.height };
        let radius = corner_radius(&target);
        let border = top_edge(&target);
        if overlay_shape(size, Self::options(state)).is_empty() {
            self.hide(state, false);
            return;
        }
        let resized = state.size != Some(size);
        if resized {
            state.size = Some(size);
            self.window.set_size(size);
        }
        if resized || radius != state.corner || border != state.edge {
            state.corner = radius;
            state.edge = border;
            self.window.set_region(&overlay_shape(size, Self::options(state)));
        }
        if !state.visible {
            state.visible = true;
            if state.resting {
                state.resting = false;
                self.window.set_resting(false);
            }
            self.window.show_inactive();
        }
    }

    fn check_session(self: &Arc<Self>) {
        let (cancel, version) = {
            let mut state = self.state.lock().unwrap();
            if state.disposed || state.target.as_ref().is_none_or(|target| target.minimized) || state.pending.is_some() {
                return;
            }
            let cancel = Cancel::new();
            state.pending = Some(cancel.clone());
            (cancel, state.generation)
        };
        let weak = Arc::downgrade(self);
        self.timers.later(0, Box::new(move || {
            let Some(inner) = weak.upgrade() else {
                return;
            };
            let answer = if cancel.is_cancelled() { Err(()) } else { (inner.hooks.read_authentication_state)(&cancel) };
            let mut state = inner.state.lock().unwrap();
            if !state.disposed && version == state.generation {
                state.login_visible = login_visible(&answer);
                state.outside = answer.is_ok() && !state.login_visible;
                if answer.is_ok() {
                    state.checked_at = (inner.hooks.now)();
                }
            }
            if state.pending.as_ref().is_some_and(|pending| pending.same(&cancel)) {
                state.pending = None;
            }
            inner.layout(&mut state);
        }));
    }

    fn schedule(self: &Arc<Self>) {
        let weak: Weak<Inner> = Arc::downgrade(self);
        let id = self.timers.later(LAYOUT_MS, Box::new(move || {
            if let Some(inner) = weak.upgrade() {
                inner.tick();
            }
        }));
        let mut state = self.state.lock().unwrap();
        if state.disposed {
            drop(state);
            self.timers.cancel(id);
        } else {
            state.timer = Some(id);
        }
    }

    fn tick(self: &Arc<Self>) {
        {
            let mut state = self.state.lock().unwrap();
            if state.disposed {
                return;
            }
            self.layout(&mut state);
        }
        self.check_session();
        self.schedule();
    }
}

#[derive(Clone)]
pub struct RiotOverlay {
    inner: Arc<Inner>,
}

impl RiotOverlay {
    pub fn new(window: Arc<dyn OverlayWindow>, timers: Arc<dyn Timers>, hooks: OverlayHooks) -> Self {
        let state = State {
            disposed: false,
            loaded: false,
            target: None,
            missing_since: None,
            login_visible: false,
            outside: false,
            checked_at: 0.0,
            pending: None,
            generation: 0,
            signed_in: false,
            hidden: false,
            covered: false,
            form_hidden: false,
            language: "pt",
            corner: 0.0,
            edge: 0,
            size: None,
            visible: false,
            resting: false,
            timer: None,
            observer: None,
        };
        Self { inner: Arc::new(Inner { window, timers, hooks, state: Mutex::new(state) }) }
    }

    pub fn start(&self, observer: Arc<dyn OverlayObserver>) {
        {
            let mut state = self.inner.state.lock().unwrap();
            if state.disposed || state.loaded {
                return;
            }
            state.loaded = true;
            state.observer = Some(observer);
            self.inner.window.set_toggle_language(state.language);
            self.inner.window.set_cover_visible(state.covered);
            self.inner.window.set_toggle_visible(!state.covered && !state.form_hidden);
        }
        self.inner.schedule();
    }

    pub fn on_state(&self, value: Option<Target>) {
        let check = {
            let mut state = self.inner.state.lock().unwrap();
            if state.disposed {
                return;
            }
            let changed = state.target.as_ref().map(|target| &target.id) != value.as_ref().map(|target| &target.id);
            if changed {
                Inner::reset_session(&mut state);
            }
            let restored = !changed && state.target.as_ref().is_some_and(|target| target.minimized) && value.as_ref().is_some_and(|target| !target.minimized);
            let form_hidden = value.as_ref().is_some_and(|target| target.form_hidden);
            let now = (self.inner.hooks.now)();
            if value.is_some() {
                state.missing_since = None;
            } else if state.target.is_some() {
                state.missing_since = Some(now);
            }
            if restored {
                state.checked_at = now;
            }
            state.target = value;
            self.inner.set_form_hidden(&mut state, form_hidden);
            self.inner.layout(&mut state);
            (changed || restored) && state.target.is_some()
        };
        if check {
            self.inner.check_session();
        }
    }

    pub fn open(&self) {
        self.inner.check_session();
        let mut state = self.inner.state.lock().unwrap();
        self.inner.layout(&mut state);
    }

    pub fn set_language(&self, value: &str) {
        let mut state = self.inner.state.lock().unwrap();
        state.language = if value == "en" { "en" } else { "pt" };
        if state.loaded && !state.disposed {
            self.inner.window.set_toggle_language(state.language);
        }
    }

    pub fn set_hidden(&self, value: bool) -> bool {
        let mut state = self.inner.state.lock().unwrap();
        if state.disposed {
            return value;
        }
        if state.hidden != value {
            state.hidden = value;
            self.inner.reshape(&mut state);
        }
        value
    }

    pub fn set_operation(&self, operation: &Value) {
        let running = operation.get("status").and_then(Value::as_str) == Some("running");
        let signed_in = running && operation.get("signedIn") == Some(&Value::Bool(true));
        let attention = operation.get("needsAttention") == Some(&Value::Bool(true));
        let mut state = self.inner.state.lock().unwrap();
        if state.disposed {
            return;
        }
        state.signed_in = signed_in;
        self.inner.set_covered(&mut state, running && !attention);
        self.inner.layout(&mut state);
    }

    pub fn window_action(&self, action: &str) -> bool {
        let observer = {
            let state = self.inner.state.lock().unwrap();
            if state.disposed {
                return false;
            }
            if action == "drag" {
                let shown = state.visible && !state.hidden;
                if shown {
                    self.inner.window.begin_drag();
                }
                return shown;
            }
            match state.observer.clone() {
                Some(observer) => observer,
                None => return false,
            }
        };
        match action {
            "minimize" => observer.command("minimize"),
            "close" => {
                let mode = (self.inner.hooks.close_client)();
                if mode != Ok(CloseMode::Background) && !self.inner.state.lock().unwrap().disposed {
                    observer.command("close");
                }
                true
            }
            _ => false,
        }
    }

    pub fn stop(&self) {
        let (timer, observer) = {
            let mut state = self.inner.state.lock().unwrap();
            if state.disposed {
                return;
            }
            state.disposed = true;
            Inner::reset_session(&mut state);
            state.visible = false;
            (state.timer.take(), state.observer.take())
        };
        if let Some(id) = timer {
            self.inner.timers.cancel(id);
        }
        if let Some(observer) = observer {
            observer.stop();
        }
        self.inner.window.close();
    }
}
