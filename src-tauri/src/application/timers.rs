use std::collections::BTreeMap;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub type Task = Box<dyn FnOnce() + Send>;

pub trait Timers: Send + Sync {
    fn later(&self, delay_ms: u64, task: Task) -> u64;
    fn cancel(&self, id: u64);
}

struct Queue {
    next: u64,
    due: BTreeMap<(Instant, u64), Task>,
    stopped: bool,
}

struct Shared {
    queue: Mutex<Queue>,
    wake: Condvar,
}

pub struct ThreadTimers {
    shared: Arc<Shared>,
}

impl ThreadTimers {
    pub fn new() -> Self {
        let shared = Arc::new(Shared { queue: Mutex::new(Queue { next: 1, due: BTreeMap::new(), stopped: false }), wake: Condvar::new() });
        let worker = shared.clone();
        thread::Builder::new().name("eclipse-timers".into()).spawn(move || run(&worker)).expect("timer thread");
        Self { shared }
    }
}

impl Default for ThreadTimers {
    fn default() -> Self {
        Self::new()
    }
}

fn run(shared: &Shared) {
    let mut queue = shared.queue.lock().unwrap();
    loop {
        if queue.stopped {
            return;
        }
        let now = Instant::now();
        let first = queue.due.keys().next().copied();
        match first {
            Some(key) if key.0 <= now => {
                let task = queue.due.remove(&key).unwrap();
                drop(queue);
                let _ = thread::Builder::new().name("eclipse-timer-task".into()).spawn(task);
                queue = shared.queue.lock().unwrap();
            }
            Some(key) => queue = shared.wake.wait_timeout(queue, key.0 - now).unwrap().0,
            None => queue = shared.wake.wait(queue).unwrap(),
        }
    }
}

impl Timers for ThreadTimers {
    fn later(&self, delay_ms: u64, task: Task) -> u64 {
        let mut queue = self.shared.queue.lock().unwrap();
        let id = queue.next;
        queue.next += 1;
        queue.due.insert((Instant::now() + Duration::from_millis(delay_ms), id), task);
        self.shared.wake.notify_all();
        id
    }

    fn cancel(&self, id: u64) {
        let mut queue = self.shared.queue.lock().unwrap();
        queue.due.retain(|key, _| key.1 != id);
    }
}

impl Drop for ThreadTimers {
    fn drop(&mut self) {
        let mut queue = self.shared.queue.lock().unwrap();
        queue.stopped = true;
        queue.due.clear();
        self.shared.wake.notify_all();
    }
}
