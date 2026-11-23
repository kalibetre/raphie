//! Standing rules as the settings pages edit them: one a line.
//!
//! Mirrors `apps/web/src/domains/settings/application/rules.ts`. The limits
//! are the runtime's (`packages/runtime/src/domains/bots/domain/rules.ts`),
//! checked here so the owner hears before sending.

pub const MAX_RULES: usize = 20;
pub const MAX_RULE_LENGTH: usize = 300;

/// Rules as they are edited: one a line.
pub fn rules_text(rules: &[String]) -> String {
    rules.join("\n")
}

/// The rules in `text`: each line once, without a bullet, none empty.
pub fn rules_of(text: &str) -> Vec<String> {
    let mut rules: Vec<String> = Vec::new();
    for line in text.lines() {
        // Runs of whitespace become one space, and the ends are trimmed.
        let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
        let rule = ["- ", "* ", "• "]
            .iter()
            .find_map(|bullet| line.strip_prefix(bullet))
            .unwrap_or(&line)
            .trim();
        if !rule.is_empty() && !rules.iter().any(|kept| kept == rule) {
            rules.push(rule.to_owned());
        }
    }
    rules
}

/// What stops `rules` from being saved, in words for the owner.
pub fn rules_problem(rules: &[String]) -> Option<String> {
    if rules.len() > MAX_RULES {
        return Some(format!(
            "Keep to {MAX_RULES} rules; there are {}.",
            rules.len()
        ));
    }
    let long = rules
        .iter()
        .position(|rule| rule.chars().count() > MAX_RULE_LENGTH)?;
    Some(format!(
        "Rule {} is over {MAX_RULE_LENGTH} characters.",
        long + 1
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_are_read_a_line_each_without_bullets_blanks_or_repeats() {
        let text = "- Use Executor  for calendar.\n\n* Answer with a card.\n• Be brief.\nBe brief.\n   \n-not a bullet";
        assert_eq!(
            rules_of(text),
            vec![
                "Use Executor for calendar.",
                "Answer with a card.",
                "Be brief.",
                "-not a bullet",
            ]
        );
        assert_eq!(rules_of(""), Vec::<String>::new());
        let rules = rules_of(text);
        assert_eq!(rules_of(&rules_text(&rules)), rules);
    }

    #[test]
    fn too_many_rules_or_one_too_long_cannot_be_saved() {
        let twenty: Vec<String> = (0..MAX_RULES).map(|n| format!("Rule {n}.")).collect();
        assert_eq!(rules_problem(&twenty), None);
        let mut more = twenty.clone();
        more.push("One more.".into());
        assert_eq!(
            rules_problem(&more).as_deref(),
            Some("Keep to 20 rules; there are 21.")
        );
        // Characters, not bytes.
        let fits = vec!["ok".to_owned(), "é".repeat(MAX_RULE_LENGTH)];
        assert_eq!(rules_problem(&fits), None);
        let long = vec!["ok".to_owned(), "é".repeat(MAX_RULE_LENGTH + 1)];
        assert_eq!(
            rules_problem(&long).as_deref(),
            Some("Rule 2 is over 300 characters.")
        );
    }
}
