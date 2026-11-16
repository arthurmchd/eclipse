#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use eclipse::application::timers::{Task, Timers};

pub struct Timer {
    pub id: u64,
    pub ms: u64,
    pub task: Option<Task>,
    pub cancelled: bool,
}

#[derive(Default)]
pub struct ManualTimers {
    next: AtomicU64,
    timers: Mutex<Vec<Timer>>,
}

impl ManualTimers {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn pending(&self) -> usize {
        self.timers.lock().unwrap().iter().filter(|timer| !timer.cancelled).count()
    }

    pub fn pending_with(&self, ms: u64) -> bool {
        self.timers.lock().unwrap().iter().any(|timer| !timer.cancelled && timer.ms == ms)
    }

    pub fn delays(&self) -> Vec<u64> {
        self.timers.lock().unwrap().iter().filter(|timer| !timer.cancelled).map(|timer| timer.ms).collect()
    }

    pub fn all_cancelled(&self) -> bool {
        self.timers.lock().unwrap().iter().all(|timer| timer.cancelled)
    }

    pub fn take(&self, pick: impl Fn(&Timer) -> bool) -> Option<Timer> {
        let mut timers = self.timers.lock().unwrap();
        let index = timers.iter().position(pick)?;
        Some(timers.remove(index))
    }

    pub fn run(timer: Timer) {
        if !timer.cancelled {
            if let Some(task) = timer.task {
                task();
            }
        }
    }

    pub fn next(&self, ms: Option<u64>) {
        let timer = self.take(|timer| !timer.cancelled).expect("a check is scheduled");
        if let Some(ms) = ms {
            assert_eq!(timer.ms, ms);
        }
        Self::run(timer);
    }

    pub fn run_all(&self, ms: u64, limit: usize) {
        for _ in 0..limit {
            let Some(timer) = self.take(|timer| timer.ms == ms) else {
                return;
            };
            Self::run(timer);
        }
    }
}

impl Timers for ManualTimers {
    fn later(&self, delay_ms: u64, task: Task) -> u64 {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        self.timers.lock().unwrap().push(Timer { id, ms: delay_ms, task: Some(task), cancelled: false });
        id
    }

    fn cancel(&self, id: u64) {
        if let Some(timer) = self.timers.lock().unwrap().iter_mut().find(|timer| timer.id == id) {
            timer.cancelled = true;
        }
    }
}

