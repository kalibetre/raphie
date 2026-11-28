//! The "New item" and "Edit item" dialog on Settings → Work.
//!
//! Mirrors the draft in `apps/web/src/domains/settings/presentation/
//! work-settings.tsx`.

use raphie_core::contracts::{WorkChange, WorkItem};
use rune::TextEdit;

use crate::jobs::{local_fields, local_moment};

/// The longest title and notes, as the web's inputs allow.
pub const TITLE_MAX: usize = 80;
pub const NOTES_MAX: usize = 2_000;

/// What is typed into the dialog.
pub struct WorkForm {
    /// Whether the dialog is open.
    pub open: bool,
    /// The item being edited; `None` for a new one.
    pub id: Option<String>,
    pub title: TextEdit,
    pub notes: TextEdit,
    pub deferred: bool,
    pub can_remind: bool,
    pub reminder: TextEdit,
    /// The fields the dialog opened with, so a save sends only
    /// what the owner changed and leaves the bot's later edits alone.
    started: (String, String),
    started_reminder: String,
    /// What is wrong with what was typed, found when it was saved.
    pub error: Option<&'static str>,
}

impl Default for WorkForm {
    fn default() -> WorkForm {
        WorkForm {
            open: false,
            id: None,
            title: TextEdit::new(""),
            notes: TextEdit::new(""),
            deferred: false,
            can_remind: true,
            reminder: TextEdit::new(""),
            started: (String::new(), String::new()),
            started_reminder: String::new(),
            error: None,
        }
    }
}

impl WorkForm {
    /// An open dialog for a new item, or for editing `item`.
    pub fn opened(item: Option<&WorkItem>) -> WorkForm {
        let title = item.map_or("", |item| item.title.as_str());
        let notes = item.map_or("", |item| item.notes.as_str());
        let reminder = item
            .and_then(|item| item.reminder_at)
            .map(|at| {
                let (date, time) = local_fields(at);
                format!("{date} {time}")
            })
            .unwrap_or_default();
        WorkForm {
            open: true,
            id: item.map(|item| item.id.clone()),
            title: TextEdit::new(title),
            notes: TextEdit::new(notes),
            deferred: false,
            can_remind: item.is_none_or(|item| item.origin.is_none()),
            reminder: TextEdit::new(&reminder),
            started: (title.to_owned(), notes.to_owned()),
            started_reminder: reminder,
            error: None,
        }
    }

    /// What is too long to save, if anything.
    pub fn problem(&self) -> Option<&'static str> {
        if self.title.text.trim().chars().count() > TITLE_MAX {
            Some("A title can be at most 80 characters.")
        } else if self.notes.text.trim().chars().count() > NOTES_MAX {
            Some("Notes can be at most 2,000 characters.")
        } else {
            None
        }
    }

    /// An edited reminder, or an error if the new local time is invalid.
    pub fn reminder_change(&self, now: i64) -> Result<Option<Option<i64>>, &'static str> {
        let reminder = self.reminder.text.trim();
        if !self.can_remind || reminder == self.started_reminder {
            return Ok(None);
        }
        if reminder.is_empty() {
            return Ok(Some(None));
        }
        let time = reminder
            .split_once(' ')
            .and_then(|(date, time)| local_moment(date, time))
            .ok_or("Use YYYY-MM-DD HH:MM for the reminder.")?;
        if time <= now {
            return Err("Choose a reminder time in the future.");
        }
        Ok(Some(Some(time)))
    }

    /// For an edit, only the fields the owner changed.
    pub fn change(&self, reminder_at: Option<Option<i64>>) -> Option<WorkChange> {
        let title = self.title.text.trim();
        let notes = self.notes.text.trim();
        let change = WorkChange {
            title: (title != self.started.0.trim()).then(|| title.to_owned()),
            notes: (notes != self.started.1.trim()).then(|| notes.to_owned()),
            status: None,
            reminder_at,
        };
        (change.title.is_some() || change.notes.is_some() || reminder_at.is_some())
            .then_some(change)
    }

    /// Whether there is a title to save.
    pub fn is_complete(&self) -> bool {
        !self.title.text.trim().is_empty()
    }
}
