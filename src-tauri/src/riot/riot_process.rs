use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

use super::{RiotError, RiotResult};
use crate::platform::windows::windows_environment::environment_for_riot;

const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub exe: String,
    pub args: Vec<String>,
    pub hidden: bool,
    pub flags: u32,
    pub environment: HashMap<String, String>,
}

pub fn plan(exe: &str, visible: bool, environment: HashMap<String, String>) -> LaunchPlan {
    let flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | if visible { 0 } else { CREATE_NO_WINDOW };
    LaunchPlan {
        exe: exe.to_string(),
        args: if visible { Vec::new() } else { vec!["--headless".to_string()] },
        hidden: !visible,
        flags,
        environment,
    }
}

pub fn launch_with(exe: &str, visible: bool, spawn: &dyn Fn(&LaunchPlan) -> std::io::Result<()>) -> RiotResult<()> {
    spawn(&plan(exe, visible, environment_for_riot())).map_err(|_| RiotError::new("Could not start the Riot Client. Check its path and Windows permissions"))
}

pub fn spawn_detached(plan: &LaunchPlan) -> std::io::Result<()> {
    Command::new(&plan.exe)
        .args(&plan.args)
        .env_clear()
        .envs(&plan.environment)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(plan.flags)
        .spawn()
        .map(|_| ())
}

pub fn launch_client(exe: &str, visible: bool) -> RiotResult<()> {
    launch_with(exe, visible, &spawn_detached)
}
