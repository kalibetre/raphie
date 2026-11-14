//! Settings → Memory: what a save carries, and the checks made before one
//! is sent.
//!
//! The limits are the runtime's (`memoryConfigurationInput` in
//! `packages/runtime/src/domains/memory/infrastructure/runtime-memory.ts`),
//! repeated here so the owner hears about a mistake before sending. The
//! runtime still checks everything itself, and its word is final.

use crate::auth::Secret;
use crate::contracts::{MemoryConfiguration, MemoryProvider};

/// What to do with the Hindsight API key the runtime holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeyChange {
    /// Leave the saved key as it is.
    Keep,
    /// Save this key in its place.
    Replace(Secret),
    /// Forget the saved key.
    Clear,
}

/// One save of a bot's memory settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryUpdate {
    pub enabled: bool,
    pub provider: MemoryProvider,
    pub scope: String,
    pub endpoint: String,
    pub bank_id: String,
    pub key: KeyChange,
}

impl MemoryUpdate {
    /// Whether this save would change anything in `saved`.
    pub fn changes(&self, saved: &MemoryConfiguration) -> bool {
        self.enabled != saved.enabled
            || self.provider != saved.provider
            || self.scope != saved.scope
            || self.endpoint != saved.endpoint
            || self.bank_id != saved.bank_id
            || self.key != KeyChange::Keep
    }

    /// What is wrong with these settings, if anything, in words for the
    /// owner.
    pub fn problem(&self) -> Option<&'static str> {
        if !is_identifier(&self.scope) {
            return Some("The scope takes up to 80 letters, numbers, underscores or hyphens.");
        }
        if self.provider == MemoryProvider::Hindsight {
            if self.endpoint.trim().is_empty() {
                return Some("Enter the Hindsight endpoint.");
            }
            if !is_identifier(&self.bank_id) {
                return Some(
                    "The bank ID takes up to 80 letters, numbers, underscores or hyphens.",
                );
            }
        }
        if let KeyChange::Replace(key) = &self.key
            && key.expose().chars().any(char::is_whitespace)
        {
            return Some("An API key has no spaces.");
        }
        None
    }
}

/// The runtime's rule for a scope and a bank ID: `[a-zA-Z0-9_-]{1,80}`.
fn is_identifier(text: &str) -> bool {
    (1..=80).contains(&text.len())
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update() -> MemoryUpdate {
        MemoryUpdate {
            enabled: true,
            provider: MemoryProvider::Builtin,
            scope: "owner".into(),
            endpoint: String::new(),
            bank_id: String::new(),
            key: KeyChange::Keep,
        }
    }

    #[test]
    fn built_in_memory_needs_only_a_scope() {
        assert_eq!(update().problem(), None);
        let spaced = MemoryUpdate {
            scope: "my scope".into(),
            ..update()
        };
        assert!(spaced.problem().unwrap().contains("scope"));
        let long = MemoryUpdate {
            scope: "a".repeat(81),
            ..update()
        };
        assert!(long.problem().is_some());
    }

    #[test]
    fn hindsight_needs_an_endpoint_and_a_bank() {
        let hindsight = MemoryUpdate {
            provider: MemoryProvider::Hindsight,
            ..update()
        };
        assert!(hindsight.problem().unwrap().contains("endpoint"));
        let no_bank = MemoryUpdate {
            endpoint: "http://127.0.0.1:8888".into(),
            ..hindsight.clone()
        };
        assert!(no_bank.problem().unwrap().contains("bank"));
        let ready = MemoryUpdate {
            bank_id: "raphie".into(),
            ..no_bank
        };
        assert_eq!(ready.problem(), None);
        let spaced_key = MemoryUpdate {
            key: KeyChange::Replace(Secret::new("two words")),
            ..ready
        };
        assert!(spaced_key.problem().unwrap().contains("key"));
    }

    #[test]
    fn a_key_change_alone_counts_as_a_change() {
        let saved = MemoryConfiguration {
            enabled: true,
            provider: MemoryProvider::Builtin,
            scope: "owner".into(),
            endpoint: String::new(),
            bank_id: String::new(),
            has_credential: true,
        };
        assert!(!update().changes(&saved));
        let cleared = MemoryUpdate {
            key: KeyChange::Clear,
            ..update()
        };
        assert!(cleared.changes(&saved));
    }
}
