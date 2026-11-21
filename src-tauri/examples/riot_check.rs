use std::io::Write;
use std::path::Path;
use std::process::ExitCode;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use eclipse::platform::windows::login_form::{inspect_form, Remember};
use eclipse::platform::windows::observer_thread::NativeObserver;
use eclipse::platform::windows::riot_window_observer::{read_line, request_line, ObserverSpawn, Output, Target};
use eclipse::platform::windows::win32::{file_version, process_names};
use eclipse::riot::riot_client::detect_client_path;
use eclipse::riot::riot_version::{RiotVersion, LAST_TESTED_MAJOR};

fn report(ok: bool, name: &str, detail: &str) -> bool {
    println!("[{}] {name}: {detail}", if ok { " ok " } else { "FAIL" });
    ok
}

fn observe(client: &str) -> Option<Target> {
    let (sender, received) = mpsc::channel::<Option<Vec<u8>>>();
    let sender = Mutex::new(sender);
    let output: Output = Arc::new(move |chunk| {
        let _ = sender.lock().map(|sender| sender.send(chunk.map(<[u8]>::to_vec)));
    });
    let mut child = NativeObserver.spawn(output).ok()?;
    child.input.write_all(request_line(std::process::id(), client, None).as_bytes()).ok()?;
    let started = Instant::now();
    let (mut buffer, mut last) = (Vec::new(), None);
    while started.elapsed() < Duration::from_secs(3) {
        match received.recv_timeout(Duration::from_millis(200)) {
            Ok(Some(chunk)) => buffer.extend_from_slice(&chunk),
            Ok(None) => break,
            Err(_) => continue,
        }
        while let Some(end) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=end).collect();
            if let Ok(target) = read_line(line.trim_ascii_end()) {
                last = target;
            }
        }
    }
    drop(child.input);
    (child.kill)();
    last
}

fn main() -> ExitCode {
    println!("Eclipse: checagem da Riot real, sem login e sem tocar em contas");
    let mut ok = true;
    let Some(client) = detect_client_path("") else {
        report(false, "Riot Client", "not installed");
        return ExitCode::FAILURE;
    };
    report(true, "Riot Client", "installed");
    let version = file_version(Path::new(&client)).map(RiotVersion);
    ok &= match version {
        Some(version) if version.newer_than_tested() => report(false, "version", &format!("{} is newer than the last tested ({LAST_TESTED_MAJOR}): check everything below by hand, then raise LAST_TESTED_MAJOR", version.text())),
        Some(version) => report(true, "version", &version.text()),
        None => report(false, "version", "could not read the file version"),
    };
    let running = process_names();
    if !running.contains("riot client.exe") && !running.contains("riotclientux.exe") {
        report(false, "Riot window", "open the Riot Client on the sign-in screen and run again");
        return ExitCode::FAILURE;
    }
    ok &= match observe(&client) {
        Some(target) if target.minimized => report(false, "observer", "the Riot window is minimized; restore it and run again"),
        Some(target) => report(true, "observer", &format!("{}x{} at {},{}{}{}", target.width, target.height, target.x, target.y, if target.dimmed { ", dimmed" } else { "" }, if target.form_hidden { ", form hidden" } else { "" })),
        None => report(false, "observer", "did not find the Riot window"),
    };
    let form = inspect_form();
    ok &= report(form.window, "sign-in window", if form.window { "found" } else { "not found" });
    if form.window {
        ok &= report(form.ready, "sign-in form", if form.ready { "recognized by its colors" } else { "not recognized: sign out in Riot or check the layout constants" });
        ok &= report(form.fields, "form fields", if form.fields { "one username and one password field" } else { "UI Automation did not find exactly one username and one password field" });
        ok &= report(form.remember != Remember::Unknown, "stay signed in box", form.remember.name());
    }
    println!("{}", if ok { "Tudo certo. Falta o login de uma conta pelo Eclipse instalado." } else { "Algo mudou na Riot. Veja o guia Atualização do Riot Client." });
    if ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
