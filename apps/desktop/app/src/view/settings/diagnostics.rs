//! Settings → Diagnostics: the switch that collects diagnostic traces, and
//! the recent traces themselves. An app-wide page, beside Account and
//! Appearance: trace collection is one setting of the runtime and its
//! trace store is shared by every bot.
//!
//! Mirrors `telemetry-settings.tsx` and `diagnostics.tsx`. The traces and
//! the filter's rule are in the core (`raphie_core::inspection`).
//!
//! One difference from the web: "Export traces" saves the JSON straight
//! into this machine's Downloads folder and says what it was saved as.

use raphie_core::contracts::{DiagnosticSpan, SpanStatus, TraceDiagnostics, TraceState};
use raphie_core::engine::Command;
use raphie_core::inspection::{TRACE_WINDOWS, span_bot, span_matches};
use rune::{El, col, row, text};

use super::inspect::{Entry, empty, entry, filter_box, heading, meta};
use super::parts::{Scope, group, page, setting};
use crate::format::{iso_utc, time_seconds};
use crate::icons;
use crate::state::{BACKEND, Ui};
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Kind, Size, button, icon_button, pressable, switch};

pub fn diagnostics(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    page(
        "rd-page-diagnostics",
        "Diagnostics",
        "Timings and failures from every bot’s runs. Nothing leaves this backend.",
        Scope::App,
        vec![telemetry(s, BACKEND, t), traces(s, t)],
        look,
    )
}

/// "Telemetry": the switch, what it does, and whether it is on.
fn telemetry(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let settings = s.model.settings.get(bot_id);
    let enabled = settings.is_some_and(|settings| settings.telemetry_enabled);
    let failed = s
        .model
        .settings_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    let note = |content: &str| {
        text(content)
            .font(font(12.5, 400.0))
            .color(t.muted_foreground)
            .wrap()
    };
    // What the last change said first, then how the settings stand.
    let state = match (&s.model.telemetry_error, settings) {
        (Some(error), _) => error.clone(),
        (None, None) if failed => "Could not load backend settings.".to_owned(),
        (None, None) => "Loading telemetry settings…".to_owned(),
        (None, Some(_)) if enabled => "Trace collection is on.".to_owned(),
        (None, Some(_)) => "Trace collection is off.".to_owned(),
    };
    let mut form = col()
        .w_full()
        .padding(18.0)
        .gap(12.0)
        .child(note(
            "Turning this off stops new traces. In-flight traces may finish exporting. Existing traces remain until retention removes them. Session Activity and recovery continue.",
        ))
        .child(note(&state).key("rd-telemetry-state"));
    if failed && settings.is_none() {
        let bot_id = bot_id.to_owned();
        form = form.child(
            pressable(
                button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-telemetry-retry"),
                true,
                move |s: &mut Ui| {
                    s.model.settings_error = None;
                    s.command(Command::LoadSettings {
                        bot_id: bot_id.clone(),
                    });
                },
            )
            .self_start(),
        );
    }
    group(
        t,
        "Telemetry",
        "Operational traces are stored on this backend for Diagnostics. No analytics service receives them.",
        vec![
            setting(
                t,
                None,
                "Collect diagnostic traces",
                "Record run and model timings, token counts, errors, and tool activity. Prompts and tool payloads are excluded.",
                Some(pressable(
                    switch(t, enabled, "Collect diagnostic traces").key("rd-telemetry"),
                    // Nothing to flip until the settings are here.
                    settings.is_some() && !s.model.setting_telemetry,
                    move |s: &mut Ui| s.set_telemetry(!enabled),
                )),
            ),
            form,
        ],
    )
}

/// "Recent traces": the window, the filter, and one row per span.
fn traces(s: &Ui, t: &Theme) -> El {
    let view = &s.model.traces;
    // Traces are shown only when the last load worked and the backend is
    // ready; anything else is an empty state that says why.
    let ready: Option<&TraceDiagnostics> = view
        .data
        .as_ref()
        .filter(|data| !view.failed && data.state == TraceState::Ready);
    let filter = s.spans.filter.text.as_str();
    // Whose span this is, by name. A bot deleted since keeps its id.
    let bot_of = |span: &DiagnosticSpan| -> Option<String> {
        let id = span_bot(span)?;
        let known = s.model.bots.iter().find(|bot| bot.id == id);
        Some(known.map_or_else(|| id.to_owned(), |bot| bot.name.clone()))
    };
    let visible: Vec<&DiagnosticSpan> = ready
        .map(|data| {
            data.spans
                .iter()
                .filter(|span| span_matches(span, bot_of(span).as_deref(), filter))
                .collect()
        })
        .unwrap_or_default();

    let buttons = row()
        .gap(4.0)
        .center_y()
        .child(pressable(
            icon_button(t, &icons::REFRESH_CW, 16.0, "Refresh traces").key("rd-traces-refresh"),
            !view.loading,
            |s: &mut Ui| s.load_traces(),
        ))
        .child(pressable(
            icon_button(t, &icons::DOWNLOAD, 16.0, "Export traces").key("rd-traces-export"),
            ready.is_some_and(|data| !data.spans.is_empty()) && !s.model.exporting,
            |s: &mut Ui| s.export_traces(),
        ));
    let mut windows = row()
        .role("group")
        .label("Trace time window")
        .mt(16.0)
        .gap(4.0)
        .center_y();
    for hours in TRACE_WINDOWS {
        // The chosen window is filled.
        let chosen = s.trace_hours == hours;
        let mut choice = button(t, Kind::Ghost, Size::Small, None, &format!("Last {hours}h"))
            .key(format!("rd-traces-{hours}h"))
            .checked(chosen);
        if chosen {
            choice = choice.fill(t.muted);
        }
        windows = windows.child(pressable(choice, true, move |s: &mut Ui| {
            s.set_trace_window(hours);
        }));
    }
    let limit = view.data.as_ref().map_or(500, |data| data.span_limit);
    let mut section = col()
        .key("rd-traces")
        .w_full()
        .child(heading(
            t,
            "Recent traces",
            20.0,
            "Operation timings and failures from exported OTLP traces, for every bot.",
            buttons,
        ))
        .child(windows)
        .child(filter_box(
            t,
            "rd-traces-filter",
            "Filter traces",
            "Filter by operation, bot, trace or session…",
            &s.spans.filter,
            |s: &mut Ui| &mut s.spans.filter,
        ))
        .child(meta(
            t,
            "rd-traces-count",
            format!("{} spans · OTLP", visible.len()),
            format!("Latest {limit} spans"),
        ));
    if ready.is_some_and(|data| !data.export_enabled) {
        section = section.child(
            text("Trace export is disabled. Showing retained traces only.")
                .key("rd-traces-notice")
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    }
    section = section.child(export_notice(s, t));

    if visible.is_empty() {
        let unavailable = view.failed
            || view
                .data
                .as_ref()
                .is_some_and(|data| data.state == TraceState::Unavailable);
        let title = if view.data.is_none() && !view.failed {
            "Loading traces…"
        } else if unavailable {
            "Trace backend unavailable"
        } else if ready.is_none() {
            "Trace backend not configured"
        } else if !filter.trim().is_empty() {
            "No matching spans"
        } else {
            "No exported traces in this window"
        };
        return section.child(empty(
            t,
            "rd-traces-empty",
            if unavailable {
                &icons::TRIANGLE_ALERT
            } else {
                &icons::ACTIVITY
            },
            Some(title),
            if ready.is_some() {
                "Completed spans appear after export. Session Activity retains the execution history."
            } else {
                "Tracing is unavailable. Retry in a moment. Activity remains available in each session."
            },
        ));
    }
    let mut list = col().w_full().pb(16.0);
    for span in visible {
        // A span is one of many in its trace, so both ids name it.
        let id = format!("{}:{}", span.trace_id, span.span_id);
        let failed = span.status == SpanStatus::Error;
        let toggle = id.clone();
        let bot = bot_of(span);
        // "Research · Error · 804.0 ms": whose, then how it went.
        let whose = bot
            .as_ref()
            .map_or(String::new(), |bot| format!("{bot} · "));
        list = list.child(entry(
            t,
            Entry {
                key: format!("rd-span-{id}"),
                summary: &span.name,
                timing: Some(format!(
                    "{whose}{}{:.1} ms",
                    if failed { "Error · " } else { "" },
                    span.duration_ms
                )),
                time: time_seconds(span.started_at),
                failed,
                open: s.spans.open.contains(&id),
                facts: vec![
                    ("Bot", bot.unwrap_or_else(|| "Not recorded".to_owned())),
                    ("Trace", span.trace_id.clone()),
                    ("Span", span.span_id.clone()),
                    (
                        "Parent",
                        span.parent_span_id
                            .clone()
                            .unwrap_or_else(|| "Root span".to_owned()),
                    ),
                    (
                        "Status",
                        if span.status == SpanStatus::Unset {
                            "No explicit status".to_owned()
                        } else {
                            span.status.word().to_owned()
                        },
                    ),
                    ("Started", iso_utc(span.started_at)),
                ],
                code: serde_json::to_string_pretty(&span.attributes).unwrap_or_default(),
            },
            move |s: &mut Ui| Ui::toggle(&mut s.spans.open, &toggle),
        ));
    }
    section.child(list)
}

/// Where the last export went, or why it failed. An empty element when
/// there is nothing to say, so callers can always add it.
pub fn export_notice(s: &Ui, t: &Theme) -> El {
    let line = |content: String| text(content).font(font(12.0, 400.0)).wrap();
    if let Some(error) = &s.model.export_error {
        line(error.clone())
            .key("rd-export-error")
            .role("alert")
            .color(t.error)
    } else if let Some(saved) = &s.model.export_saved {
        line(format!("Saved to your Downloads folder as {saved}."))
            .key("rd-export-saved")
            .color(t.muted_foreground)
    } else {
        col()
    }
}
