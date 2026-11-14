//! The edits in progress on Settings → Profile, and the rules for saving
//! them.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! bot-profile-form.tsx`: what counts as a change, when saving is allowed,
//! and what happens when the bot was changed somewhere else meanwhile.

use raphie_core::contracts::{BotProfile, UpdateBotProfile};
use rune::TextEdit;

/// The runtime's limits (`packages/runtime/src/domains/bots/presentation/
/// http/routes.ts`), checked here so the owner hears before sending.
const NAME_LIMIT: usize = 80;
const DESCRIPTION_LIMIT: usize = 500;
const SOUL_LIMIT: usize = 16_000;

/// One bot's profile as the form shows it.
pub struct ProfileDraft {
    /// The profile these edits started from. `None` until a bot's profile
    /// has been opened.
    pub saved: Option<BotProfile>,
    pub name: TextEdit,
    pub description: TextEdit,
    /// The personality (SOUL.md).
    pub soul: TextEdit,
    /// The chosen colour as `#rrggbb`, or `None` to let Raphie pick.
    pub color: Option<String>,
    /// A custom colour being typed.
    pub custom_color: TextEdit,
    /// What the last save said, until the next edit ("Saved revision 4.").
    pub message: Option<String>,
}

impl ProfileDraft {
    /// A form with no bot in it yet.
    pub fn empty() -> ProfileDraft {
        ProfileDraft {
            saved: None,
            name: TextEdit::new(""),
            description: TextEdit::new(""),
            soul: TextEdit::new(""),
            color: None,
            custom_color: TextEdit::new(""),
            message: None,
        }
    }

    /// A form showing `profile`, with nothing changed.
    pub fn of(profile: &BotProfile) -> ProfileDraft {
        ProfileDraft {
            saved: Some(profile.clone()),
            name: TextEdit::new(profile.name.clone()),
            description: TextEdit::new(profile.description.clone()),
            soul: TextEdit::new(profile.soul.clone()),
            color: profile.color.clone(),
            custom_color: TextEdit::new(profile.color.clone().unwrap_or_default()),
            message: None,
        }
    }

    /// The bot this form edits.
    pub fn bot_id(&self) -> Option<&str> {
        self.saved.as_ref().map(|saved| saved.id.as_str())
    }

    /// Whether anything differs from the profile the edits started from.
    pub fn is_dirty(&self) -> bool {
        // `is_some_and` is false for `None`: an empty form has no changes.
        self.saved.as_ref().is_some_and(|saved| {
            self.name.text != saved.name
                || self.description.text != saved.description
                || self.soul.text != saved.soul
                || self.color != saved.color
        })
    }

    /// Whether `latest` (the bot as the host has it now) was saved by
    /// someone else since these edits started.
    pub fn changed_elsewhere(&self, latest: &BotProfile) -> bool {
        self.saved
            .as_ref()
            .is_some_and(|saved| saved.revision != latest.revision)
    }

    /// Why the form cannot be saved as it is, if it cannot.
    pub fn problem(&self) -> Option<&'static str> {
        // `chars().count()` counts characters; `len()` would count bytes.
        let length = |edit: &TextEdit| edit.text.trim().chars().count();
        if length(&self.name) == 0 {
            Some("Give this bot a name.")
        } else if length(&self.name) > NAME_LIMIT {
            Some("A name can be at most 80 characters.")
        } else if length(&self.description) > DESCRIPTION_LIMIT {
            Some("A description can be at most 500 characters.")
        } else if length(&self.soul) == 0 {
            Some("Give this bot a personality.")
        } else if length(&self.soul) > SOUL_LIMIT {
            Some("A personality can be at most 16,000 characters.")
        } else {
            None
        }
    }

    /// The request that saves this form, or `None` for an empty form.
    pub fn update(&self) -> Option<UpdateBotProfile> {
        let saved = self.saved.as_ref()?;
        Some(UpdateBotProfile {
            name: self.name.text.trim().to_owned(),
            description: self.description.text.trim().to_owned(),
            soul: self.soul.text.trim().to_owned(),
            color: self.color.clone(),
            revision: saved.revision,
        })
    }

    /// Takes the custom colour field as the colour, if it is `#rrggbb`.
    /// Returns false, changing nothing, when it is not.
    pub fn use_custom_color(&mut self) -> bool {
        let typed = self.custom_color.text.trim().to_lowercase();
        let digits = typed.strip_prefix('#').unwrap_or("");
        let valid = digits.len() == 6 && digits.chars().all(|c| c.is_ascii_hexdigit());
        if valid {
            self.color = Some(typed);
            self.message = None;
        }
        valid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn research() -> BotProfile {
        BotProfile {
            id: "b-research".into(),
            name: "Research".into(),
            description: "Reads papers".into(),
            color: None,
            soul: "Be brief.".into(),
            revision: 3,
        }
    }

    #[test]
    fn a_fresh_form_has_no_changes_and_any_edit_is_one() {
        let mut draft = ProfileDraft::of(&research());
        assert!(!draft.is_dirty());
        draft.description = TextEdit::new("Reads and summarises");
        assert!(draft.is_dirty());
        let update = draft.update().unwrap();
        assert_eq!((update.revision, update.color), (3, None));
        assert_eq!(update.description, "Reads and summarises");
        assert!(!ProfileDraft::empty().is_dirty());
    }

    #[test]
    fn a_name_and_a_personality_are_required_within_the_limits() {
        let mut draft = ProfileDraft::of(&research());
        assert_eq!(draft.problem(), None);
        draft.name = TextEdit::new("   ");
        assert_eq!(draft.problem(), Some("Give this bot a name."));
        draft.name = TextEdit::new("é".repeat(81));
        assert!(draft.problem().unwrap().contains("80 characters"));
        draft.name = TextEdit::new("é".repeat(80));
        assert_eq!(draft.problem(), None, "80 characters, not 80 bytes");
        draft.soul = TextEdit::new("");
        assert_eq!(draft.problem(), Some("Give this bot a personality."));
    }

    #[test]
    fn a_custom_colour_must_be_six_hex_digits() {
        let mut draft = ProfileDraft::of(&research());
        for wrong in ["", "b5c99b", "#b5c99", "#b5c99bff", "#b5c9zz"] {
            draft.custom_color = TextEdit::new(wrong);
            assert!(!draft.use_custom_color(), "{wrong}");
            assert_eq!(draft.color, None);
        }
        draft.custom_color = TextEdit::new(" #B5C99B ");
        assert!(draft.use_custom_color());
        assert_eq!(draft.color.as_deref(), Some("#b5c99b"));
        assert!(draft.is_dirty());
    }

    #[test]
    fn a_newer_revision_means_it_changed_elsewhere() {
        let draft = ProfileDraft::of(&research());
        let mut latest = research();
        assert!(!draft.changed_elsewhere(&latest));
        latest.revision = 4;
        assert!(draft.changed_elsewhere(&latest));
    }
}
