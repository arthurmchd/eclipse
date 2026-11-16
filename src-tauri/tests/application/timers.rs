use std::sync::mpsc;
use std::time::{Duration, Instant};

use eclipse::application::timers::{ThreadTimers, Timers};

#[test]
fn tasks_run_in_the_order_they_fall_due_and_a_cancelled_one_never_runs() {
    let timers = ThreadTimers::new();
    let (send, receive) = mpsc::channel();
    let started = Instant::now();
    for (delay, name) in [(60, "late"), (10, "early"), (30, "cancelled")] {
        let send = send.clone();
        let id = timers.later(delay, Box::new(move || send.send(name).unwrap()));
        if name == "cancelled" {
            timers.cancel(id);
        }
    }
    assert_eq!(receive.recv_timeout(Duration::from_secs(2)).unwrap(), "early");
    assert_eq!(receive.recv_timeout(Duration::from_secs(2)).unwrap(), "late");
    assert!(started.elapsed() >= Duration::from_millis(60));
    assert!(receive.recv_timeout(Duration::from_millis(100)).is_err());
}

#[test]
fn a_slow_task_does_not_hold_back_the_next_one() {
    let timers = ThreadTimers::new();
    let (send, receive) = mpsc::channel();
    let slow = send.clone();
    timers.later(0, Box::new(move || {
        std::thread::sleep(Duration::from_millis(300));
        slow.send("slow").unwrap();
    }));
    timers.later(20, Box::new(move || send.send("quick").unwrap()));
    assert_eq!(receive.recv_timeout(Duration::from_secs(2)).unwrap(), "quick");
    assert_eq!(receive.recv_timeout(Duration::from_secs(2)).unwrap(), "slow");
}

#[test]
fn dropping_the_timers_discards_what_was_pending() {
    let (send, receive) = mpsc::channel::<()>();
    {
        let timers = ThreadTimers::new();
        timers.later(50, Box::new(move || send.send(()).unwrap()));
    }
    assert!(receive.recv_timeout(Duration::from_millis(200)).is_err());
}
