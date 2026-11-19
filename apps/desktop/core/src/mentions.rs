//! "@Name" for another bot: what the composer offers while it is typed, and
//! how a message shows the bots it names.
//!
//! Mirrors `apps/web/src/domains/conversations/application/mentions.ts`.
//! Positions are byte offsets into the text.

use crate::contracts::BotRef;

/// The "@name" being typed before the caret: where its @ is, and what
/// follows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MentionQuery {
    pub start: usize,
    pub query: String,
}

/// An @ starts a mention only at the start of the text or after whitespace,
/// so an email address never opens the menu. Names may have spaces, so the
/// query runs to the caret, up to a line break.
pub fn mention_query(text: &str, caret: usize) -> Option<MentionQuery> {
    let before = text.get(..caret)?;
    let start = before.rfind('@')?;
    if before[..start]
        .chars()
        .next_back()
        .is_some_and(|c| !c.is_whitespace())
    {
        return None;
    }
    let query = &before[start + 1..];
    if query.contains('\n') || query.chars().count() > 40 {
        return None;
    }
    Some(MentionQuery {
        start,
        query: query.to_owned(),
    })
}

/// Bots whose name starts with what was typed, case aside.
pub fn mention_matches<'a>(bots: &'a [BotRef], query: &str) -> Vec<&'a BotRef> {
    let typed = query.to_lowercase();
    bots.iter()
        .filter(|bot| bot.name.to_lowercase().starts_with(&typed))
        .collect()
}

/// Replaces the typed "@que" with "@Name", then one space, and returns the
/// new text with the caret after it.
pub fn insert_mention(
    text: &str,
    mention: &MentionQuery,
    caret: usize,
    name: &str,
) -> (String, usize) {
    let rest = &text[caret..];
    let space = if rest.starts_with(char::is_whitespace) {
        ""
    } else {
        " "
    };
    let tag = format!("@{name}");
    let caret = mention.start + tag.len() + 1;
    (
        format!("{}{tag}{space}{rest}", &text[..mention.start]),
        caret,
    )
}

/// A piece of a message: text as written, or a mention of a bot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MentionPart<'a> {
    Text(&'a str),
    /// The bot, and the "@Name" as written.
    Mention(&'a BotRef, &'a str),
}

/// What may follow a mentioned name: the end, a space or punctuation.
fn ends_name(rest: &str) -> bool {
    rest.chars()
        .next()
        .is_none_or(|c| c.is_whitespace() || ".,!?;:)'\"".contains(c))
}

/// Splits text around "@Name" for known bots. Longer names win ("@Chief of
/// staff" over "@Chief"), and an @ inside a word is left alone.
pub fn split_mentions<'a>(text: &'a str, bots: &'a [BotRef]) -> Vec<MentionPart<'a>> {
    let mut by_length: Vec<&BotRef> = bots.iter().collect();
    by_length.sort_by_key(|bot| std::cmp::Reverse(bot.name.len()));
    let mut parts = Vec::new();
    let mut last = 0;
    for (at, _) in text.match_indices('@') {
        if at < last {
            continue;
        }
        let starts_word = text[..at]
            .chars()
            .next_back()
            .is_none_or(|c| c.is_whitespace() || c == '(');
        if !starts_word {
            continue;
        }
        let after = &text[at + 1..];
        let found = by_length.iter().find_map(|bot| {
            let written = after.get(..bot.name.len())?;
            (written.to_lowercase() == bot.name.to_lowercase()
                && ends_name(&after[bot.name.len()..]))
            .then_some((*bot, bot.name.len()))
        });
        if let Some((bot, length)) = found {
            if at > last {
                parts.push(MentionPart::Text(&text[last..at]));
            }
            let end = at + 1 + length;
            parts.push(MentionPart::Mention(bot, &text[at..end]));
            last = end;
        }
    }
    if last < text.len() || parts.is_empty() {
        parts.push(MentionPart::Text(&text[last..]));
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bots() -> Vec<BotRef> {
        [("r", "Research"), ("c", "Chief of staff"), ("w", "Writer")]
            .map(|(id, name)| BotRef {
                id: id.into(),
                name: name.into(),
            })
            .to_vec()
    }

    fn query(start: usize, query: &str) -> Option<MentionQuery> {
        Some(MentionQuery {
            start,
            query: query.into(),
        })
    }

    // The same cases as apps/web/test/mentions.test.ts.
    #[test]
    fn an_at_opens_a_mention_only_at_a_words_start_up_to_the_caret() {
        assert_eq!(mention_query("@", 1), query(0, ""));
        assert_eq!(mention_query("Ask @Res", 8), query(4, "Res"));
        assert_eq!(mention_query("Ask @Chief of", 13), query(4, "Chief of"));
        assert_eq!(mention_query("mail me@home", 12), None);
        assert_eq!(mention_query("@Res\nmore", 9), None);
        assert_eq!(mention_query("plain text", 10), None);
        assert_eq!(mention_query("Ask @Research to", 6), query(4, "R"));
    }

    #[test]
    fn matches_are_bots_whose_names_start_with_what_was_typed() {
        let bots = bots();
        let ids = |q: &str| -> Vec<String> {
            mention_matches(&bots, q)
                .iter()
                .map(|b| b.id.clone())
                .collect()
        };
        assert_eq!(ids(""), ["r", "c", "w"]);
        assert_eq!(ids("re"), ["r"]);
        assert_eq!(ids("chief o"), ["c"]);
        assert!(ids("zz").is_empty());
    }

    #[test]
    fn choosing_a_bot_completes_its_name_and_moves_the_caret_past_it() {
        assert_eq!(
            insert_mention(
                "Ask @Res about snapshots",
                &query(4, "Res").unwrap(),
                8,
                "Research"
            ),
            ("Ask @Research about snapshots".to_owned(), 14)
        );
        assert_eq!(
            insert_mention("@", &query(0, "").unwrap(), 1, "Writer"),
            ("@Writer ".to_owned(), 8)
        );
    }

    #[test]
    fn a_message_splits_around_the_bots_it_names_and_only_those() {
        let bots = bots();
        assert_eq!(
            split_mentions("aks @Research why it is checking memory?", &bots),
            [
                MentionPart::Text("aks "),
                MentionPart::Mention(&bots[0], "@Research"),
                MentionPart::Text(" why it is checking memory?"),
            ]
        );
        assert_eq!(
            split_mentions("@chief of staff, and @Research.", &bots),
            [
                MentionPart::Mention(&bots[1], "@chief of staff"),
                MentionPart::Text(", and "),
                MentionPart::Mention(&bots[0], "@Research"),
                MentionPart::Text("."),
            ]
        );
        assert_eq!(
            split_mentions("mail me@Research or @Nobody", &bots),
            [MentionPart::Text("mail me@Research or @Nobody")]
        );
        assert_eq!(
            split_mentions("@Researchers", &bots),
            [MentionPart::Text("@Researchers")]
        );
    }
}
