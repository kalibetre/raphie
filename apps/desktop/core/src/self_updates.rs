//! What a bot changed about itself or the owner's profile in one reply,
//! found by its tool steps.
//!
//! Mirrors `apps/web/src/domains/conversations/application/self-updates.ts`.
//! Tool arguments are not recorded in the activity journal, so a change is
//! matched by time: the save made while the tool step ran. Pure functions,
//! no clock and no I/O.

use crate::contracts::{BotRevision, OwnerProfile};
use crate::projections::ToolStep;

/// What a self-update changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelfUpdateKind {
    /// The bot's own personality (`update_personality`).
    Personality,
    /// The owner's profile, shared by every bot (`update_owner_profile`).
    Owner,
    /// One of its skills, written or improved (`save_skill`). The runtime
    /// keeps the change by the step's call; see `skill_change` in the API.
    Skill,
}

/// One finished self-update step of a reply.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelfUpdateNote {
    pub kind: SelfUpdateKind,
    /// The tool step's id.
    pub id: String,
    pub started_at: i64,
    pub done_at: i64,
}

impl SelfUpdateNote {
    /// Names this note among a session's: a provider may reuse call ids, so
    /// the step's start goes with it.
    pub fn key(&self) -> String {
        format!("{}@{}", self.id, self.started_at)
    }
}

/// Clock slack, in milliseconds, between a step's events and the save they
/// bracket.
const SLACK: i64 = 2000;

/// The finished self-updates among a reply's tool steps, in order. MCP
/// tools with the same names are not the runtime's own.
pub fn self_update_notes(steps: &[ToolStep]) -> Vec<SelfUpdateNote> {
    steps
        .iter()
        .filter(|step| step.server.is_none())
        .filter_map(|step| {
            let kind = match step.tool.as_str() {
                "update_personality" => SelfUpdateKind::Personality,
                "update_owner_profile" => SelfUpdateKind::Owner,
                "save_skill" => SelfUpdateKind::Skill,
                _ => return None,
            };
            Some(SelfUpdateNote {
                kind,
                id: step.id.clone(),
                started_at: step.started_at,
                done_at: step.done_at?,
            })
        })
        .collect()
}

/// Whether a save at `at` happened while `note`'s step ran.
fn during(note: &SelfUpdateNote, at: i64) -> bool {
    at >= note.started_at - SLACK && at <= note.done_at + SLACK
}

/// The revision a bot saved during a personality note, and the one before
/// it, to undo to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PersonalityEdit<'a> {
    pub edit: &'a BotRevision,
    pub before: Option<&'a BotRevision>,
}

/// The revision the bot saved during `note`, from `history` (newest
/// first). `None` when it saved none, as when it was not allowed.
pub fn personality_edit<'a>(
    history: &'a [BotRevision],
    note: &SelfUpdateNote,
) -> Option<PersonalityEdit<'a>> {
    let index = history.iter().position(|revision| {
        revision.changed_by.as_deref() == Some("bot") && during(note, revision.updated_at)
    })?;
    Some(PersonalityEdit {
        edit: &history[index],
        before: history.get(index + 1),
    })
}

/// Whether the owner's profile is still as the bot saved it during `note`:
/// false when the save failed or the profile has changed since.
pub fn owner_saved(owner: &OwnerProfile, note: &SelfUpdateNote) -> bool {
    // Milliseconds arrive as a JSON number; whole ones are exact in an f64.
    owner
        .updated_at
        .is_some_and(|at| during(note, at.round() as i64))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(id: &str, tool: &str, done: bool) -> ToolStep {
        ToolStep {
            id: id.into(),
            server: None,
            tool: tool.into(),
            started_at: 10_000,
            done_at: done.then_some(10_500),
            args: None,
            result: None,
            failed: false,
            approval: None,
        }
    }

    fn note() -> SelfUpdateNote {
        self_update_notes(&[step("a", "update_personality", true)]).remove(0)
    }

    #[test]
    fn only_finished_self_updates_become_notes() {
        let mcp = ToolStep {
            server: Some("evil".into()),
            ..step("e", "update_personality", true)
        };
        let notes = self_update_notes(&[
            step("a", "update_personality", true),
            step("b", "update_owner_profile", true),
            step("c", "update_owner_profile", false),
            step("d", "read_skill", true),
            mcp,
            step("f", "save_skill", true),
        ]);
        let found: Vec<(&str, SelfUpdateKind)> = notes
            .iter()
            .map(|note| (note.id.as_str(), note.kind))
            .collect();
        assert_eq!(
            found,
            [
                ("a", SelfUpdateKind::Personality),
                ("b", SelfUpdateKind::Owner),
                ("f", SelfUpdateKind::Skill)
            ]
        );
    }

    #[test]
    fn a_personality_edit_is_the_bots_revision_saved_during_the_step() {
        let revision = |number: u32, updated_at: i64, by: Option<&str>| BotRevision {
            revision: number,
            name: "Research".into(),
            description: String::new(),
            color: None,
            personality: format!("Version {number}"),
            changed_by: by.map(str::to_owned),
            preset: None,
            updated_at,
        };
        let history = [
            revision(4, 90_000, Some("bot")),
            revision(3, 10_200, Some("bot")),
            revision(2, 5_000, Some("owner")),
            revision(1, 1_000, None),
        ];
        let found = personality_edit(&history, &note()).expect("an edit");
        assert_eq!(found.edit.revision, 3);
        assert_eq!(found.before.map(|r| r.revision), Some(2));
        // Within the slack either side of the step.
        assert!(personality_edit(&[revision(5, 8_000, Some("bot"))], &note()).is_some());
        assert!(personality_edit(&[revision(5, 12_500, Some("bot"))], &note()).is_some());
        assert!(personality_edit(&[revision(5, 12_501, Some("bot"))], &note()).is_none());
        // The owner's save in the window is not the bot's.
        assert!(personality_edit(&[revision(5, 10_200, Some("owner"))], &note()).is_none());
        // Not allowed: nothing saved while the step ran.
        assert!(personality_edit(&[revision(1, 1_000, None)], &note()).is_none());
        // The first revision has nothing before it to undo to.
        let only = [revision(1, 10_200, Some("bot"))];
        assert_eq!(personality_edit(&only, &note()).unwrap().before, None);
    }

    #[test]
    fn an_owner_note_holds_only_while_the_profile_is_as_the_bot_saved_it() {
        let owner = OwnerProfile {
            rules: Vec::new(),
            instructions: String::new(),
            instructions_default: false,
            name: "Hana Girma".into(),
            call_me: "Hana".into(),
            time_zone: "Africa/Addis_Ababa".into(),
            about: String::new(),
            updated_at: Some(10_300.0),
        };
        assert!(owner_saved(&owner, &note()));
        let later = OwnerProfile {
            updated_at: Some(60_000.0),
            ..owner.clone()
        };
        assert!(!owner_saved(&later, &note()));
        let never = OwnerProfile {
            updated_at: None,
            ..owner
        };
        assert!(!owner_saved(&never, &note()));
    }
}
