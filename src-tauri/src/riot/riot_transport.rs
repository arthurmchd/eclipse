use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::Value;

use super::{check, Cancel, LocalApi, Response, RiotError, RiotResult};
use crate::integration::backend::{cached_backend_certificate, read_backend, Backend};

pub const FAILED: &str = "The local Riot service could not complete the request";
pub const DEFAULT_MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpsRequest {
    pub port: u16,
    pub method: String,
    pub path: String,
    pub ca: Vec<u8>,
    pub token: String,
    pub body: Option<String>,
    pub timeout_ms: u64,
    pub max_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SendFailure;

pub trait HttpsClient: Send + Sync {
    fn send(&self, request: &HttpsRequest) -> Result<(u16, Vec<u8>), SendFailure>;
}

pub type ClientPath = Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>;
pub type Connection = Arc<dyn Fn() -> Result<Backend, String> + Send + Sync>;
pub type Certificate = Arc<dyn Fn(&Path) -> Result<Vec<u8>, String> + Send + Sync>;

pub struct RiotTransport {
    client_path: ClientPath,
    connection: Connection,
    certificate: Certificate,
    https: Arc<dyn HttpsClient>,
    max_bytes: usize,
}

impl RiotTransport {
    pub fn new(client_path: ClientPath, connection: Connection, certificate: Certificate, https: Arc<dyn HttpsClient>, max_bytes: usize) -> Self {
        Self { client_path, connection, certificate, https, max_bytes }
    }

    pub fn for_riot_client(client_path: ClientPath, connection: Option<Connection>, max_bytes: usize) -> Self {
        Self::new(
            client_path,
            connection.unwrap_or_else(|| Arc::new(read_backend)),
            Arc::new(cached_backend_certificate),
            Arc::new(TlsClient::default()),
            max_bytes,
        )
    }

    fn prepare(&self, method: &str, path: &str, body: Option<&Value>, timeout_ms: u64) -> Result<HttpsRequest, ()> {
        let backend = (self.connection)().map_err(|_| ())?;
        let client = (self.client_path)().ok_or(())?;
        let ca = (self.certificate)(&client).map_err(|_| ())?;
        Ok(HttpsRequest {
            port: backend.port,
            method: method.to_string(),
            path: path.to_string(),
            ca,
            token: backend.token,
            body: body.filter(|body| !body.is_null()).map(Value::to_string),
            timeout_ms,
            max_bytes: self.max_bytes,
        })
    }
}

fn parse(status: u16, bytes: &[u8]) -> Response {
    let json = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(bytes).unwrap_or(Value::Null) };
    Response::new(status, json)
}

impl LocalApi for RiotTransport {
    fn request(&self, method: &str, path: &str, body: Option<&Value>, timeout_ms: u64, cancel: Option<&Cancel>) -> RiotResult<Response> {
        check(cancel)?;
        if !path.starts_with('/') || path.contains(['\r', '\n', '\0']) {
            return Err(RiotError::new("Invalid local Riot request"));
        }
        let request = self.prepare(method, path, body, timeout_ms).map_err(|_| RiotError::new(FAILED))?;
        let Some(cancel) = cancel else {
            let (status, bytes) = self.https.send(&request).map_err(|_| RiotError::new(FAILED))?;
            return Ok(parse(status, &bytes));
        };
        let (sender, receiver) = mpsc::channel();
        let https = self.https.clone();
        thread::spawn(move || {
            let _ = sender.send(https.send(&request));
        });
        loop {
            check(Some(cancel))?;
            match receiver.recv_timeout(Duration::from_millis(25)) {
                Ok(Ok((status, bytes))) => {
                    check(Some(cancel))?;
                    return Ok(parse(status, &bytes));
                }
                Ok(Err(SendFailure)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    check(Some(cancel))?;
                    return Err(RiotError::new(FAILED));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    }
}

pub fn reuses_connection(method: &str) -> bool {
    method == "GET"
}

pub struct AgentCache<T> {
    kept: Mutex<Option<(Vec<u8>, u16, T)>>,
}

impl<T> Default for AgentCache<T> {
    fn default() -> Self {
        Self { kept: Mutex::new(None) }
    }
}

impl<T: Clone> AgentCache<T> {
    pub fn get(&self, ca: &[u8], port: u16, build: impl FnOnce() -> Result<T, SendFailure>) -> Result<T, SendFailure> {
        let mut kept = self.kept.lock().unwrap();
        if let Some((known_ca, known_port, agent)) = kept.as_ref() {
            if *known_port == port && known_ca.as_slice() == ca {
                return Ok(agent.clone());
            }
        }
        *kept = None;
        let agent = build()?;
        *kept = Some((ca.to_vec(), port, agent.clone()));
        Ok(agent)
    }
}

fn build_agent(ca: &[u8], idle: usize) -> Result<ureq::Agent, SendFailure> {
    let root = native_tls::Certificate::from_pem(ca).map_err(|_| SendFailure)?;
    let connector = native_tls::TlsConnector::builder().add_root_certificate(root).disable_built_in_roots(true).build().map_err(|_| SendFailure)?;
    Ok(ureq::AgentBuilder::new().tls_connector(Arc::new(connector)).redirects(0).max_idle_connections(idle).max_idle_connections_per_host(idle).build())
}

#[derive(Default)]
pub struct TlsClient {
    reads: AgentCache<ureq::Agent>,
}

impl HttpsClient for TlsClient {
    fn send(&self, request: &HttpsRequest) -> Result<(u16, Vec<u8>), SendFailure> {
        let agent = if reuses_connection(&request.method) { self.reads.get(&request.ca, request.port, || build_agent(&request.ca, 1))? } else { build_agent(&request.ca, 0)? };
        let url = format!("https://127.0.0.1:{}{}", request.port, request.path);
        let authorization = format!("Basic {}", STANDARD.encode(format!("riot:{}", request.token)));
        let call = agent.request(&request.method, &url).timeout(Duration::from_millis(request.timeout_ms)).set("Authorization", &authorization).set("Content-Type", "application/json");
        let outcome = match &request.body {
            Some(body) => call.send_string(body),
            None => call.call(),
        };
        let response = match outcome {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(_) => return Err(SendFailure),
        };
        let status = response.status();
        let mut bytes = Vec::new();
        response.into_reader().take(request.max_bytes as u64 + 1).read_to_end(&mut bytes).map_err(|_| SendFailure)?;
        if bytes.len() > request.max_bytes {
            return Err(SendFailure);
        }
        Ok((status, bytes))
    }
}
