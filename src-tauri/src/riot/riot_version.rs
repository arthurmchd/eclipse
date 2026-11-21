use crate::platform::windows::login_form::FillFailure;

pub const LAST_TESTED_MAJOR: u32 = 143;
pub const NEWER_RIOT: &str = "Eclipse does not recognize this newer Riot Client yet. Finish signing in there and check for an Eclipse update. Riot Client ";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RiotVersion(pub [u32; 4]);

impl RiotVersion {
    pub fn major(self) -> u32 {
        self.0[0]
    }

    pub fn newer_than_tested(self) -> bool {
        self.major() > LAST_TESTED_MAJOR
    }

    pub fn text(self) -> String {
        let [a, b, c, d] = self.0;
        format!("{a}.{b}.{c}.{d}")
    }
}

pub fn version_line(version: Option<RiotVersion>) -> String {
    match version {
        Some(version) if version.newer_than_tested() => format!("Riot Client {} (newer than the last tested, {LAST_TESTED_MAJOR})", version.text()),
        Some(version) => format!("Riot Client {}", version.text()),
        None => "Riot Client version unknown".to_string(),
    }
}

pub fn layout_failure(failure: FillFailure) -> bool {
    matches!(failure, FillFailure::FormNotReady | FillFailure::InputFailed | FillFailure::Failed)
}

pub fn newer_riot_message(version: Option<RiotVersion>, failure: FillFailure) -> Option<String> {
    version.filter(|version| version.newer_than_tested() && layout_failure(failure)).map(|version| format!("{NEWER_RIOT}{}", version.major()))
}
