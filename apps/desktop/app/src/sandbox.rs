//! The edits in progress on Settings → Sandbox.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! sandbox-form.tsx`: what counts as a change, when saving is allowed, and
//! what happens when the settings were changed somewhere else meanwhile.
//! The checks on what was typed live in the core (`raphie_core::sandbox`).

use raphie_core::contracts::{SandboxProvider, SandboxSettings};
use raphie_core::sandbox::{SandboxUpdate, parse_disk_quota, parse_idle_minutes};
use rune::TextEdit;

/// One bot's sandbox settings as the form shows them.
pub struct SandboxDraft {
    /// The bot and the settings these edits started from. `None` until a
    /// bot's settings have arrived.
    pub saved: Option<(String, SandboxSettings)>,
    pub provider: SandboxProvider,
    /// "I understand host and local network access".
    pub acknowledged: bool,
    pub idle: TextEdit,
    /// The disk quota in MiB; empty is no limit.
    pub quota: TextEdit,
    /// Whether the list of providers is open.
    pub choosing_provider: bool,
}

impl SandboxDraft {
    /// A form with no bot in it yet.
    pub fn empty() -> SandboxDraft {
        SandboxDraft {
            saved: None,
            provider: SandboxProvider::JustBash,
            acknowledged: false,
            idle: TextEdit::new(""),
            quota: TextEdit::new(""),
            choosing_provider: false,
        }
    }

    /// A form showing `bot_id`'s settings, with nothing changed.
    pub fn of(bot_id: &str, saved: &SandboxSettings) -> SandboxDraft {
        SandboxDraft {
            saved: Some((bot_id.to_owned(), saved.clone())),
            provider: saved.provider,
            acknowledged: saved.host_network_acknowledged,
            idle: TextEdit::new(saved.idle_minutes.to_string()),
            quota: TextEdit::new(quota_text(saved)),
            choosing_provider: false,
        }
    }

    pub fn bot_id(&self) -> Option<&str> {
        self.saved.as_ref().map(|(bot_id, _)| bot_id.as_str())
    }

    /// Whether anything differs from the saved settings. The text is
    /// compared as typed, so "030" counts as an edit of "30".
    pub fn is_dirty(&self) -> bool {
        self.saved.as_ref().is_some_and(|(_, saved)| {
            self.provider != saved.provider
                || self.acknowledged != saved.host_network_acknowledged
                || self.idle.text != saved.idle_minutes.to_string()
                || self.quota.text != quota_text(saved)
        })
    }

    /// What stops the form from being saved, in words for the owner.
    pub fn problem(&self) -> Option<&'static str> {
        if self.provider == SandboxProvider::Container && !self.acknowledged {
            return Some("Acknowledge host and local network access to use Container.");
        }
        if parse_idle_minutes(&self.idle.text).is_none() {
            return Some("Idle minutes are a whole number from 1 to 1440.");
        }
        if parse_disk_quota(&self.quota.text).is_none() {
            return Some("The disk quota is a whole number of MiB, or empty for no limit.");
        }
        None
    }

    /// What a save would send, or `None` while the form has a problem.
    pub fn update(&self) -> Option<SandboxUpdate> {
        let (_, saved) = self.saved.as_ref()?;
        if self.problem().is_some() {
            return None;
        }
        Some(SandboxUpdate {
            provider: self.provider,
            host_network_acknowledged: self.acknowledged,
            // `?` returns `None` if the text does not parse; `problem`
            // above already ruled that out.
            idle_minutes: parse_idle_minutes(&self.idle.text)?,
            disk_quota_mib: parse_disk_quota(&self.quota.text)?,
            revision: saved.revision,
        })
    }

    /// Whether `latest` is a newer revision than these edits started from.
    pub fn changed_elsewhere(&self, latest: &SandboxSettings) -> bool {
        self.saved
            .as_ref()
            .is_some_and(|(_, saved)| saved.revision != latest.revision)
    }
}

/// The quota as the field shows it: the number, or empty for no limit.
fn quota_text(settings: &SandboxSettings) -> String {
    settings
        .disk_quota_mib
        .map_or(String::new(), |quota| quota.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved() -> SandboxSettings {
        SandboxSettings {
            provider: SandboxProvider::JustBash,
            idle_minutes: 30,
            disk_quota_mib: None,
            host_network_acknowledged: false,
            revision: 4,
        }
    }

    #[test]
    fn a_fresh_form_has_nothing_to_save() {
        let draft = SandboxDraft::of("default", &saved());
        assert!(!draft.is_dirty());
        assert_eq!(draft.problem(), None);
        assert_eq!(draft.update().map(|update| update.revision), Some(4));
    }

    #[test]
    fn a_container_needs_the_acknowledgement() {
        let mut draft = SandboxDraft::of("default", &saved());
        draft.provider = SandboxProvider::Container;
        assert!(draft.is_dirty());
        assert!(draft.problem().unwrap().contains("Acknowledge"));
        assert_eq!(draft.update(), None);
        draft.acknowledged = true;
        draft.quota = TextEdit::new("2048");
        let update = draft.update().expect("a valid form");
        assert_eq!(update.disk_quota_mib, Some(2048));
        assert!(update.host_network_acknowledged);
    }

    #[test]
    fn typed_numbers_are_checked() {
        let mut draft = SandboxDraft::of("default", &saved());
        draft.idle = TextEdit::new("2000");
        assert!(draft.problem().unwrap().contains("Idle minutes"));
        draft.idle = TextEdit::new("60");
        draft.quota = TextEdit::new("a lot");
        assert!(draft.problem().unwrap().contains("disk quota"));
    }

    #[test]
    fn a_newer_revision_is_a_change_elsewhere() {
        let draft = SandboxDraft::of("default", &saved());
        assert!(!draft.changed_elsewhere(&saved()));
        let newer = SandboxSettings {
            revision: 5,
            ..saved()
        };
        assert!(draft.changed_elsewhere(&newer));
    }
}
