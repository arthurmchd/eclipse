use std::cell::{Cell, RefCell};
use std::sync::{Arc, Mutex};

use eclipse::integration::overlay::overlay_drag::{request_from_cards, start_message, DragPlatform, Outcome, OverlayDrag, Point, WindowsDrag, BEAT_MS, FROM_CARDS, LOOP_BEATS, MAX_RETAKES, START_MESSAGE};
use eclipse::platform::windows::observer_thread::DRAG_MESSAGE;
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, GetWindowRect, PeekMessageW, SetWindowLongPtrW, GWLP_HWNDPARENT, MSG, PM_REMOVE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP};

const OVERLAY: isize = 900;
const RIOT: isize = 700;

struct Fake {
    visible: Cell<bool>,
    owner: Cell<isize>,
    down: Cell<bool>,
    cursor: Cell<Option<Point>>,
    caption: Cell<bool>,
    origin: Point,
    client: Point,
    joined: Cell<bool>,
    refuses: Cell<bool>,
    capture: Cell<isize>,
    in_loop: Cell<bool>,
    takes: Cell<u32>,
    releases: Cell<u32>,
    moves: RefCell<Vec<(isize, Point, Point)>>,
    beating: Cell<bool>,
    logs: RefCell<Vec<&'static str>>,
}

impl Fake {
    fn new() -> Self {
        Self {
            visible: Cell::new(true),
            owner: Cell::new(RIOT),
            down: Cell::new(true),
            cursor: Cell::new(Some(Point::new(1100, 215))),
            caption: Cell::new(true),
            origin: Point::new(1000, 200),
            client: Point::new(1001, 201),
            joined: Cell::new(true),
            refuses: Cell::new(false),
            capture: Cell::new(RIOT),
            in_loop: Cell::new(false),
            takes: Cell::new(0),
            releases: Cell::new(0),
            moves: RefCell::new(Vec::new()),
            beating: Cell::new(false),
            logs: RefCell::new(Vec::new()),
        }
    }

    fn last_move(&self) -> Option<(isize, Point, Point)> {
        self.moves.borrow().last().copied()
    }

    fn logs(&self) -> Vec<&'static str> {
        self.logs.borrow().clone()
    }
}

impl DragPlatform for Fake {
    fn overlay(&self) -> isize {
        OVERLAY
    }

    fn overlay_visible(&self) -> bool {
        self.visible.get()
    }

    fn overlay_owner(&self) -> isize {
        self.owner.get()
    }

    fn primary_down(&self) -> bool {
        self.down.get()
    }

    fn cursor(&self) -> Option<Point> {
        self.cursor.get()
    }

    fn caption_at(&self, riot: isize, _at: Point) -> bool {
        riot == RIOT && self.caption.get()
    }

    fn window_origin(&self, _riot: isize) -> Option<Point> {
        Some(self.origin)
    }

    fn client_origin(&self, _riot: isize) -> Option<Point> {
        Some(self.client)
    }

    fn take_capture(&self) {
        self.takes.set(self.takes.get() + 1);
        if self.refuses.get() {
            return;
        }
        if self.joined.get() || self.capture.get() == 0 {
            self.capture.set(OVERLAY);
        }
    }

    fn shares_capture(&self, _riot: isize) -> bool {
        self.joined.get() && self.capture.get() == OVERLAY
    }

    fn has_capture(&self) -> bool {
        if self.refuses.get() {
            return false;
        }
        self.capture.get() == OVERLAY || (!self.joined.get() && self.takes.get() > self.releases.get())
    }

    fn release_capture(&self) {
        self.releases.set(self.releases.get() + 1);
        if self.capture.get() == OVERLAY {
            self.capture.set(0);
        }
    }

    fn in_move_loop(&self, _riot: isize) -> bool {
        self.in_loop.get()
    }

    fn move_both(&self, riot: isize, riot_at: Point, overlay_at: Point) {
        self.moves.borrow_mut().push((riot, riot_at, overlay_at));
    }

    fn start_beat(&self) {
        self.beating.set(true);
    }

    fn stop_beat(&self) {
        self.beating.set(false);
    }

    fn log(&self, line: &'static str) {
        self.logs.borrow_mut().push(line);
    }
}

fn taken() -> (Fake, OverlayDrag) {
    let fake = Fake::new();
    let mut drag = OverlayDrag::new();
    assert!(drag.start(&fake, RIOT));
    (fake, drag)
}

#[test]
fn takes_over_a_title_bar_drag_and_moves_both_windows_from_the_grabbed_point() {
    let (fake, drag) = taken();
    assert!(drag.dragging());
    assert_eq!(fake.capture.get(), OVERLAY);
    assert!(fake.beating.get());
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1000, 200), Point::new(1001, 201))));
    assert_eq!(fake.logs(), vec![Outcome::Taken.line()]);
}

#[test]
fn each_mouse_move_keeps_the_grabbed_point_under_the_cursor_and_the_cards_on_the_client_area() {
    let (fake, mut drag) = taken();
    fake.cursor.set(Some(Point::new(1400, 515)));
    drag.moved(&fake);
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1300, 500), Point::new(1301, 501))));
    fake.cursor.set(Some(Point::new(-50, -5)));
    drag.moved(&fake);
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(-150, -20), Point::new(-149, -19))));
    assert!(drag.dragging());
}

#[test]
fn leaves_the_drag_to_riot_when_the_cards_are_hidden_another_window_owns_them_or_the_button_is_up() {
    let cases: [fn(&Fake); 3] = [|fake| fake.visible.set(false), |fake| fake.owner.set(123), |fake| fake.down.set(false)];
    for setup in cases {
        let fake = Fake::new();
        setup(&fake);
        let mut drag = OverlayDrag::new();
        assert!(!drag.start(&fake, RIOT));
        assert!(!drag.dragging());
        assert_eq!(fake.takes.get(), 0);
        assert!(fake.moves.borrow().is_empty());
        assert!(fake.logs().is_empty());
    }
    let fake = Fake::new();
    let mut drag = OverlayDrag::new();
    assert!(!drag.start(&fake, 0));
    assert!(!drag.start(&fake, 555));
    assert_eq!(fake.takes.get(), 0);
}

#[test]
fn a_point_that_is_not_the_title_bar_stays_with_riot_and_is_logged_once() {
    let fake = Fake::new();
    fake.caption.set(false);
    let mut drag = OverlayDrag::new();
    assert!(!drag.start(&fake, RIOT));
    assert!(!drag.start(&fake, RIOT));
    assert_eq!(fake.takes.get(), 0);
    assert!(fake.moves.borrow().is_empty());
    assert_eq!(fake.logs(), vec![Outcome::NotCaption.line()]);
}

#[test]
fn gives_the_capture_back_and_moves_nothing_when_riot_keeps_it() {
    let fake = Fake::new();
    fake.joined.set(false);
    let mut drag = OverlayDrag::new();
    assert!(!drag.start(&fake, RIOT));
    assert!(!drag.start(&fake, RIOT));
    assert!(!drag.dragging());
    assert_eq!(fake.takes.get(), 2);
    assert_eq!(fake.releases.get(), 2);
    assert_eq!(fake.capture.get(), RIOT);
    assert!(!fake.beating.get());
    assert!(fake.moves.borrow().is_empty());
    assert_eq!(fake.logs(), vec![Outcome::KeptByRiot.line()]);
}

#[test]
fn releasing_the_button_leaves_riot_where_it_was_dropped_and_frees_the_mouse() {
    let (fake, mut drag) = taken();
    fake.cursor.set(Some(Point::new(1250, 315)));
    drag.released(&fake);
    assert!(drag.dragging());
    fake.down.set(false);
    drag.released(&fake);
    assert!(!drag.dragging());
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1150, 300), Point::new(1151, 301))));
    assert_eq!(fake.capture.get(), 0);
    assert!(!fake.beating.get());
    let count = fake.moves.borrow().len();
    drag.moved(&fake);
    drag.beat(&fake);
    assert_eq!(fake.moves.borrow().len(), count);
}

#[test]
fn a_move_after_the_button_is_up_ends_the_drag() {
    let (fake, mut drag) = taken();
    fake.down.set(false);
    fake.cursor.set(Some(Point::new(1120, 215)));
    drag.moved(&fake);
    assert!(!drag.dragging());
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1020, 200), Point::new(1021, 201))));
    assert_eq!(fake.capture.get(), 0);
}

#[test]
fn retakes_the_capture_riot_lets_go_of_at_most_three_times() {
    let (fake, mut drag) = taken();
    for round in 1..=MAX_RETAKES {
        fake.capture.set(0);
        drag.capture_changed(&fake, 0);
        assert!(drag.dragging());
        assert_eq!(fake.capture.get(), OVERLAY);
        assert_eq!(fake.takes.get(), 1 + round);
    }
    fake.capture.set(0);
    drag.capture_changed(&fake, 0);
    assert!(!drag.dragging());
    assert_eq!(fake.takes.get(), 1 + MAX_RETAKES);
    assert!(!fake.beating.get());
}

#[test]
fn capture_taken_by_another_window_ends_the_drag_without_touching_it() {
    let (fake, mut drag) = taken();
    drag.capture_changed(&fake, OVERLAY);
    assert!(drag.dragging());
    fake.capture.set(4242);
    drag.capture_changed(&fake, 4242);
    assert!(!drag.dragging());
    assert_eq!(fake.releases.get(), 0);
    assert_eq!(fake.capture.get(), 4242);
}

#[test]
fn capture_lost_with_the_button_up_ends_the_drag() {
    let (fake, mut drag) = taken();
    fake.down.set(false);
    fake.capture.set(0);
    drag.capture_changed(&fake, 0);
    assert!(!drag.dragging());
    assert_eq!(fake.takes.get(), 1);
}

#[test]
fn the_beat_repeats_the_position_so_riot_returning_to_its_start_is_corrected() {
    let (fake, mut drag) = taken();
    let count = fake.moves.borrow().len();
    drag.beat(&fake);
    drag.beat(&fake);
    assert_eq!(fake.moves.borrow().len(), count + 2);
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1000, 200), Point::new(1001, 201))));
    assert!(drag.dragging());
}

#[test]
fn the_beat_ends_the_drag_when_the_button_is_already_up() {
    let (fake, mut drag) = taken();
    fake.down.set(false);
    drag.beat(&fake);
    assert!(!drag.dragging());
    assert!(!fake.beating.get());
    assert_eq!(fake.capture.get(), 0);
}

#[test]
fn the_beat_gives_up_when_riot_stays_in_its_own_drag_for_three_beats() {
    let (fake, mut drag) = taken();
    fake.in_loop.set(true);
    for _ in 1..LOOP_BEATS {
        drag.beat(&fake);
        assert!(drag.dragging());
    }
    drag.beat(&fake);
    assert!(!drag.dragging());
    assert_eq!(fake.capture.get(), 0);
    assert_eq!(fake.logs(), vec![Outcome::Taken.line(), Outcome::RiotKeptLoop.line()]);
    fake.in_loop.set(false);
    fake.capture.set(RIOT);
    assert!(drag.start(&fake, RIOT));
    assert_eq!(fake.logs().len(), 2);
}

#[test]
fn the_beat_takes_the_capture_back_when_it_went_to_nobody_and_stops_after_three_tries() {
    let (fake, mut drag) = taken();
    for round in 1..=MAX_RETAKES {
        fake.capture.set(0);
        drag.beat(&fake);
        assert!(drag.dragging());
        assert_eq!(fake.takes.get(), 1 + round);
    }
    fake.capture.set(0);
    drag.beat(&fake);
    assert!(!drag.dragging());
}

fn grabbed() -> (Fake, OverlayDrag) {
    let fake = Fake::new();
    fake.caption.set(false);
    let mut drag = OverlayDrag::new();
    assert!(drag.grab(&fake));
    (fake, drag)
}

#[test]
fn a_press_on_the_cards_area_moves_both_windows_from_the_grabbed_point_without_asking_riot_for_its_title_bar() {
    let (fake, mut drag) = grabbed();
    assert!(drag.dragging());
    assert_eq!(fake.capture.get(), OVERLAY);
    assert!(fake.beating.get());
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1000, 200), Point::new(1001, 201))));
    fake.cursor.set(Some(Point::new(1400, 515)));
    drag.moved(&fake);
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1300, 500), Point::new(1301, 501))));
    assert_eq!(fake.logs(), vec![Outcome::TakenFromCards.line()]);
    fake.down.set(false);
    drag.released(&fake);
    assert!(!drag.dragging());
    assert!(!fake.beating.get());
    assert_eq!(fake.capture.get(), 0);
}

#[test]
fn a_press_on_the_cards_area_moves_nothing_when_hidden_without_an_owner_or_with_the_button_already_up() {
    let cases: [fn(&Fake); 3] = [|fake| fake.visible.set(false), |fake| fake.owner.set(0), |fake| fake.down.set(false)];
    for setup in cases {
        let fake = Fake::new();
        setup(&fake);
        let mut drag = OverlayDrag::new();
        assert!(!drag.grab(&fake));
        assert!(!drag.dragging());
        assert_eq!(fake.takes.get(), 0);
        assert!(fake.moves.borrow().is_empty());
        assert!(fake.logs().is_empty());
    }
}

#[test]
fn a_press_on_the_cards_area_that_cannot_take_the_capture_moves_nothing_and_is_logged_once() {
    let fake = Fake::new();
    fake.refuses.set(true);
    let mut drag = OverlayDrag::new();
    assert!(!drag.grab(&fake));
    assert!(!drag.grab(&fake));
    assert!(!drag.dragging());
    assert!(!fake.beating.get());
    assert!(fake.moves.borrow().is_empty());
    assert_eq!(fake.logs(), vec![Outcome::CardsKeptCapture.line()]);
}

#[test]
fn a_press_on_the_cards_area_during_a_drag_is_ignored_and_the_beat_keeps_it_going_without_a_riot_loop() {
    let (fake, mut drag) = grabbed();
    assert!(!drag.grab(&fake));
    assert!(!drag.start(&fake, RIOT));
    assert_eq!(fake.takes.get(), 1);
    fake.cursor.set(Some(Point::new(1200, 300)));
    drag.beat(&fake);
    assert!(drag.dragging());
    assert_eq!(fake.last_move(), Some((RIOT, Point::new(1100, 285), Point::new(1101, 286))));
}

#[test]
fn a_second_start_during_a_drag_is_ignored() {
    let (fake, mut drag) = taken();
    assert!(!drag.start(&fake, RIOT));
    assert_eq!(fake.takes.get(), 1);
    assert!(drag.dragging());
}

#[test]
fn each_outcome_is_logged_once_per_run_in_english_without_account_data() {
    let (fake, mut drag) = taken();
    fake.down.set(false);
    drag.released(&fake);
    fake.down.set(true);
    fake.capture.set(RIOT);
    assert!(drag.start(&fake, RIOT));
    assert_eq!(fake.logs(), vec![Outcome::Taken.line()]);
    let lines: Vec<&str> = Outcome::ALL.iter().map(|outcome| outcome.line()).collect();
    for (index, line) in lines.iter().enumerate() {
        assert!(line.starts_with("riot drag: "));
        assert!(line.is_ascii());
        assert!(!lines[index + 1..].contains(line));
    }
}

#[test]
fn timing_and_message_match_the_decision_and_the_helper() {
    assert_eq!(BEAT_MS, 15);
    assert_eq!(MAX_RETAKES, 3);
    assert_eq!(LOOP_BEATS, 3);
    assert_eq!(DRAG_MESSAGE, START_MESSAGE);
    assert!(start_message() >= 0xC000);
    assert_eq!(start_message(), start_message());
    assert_eq!(FROM_CARDS, 1);
}

fn test_window(x: i32, y: i32) -> HWND {
    let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
    let window = unsafe { CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, class.as_ptr(), std::ptr::null(), WS_POPUP, x, y, 400, 300, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()) };
    assert!(!window.is_null());
    window
}

fn origin(window: HWND) -> (i32, i32) {
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    assert_ne!(unsafe { GetWindowRect(window, &mut rect) }, 0);
    (rect.left, rect.top)
}

#[test]
fn the_windows_platform_moves_two_real_windows_together_off_screen() {
    let riot = test_window(-20000, -20000);
    let cards = test_window(-20000, -20000);
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let platform = WindowsDrag::new(cards as isize, Arc::new(move |line: &str| lines.lock().unwrap().push(line.to_string())));
    assert_eq!(platform.overlay_owner(), 0);
    unsafe {
        SetWindowLongPtrW(cards, GWLP_HWNDPARENT, riot as isize);
    }
    assert_eq!(platform.overlay_owner(), riot as isize);
    assert!(!platform.overlay_visible());
    assert_eq!(platform.window_origin(riot as isize), Some(Point::new(-20000, -20000)));
    assert_eq!(platform.client_origin(riot as isize), Some(Point::new(-20000, -20000)));
    assert!(!platform.caption_at(riot as isize, Point::new(-19990, -19990)));
    assert!(!platform.in_move_loop(riot as isize));
    platform.move_both(riot as isize, Point::new(-20300, -20200), Point::new(-20299, -20199));
    assert_eq!(origin(riot), (-20300, -20200));
    assert_eq!(origin(cards), (-20299, -20199));
    platform.take_capture();
    assert!(platform.has_capture());
    assert!(platform.shares_capture(cards as isize));
    platform.release_capture();
    assert!(!platform.has_capture());
    platform.start_beat();
    platform.stop_beat();
    assert!(request_from_cards(cards as isize));
    let mut message: MSG = unsafe { std::mem::zeroed() };
    assert_ne!(unsafe { PeekMessageW(&mut message, cards, start_message(), start_message(), PM_REMOVE) }, 0);
    assert_eq!((message.wParam, message.lParam), (0, FROM_CARDS));
    unsafe {
        DestroyWindow(cards);
        DestroyWindow(riot);
    }
}
