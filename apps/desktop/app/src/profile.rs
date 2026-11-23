//! The edits in progress on Settings → Profile, and the rules for saving
//! them.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! bot-profile-form.tsx`: what counts as a change, when saving is allowed,
//! and what happens when the bot was changed somewhere else meanwhile.

use raphie_core::contracts::{BotProfile, NewBot, ReplyStyle, SelfUpdates, UpdateBotProfile};
use rune::TextEdit;

/// The runtime's limits (`packages/runtime/src/domains/bots/presentation/
/// http/routes.ts`), checked here so the owner hears before sending.
const NAME_LIMIT: usize = 80;
const DESCRIPTION_LIMIT: usize = 500;
const PERSONALITY_LIMIT: usize = 16_000;
const INSTRUCTIONS_LIMIT: usize = 16_000;

/// The personality a new bot starts with, as the web offers it.
pub const STARTER_PERSONALITY: &str = "Be thoughtful and candid. Explain uncertainty. Never claim an action succeeded without confirmation.";

/// Where an unsaved "Create a bot" form is kept while the owner looks at
/// another page. Bot ids never look like this.
pub const NEW_BOT: &str = "new-bot";

/// One bot's profile as the form shows it.
pub struct ProfileDraft {
    /// The profile these edits started from. `None` until a bot's profile
    /// has been opened.
    pub saved: Option<BotProfile>,
    pub name: TextEdit,
    pub description: TextEdit,
    /// The personality the owner wrote.
    pub personality: TextEdit,
    /// The chosen colour as `#rrggbb`, or `None` to let Raphie pick.
    pub color: Option<String>,
    /// How the bot writes its replies.
    pub reply_style: ReplyStyle,
    /// What the bot may change by itself. `None` when the runtime is too
    /// old to say: the switches stay hidden and a save leaves them out.
    pub self_updates: Option<SelfUpdates>,
    /// The bot's instructions on its tools as they are edited.
    pub instructions: TextEdit,
    /// A custom colour being typed.
    pub custom_color: TextEdit,
    /// What the last save said, until the next edit ("Saved revision 4.").
    pub message: Option<String>,
    /// This form describes a bot that does not exist yet ("Create a bot").
    pub creating: bool,
}

impl ProfileDraft {
    /// A form with no bot in it yet.
    pub fn empty() -> ProfileDraft {
        ProfileDraft {
            saved: None,
            name: TextEdit::new(""),
            description: TextEdit::new(""),
            personality: TextEdit::new(""),
            color: None,
            reply_style: ReplyStyle::default(),
            self_updates: None,
            instructions: TextEdit::new(""),
            custom_color: TextEdit::new(""),
            message: None,
            creating: false,
        }
    }

    /// The "Create a bot" form as it opens: a starter personality, and
    /// nothing else filled in.
    pub fn new_bot() -> ProfileDraft {
        ProfileDraft {
            personality: TextEdit::new(STARTER_PERSONALITY),
            self_updates: Some(SelfUpdates::NEW_BOT),
            creating: true,
            ..ProfileDraft::empty()
        }
    }

    /// A form showing `profile`, with nothing changed.
    pub fn of(profile: &BotProfile) -> ProfileDraft {
        ProfileDraft {
            saved: Some(profile.clone()),
            name: TextEdit::new(profile.name.clone()),
            description: TextEdit::new(profile.description.clone()),
            personality: TextEdit::new(profile.personality.clone()),
            color: profile.color.clone(),
            reply_style: profile.reply_style,
            self_updates: profile.self_updates,
            instructions: TextEdit::new(profile.instructions.clone()),
            custom_color: TextEdit::new(profile.color.clone().unwrap_or_default()),
            message: None,
            creating: false,
        }
    }

    /// The bot this form edits.
    pub fn bot_id(&self) -> Option<&str> {
        self.saved.as_ref().map(|saved| saved.id.as_str())
    }

    /// The name an unsaved form is kept under while another page shows:
    /// the bot's id, or [`NEW_BOT`] for a bot being created.
    pub fn park_key(&self) -> Option<&str> {
        if self.creating {
            Some(NEW_BOT)
        } else {
            self.bot_id()
        }
    }

    /// Whether anything differs from the profile the edits started from
    /// or, for a new bot, from the form as it opened.
    pub fn is_dirty(&self) -> bool {
        if self.creating {
            return !self.name.text.is_empty()
                || !self.description.text.is_empty()
                || self.personality.text != STARTER_PERSONALITY
                || self.color.is_some()
                || self.reply_style != ReplyStyle::default()
                || self.self_updates != Some(SelfUpdates::NEW_BOT);
        }
        // `is_some_and` is false for `None`: an empty form has no changes.
        self.saved.as_ref().is_some_and(|saved| {
            self.name.text != saved.name
                || self.description.text != saved.description
                || self.personality.text != saved.personality
                || self.color != saved.color
                || self.reply_style != saved.reply_style
                || self.self_updates != saved.self_updates
                || self.instructions.text.trim() != saved.instructions
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
        } else if length(&self.personality) == 0 {
            Some("Give this bot a personality.")
        } else if length(&self.personality) > PERSONALITY_LIMIT {
            Some("A personality can be at most 16,000 characters.")
        } else if length(&self.instructions) > INSTRUCTIONS_LIMIT {
            Some("Instructions can be at most 16,000 characters.")
        } else {
            None
        }
    }

    /// Everything that stops a save, the form's own fields first.
    pub fn blocker(&self) -> Option<String> {
        self.problem().map(str::to_owned)
    }

    /// The request that saves this form, or `None` for an empty form.
    pub fn update(&self) -> Option<UpdateBotProfile> {
        let saved = self.saved.as_ref()?;
        Some(UpdateBotProfile {
            instructions: Some(self.instructions.text.trim().to_owned())
                .filter(|instructions| instructions != &saved.instructions),
            name: self.name.text.trim().to_owned(),
            description: self.description.text.trim().to_owned(),
            personality: self.personality.text.trim().to_owned(),
            reply_style: self.reply_style,
            color: self.color.clone(),
            self_updates: self.self_updates,
            revision: saved.revision,
        })
    }

    /// The bot this form would create, or `None` for a form that edits
    /// an existing one.
    pub fn new_bot_request(&self) -> Option<NewBot> {
        self.creating.then(|| NewBot {
            name: self.name.text.trim().to_owned(),
            description: self.description.text.trim().to_owned(),
            personality: self.personality.text.trim().to_owned(),
            reply_style: self.reply_style,
            color: self.color.clone(),
            self_updates: self.self_updates,
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
            instructions: String::new(),
            id: "b-research".into(),
            name: "Research".into(),
            description: "Reads papers".into(),
            color: None,
            personality: "Be brief.".into(),
            reply_style: Default::default(),
            self_updates: Some(SelfUpdates {
                personality: true,
                owner: true,
                skills: true,
            }),
            changed_by: Some("bot".into()),
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
        draft.personality = TextEdit::new("");
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
    fn a_new_bot_starts_with_a_personality_and_nothing_to_discard() {
        let mut draft = ProfileDraft::new_bot();
        assert!(!draft.is_dirty(), "the starter text is not an edit");
        assert_eq!(draft.park_key(), Some(NEW_BOT));
        assert_eq!(draft.problem(), Some("Give this bot a name."));
        assert_eq!(draft.update(), None, "there is no bot to update");
        draft.name = TextEdit::new(" Travel ");
        assert!(draft.is_dirty());
        assert_eq!(draft.problem(), None);
        let bot = draft.new_bot_request().expect("a bot to create");
        assert_eq!((bot.name.as_str(), bot.color), ("Travel", None));
        assert_eq!(bot.personality, STARTER_PERSONALITY);
        // A form for an existing bot creates nothing.
        assert_eq!(ProfileDraft::of(&research()).new_bot_request(), None);
    }

    #[test]
    fn self_updates_are_part_of_the_draft_and_of_every_save() {
        let mut draft = ProfileDraft::of(&research());
        draft.self_updates.as_mut().unwrap().owner = false;
        assert!(draft.is_dirty());
        let update = draft.update().unwrap();
        assert_eq!(
            update.self_updates,
            Some(SelfUpdates {
                personality: true,
                owner: false,
                skills: true,
            })
        );
        // A runtime too old to say has none, and a save leaves them out.
        let old = BotProfile {
            self_updates: None,
            ..research()
        };
        let draft = ProfileDraft::of(&old);
        assert!(!draft.is_dirty());
        assert_eq!(draft.update().unwrap().self_updates, None);
        // A new bot may change its personality, not the owner's profile.
        let mut draft = ProfileDraft::new_bot();
        let request = draft.new_bot_request().unwrap();
        assert_eq!(request.self_updates, Some(SelfUpdates::NEW_BOT));
        draft.self_updates = Some(SelfUpdates {
            personality: false,
            owner: false,
            skills: true,
        });
        assert!(draft.is_dirty(), "turning a switch off is an edit");
    }

    #[test]
    fn instructions_are_sent_only_when_they_change() {
        let mut draft = ProfileDraft::of(&BotProfile {
            instructions: "Calendar: Executor.".into(),
            ..research()
        });
        draft.instructions = TextEdit::new("Calendar: Executor.\n");
        assert!(!draft.is_dirty(), "a trailing line is no edit");
        assert_eq!(draft.update().unwrap().instructions, None);
        draft.instructions = TextEdit::new(" Calendar: Executor. Boards by column. ");
        assert!(draft.is_dirty());
        assert_eq!(
            draft.update().unwrap().instructions.as_deref(),
            Some("Calendar: Executor. Boards by column.")
        );
        draft.instructions = TextEdit::new("x".repeat(16_001));
        assert_eq!(
            draft.problem(),
            Some("Instructions can be at most 16,000 characters.")
        );
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
