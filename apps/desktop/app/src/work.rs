//! The "New item" and "Edit item" dialog on Settings → Work.
//!
//! Mirrors the draft in `apps/web/src/domains/settings/presentation/
//! work-settings.tsx`.

use raphie_core::contracts::WorkItem;
use rune::TextEdit;

/// What is typed into the dialog.
pub struct WorkForm {
    /// Whether the dialog is open.
    pub open: bool,
    /// The item being edited; `None` for a new one.
    pub id: Option<String>,
    pub title: TextEdit,
    pub notes: TextEdit,
}

impl Default for WorkForm {
    fn default() -> WorkForm {
        WorkForm {
            open: false,
            id: None,
            title: TextEdit::new(""),
            notes: TextEdit::new(""),
        }
    }
}

impl WorkForm {
    /// An open dialog for a new item, or for editing `item`.
    pub fn opened(item: Option<&WorkItem>) -> WorkForm {
        WorkForm {
            open: true,
            id: item.map(|item| item.id.clone()),
            title: TextEdit::new(item.map_or("", |item| item.title.as_str())),
            notes: TextEdit::new(item.map_or("", |item| item.notes.as_str())),
        }
    }

    /// Whether there is a title to save.
    pub fn is_complete(&self) -> bool {
        !self.title.text.trim().is_empty()
    }
}
