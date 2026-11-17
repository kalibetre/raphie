//! Non-secret preferences kept between launches: the last origin and the
//! chosen appearance.
//!
//! Tokens never go here; they live in the OS credential store
//! ([`crate::auth::KeychainStore`]).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::flavor::Flavor;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Settings {
    /// The last origin signed in to, offered again at launch.
    pub origin: Option<String>,
    /// Light, dark, or whatever the system uses. `#[serde(default)]` lets
    /// settings files written before this field existed still load.
    #[serde(default)]
    pub theme: ThemeChoice,
    /// Models starred in the composer's picker, as
    /// [`crate::model_library::favorite_key`]s. Kept on this computer, as
    /// the web keeps its own in the browser.
    #[serde(default)]
    pub model_favorites: Vec<String>,
    /// The bot roster's width in points, once dragged. Whole points, so the
    /// settings stay comparable (`Eq`); `None` keeps the default. Files
    /// from before the conversations moved into the roster also hold a
    /// `panel_width`; unknown fields are ignored, so they still load.
    #[serde(default)]
    pub roster_width: Option<u32>,
}

/// The appearance chosen in Settings → Appearance.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeChoice {
    /// Follow the operating system.
    #[default]
    System,
    Light,
    Dark,
}

impl Settings {
    /// `<config dir>/raphie-desktop/settings.json`, e.g.
    /// `~/Library/Application Support/raphie-desktop/settings.json` on
    /// macOS. The dev build's folder is `raphie-desktop-dev`
    /// ([`Flavor::config_folder`]).
    pub fn default_path() -> Option<PathBuf> {
        Some(
            dirs::config_dir()?
                .join(Flavor::current().config_folder())
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
            theme: ThemeChoice::Dark,
            model_favorites: vec!["openrouter-1:anthropic/claude".into()],
            roster_width: Some(300),
        };
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path), settings);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_from_before_the_theme_existed_still_load() {
        let old: Settings = serde_json::from_str(r#"{"origin":"https://raphie.example"}"#).unwrap();
        assert_eq!(old.theme, ThemeChoice::System);
        assert_eq!(old.origin.as_deref(), Some("https://raphie.example"));
        // Nor had the column widths: the defaults apply.
        assert_eq!(old.roster_width, None);
    }

    #[test]
    fn settings_saved_with_the_old_conversations_panel_still_load() {
        let old: Settings = serde_json::from_str(
            r#"{"origin":"https://raphie.example","roster_width":300,"panel_width":420}"#,
        )
        .unwrap();
        assert_eq!(old.roster_width, Some(300));
        assert_eq!(old.origin.as_deref(), Some("https://raphie.example"));
    }
}
