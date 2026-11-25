use serde_json::{json, Value};

use crate::integration::asset_protocol::{served_url, CARDS_PAGE};

pub const COMMAND: &str = "manager";
pub const CARDS_LABEL: &str = "cards";
pub const METHODS: [&str; 14] = ["init", "saveAccount", "addAccounts", "pinAccount", "reorderAccounts", "deleteAccount", "refresh", "runningGames", "signIn", "cancelSignIn", "saveSettings", "events", "operation", "openExternal"];
pub const WINDOW_ACTIONS: [&str; 3] = ["minimize", "close", "drag"];
pub const MAX_ARGS: usize = 4;
pub const MAX_BYTES: usize = 32768;
pub const UNTRUSTED: &str = "The account controls are only available in their embedded view";
pub const INVALID: &str = "Invalid account command";
pub const FAILED: &str = "Não foi possível concluir a ação no serviço de contas.";

const PRELOAD: &str = include_str!("../../../../src/integration/manager/manager-preload.js");

pub struct Caller<'a> {
    pub label: &'a str,
    pub url: Option<&'a str>,
}

pub fn trusted(caller: &Caller) -> bool {
    caller.label == CARDS_LABEL && caller.url == Some(served_url(CARDS_PAGE).as_str())
}

pub type Request = Box<dyn Fn(&str, &[Value]) -> Result<Value, String> + Send + Sync>;
pub type WindowAction = Box<dyn Fn(&str) -> bool + Send + Sync>;

pub struct ManagerHost {
    request: Request,
    window_action: WindowAction,
}

impl ManagerHost {
    pub fn new(request: Request, window_action: WindowAction) -> Self {
        Self { request, window_action }
    }

    pub fn invoke(&self, caller: &Caller, method: &str, args: &Value) -> Result<Value, String> {
        if !trusted(caller) {
            return Err(UNTRUSTED.into());
        }
        let list = args.as_array();
        if method == "windowAction" {
            if let Some([Value::String(action)]) = list.map(Vec::as_slice) {
                if WINDOW_ACTIONS.contains(&action.as_str()) {
                    return Ok(json!({ "ok": (self.window_action)(action) }));
                }
            }
        }
        let Some(list) = list.filter(|list| METHODS.contains(&method) && list.len() <= MAX_ARGS) else {
            return Err(INVALID.into());
        };
        if args.to_string().len() > MAX_BYTES {
            return Err(FAILED.into());
        }
        (self.request)(method, list).map_err(|_| FAILED.to_string())
    }

    pub fn open_external(&self, url: &str) {
        if url::Url::parse(url).is_ok_and(|parsed| parsed.scheme() == "https") {
            let _ = (self.request)("openExternal", &[Value::String(url.to_string())]);
        }
    }
}

pub fn bridge_script() -> String {
    format!(
        "(() => {{\nconst module = undefined;\n{PRELOAD}\nconst api = createManagerApi({{\n  ipcRenderer: {{ invoke: (_channel, method, args) => window.__TAURI_INTERNALS__.invoke('{COMMAND}', {{ method, args }}) }},\n  onUnload: (callback) => window.addEventListener('unload', callback, {{ once: true }}),\n  hidden: () => document.hidden,\n  onVisibility: (callback) => document.addEventListener('visibilitychange', callback),\n}});\nObject.defineProperty(window, 'api', {{ value: api, enumerable: true }});\n}})();\n"
    )
}
