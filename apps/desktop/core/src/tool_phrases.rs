//! What a bot did with its tools, in its own words and the past tense.
//!
//! Mirrors `apps/web/src/domains/conversations/application/tool-phrases.ts`.

/// One tool step in words: a built-in tool's phrase, or the service used.
pub fn tool_phrase(tool: &str, server: Option<&str>) -> String {
    let phrase = match tool {
        "memory_retain" => "Noted something to remember",
        "memory_revise" => "Updated a note",
        "memory_forget" => "Forgot a note",
        "memory_recall" => "Checked what I remember",
        "memory_reflect" => "Thought over what I remember",
        "schedule_create" => "Scheduled a job",
        "schedule_update" => "Updated a scheduled job",
        "schedule_delete" => "Removed a scheduled job",
        "schedule_list" => "Checked the schedule",
        "web_search" => "Searched the web",
        "read_document" => "Read a document",
        "read_skill" => "Read a skill",
        "handoff_create" => "Handed off a task",
        "handoff_follow_up" => "Followed up on a handoff",
        "handoff_list" | "handoff_read" => "Checked on handed-off work",
        "update_owner_profile" => "Updated what I know about you",
        "update_personality" => "Updated my personality",
        "workspace_exec" | "bash" => "Ran a command",
        _ => return format!("Used {}", server.unwrap_or(tool)),
    };
    phrase.to_owned()
}

/// A finished turn's tools in one line: each distinct phrase once, in order,
/// the first two named and the rest counted.
pub fn steps_summary<'a>(steps: impl IntoIterator<Item = (&'a str, Option<&'a str>)>) -> String {
    let mut said: Vec<String> = Vec::new();
    for (tool, server) in steps {
        let phrase = tool_phrase(tool, server);
        if !said.contains(&phrase) {
            said.push(phrase);
        }
    }
    // Later phrases continue the sentence, so they start in lower case.
    for phrase in said.iter_mut().skip(1) {
        let mut chars = phrase.chars();
        if let Some(first) = chars.next() {
            *phrase = first.to_lowercase().chain(chars).collect();
        }
    }
    if said.len() <= 2 {
        said.join(", ")
    } else {
        format!("{} and {} more", said[..2].join(", "), said.len() - 2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_in_tools_say_what_the_bot_did() {
        assert_eq!(
            tool_phrase("schedule_update", None),
            "Updated a scheduled job"
        );
        assert_eq!(tool_phrase("execute", Some("Executor")), "Used Executor");
        assert_eq!(tool_phrase("mystery", None), "Used mystery");
    }

    #[test]
    fn a_summary_says_each_thing_once_and_counts_past_the_second() {
        assert_eq!(
            steps_summary([("memory_retain", None), ("memory_retain", None)]),
            "Noted something to remember"
        );
        assert_eq!(
            steps_summary([
                ("schedule_update", None),
                ("memory_retain", None),
                ("web_search", None),
                ("read_document", None),
            ]),
            "Updated a scheduled job, noted something to remember and 2 more"
        );
    }
}
