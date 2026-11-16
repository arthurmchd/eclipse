use std::sync::Arc;

use serde_json::Value;

use super::{LocalApi, RiotError, RiotResult};

pub const FLAG: &str = "/client-feature-flags/v1/flags/lifecycle.backgroundRunning/enabled";
pub const PLAYER_CHOICE: &str = "/data-store/v1/install-settings/lifecycle/enable_run_in_background_set_by_player";
pub const COMMAND_LINE: &str = "/riotclientapp/v1/command-line-args";
pub const FROM_XBOX: &str = "/product-launcher/v1/launching_from_xbgp";
pub const XBOX_RUNNING: &str = "/riotclientapp/v1/isXbgpRunning";
pub const XBOX_NOTICE_DISMISSED: &str = "/data-store/v1/install-settings/lifecycle/xbox_background_running_notification_dismissed";
pub const CLOSE_READS: [&str; 6] = [FLAG, PLAYER_CHOICE, COMMAND_LINE, FROM_XBOX, XBOX_RUNNING, XBOX_NOTICE_DISMISSED];
pub const SWITCH_TO_BACKGROUND: &str = "/riot-client-lifecycle/v1/quit/switch-background-mode";
pub const QUIT: &str = "/riot-client-lifecycle/v1/quit";

#[derive(Debug, Clone, Default)]
pub struct CloseSettings {
    pub flag: Option<Value>,
    pub player_choice: Option<Value>,
    pub command_line: Option<Value>,
    pub from_xbox: Option<Value>,
    pub xbox_running: Option<Value>,
    pub xbox_notice_dismissed: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseMode {
    Background,
    Quit,
}

fn truthy(value: &Option<Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Number(number)) => number.as_f64().is_some_and(|number| number != 0.0 && !number.is_nan()),
        Some(_) => true,
    }
}

pub fn close_mode(settings: &CloseSettings) -> CloseMode {
    if !truthy(&settings.xbox_notice_dismissed) && !truthy(&settings.player_choice) && truthy(&settings.xbox_running) {
        return CloseMode::Background;
    }
    if !truthy(&settings.flag) && !truthy(&settings.from_xbox) {
        return CloseMode::Quit;
    }
    let run_in_background = match &settings.player_choice {
        Some(Value::Bool(choice)) => *choice,
        _ => true,
    };
    let background_launch = settings
        .command_line
        .as_ref()
        .and_then(Value::as_array)
        .is_some_and(|args| args.iter().any(|arg| arg.as_str().is_some_and(|arg| arg.contains("--launch-background-mode"))));
    if run_in_background || background_launch || truthy(&settings.from_xbox) {
        CloseMode::Background
    } else {
        CloseMode::Quit
    }
}

pub struct RiotAppControls {
    request: Arc<dyn LocalApi>,
}

impl RiotAppControls {
    pub fn new(request: Arc<dyn LocalApi>) -> Self {
        Self { request }
    }

    fn read(&self, path: &str) -> RiotResult<Option<Value>> {
        let response = self.request.get(path)?;
        Ok(if response.accepted() { Some(response.json) } else { None })
    }

    pub fn close(&self) -> RiotResult<CloseMode> {
        let settings = CloseSettings {
            flag: self.read(FLAG)?,
            player_choice: self.read(PLAYER_CHOICE)?,
            command_line: self.read(COMMAND_LINE)?,
            from_xbox: self.read(FROM_XBOX)?,
            xbox_running: self.read(XBOX_RUNNING)?,
            xbox_notice_dismissed: self.read(XBOX_NOTICE_DISMISSED)?,
        };
        let mode = close_mode(&settings);
        let target = if mode == CloseMode::Background { SWITCH_TO_BACKGROUND } else { QUIT };
        if !self.request.post(target)?.accepted() {
            return Err(RiotError::new("The Riot Client did not accept the close request"));
        }
        Ok(mode)
    }
}
