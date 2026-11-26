//! The composer's "/" menu: commands that act at once, and the bot's skills,
//! which a message invokes by starting with "/name".
//!
//! Mirrors `apps/web/src/domains/conversations/application/slash.ts`.
//! Positions are byte offsets into the text.

/// What a "/" entry does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlashKind {
    /// Open the model picker.
    Model,
    /// Stop the reply in progress.
    Stop,
    /// Start a handoff: write "@" for the bot menu.
    Handoff,
    /// Invoke a skill by name.
    Skill,
}

/// One entry of the "/" menu.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlashItem {
    pub kind: SlashKind,
    pub name: String,
    pub description: String,
}

impl SlashItem {
    pub fn is_command(&self) -> bool {
        self.kind != SlashKind::Skill
    }
}

/// The "/name" being typed: only at the very start of the text, and only
/// until a space, so a "/" later in a message never opens the menu.
pub fn slash_query(text: &str, caret: usize) -> Option<String> {
    if !text.starts_with('/') || caret < 1 {
        return None;
    }
    let typed = text.get(1..caret)?;
    if typed.contains(char::is_whitespace) {
        return None;
    }
    Some(typed.to_lowercase())
}

/// Entries whose name starts with what was typed, in the order given.
pub fn slash_matches(items: &[SlashItem], query: &str) -> Vec<SlashItem> {
    items
        .iter()
        .filter(|item| item.name.starts_with(query))
        .cloned()
        .collect()
}

/// The skill a message starts with, as the runtime reads it: "/name", or
/// "/name_with_underscores" as Telegram spells it, then a space or the end.
/// Only names in `skills` count, so "/tmp" stays text. Returns the skill's
/// name and how many bytes the typed "/name" takes.
pub fn leading_skill(text: &str, skills: &[&str]) -> Option<(String, usize)> {
    let rest = text.strip_prefix('/')?;
    let typed = rest.split(char::is_whitespace).next().unwrap_or("");
    let valid = !typed.is_empty()
        && typed.len() <= 64
        && typed
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if !valid {
        return None;
    }
    let name = typed.replace('_', "-");
    skills
        .contains(&name.as_str())
        .then(|| (name, typed.len() + 1))
}

/// The text once a skill is chosen: "/name " and whatever followed the
/// typed word, with the caret after the space.
pub fn insert_skill(text: &str, name: &str) -> (String, usize) {
    let rest = text
        .split_once(char::is_whitespace)
        .map_or("", |(_, rest)| rest);
    (format!("/{name} {rest}"), name.len() + 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(kind: SlashKind, name: &str) -> SlashItem {
        SlashItem {
            kind,
            name: name.into(),
            description: String::new(),
        }
    }

    #[test]
    fn the_menu_opens_only_for_the_first_word() {
        assert_eq!(slash_query("/", 1).as_deref(), Some(""));
        assert_eq!(slash_query("/WE", 3).as_deref(), Some("we"));
        assert_eq!(slash_query("/weekly-report now", 18), None);
        assert_eq!(slash_query("see /tmp", 8), None);
        assert_eq!(slash_query("", 0), None);
    }

    #[test]
    fn a_leading_skill_is_read_as_the_runtime_reads_it() {
        let skills = ["weekly-report"];
        assert_eq!(
            leading_skill("/weekly-report for the team", &skills),
            Some(("weekly-report".into(), 14))
        );
        assert_eq!(
            leading_skill("/weekly_report", &skills),
            Some(("weekly-report".into(), 14))
        );
        assert_eq!(leading_skill("/tmp is full", &skills), None);
        assert_eq!(leading_skill("see /weekly-report", &skills), None);
    }

    #[test]
    fn matches_and_a_chosen_skill_keep_the_rest() {
        let items = [
            item(SlashKind::Model, "model"),
            item(SlashKind::Skill, "weekly-report"),
        ];
        let names: Vec<_> = slash_matches(&items, "w")
            .into_iter()
            .map(|i| i.name)
            .collect();
        assert_eq!(names, vec!["weekly-report"]);
        assert_eq!(
            insert_skill("/we", "weekly-report"),
            ("/weekly-report ".into(), 15)
        );
        assert_eq!(
            insert_skill("/we for the team", "weekly-report").0,
            "/weekly-report for the team"
        );
    }
}
