//! A small Server-Sent Events parser.
//!
//! The runtime's streams (`/api/sessions/events`, `/api/sessions/<id>/events`)
//! send each state as one `data:` event of JSON, plus `: heartbeat` comments
//! while idle. Network chunks can split a line, or even a UTF-8 character,
//! anywhere, so the parser keeps the unfinished bytes and only decodes whole
//! lines. It knows nothing about HTTP; that keeps it easy to test.

/// Feed it bytes as they arrive; it returns the `data` of each finished event.
#[derive(Debug, Default)]
pub struct SseParser {
    /// Bytes after the last newline, waiting for the rest of their line.
    pending: Vec<u8>,
    /// `data:` lines of the event being read, joined with `\n`.
    data: String,
    has_data: bool,
}

impl SseParser {
    pub fn new() -> SseParser {
        SseParser::default()
    }

    /// Adds a chunk and returns every event it completed, in order.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(chunk);
        let mut events = Vec::new();
        // Take whole lines off the front; whatever follows the last `\n` stays.
        while let Some(end) = self.pending.iter().position(|&b| b == b'\n') {
            // `drain` removes the line from `pending` and hands us its bytes.
            let mut line: Vec<u8> = self.pending.drain(..=end).collect();
            line.pop(); // the `\n`
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            // A whole line is complete UTF-8 unless the server sent bad bytes;
            // replace those rather than failing the stream.
            let line = String::from_utf8_lossy(&line);
            if let Some(event) = self.line(&line) {
                events.push(event);
            }
        }
        events
    }

    fn line(&mut self, line: &str) -> Option<String> {
        if line.is_empty() {
            // A blank line ends the event.
            if !self.has_data {
                return None;
            }
            self.has_data = false;
            return Some(std::mem::take(&mut self.data));
        }
        if line.starts_with(':') {
            return None; // a comment, such as the runtime's heartbeat
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        if field == "data" {
            if self.has_data {
                self.data.push('\n');
            }
            self.data.push_str(value);
            self.has_data = true;
        }
        // `event`, `id` and `retry` are not used by Raphie's streams.
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_events_and_skips_heartbeats() {
        let mut parser = SseParser::new();
        let events = parser.push(b"data: {\"a\":1}\n\n: heartbeat\n\ndata: {\"a\":2}\n\n");
        assert_eq!(events, vec![r#"{"a":1}"#, r#"{"a":2}"#]);
    }

    #[test]
    fn joins_lines_split_across_chunks_and_crlf() {
        let mut parser = SseParser::new();
        assert!(parser.push(b"da").is_empty());
        assert!(parser.push(b"ta: hel").is_empty());
        assert!(parser.push(b"lo\r\n").is_empty());
        assert_eq!(parser.push(b"\r\n"), vec!["hello"]);
    }

    #[test]
    fn keeps_a_split_utf8_character_intact() {
        let text = "data: caf\u{e9} \u{1f375}\n\n".as_bytes();
        let mut parser = SseParser::new();
        let mut events = Vec::new();
        for byte in text {
            events.extend(parser.push(std::slice::from_ref(byte)));
        }
        assert_eq!(events, vec!["caf\u{e9} \u{1f375}"]);
    }

    #[test]
    fn multi_line_data_joins_with_newlines() {
        let mut parser = SseParser::new();
        assert_eq!(parser.push(b"data: a\ndata: b\nid: 7\n\n"), vec!["a\nb"]);
    }
}
