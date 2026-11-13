#[path = "riot/auth_context_regression.rs"]
mod auth_context_regression;
#[path = "riot/game_ranks.rs"]
mod game_ranks;
#[path = "riot/riot_app_controls.rs"]
mod riot_app_controls;
#[path = "riot/riot_authentication.rs"]
mod riot_authentication;
#[path = "riot/riot_client.rs"]
mod riot_client;
#[path = "riot/riot_interface.rs"]
mod riot_interface;
#[path = "riot/riot_process.rs"]
mod riot_process;
#[path = "riot/riot_state.rs"]
mod riot_state;
#[path = "riot/riot_transport.rs"]
mod riot_transport;
#[path = "riot/sign_in_flow.rs"]
mod sign_in_flow;

use std::sync::{Arc, Mutex};

use eclipse::riot::{Cancel, LocalApi, Response, RiotError, RiotResult};
use serde_json::Value;

pub type Call = (String, String, Option<Value>);

pub struct FakeApi {
    calls: Mutex<Vec<Call>>,
    timeouts: Mutex<Vec<u64>>,
    handler: Box<dyn Fn(&str, &str, Option<&Value>) -> RiotResult<Response> + Send + Sync>,
}

impl FakeApi {
    pub fn new(handler: impl Fn(&str, &str, Option<&Value>) -> RiotResult<Response> + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { calls: Mutex::new(Vec::new()), timeouts: Mutex::new(Vec::new()), handler: Box::new(handler) })
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    pub fn timeouts(&self) -> Vec<u64> {
        self.timeouts.lock().unwrap().clone()
    }

    pub fn routes(&self) -> Vec<(String, String)> {
        self.calls().into_iter().map(|(method, path, _)| (method, path)).collect()
    }
}

impl LocalApi for FakeApi {
    fn request(&self, method: &str, path: &str, body: Option<&Value>, timeout_ms: u64, cancel: Option<&Cancel>) -> RiotResult<Response> {
        self.calls.lock().unwrap().push((method.to_string(), path.to_string(), body.cloned()));
        self.timeouts.lock().unwrap().push(timeout_ms);
        if cancel.is_some_and(Cancel::is_cancelled) {
            return Err(RiotError::cancelled());
        }
        (self.handler)(method, path, body)
    }
}

pub fn reply(status: u16, json: Value) -> RiotResult<Response> {
    Ok(Response::new(status, json))
}

pub fn route(method: &str, path: &str) -> (String, String) {
    (method.to_string(), path.to_string())
}
