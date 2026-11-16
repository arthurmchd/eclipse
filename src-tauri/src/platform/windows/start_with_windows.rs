use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use winreg::types::FromRegValue;

pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
pub const APPROVED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
pub const ENABLED: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

pub trait StartupRegistry: Send + Sync {
    fn entries(&self) -> io::Result<Vec<(String, String)>>;
    fn approval(&self, name: &str) -> io::Result<Option<Vec<u8>>>;
    fn write_entry(&self, name: &str, command: &str) -> io::Result<()>;
    fn write_approval(&self, name: &str, bytes: &[u8]) -> io::Result<()>;
    fn remove(&self, name: &str) -> io::Result<()>;
}

pub struct UserRegistry;

fn missing_is_fine(result: io::Result<()>) -> io::Result<()> {
    match result {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

impl StartupRegistry for UserRegistry {
    fn entries(&self) -> io::Result<Vec<(String, String)>> {
        let user = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let key = match user.open_subkey(RUN_KEY) {
            Ok(key) => key,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        Ok(key.enum_values().filter_map(Result::ok).filter_map(|(name, value)| String::from_reg_value(&value).ok().map(|command| (name, command))).collect())
    }

    fn approval(&self, name: &str) -> io::Result<Option<Vec<u8>>> {
        let user = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let key = match user.open_subkey(APPROVED_KEY) {
            Ok(key) => key,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        match key.get_raw_value(name) {
            Ok(value) => Ok(Some(value.bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn write_entry(&self, name: &str, command: &str) -> io::Result<()> {
        let user = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let (key, _) = user.create_subkey(RUN_KEY)?;
        key.set_value(name, &command.to_string())
    }

    fn write_approval(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        let user = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let (key, _) = user.create_subkey(APPROVED_KEY)?;
        key.set_raw_value(name, &winreg::RegValue { bytes: bytes.to_vec(), vtype: winreg::enums::RegType::REG_BINARY })
    }

    fn remove(&self, name: &str) -> io::Result<()> {
        let user = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        for path in [RUN_KEY, APPROVED_KEY] {
            match user.open_subkey_with_flags(path, winreg::enums::KEY_SET_VALUE) {
                Ok(key) => missing_is_fine(key.delete_value(name))?,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
}

pub fn command_path(command: &str) -> String {
    let command = command.trim();
    match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or_default().to_string(),
        None => command.to_string(),
    }
}

fn same_path(a: &str, b: &Path) -> bool {
    let normal = |text: &str| text.replace('/', "\\").to_lowercase();
    normal(a) == normal(&b.to_string_lossy())
}

pub fn approved(bytes: Option<&[u8]>) -> bool {
    bytes.and_then(|bytes| bytes.first()).is_none_or(|first| first % 2 == 0)
}

pub struct StartWithWindows {
    registry: Arc<dyn StartupRegistry>,
    exec_path: PathBuf,
    name: String,
    packaged: bool,
    log: Box<dyn Fn(&str) + Send + Sync>,
}

impl StartWithWindows {
    pub fn new(registry: Arc<dyn StartupRegistry>, exec_path: PathBuf, name: &str, packaged: bool, log: Box<dyn Fn(&str) + Send + Sync>) -> Self {
        Self { registry, exec_path, name: name.to_string(), packaged, log }
    }

    pub fn available(&self) -> bool {
        self.packaged
    }

    fn own_entries(&self) -> io::Result<Vec<String>> {
        Ok(self.registry.entries()?.into_iter().filter(|(_, command)| same_path(&command_path(command), &self.exec_path)).map(|(name, _)| name).collect())
    }

    fn read(&self) -> io::Result<bool> {
        for name in self.own_entries()? {
            if approved(self.registry.approval(&name)?.as_deref()) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn enabled(&self) -> bool {
        self.available() && self.read().unwrap_or(false)
    }

    fn write(&self, on: bool) -> io::Result<()> {
        if on {
            self.registry.write_entry(&self.name, &format!("\"{}\"", self.exec_path.display()))?;
            return self.registry.write_approval(&self.name, &ENABLED);
        }
        let mut names = vec![self.name.clone()];
        for name in self.own_entries()? {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        for name in names {
            self.registry.remove(&name)?;
        }
        Ok(())
    }

    pub fn set(&self, on: bool) -> bool {
        if !self.available() {
            return false;
        }
        if self.write(on).is_err() {
            (self.log)(&format!("could not turn {} the start with Windows", if on { "on" } else { "off" }));
        }
        self.enabled()
    }
}
