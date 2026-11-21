use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use eclipse::integration::backend::Backend;
use eclipse::riot::riot_app_controls::FLAG;
use eclipse::riot::riot_client::detect_client_path;
use eclipse::riot::riot_transport::{HttpsClient, HttpsRequest, RiotTransport, SendFailure, DEFAULT_MAX_BYTES, FAILED};
use eclipse::riot::{Cancel, LocalApi, Response};
use serde_json::json;

struct Https {
    sent: Mutex<Vec<HttpsRequest>>,
    answer: Result<(u16, Vec<u8>), SendFailure>,
    delay: Duration,
}

impl HttpsClient for Https {
    fn send(&self, request: &HttpsRequest) -> Result<(u16, Vec<u8>), SendFailure> {
        self.sent.lock().unwrap().push(request.clone());
        thread::sleep(self.delay);
        self.answer.clone()
    }
}

fn https(answer: Result<(u16, Vec<u8>), SendFailure>, delay: Duration) -> Arc<Https> {
    Arc::new(Https { sent: Mutex::new(Vec::new()), answer, delay })
}

fn transport(client: Arc<Https>, connection: Result<Backend, String>, max_bytes: usize) -> RiotTransport {
    RiotTransport::new(
        Arc::new(|| Some(PathBuf::from("synthetic-client"))),
        Arc::new(move || connection.clone()),
        Arc::new(|file: &Path| {
            assert_eq!(file, Path::new("synthetic-client"));
            Ok(b"synthetic-ca".to_vec())
        }),
        client,
        max_bytes,
    )
}

fn backend() -> Result<Backend, String> {
    Ok(Backend { pid: 1, port: 54321, token: "synthetic-secret".into() })
}

#[test]
fn the_local_riot_transport_sends_json_to_the_riot_port_with_its_own_certificate_and_token() {
    let client = https(Ok((200, br#"{"type":"success"}"#.to_vec())), Duration::ZERO);
    let api = transport(client.clone(), backend(), 1024);
    let response = api.request("POST", "/synthetic-login", Some(&json!({ "password": "dummy-password" })), 9000, None).unwrap();
    assert_eq!(response, Response::new(200, json!({ "type": "success" })));
    let sent = client.sent.lock().unwrap()[0].clone();
    assert_eq!(sent.port, 54321);
    assert_eq!(sent.ca, b"synthetic-ca");
    assert_eq!(sent.token, "synthetic-secret");
    assert_eq!(sent.timeout_ms, 9000);
    assert_eq!(sent.max_bytes, 1024);
    assert_eq!(serde_json::from_str::<serde_json::Value>(sent.body.as_deref().unwrap()).unwrap(), json!({ "password": "dummy-password" }));
}

#[test]
fn an_empty_or_unreadable_answer_reaches_the_caller_as_null() {
    for body in [b"".to_vec(), b"not json".to_vec()] {
        let api = transport(https(Ok((204, body)), Duration::ZERO), backend(), 1024);
        assert_eq!(api.get("/state").unwrap(), Response::new(204, serde_json::Value::Null));
    }
}

#[test]
fn cancelled_requests_never_start_or_stop_immediately() {
    let before = https(Ok((200, Vec::new())), Duration::ZERO);
    let cancel = Cancel::new();
    cancel.cancel();
    assert!(transport(before.clone(), backend(), 1024).request("GET", "/state", None, 4000, Some(&cancel)).unwrap_err().is_cancelled());
    assert!(before.sent.lock().unwrap().is_empty());
    let slow = https(Ok((200, Vec::new())), Duration::from_secs(3));
    let api = transport(slow, backend(), 1024);
    let cancel = Cancel::new();
    let trigger = cancel.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(50));
        trigger.cancel();
    });
    let began = Instant::now();
    assert!(api.request("GET", "/state", None, 4000, Some(&cancel)).unwrap_err().is_cancelled());
    assert!(began.elapsed() < Duration::from_secs(2));
}

#[test]
fn network_errors_are_generic() {
    let api = transport(https(Err(SendFailure), Duration::ZERO), backend(), 1024);
    assert_eq!(api.get("/state").unwrap_err().message, FAILED);
    let cancel = Cancel::new();
    assert_eq!(api.request("GET", "/state", None, 4000, Some(&cancel)).unwrap_err().message, FAILED);
}

#[test]
fn a_missing_backend_and_invalid_request_paths_fail_without_exposing_a_lockfile() {
    let missing = https(Ok((200, Vec::new())), Duration::ZERO);
    assert_eq!(transport(missing.clone(), Err("synthetic-secret".into()), 1024).get("/state").unwrap_err().message, FAILED);
    assert!(missing.sent.lock().unwrap().is_empty());
    let client = https(Ok((200, Vec::new())), Duration::ZERO);
    let api = transport(client.clone(), backend(), 1024);
    for path in ["https://elsewhere.invalid", "/state\r\nInjected: yes"] {
        assert_eq!(api.get(path).unwrap_err().message, "Invalid local Riot request");
    }
    assert!(client.sent.lock().unwrap().is_empty());
}

#[test]
#[ignore]
fn the_real_riot_client_certificate_is_accepted_on_a_single_read() {
    let client = detect_client_path("").expect("the Riot Client is not installed");
    let api = RiotTransport::for_riot_client(Arc::new(move || Some(PathBuf::from(&client))), None, DEFAULT_MAX_BYTES);
    let response = api.get(FLAG).expect("the open Riot Client did not answer over verified TLS");
    println!("status {}", response.status);
    assert!((200..500).contains(&response.status));
}
