use serde_json::Value;

use crate::application::language::{localize, main_text};

pub const APP_NAME: &str = "Eclipse";
pub const MAX_CHARS: usize = 240;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub title: String,
    pub text: String,
}

pub trait Notifier: Send + Sync {
    fn show(&self, notice: &Notice);
}

pub fn clip(text: &str) -> String {
    text.chars().take(MAX_CHARS).collect()
}

fn text_of(value: &Value) -> &str {
    value.get("text").and_then(Value::as_str).unwrap_or_default()
}

pub fn operation_notice(operation: &Value, language: Option<&str>) -> Option<Notice> {
    (operation.get("status").and_then(Value::as_str) == Some("failed")).then(|| Notice { title: main_text(language).game_failed.to_string(), text: clip(text_of(operation)) })
}

pub fn status_notice(payload: &Value, language: Option<&str>) -> Option<Notice> {
    (payload.get("needsAttention") == Some(&Value::Bool(true))).then(|| Notice { title: main_text(language).needs_attention.to_string(), text: clip(text_of(payload)) })
}

pub fn error_notice(message: &str, language: Option<&str>) -> Notice {
    Notice { title: APP_NAME.to_string(), text: clip(&localize(message, language)) }
}
