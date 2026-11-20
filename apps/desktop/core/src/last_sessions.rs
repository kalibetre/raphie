//! The conversation last open with each bot, so choosing a bot again goes
//! back to it instead of a new one. Mirrors the web's `last-session`
//! entries in the browser; this file is this computer's.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::flavor::Flavor;

/// For every Raphie this computer has signed in to, by origin: each bot's
/// last open session. `#[serde(transparent)]` writes the bare map.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct LastSessions {
    origins: HashMap<String, HashMap<String, String>>,
}

impl LastSessions {
    /// `<config dir>/raphie-desktop/last-sessions.json`, beside the settings.
    pub fn default_path() -> Option<PathBuf> {
        Some(
            dirs::config_dir()?
                .join(Flavor::current().config_folder())
                .join("last-sessions.json"),
        )
    }

    /// A missing or unreadable file is simply empty: a bot then opens on a
    /// new conversation, as it did before.
    pub fn load(path: &Path) -> LastSessions {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        std::fs::write(path, json)
    }

    /// The session last open with `bot_id` on `origin`.
    pub fn get(&self, origin: &str, bot_id: &str) -> Option<&str> {
        self.origins.get(origin)?.get(bot_id).map(String::as_str)
    }

    /// Notes `session_id` as open with `bot_id`. Returns true when that is
    /// news, so the file is written only on a change.
    pub fn set(&mut self, origin: &str, bot_id: &str, session_id: &str) -> bool {
        let bots = self.origins.entry(origin.to_owned()).or_default();
        if bots.get(bot_id).map(String::as_str) == Some(session_id) {
            return false;
        }
        bots.insert(bot_id.to_owned(), session_id.to_owned());
        true
    }

    /// Forgets `session_id` wherever it is the last one, as when it is
    /// deleted. Returns true when something was forgotten.
    pub fn forget(&mut self, origin: &str, session_id: &str) -> bool {
        let Some(bots) = self.origins.get_mut(origin) else {
            return false;
        };
        let before = bots.len();
        bots.retain(|_, id| id != session_id);
        bots.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_bot_keeps_its_own_last_session_per_raphie() {
        let mut last = LastSessions::default();
        assert_eq!(last.get("https://a", "default"), None);
        assert!(last.set("https://a", "default", "s-1"));
        assert!(!last.set("https://a", "default", "s-1"), "no news");
        assert!(last.set("https://a", "research", "s-2"));
        assert!(last.set("https://b", "default", "s-9"));
        assert_eq!(last.get("https://a", "default"), Some("s-1"));
        assert_eq!(last.get("https://a", "research"), Some("s-2"));
        assert_eq!(last.get("https://b", "default"), Some("s-9"));
        assert!(last.forget("https://a", "s-2"));
        assert_eq!(last.get("https://a", "research"), None);
        assert!(!last.forget("https://a", "s-2"));
    }

    #[test]
    fn round_trips_and_tolerates_a_missing_file() {
        let dir = std::env::temp_dir().join(format!("raphie-last-{}", std::process::id()));
        let path = dir.join("last-sessions.json");
        assert_eq!(LastSessions::load(&path), LastSessions::default());
        let mut last = LastSessions::default();
        last.set("https://a", "default", "s-1");
        last.save(&path).unwrap();
        assert_eq!(LastSessions::load(&path), last);
        let _ = std::fs::remove_dir_all(dir);
    }
}
