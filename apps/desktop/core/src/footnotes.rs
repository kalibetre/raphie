//! A reply's Markdown footnotes, which Rune's Markdown does not draw: each
//! reference becomes a superscript number and the notes are listed apart,
//! as the web shows them. The runtime's `plainFootnotes` does the same for
//! Telegram and Discord.

/// A reply with its footnotes taken out.
#[derive(Debug, PartialEq, Eq)]
pub struct Cited {
    /// The reply, each reference to a note as a superscript number.
    pub body: String,
    /// The notes in the order the reply first cites them, numbered from 1.
    pub notes: Vec<String>,
}

/// `n` in superscript digits: 12 is "¹²".
pub fn superscript(n: usize) -> String {
    const DIGITS: [char; 10] = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    n.to_string()
        .bytes()
        .map(|digit| DIGITS[usize::from(digit - b'0')])
        .collect()
}

/// `source` with its footnotes taken out. A reference with no note stays as
/// written; a note nothing cites is dropped, as Markdown does. Code is left
/// alone.
pub fn cite(source: &str) -> Cited {
    let mut notes: Vec<(String, String)> = Vec::new();
    let mut body: Vec<&str> = Vec::new();
    let mut fenced = false;
    let mut open_note: Option<usize> = None;
    for line in source.split('\n') {
        if is_fence(line) {
            fenced = !fenced;
        }
        if let Some((label, text)) = (!fenced).then(|| definition(line)).flatten() {
            notes.retain(|(seen, _)| seen != label);
            notes.push((label.to_owned(), text.trim().to_owned()));
            open_note = Some(notes.len() - 1);
            continue;
        }
        if let Some(n) = open_note
            && (line.starts_with('\t') || line.starts_with("  "))
            && !line.trim().is_empty()
        {
            let note = &mut notes[n].1;
            *note = format!("{note} {}", line.trim()).trim().to_owned();
            continue;
        }
        open_note = None;
        body.push(line);
    }
    if notes.is_empty() {
        return Cited {
            body: source.to_owned(),
            notes: Vec::new(),
        };
    }
    let mut order: Vec<&str> = Vec::new();
    let mut fenced = false;
    let mut cited = Vec::with_capacity(body.len());
    for line in body {
        if is_fence(line) {
            fenced = !fenced;
        }
        cited.push(if fenced {
            line.to_owned()
        } else {
            references(line, &notes, &mut order)
        });
    }
    let notes = order
        .iter()
        .filter_map(|label| notes.iter().find(|(seen, _)| seen == label))
        .map(|(_, text)| text.clone())
        .collect();
    Cited {
        body: cited.join("\n").trim_end().to_owned(),
        notes,
    }
}

fn is_fence(line: &str) -> bool {
    let indent = line.len() - line.trim_start_matches(' ').len();
    let rest = &line[indent..];
    indent <= 3 && (rest.starts_with("```") || rest.starts_with("~~~"))
}

/// "[^label]: text" as its label and text.
fn definition(line: &str) -> Option<(&str, &str)> {
    let rest = line.strip_prefix("[^")?;
    let (label, text) = rest.split_once("]:")?;
    if label.is_empty() || label.contains(char::is_whitespace) || label.contains(']') {
        return None;
    }
    Some((label, text))
}

/// `line` with each "[^label]" for a known note as its number, outside code.
fn references<'a>(line: &'a str, notes: &[(String, String)], order: &mut Vec<&'a str>) -> String {
    let mut out = String::with_capacity(line.len());
    // Odd segments between backticks are inline code.
    for (n, part) in line.split('`').enumerate() {
        if n > 0 {
            out.push('`');
        }
        if n % 2 == 1 {
            out.push_str(part);
            continue;
        }
        let mut rest = part;
        while let Some(start) = rest.find("[^") {
            out.push_str(&rest[..start]);
            let after = &rest[start + 2..];
            let label = after
                .split_once(']')
                .map(|(label, _)| label)
                .filter(|label| {
                    !label.is_empty()
                        && !label.contains(char::is_whitespace)
                        && notes.iter().any(|(seen, _)| seen == label)
                });
            match label {
                Some(label) => {
                    let n = match order.iter().position(|seen| *seen == label) {
                        Some(n) => n,
                        None => {
                            order.push(label);
                            order.len() - 1
                        }
                    };
                    out.push_str(&superscript(n + 1));
                    rest = &after[label.len() + 1..];
                }
                None => {
                    out.push_str("[^");
                    rest = after;
                }
            }
        }
        out.push_str(rest);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_become_numbers_in_citation_order() {
        let cited = cite(
            "Rises to 2M ETB.[^vat] Turnover tax stays.[^tot]\n\nAgain.[^vat]\n\n\
             [^tot]: Addis Fortune\n[^vat]: VAT Proclamation amendment,\n  mor.gov.et",
        );
        assert_eq!(
            cited.body,
            "Rises to 2M ETB.¹ Turnover tax stays.²\n\nAgain.¹"
        );
        assert_eq!(
            cited.notes,
            ["VAT Proclamation amendment, mor.gov.et", "Addis Fortune"]
        );
        assert_eq!(superscript(12), "¹²");
    }

    #[test]
    fn code_unknown_references_and_unused_notes_stay_as_written() {
        let source = "No sources here.";
        assert_eq!(
            cite(source),
            Cited {
                body: source.to_owned(),
                notes: vec![]
            }
        );
        let cited = cite(
            "Use `[^1]` for a note.[^1] Not this one.[^2]\n```\n[^1] in code\n```\n\n\
             [^1]: The guide\n[^3]: Never cited",
        );
        assert_eq!(
            cited.body,
            "Use `[^1]` for a note.¹ Not this one.[^2]\n```\n[^1] in code\n```"
        );
        assert_eq!(cited.notes, ["The guide"]);
    }
}
