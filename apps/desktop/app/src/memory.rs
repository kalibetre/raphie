//! The edits in progress on Settings → Memory.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! memory-settings.tsx`: what counts as a change, and what a save sends. The
//! checks themselves live in the core (`raphie_core::memory`).

use raphie_core::auth::Secret;
use raphie_core::contracts::{MemoryConfiguration, MemoryProvider};
use raphie_core::memory::{KeyChange, MemoryUpdate};
use rune::TextEdit;

/// One bot's memory settings as the form shows them.
pub struct MemoryDraft {
    /// The bot and the settings these edits started from. `None` until a
    /// bot's settings have arrived.
    pub saved: Option<(String, MemoryConfiguration)>,
    pub enabled: bool,
    pub provider: MemoryProvider,
    pub scope: TextEdit,
    /// The Hindsight server's address.
    pub endpoint: TextEdit,
    pub bank_id: TextEdit,
    /// A new Hindsight API key. A secure field: it draws dots, and Rune
    /// wipes it from memory when it is cleared or dropped.
    pub key: TextEdit,
    /// Forget the saved key instead of keeping or replacing it.
    pub clear_key: bool,
    /// Whether the list of back ends is open.
    pub choosing_backend: bool,
}

impl MemoryDraft {
    /// A form with no bot in it yet.
    pub fn empty() -> MemoryDraft {
        MemoryDraft {
            saved: None,
            enabled: false,
            provider: MemoryProvider::Builtin,
            scope: TextEdit::new(""),
            endpoint: TextEdit::new(""),
            bank_id: TextEdit::new(""),
            key: TextEdit::new("").secure(),
            clear_key: false,
            choosing_backend: false,
        }
    }

    /// A form showing `bot_id`'s settings, with nothing changed.
    pub fn of(bot_id: &str, saved: &MemoryConfiguration) -> MemoryDraft {
        MemoryDraft {
            saved: Some((bot_id.to_owned(), saved.clone())),
            enabled: saved.enabled,
            provider: saved.provider,
            scope: TextEdit::new(saved.scope.clone()),
            endpoint: TextEdit::new(saved.endpoint.clone()),
            bank_id: TextEdit::new(saved.bank_id.clone()),
            ..MemoryDraft::empty()
        }
    }

    pub fn bot_id(&self) -> Option<&str> {
        // `as_ref` borrows the pair inside the `Option` instead of moving it.
        self.saved.as_ref().map(|(bot_id, _)| bot_id.as_str())
    }

    /// What a save would send. The key fields only apply to Hindsight;
    /// while they are hidden they never count and are never sent.
    pub fn update(&self) -> MemoryUpdate {
        let key = if self.provider != MemoryProvider::Hindsight {
            KeyChange::Keep
        } else if self.clear_key {
            KeyChange::Clear
        } else if self.key.text.is_empty() {
            KeyChange::Keep
        } else {
            KeyChange::Replace(Secret::new(self.key.text.as_str()))
        };
        MemoryUpdate {
            enabled: self.enabled,
            provider: self.provider,
            scope: self.scope.text.clone(),
            endpoint: self.endpoint.text.clone(),
            bank_id: self.bank_id.text.clone(),
            key,
        }
    }

    /// Whether anything differs from the saved settings.
    pub fn is_dirty(&self) -> bool {
        self.saved
            .as_ref()
            .is_some_and(|(_, saved)| self.update().changes(saved))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved() -> MemoryConfiguration {
        MemoryConfiguration {
            enabled: true,
            provider: MemoryProvider::Hindsight,
            scope: "owner".into(),
            endpoint: "http://127.0.0.1:8888".into(),
            bank_id: "raphie".into(),
            has_credential: true,
        }
    }

    #[test]
    fn a_fresh_form_has_nothing_to_save() {
        let draft = MemoryDraft::of("default", &saved());
        assert!(!draft.is_dirty());
        assert_eq!(draft.update().key, KeyChange::Keep);
    }

    #[test]
    fn the_key_is_replaced_cleared_or_kept() {
        let mut draft = MemoryDraft::of("default", &saved());
        draft.key = TextEdit::new("hs-not-a-real-key").secure();
        assert!(draft.is_dirty());
        assert!(matches!(draft.update().key, KeyChange::Replace(_)));
        draft.clear_key = true;
        assert_eq!(draft.update().key, KeyChange::Clear);
        // Built-in memory has no key: a typed one is not sent.
        draft.provider = MemoryProvider::Builtin;
        assert_eq!(draft.update().key, KeyChange::Keep);
    }
}
