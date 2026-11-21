//! A bot's skills: standard Agent Skills kept in its workspace at
//! `skills/<name>/SKILL.md`. The runtime checks them; this module holds what
//! the client needs to send them.

use crate::attachments::multipart;

/// What a new skill starts as in the editor.
pub const TEMPLATE: &str = "---\nname: my-skill\ndescription: What this skill does, and when to use it.\n---\n\n# My skill\n\n1. The first step.\n2. The next step.\n";

/// The body of `POST /api/skills/import`: the archive, and whether skills
/// with the same name are replaced.
pub fn import_form(boundary: &str, name: &str, bytes: &[u8], replace: bool) -> (String, Vec<u8>) {
    let (content_type, file) = multipart(boundary, name, bytes);
    let field = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"replace\"\r\n\r\n{replace}\r\n"
    );
    let mut body = field.into_bytes();
    body.extend_from_slice(&file);
    (content_type, body)
}

/// The `name:` in a SKILL.md's frontmatter, as the runtime will read it, or
/// empty when there is none.
pub fn skill_name(text: &str) -> String {
    let text = text.trim_start_matches('\u{feff}');
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return String::new();
    };
    for line in rest.lines() {
        let line = line.trim_end();
        if line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            return value.trim().trim_matches(['"', '\'']).to_owned();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_name_comes_from_the_frontmatter() {
        assert_eq!(skill_name(TEMPLATE), "my-skill");
        assert_eq!(skill_name("---\nname: \"pdf\"\n---\nname: no"), "pdf");
        assert_eq!(skill_name("name: outside"), "");
        assert_eq!(skill_name("---\ndescription: x\n---\nname: body"), "");
    }

    #[test]
    fn the_import_form_says_whether_to_replace() {
        let (content_type, body) = import_form("b", "s.zip", b"PK", true);
        assert_eq!(content_type, "multipart/form-data; boundary=b");
        let body = String::from_utf8_lossy(&body);
        assert!(body.starts_with(
            "--b\r\nContent-Disposition: form-data; name=\"replace\"\r\n\r\ntrue\r\n--b\r\n"
        ));
        assert!(body.ends_with("PK\r\n--b--\r\n"));
    }
}
