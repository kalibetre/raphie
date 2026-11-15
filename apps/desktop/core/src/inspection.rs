//! Settings → Diagnostics and Activity: the traces and events on screen,
//! and how the filter box narrows them.
//!
//! Both pages are read-only lists the runtime keeps. Diagnostics shows
//! exported OTLP spans for a time window; Activity shows the durable events
//! of every conversation a bot had.

use crate::contracts::{ActivityEvent, DiagnosticSpan, TraceDiagnostics};

/// The time windows Diagnostics offers, in hours. The runtime takes no
/// others.
pub const TRACE_WINDOWS: [u8; 3] = [1, 6, 24];

/// The traces on screen, for one bot and one time window.
///
/// Answers name the bot and window they are for, so one that arrives after
/// the owner chose another window is dropped.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TraceView {
    /// The bot and window (in hours) being shown; `None` until the page is
    /// opened.
    pub shown: Option<(String, u8)>,
    /// What the runtime answered; `None` until it has.
    pub data: Option<TraceDiagnostics>,
    pub loading: bool,
    /// The last load failed. Traces loaded before stay in `data`, but the
    /// page treats the backend as unavailable until a load succeeds.
    pub failed: bool,
}

impl TraceView {
    /// A load for `bot_id`'s last `hours` hours is starting. Another bot
    /// or window empties the list; the same one keeps it until the answer.
    pub fn open(&mut self, bot_id: &str, hours: u8) {
        if !self.shows(bot_id, hours) {
            *self = TraceView {
                shown: Some((bot_id.to_owned(), hours)),
                ..TraceView::default()
            };
        }
        self.loading = true;
    }

    fn shows(&self, bot_id: &str, hours: u8) -> bool {
        // `as_ref` borrows the pair inside the `Option` to compare it.
        self.shown
            .as_ref()
            .is_some_and(|(bot, window)| bot == bot_id && *window == hours)
    }

    pub fn loaded(&mut self, bot_id: &str, hours: u8, data: TraceDiagnostics) {
        if self.shows(bot_id, hours) {
            self.loading = false;
            self.failed = false;
            self.data = Some(data);
        }
    }

    pub fn load_failed(&mut self, bot_id: &str, hours: u8) {
        if self.shows(bot_id, hours) {
            self.loading = false;
            self.failed = true;
        }
    }
}

/// Whether a span passes the filter box: its name, trace id, status or
/// attributes contain the typed text, whatever its case.
pub fn span_matches(span: &DiagnosticSpan, filter: &str) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        span.name,
        span.trace_id,
        span.status.word(),
        span.attributes
    );
    haystack
        .to_lowercase()
        .contains(&filter.trim().to_lowercase())
}

/// Whether an event passes the filter box: its summary, type or run id
/// contain the typed text, whatever its case.
pub fn event_matches(event: &ActivityEvent, filter: &str) -> bool {
    let haystack = format!(
        "{} {} {}",
        event.summary,
        event.kind,
        event.run_id.as_deref().unwrap_or("")
    );
    haystack
        .to_lowercase()
        .contains(&filter.trim().to_lowercase())
}

/// Whether an event is one that went wrong: its dot is drawn in red.
pub fn is_failure(event: &ActivityEvent) -> bool {
    event.kind.contains("failed") || event.kind.contains("uncertain")
}

/// JSON text laid out over several lines for reading. Text that is not
/// JSON is returned as it is.
pub fn pretty_json(text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| serde_json::to_string_pretty(&value).ok())
        .unwrap_or_else(|| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{SpanStatus, TraceState};

    fn span(name: &str, status: SpanStatus) -> DiagnosticSpan {
        DiagnosticSpan {
            trace_id: "4bf92f3577b34da6".into(),
            span_id: "00f067aa".into(),
            parent_span_id: None,
            name: name.into(),
            started_at: 1_700_000_000_000,
            duration_ms: 12.5,
            status,
            attributes: serde_json::json!({ "session.id": "s-1", "tokens": 42 }),
        }
    }

    fn event(kind: &str, summary: &str) -> ActivityEvent {
        ActivityEvent {
            id: 1,
            at: 1_700_000_000_000,
            attempt_id: "a-1".into(),
            run_id: Some("run-7".into()),
            operation_id: None,
            plugin_id: None,
            kind: kind.into(),
            summary: summary.into(),
            details_json: "{}".into(),
        }
    }

    fn traces() -> TraceDiagnostics {
        TraceDiagnostics {
            source: "otlp".into(),
            state: TraceState::Ready,
            export_enabled: true,
            spans: vec![span("model.call", SpanStatus::Ok)],
            from: 0,
            to: 1,
            span_limit: 500,
        }
    }

    #[test]
    fn the_filter_looks_in_names_ids_status_and_attributes() {
        let failed = span("tool.run", SpanStatus::Error);
        assert!(span_matches(&failed, ""));
        assert!(span_matches(&failed, "TOOL"));
        assert!(span_matches(&failed, "4bf92"));
        assert!(span_matches(&failed, "error"));
        assert!(span_matches(&failed, "s-1"), "an attribute's value");
        assert!(!span_matches(&failed, "model"));

        let started = event("tool.started", "search started");
        assert!(event_matches(&started, " Search "));
        assert!(event_matches(&started, "run-7"));
        assert!(!event_matches(&started, "approval"));
        assert!(!is_failure(&started));
        assert!(is_failure(&event("model.failed", "model failed")));
        assert!(is_failure(&event("tool.uncertain", "outcome unknown")));
    }

    #[test]
    fn an_answer_for_another_window_is_dropped() {
        let mut view = TraceView::default();
        view.open("default", 1);
        view.open("default", 6);
        view.loaded("default", 1, traces());
        assert!(view.data.is_none() && view.loading);
        view.loaded("default", 6, traces());
        assert!(view.data.is_some() && !view.loading);
        // A refresh keeps the traces; a failure keeps them and says so.
        view.open("default", 6);
        assert!(view.data.is_some());
        view.load_failed("default", 6);
        assert!(view.failed && view.data.is_some());
        view.loaded("default", 6, traces());
        assert!(!view.failed);
    }

    #[test]
    fn details_are_laid_out_for_reading() {
        assert_eq!(pretty_json(r#"{"a":1}"#), "{\n  \"a\": 1\n}");
        assert_eq!(pretty_json("not json"), "not json");
    }
}
