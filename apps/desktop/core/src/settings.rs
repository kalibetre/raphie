//! Non-secret preferences kept between launches: just the last origin.
//!
//! Tokens never go here; they live in the OS credential store
//! ([`crate::auth::KeychainStore`]).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Settings {
    /// The last origin signed in to, offered again at launch.
    pub origin: Option<String>,
}

impl Settings {
    /// `<config dir>/raphie-desktop/settings.json`, e.g.
    /// `~/Library/Application Support/raphie-desktop/settings.json` on macOS.
    pub fn default_path() -> Option<PathBuf> {
        Some(
            dirs::config_dir()?
                .join("raphie-desktop")
                .join("settings.json"),
        )
    }

    /// Missing or unreadable settings are simply empty: they are a convenience.
    pub fn load(path: &Path) -> Settings {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_tolerates_a_missing_file() {
        let dir = std::env::temp_dir().join(format!("raphie-settings-{}", std::process::id()));
        let path = dir.join("nested").join("settings.json");
        assert_eq!(Settings::load(&path), Settings::default());
        let settings = Settings {
            origin: Some("http://127.0.0.1:4321".into()),
        };
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path), settings);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
