//! What is open and typed on Settings → Skills: the list, one skill's
//! editor, and the import dialog.
//!
//! Mirrors the state in `apps/web/src/domains/settings/presentation/
//! skill-settings.tsx`.

use std::path::PathBuf;

use raphie_core::contracts::{SaveSkill, SkillDetail, SkillText};
use raphie_core::skills::{TEMPLATE, skill_name};
use rune::TextEdit;

/// What the Skills page shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SkillsMode {
    List,
    /// The editor for a saved skill, by name.
    Edit(String),
    /// The editor for a skill that does not exist yet.
    New,
}

/// One skill's text files in the editor.
pub struct SkillEditor {
    /// The files as they were opened (or the template), to tell edits.
    original: Vec<(String, String)>,
    pub files: Vec<(String, TextEdit)>,
    /// Files that are not text: kept as they are, listed only.
    pub binaries: Vec<String>,
    /// The file being edited, by index.
    pub open: usize,
    pub new_path: TextEdit,
    /// Whether the delete confirmation is up.
    pub confirm_delete: bool,
    /// A note for the save bar, such as "Save or discard your changes first."
    pub note: Option<String>,
}

impl SkillEditor {
    /// A new skill, starting from the template.
    pub fn new_skill() -> SkillEditor {
        SkillEditor::from_files(vec![("SKILL.md".to_owned(), TEMPLATE.to_owned())], vec![])
    }

    /// A saved skill's files.
    pub fn of(detail: &SkillDetail) -> SkillEditor {
        let mut texts = vec![];
        let mut binaries = vec![];
        for file in &detail.contents {
            match &file.text {
                Some(text) => texts.push((file.path.clone(), text.clone())),
                None => binaries.push(file.path.clone()),
            }
        }
        SkillEditor::from_files(texts, binaries)
    }

    fn from_files(files: Vec<(String, String)>, binaries: Vec<String>) -> SkillEditor {
        SkillEditor {
            files: files
                .iter()
                .map(|(path, text)| (path.clone(), TextEdit::new(text.clone())))
                .collect(),
            original: files,
            binaries,
            open: 0,
            new_path: TextEdit::new(""),
            confirm_delete: false,
            note: None,
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.files.len() != self.original.len()
            || self
                .files
                .iter()
                .zip(&self.original)
                .any(|((path, edit), (saved_path, text))| path != saved_path || edit.text != *text)
    }

    /// The name the skill's SKILL.md gives it.
    pub fn name(&self) -> String {
        self.files
            .iter()
            .find(|(path, _)| path == "SKILL.md")
            .map_or_else(String::new, |(_, edit)| skill_name(&edit.text))
    }

    /// Adds the file typed in `new_path` and opens it. Refuses an empty
    /// path and one already there.
    pub fn add_file(&mut self) -> bool {
        let path = self.new_path.text.trim().to_owned();
        if !self.can_add() {
            return false;
        }
        self.files.push((path, TextEdit::new("")));
        self.open = self.files.len() - 1;
        self.new_path.clear();
        true
    }

    pub fn can_add(&self) -> bool {
        let path = self.new_path.text.trim();
        !path.is_empty() && !self.files.iter().any(|(existing, _)| existing == path)
    }

    /// Drops the open file; SKILL.md stays.
    pub fn remove_open(&mut self) {
        if self
            .files
            .get(self.open)
            .is_some_and(|(path, _)| path != "SKILL.md")
        {
            self.files.remove(self.open);
            self.open = 0;
        }
    }

    /// What a save sends.
    pub fn save(&self) -> SaveSkill {
        SaveSkill {
            files: self
                .files
                .iter()
                .map(|(path, edit)| SkillText {
                    path: path.clone(),
                    text: edit.text.clone(),
                })
                .collect(),
        }
    }
}

/// The import dialog: a .zip from this machine, or a GitHub link.
pub struct SkillImportForm {
    pub open: bool,
    /// The GitHub tab rather than the .zip one.
    pub github: bool,
    pub zip: Option<PathBuf>,
    pub url: TextEdit,
    pub replace: bool,
}

impl SkillImportForm {
    pub fn new() -> SkillImportForm {
        SkillImportForm {
            open: false,
            github: false,
            zip: None,
            url: TextEdit::new(""),
            replace: false,
        }
    }

    pub fn ready(&self) -> bool {
        if self.github {
            !self.url.text.trim().is_empty()
        } else {
            self.zip.is_some()
        }
    }
}

impl Default for SkillImportForm {
    fn default() -> Self {
        SkillImportForm::new()
    }
}

/// Settings → Skills.
pub struct SkillsView {
    pub mode: SkillsMode,
    /// The editor, once its skill has loaded.
    pub editor: Option<SkillEditor>,
    pub import: SkillImportForm,
}

impl SkillsView {
    pub fn new() -> SkillsView {
        SkillsView {
            mode: SkillsMode::List,
            editor: None,
            import: SkillImportForm::new(),
        }
    }
}

impl Default for SkillsView {
    fn default() -> Self {
        SkillsView::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use raphie_core::contracts::{SkillFile, SkillSummary};

    fn detail() -> SkillDetail {
        SkillDetail {
            summary: SkillSummary {
                name: "weekly-report".into(),
                description: "Report.".into(),
                enabled: true,
                files: vec!["SKILL.md".into(), "assets/logo.png".into()],
                problem: None,
                bot_change: None,
            },
            contents: vec![
                SkillFile {
                    path: "SKILL.md".into(),
                    bytes: 10,
                    text: Some("---\nname: weekly-report\n---\n".into()),
                },
                SkillFile {
                    path: "assets/logo.png".into(),
                    bytes: 99,
                    text: None,
                },
            ],
        }
    }

    #[test]
    fn an_editor_tells_edits_and_keeps_binaries_out_of_a_save() {
        let mut editor = SkillEditor::of(&detail());
        assert!(!editor.is_dirty());
        assert_eq!(editor.binaries, vec!["assets/logo.png".to_owned()]);
        assert_eq!(editor.name(), "weekly-report");
        editor.new_path = TextEdit::new("references/notes.md");
        assert!(editor.add_file());
        assert!(editor.is_dirty());
        assert_eq!(editor.open, 1);
        editor.new_path = TextEdit::new("SKILL.md");
        assert!(!editor.add_file(), "a file already there");
        let paths: Vec<_> = editor.save().files.into_iter().map(|f| f.path).collect();
        assert_eq!(paths, vec!["SKILL.md", "references/notes.md"]);
        editor.remove_open();
        assert!(!editor.is_dirty());
    }

    #[test]
    fn a_new_skill_starts_from_the_template() {
        let editor = SkillEditor::new_skill();
        assert_eq!(editor.name(), "my-skill");
        assert!(!editor.is_dirty());
    }
}
