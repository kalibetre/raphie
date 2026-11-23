//! The edits in progress on Settings → You: who every bot is talking
//! to.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! owner-settings.tsx`. The profile is shared by every bot, so the form
//! holds no bot id.

use std::sync::OnceLock;

use raphie_core::contracts::{OwnerProfile, SaveOwnerProfile};
use rune::TextEdit;
use rune_kit::ComboboxState;

/// The runtime's limits (`packages/runtime/src/domains/bots/presentation/
/// http/owner-routes.ts`), checked here so the owner hears before sending.
const NAME_LIMIT: usize = 80;
const CALL_ME_LIMIT: usize = 40;
pub const ABOUT_LIMIT: usize = 2_000;
/// The runtime's limit on a set of instructions, for every bot or one.
pub const INSTRUCTIONS_LIMIT: usize = 16_000;

/// The time zone choice that clears it, as the list names it.
pub const NOT_SET: &str = "none";

/// The owner profile as the form shows it.
pub struct OwnerDraft {
    /// The profile these edits started from. `None` until it has arrived.
    pub saved: Option<OwnerProfile>,
    pub name: TextEdit,
    pub call_me: TextEdit,
    /// An IANA time zone, or empty for none.
    pub time_zone: String,
    pub about: TextEdit,
    /// The instructions for every bot as they are edited.
    pub instructions: TextEdit,
    /// The searchable list of time zones.
    pub zones: ComboboxState,
}

impl OwnerDraft {
    /// A form with nothing loaded yet.
    pub fn empty() -> OwnerDraft {
        OwnerDraft {
            saved: None,
            name: TextEdit::new(""),
            call_me: TextEdit::new(""),
            time_zone: String::new(),
            about: TextEdit::new(""),
            instructions: TextEdit::new(""),
            zones: ComboboxState::default(),
        }
    }

    /// A form showing `saved`, with nothing changed.
    pub fn of(saved: &OwnerProfile) -> OwnerDraft {
        OwnerDraft {
            saved: Some(saved.clone()),
            name: TextEdit::new(saved.name.clone()),
            call_me: TextEdit::new(saved.call_me.clone()),
            time_zone: saved.time_zone.clone(),
            about: TextEdit::new(saved.about.clone()),
            instructions: TextEdit::new(saved.instructions.clone()),
            zones: ComboboxState::default(),
        }
    }

    /// Whether anything differs from the saved profile.
    pub fn is_dirty(&self) -> bool {
        self.saved.as_ref().is_some_and(|saved| {
            self.name.text != saved.name
                || self.call_me.text != saved.call_me
                || self.time_zone != saved.time_zone
                || self.about.text != saved.about
                || self.instructions.text.trim() != saved.instructions.trim()
        })
    }

    /// What stops the form from being saved, in words for the owner.
    pub fn problem(&self) -> Option<String> {
        let long = |edit: &TextEdit, limit: usize| edit.text.trim().chars().count() > limit;
        if long(&self.name, NAME_LIMIT) {
            return Some(format!("Your name is at most {NAME_LIMIT} characters."));
        }
        if long(&self.call_me, CALL_ME_LIMIT) {
            return Some(format!(
                "What bots call you is at most {CALL_ME_LIMIT} characters."
            ));
        }
        if long(&self.about, ABOUT_LIMIT) {
            return Some("About you is at most 2,000 characters.".to_owned());
        }
        if long(&self.instructions, INSTRUCTIONS_LIMIT) {
            return Some(
                "The instructions for every bot are at most 16,000 characters.".to_owned(),
            );
        }
        None
    }

    /// The instructions to send: those typed, when they differ from the
    /// saved ones.
    fn changed_instructions(&self) -> Option<String> {
        let typed = self.instructions.text.trim();
        let saved = self.saved.as_ref().map(|saved| saved.instructions.trim());
        (saved != Some(typed)).then(|| typed.to_owned())
    }

    /// What "Reset to Raphie's" sends: the saved profile as it is, with
    /// the instructions for every bot back to Raphie's own.
    pub fn reset_instructions(&self) -> Option<SaveOwnerProfile> {
        let saved = self.saved.as_ref()?;
        Some(SaveOwnerProfile {
            name: saved.name.clone(),
            call_me: saved.call_me.clone(),
            time_zone: saved.time_zone.clone(),
            about: saved.about.clone(),
            instructions: Some(None),
        })
    }

    /// What a save would send, trimmed as the web trims it, or `None`
    /// while the form has a problem.
    pub fn update(&self) -> Option<SaveOwnerProfile> {
        if self.problem().is_some() {
            return None;
        }
        Some(SaveOwnerProfile {
            // Unchanged, Raphie's stay Raphie's and keep following releases.
            instructions: self.changed_instructions().map(Some),
            name: self.name.text.trim().to_owned(),
            call_me: self.call_me.text.trim().to_owned(),
            time_zone: self.time_zone.clone(),
            about: self.about.text.trim().to_owned(),
        })
    }
}

/// A time zone as people read it: `America/New_York` as "America/New York".
pub fn zone_label(zone: &str) -> String {
    zone.replace('_', " ")
}

/// The time zones to choose from, from this machine's time zone database,
/// sorted, with `UTC`. Empty when the database cannot be read.
pub fn time_zones() -> &'static [String] {
    static ZONES: OnceLock<Vec<String>> = OnceLock::new();
    ZONES.get_or_init(|| {
        let table = std::fs::read_to_string("/usr/share/zoneinfo/zone.tab").unwrap_or_default();
        let mut zones = parse_zone_table(&table);
        if !zones.is_empty() {
            zones.push("UTC".to_owned());
            zones.sort();
        }
        zones
    })
}

/// The zone names in a `zone.tab`: the third column of each line that is
/// not a comment.
fn parse_zone_table(table: &str) -> Vec<String> {
    table
        .lines()
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| line.split('\t').nth(2))
        .map(str::to_owned)
        .collect()
}

/// This machine's time zone, such as `Africa/Addis_Ababa`, if it can tell.
pub fn device_zone() -> Option<String> {
    if let Ok(zone) = std::env::var("TZ")
        && zone.contains('/')
    {
        return Some(zone.trim_start_matches(':').to_owned());
    }
    let target = std::fs::read_link("/etc/localtime").ok()?;
    zone_from_path(&target.to_string_lossy())
}

/// The zone at the end of a path into a time zone database.
fn zone_from_path(path: &str) -> Option<String> {
    let (_, zone) = path.split_once("zoneinfo/")?;
    (!zone.is_empty()).then(|| zone.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved() -> OwnerProfile {
        OwnerProfile {
            instructions: String::new(),
            instructions_default: false,
            name: "Hana Girma".into(),
            call_me: "Hana".into(),
            time_zone: "Africa/Addis_Ababa".into(),
            about: "Mornings are for deep work.".into(),
            updated_at: Some(1.0),
        }
    }

    #[test]
    fn a_fresh_form_is_clean_and_an_edit_makes_it_dirty() {
        let mut draft = OwnerDraft::of(&saved());
        assert!(!draft.is_dirty());
        draft.time_zone = "Europe/Berlin".into();
        assert!(draft.is_dirty());
    }

    #[test]
    fn a_save_sends_trimmed_text_and_refuses_too_much() {
        let mut draft = OwnerDraft::of(&saved());
        draft.call_me = TextEdit::new("  Hana  ");
        assert_eq!(
            draft.update().map(|update| update.call_me),
            Some("Hana".into())
        );
        draft.about = TextEdit::new("x".repeat(ABOUT_LIMIT + 1));
        assert!(draft.problem().is_some());
        assert_eq!(draft.update(), None);
    }

    #[test]
    fn instructions_are_sent_only_when_changed_and_reset_sends_null() {
        let mut draft = OwnerDraft::of(&OwnerProfile {
            instructions: "- Give times on a 12-hour clock.".into(),
            ..saved()
        });
        draft.instructions = TextEdit::new("- Give times on a 12-hour clock.\n");
        assert!(!draft.is_dirty());
        assert_eq!(draft.update().and_then(|update| update.instructions), None);
        draft.instructions = TextEdit::new("- Leave out all-day events.");
        assert_eq!(
            draft.update().and_then(|update| update.instructions),
            Some(Some("- Leave out all-day events.".into()))
        );
        assert_eq!(
            draft.reset_instructions().map(|update| update.instructions),
            Some(Some(None))
        );
    }

    #[test]
    fn zones_come_from_the_table_and_the_link() {
        let table = "# comment\nET\t+0902+03842\tAfrica/Addis_Ababa\nDE\t+5230+01322\tEurope/Berlin\tmost of Germany\n";
        assert_eq!(
            parse_zone_table(table),
            vec!["Africa/Addis_Ababa".to_owned(), "Europe/Berlin".to_owned()]
        );
        assert_eq!(
            zone_from_path("/var/db/timezone/zoneinfo/America/New_York"),
            Some("America/New_York".into())
        );
        assert_eq!(zone_from_path("/etc/localtime"), None);
        assert_eq!(zone_label("America/New_York"), "America/New York");
    }
}
