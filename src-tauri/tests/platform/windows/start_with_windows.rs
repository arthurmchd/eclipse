use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use eclipse::platform::windows::start_with_windows::{approved, command_path, StartWithWindows, StartupRegistry, ENABLED};

const EXE: &str = "C:/Users/synthetic/AppData/Local/Programs/Eclipse/Eclipse.exe";

#[derive(Default)]
struct Registry {
    run: Mutex<BTreeMap<String, String>>,
    approval: Mutex<BTreeMap<String, Vec<u8>>>,
    calls: Mutex<Vec<String>>,
    fail_read: bool,
    fail_write: bool,
}

fn failure() -> io::Error {
    io::Error::other("synthetic registry failure")
}

impl StartupRegistry for Registry {
    fn entries(&self) -> io::Result<Vec<(String, String)>> {
        self.calls.lock().unwrap().push("entries".into());
        if self.fail_read {
            return Err(failure());
        }
        Ok(self.run.lock().unwrap().iter().map(|(name, command)| (name.clone(), command.clone())).collect())
    }

    fn approval(&self, name: &str) -> io::Result<Option<Vec<u8>>> {
        if self.fail_read {
            return Err(failure());
        }
        Ok(self.approval.lock().unwrap().get(name).cloned())
    }

    fn write_entry(&self, name: &str, command: &str) -> io::Result<()> {
        self.calls.lock().unwrap().push(format!("write {name} {command}"));
        if self.fail_write {
            return Err(failure());
        }
        self.run.lock().unwrap().insert(name.into(), command.into());
        Ok(())
    }

    fn write_approval(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        self.calls.lock().unwrap().push(format!("approve {name}"));
        if self.fail_write {
            return Err(failure());
        }
        self.approval.lock().unwrap().insert(name.into(), bytes.to_vec());
        Ok(())
    }

    fn remove(&self, name: &str) -> io::Result<()> {
        self.calls.lock().unwrap().push(format!("remove {name}"));
        if self.fail_write {
            return Err(failure());
        }
        self.run.lock().unwrap().remove(name);
        self.approval.lock().unwrap().remove(name);
        Ok(())
    }
}

fn registry(run: &[(&str, &str)], disabled: &[&str]) -> Registry {
    let registry = Registry::default();
    for (name, command) in run {
        registry.run.lock().unwrap().insert(name.to_string(), command.to_string());
    }
    for name in disabled {
        registry.approval.lock().unwrap().insert(name.to_string(), vec![3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    registry
}

fn startup(registry: Arc<Registry>, packaged: bool, lines: Arc<Mutex<Vec<String>>>) -> StartWithWindows {
    StartWithWindows::new(registry, PathBuf::from(EXE), "Eclipse", packaged, Box::new(move |line| lines.lock().unwrap().push(line.to_string())))
}

fn quoted(path: &str) -> String {
    format!("\"{}\"", PathBuf::from(path).display())
}

#[test]
fn starting_with_windows_is_off_by_default_and_turns_on_as_an_eclipse_entry_for_the_installed_executable() {
    let registry = Arc::new(registry(&[], &[]));
    let start = startup(registry.clone(), true, Arc::default());
    assert!(start.available());
    assert!(!start.enabled());
    assert!(!registry.calls.lock().unwrap().iter().any(|call| call.starts_with("write")));
    assert!(start.set(true));
    assert_eq!(*registry.run.lock().unwrap(), BTreeMap::from([("Eclipse".to_string(), quoted(EXE))]));
    assert_eq!(registry.approval.lock().unwrap()["Eclipse"], ENABLED);
    assert!(start.enabled());
}

#[test]
fn turning_it_off_removes_the_eclipse_entry_and_any_other_entry_for_the_same_executable_and_leaves_other_programs_alone() {
    let other = "C:/Other/other.exe";
    let registry = Arc::new(registry(&[("Eclipse", &quoted(EXE)), ("electron.app.Eclipse", &EXE.replace('/', "\\").to_uppercase()), ("OtherProgram", other)], &[]));
    let start = startup(registry.clone(), true, Arc::default());
    assert!(start.enabled());
    assert!(!start.set(false));
    assert_eq!(*registry.run.lock().unwrap(), BTreeMap::from([("OtherProgram".to_string(), other.to_string())]));
    let removed: Vec<String> = registry.calls.lock().unwrap().iter().filter(|call| call.starts_with("remove")).cloned().collect();
    assert_eq!(removed, ["remove Eclipse", "remove electron.app.Eclipse"]);
}

#[test]
fn an_entry_disabled_in_task_manager_reads_as_off_and_turning_it_on_enables_it_again() {
    let registry = Arc::new(registry(&[("Eclipse", &quoted(EXE))], &["Eclipse"]));
    let start = startup(registry.clone(), true, Arc::default());
    assert!(!start.enabled());
    assert!(start.set(true));
    assert_eq!(registry.approval.lock().unwrap()["Eclipse"], ENABLED);
}

#[test]
fn running_from_the_project_never_reads_or_writes_the_windows_startup_entries() {
    let registry = Arc::new(registry(&[("Eclipse", &quoted(EXE))], &[]));
    let start = startup(registry.clone(), false, Arc::default());
    assert!(!start.available());
    assert!(!start.enabled());
    assert!(!start.set(true));
    assert!(registry.calls.lock().unwrap().is_empty());
}

#[test]
fn a_registry_failure_reads_as_off_and_is_logged_with_a_fixed_line() {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let failing = startup(Arc::new(Registry { fail_write: true, ..Registry::default() }), true, lines.clone());
    assert!(!failing.set(true));
    assert_eq!(*lines.lock().unwrap(), ["could not turn on the start with Windows"]);
    let unreadable = startup(Arc::new(Registry { fail_read: true, ..Registry::default() }), true, lines.clone());
    assert!(!unreadable.enabled());
    assert!(!unreadable.set(false));
    assert_eq!(lines.lock().unwrap().last().unwrap(), "could not turn off the start with Windows");
}

#[test]
fn the_executable_is_read_from_a_quoted_or_bare_command_and_a_missing_approval_counts_as_on() {
    assert_eq!(command_path("\"C:\\Program Files\\Eclipse\\Eclipse.exe\" --hidden"), "C:\\Program Files\\Eclipse\\Eclipse.exe");
    assert_eq!(command_path("  C:\\Eclipse.exe "), "C:\\Eclipse.exe");
    assert!(approved(None));
    assert!(approved(Some(&[2, 0])));
    assert!(approved(Some(&[6, 0])));
    assert!(!approved(Some(&[3, 0])));
    assert!(!approved(Some(&[7])));
}
