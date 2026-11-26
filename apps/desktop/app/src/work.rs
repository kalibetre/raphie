//! The "New item" and "Edit item" dialog on Settings → Work.
//!
//! Mirrors the draft in `apps/web/src/domains/settings/presentation/
//! work-settings.tsx`.

use raphie_core::contracts::{WorkChange, WorkItem};
use rune::TextEdit;

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
    /// The title and notes the dialog opened with, so a save sends only
    /// what the owner changed and leaves the bot's later edits alone.
    started: (String, String),
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
            started: (String::new(), String::new()),
            error: None,
        }
    }
}

impl WorkForm {
    /// An open dialog for a new item, or for editing `item`.
    pub fn opened(item: Option<&WorkItem>) -> WorkForm {
        let title = item.map_or("", |item| item.title.as_str());
        let notes = item.map_or("", |item| item.notes.as_str());
        WorkForm {
            open: true,
            id: item.map(|item| item.id.clone()),
            title: TextEdit::new(title),
            notes: TextEdit::new(notes),
            started: (title.to_owned(), notes.to_owned()),
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

    /// For an edit, only the title and notes the owner changed; `None` when
    /// nothing changed.
    pub fn change(&self) -> Option<WorkChange> {
        let title = self.title.text.trim();
        let notes = self.notes.text.trim();
        let change = WorkChange {
            title: (title != self.started.0.trim()).then(|| title.to_owned()),
            notes: (notes != self.started.1.trim()).then(|| notes.to_owned()),
            status: None,
        };
        (change.title.is_some() || change.notes.is_some()).then_some(change)
    }

    /// Whether there is a title to save.
    pub fn is_complete(&self) -> bool {
        !self.title.text.trim().is_empty()
    }
}
