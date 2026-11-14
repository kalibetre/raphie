//! The open conversation: the owner's messages as bubbles on the right,
//! replies as Markdown on the page, and under each message the tools the
//! run used.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/chat.tsx` and
//! `active-run.tsx`, and the message rules in `chat.css`.

use raphie_core::contracts::{
    ControlAction, QueueMode, SessionActivity, SessionObservation, SessionTurn, TurnStatus,
};
use raphie_core::model::Conversation;
use raphie_core::projections::{
    ToolStep, active_run_label, completed_at, format_cost, format_duration, format_tokens,
    run_usage, steps_by_turn,
};
use rune::{El, LiveRegion, ScrollSpec, col, icon, row, text};
use rune_kit::{Loader, Markdown};

use super::Look;
use super::steps::{Run, Working, tool_steps};
use crate::format;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, button, pressable};

/// The widest the conversation column gets, padding included, as on the web
/// (`max-width: 780px; padding: 28px`).
pub const READING_WIDTH: f32 = 780.0;

pub fn conversation(s: &Ui, conversation: &Conversation, look: &Look) -> El {
    col()
        .key("rd-transcript")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        // Follow the end while the reply streams in, unless the owner
        // scrolled up to read.
        .scroll(ScrollSpec { stick_bottom: true })
        .child(
            col().w_full().items_center().child(
                col()
                    .w_full()
                    .max_w(READING_WIDTH)
                    .padding(28.0)
                    .gap(18.0)
                    .children(items(s, conversation, look)),
            ),
        )
}

/// Everything in the conversation, top to bottom.
fn items(s: &Ui, conversation: &Conversation, look: &Look) -> Vec<El> {
    let t = &look.theme;
    let mut items: Vec<El> = Vec::new();
    if conversation.older_cursor().is_some() {
        let label = if conversation.loading_older {
            "Loading…"
        } else {
            "Show earlier messages"
        };
        items.push(row().w_full().justify_center().child(pressable(
            button(t, Kind::Ghost, Size::Small, None, label).key("rd-load-older"),
            !conversation.loading_older,
            |s: &mut Ui| s.load_older(),
        )));
    }
    // `let ... else` handles the "nothing yet" case and leaves the happy
    // path unindented.
    let Some(observation) = &conversation.observation else {
        items.push(
            row()
                .key("rd-loading")
                .pt(40.0)
                .gap(7.0)
                .center_y()
                .child(
                    Loader::new()
                        .size(14.0)
                        .color(t.muted_foreground)
                        .build(&look.kit),
                )
                .child(
                    text("Loading conversation…")
                        .font(font(13.0, 400.0))
                        .color(t.muted_foreground),
                ),
        );
        return items;
    };

    let now = format::now_ms();
    let turns = conversation.turns();
    // Each turn with the tool steps of its run, worked out from the journal.
    let runs = steps_by_turn(&turns, &observation.activity, &observation.tool_approvals);
    let live = conversation.live_text();
    // The reply being written belongs to the newest turn that is running.
    let writing = runs
        .iter()
        .rev()
        .map(|(turn, _)| *turn)
        .find(|turn| is_running(turn));

    for (turn, steps) in &runs {
        items.push(owner_turn(s, turn, steps, now, look));
        let streaming = writing
            .is_some_and(|w| w.id == turn.id)
            .then_some(live)
            .flatten();
        if let Some(reply) = reply(turn, streaming, &observation.activity, look) {
            items.push(reply);
        }
    }
    // What each running turn is doing now, after the messages.
    for (turn, steps) in &runs {
        if is_running(turn) {
            items.push(active_run(s, turn, steps, observation, now, look));
        }
    }
    if let Some(error) = &observation.error {
        items.push(error_line("rd-reply-error", &error.message, t));
    }
    items
}

/// A turn Raphie is working on now (not one waiting in the queue).
fn is_running(turn: &SessionTurn) -> bool {
    turn.status == TurnStatus::Pending && turn.queue_mode.is_none()
}

/// The owner's side of a turn: the message, then what became of it (queue
/// controls, the tools a finished run used, a stop or failure line).
fn owner_turn(s: &Ui, turn: &SessionTurn, steps: &[ToolStep], now: i64, look: &Look) -> El {
    let t = &look.theme;
    let mut block = col().w_full().gap(14.0).child(owner_message(turn, t));
    if let Some(mode) = turn.queue_mode {
        block = block.child(queue_controls(turn, mode, t));
    }
    let working = turn.status == TurnStatus::Pending;
    if !working && !steps.is_empty() {
        let run = Run {
            turn_id: &turn.id,
            steps,
            working: None,
        };
        block = block.child(tool_steps(s, &run, now, look));
    }
    if turn.cancelled == Some(true) {
        block = block.child(
            text("Stopped · message not completed")
                .key(format!("rd-stopped-{}", turn.id))
                .font(font(11.5, 400.0))
                .color(t.faint),
        );
    } else if turn.status == TurnStatus::Error {
        block = block.child(error_line(
            &format!("rd-failed-{}", turn.id),
            "Raphie could not complete this reply. Send a new message to retry.",
            t,
        ));
    }
    block
}

/// The owner's message: a bubble on the right, or a centred marker when a
/// scheduled job started the turn.
fn owner_message(turn: &SessionTurn, t: &Theme) -> El {
    let key = format!("rd-turn-{}", turn.id);
    if let Some(job) = &turn.scheduled {
        return row().key(key).w_full().justify_center().child(
            row()
                .px(12.0)
                .py(4.0)
                .gap(7.0)
                .center_y()
                .radius(13.0)
                .fill(t.accent_soft)
                .help(format!("Saved instruction: {}", turn.text))
                .child(
                    icon(&icons::CALENDAR_CLOCK, 13.0)
                        .color(t.accent)
                        .a11y_hidden(),
                )
                .child(text("Scheduled ·").font(font(12.0, 400.0)).color(t.accent))
                .child(
                    text(job.name.clone())
                        .font(font(12.0, 600.0))
                        .color(t.accent),
                )
                .child(
                    text(format::clock(turn.created_at))
                        .font(font(12.0, 400.0))
                        .color(t.muted_foreground),
                ),
        );
    }
    // A queued message is tinted until Raphie picks it up.
    let queued = turn.queue_mode.is_some();
    let (fill, border) = if queued {
        (t.card.mix(t.accent, 0.16), t.border.mix(t.accent, 0.45))
    } else {
        (t.muted, t.border)
    };
    row().key(key).w_full().justify_end().child(
        col()
            .max_w(560.0)
            .px(14.0)
            .py(9.0)
            .fill(fill)
            .border(1.0, border)
            // A speech bubble: every corner round but the bottom-right.
            .corners([16.0, 16.0, 4.0, 16.0])
            // The time the message was sent, on hover.
            .help(format::clock(turn.created_at))
            .child(
                text(turn.text.clone())
                    .font(font(14.0, 400.0).lh(23.0))
                    .color(t.foreground)
                    .wrap()
                    .selectable(true)
                    .selection_color(t.selection()),
            ),
    )
}

/// Under a queued message: how it will join the run, and a button to change
/// that (the web's `.message-queue-controls`).
fn queue_controls(turn: &SessionTurn, mode: QueueMode, t: &Theme) -> El {
    let steering = mode == QueueMode::Steer;
    let (status, glyph, label, action) = if steering {
        (
            "Steering after this step",
            &icons::LIST_END,
            "Keep queued",
            ControlAction::Queue,
        )
    } else {
        (
            "Queued",
            &icons::CORNER_UP_RIGHT,
            "Steer",
            ControlAction::Steer,
        )
    };
    let turn_id = turn.id.clone();
    row()
        .key(format!("rd-queue-{}", turn.id))
        .w_full()
        .gap(10.0)
        .justify_end()
        .center_y()
        .child(
            text(status)
                .font(font(11.0, 400.0))
                .color(t.muted_foreground),
        )
        .child(
            row()
                .key(format!("rd-queue-toggle-{}", turn.id))
                .role("button")
                .label(label)
                .px(9.0)
                .py(5.0)
                .gap(5.0)
                .center_y()
                .radius(6.0)
                .fill(t.card)
                .border(1.0, t.border)
                .hover(t.hover.alpha(0.6))
                .focus_ring(2.0, 2.0, t.accent)
                .child(icon(glyph, 14.0).color(t.foreground).a11y_hidden())
                .child(
                    text(label)
                        .font(font(11.0, 400.0))
                        .color(t.foreground)
                        .a11y_hidden(),
                )
                .on_press(move |s: &mut Ui| s.control(action, Some(&turn_id))),
        )
}

/// What Raphie answered to `turn`, if there is anything to show yet: the
/// finished reply with its time and cost, or the text written so far.
fn reply(
    turn: &SessionTurn,
    live: Option<&str>,
    activity: &[SessionActivity],
    look: &Look,
) -> Option<El> {
    let t = &look.theme;
    let (source, streaming) = match (&turn.answer, live) {
        (Some(answer), _) => (answer.as_str(), false),
        (None, Some(text)) if !text.is_empty() => (text, true),
        _ => return None,
    };
    let mut reply = col()
        .key(format!("rd-reply-{}", turn.id))
        .w_full()
        .px(2.0)
        .child(
            Markdown::new(source)
                .style(t.markdown(&look.kit))
                .streaming(streaming)
                .selectable(true)
                .build(&look.kit),
        );
    if turn.status == TurnStatus::Done {
        // "08:45 PM   88 tokens · $0.0000", from the run's model calls.
        let mut meta = row().key(format!("rd-meta-{}", turn.id)).mt(6.0).gap(10.0);
        let small = |content: String| text(content).font(font(11.5, 400.0)).color(t.faint);
        if let Some(at) = completed_at(&turn.id, activity) {
            meta = meta.child(small(format::clock(at)));
        }
        if let Some(usage) = run_usage(&turn.id, activity) {
            let calls = if usage.calls == 1 { "call" } else { "calls" };
            meta = meta.child(
                small(format!(
                    "{} tokens · {}",
                    format_tokens(usage.tokens),
                    format_cost(usage.cost)
                ))
                .help(format!(
                    "{} tokens across {} model {calls}, provider-reported",
                    usage.tokens, usage.calls
                )),
            );
        }
        reply = reply.child(meta);
    }
    Some(reply)
}

/// What a running turn is doing: its label, how long it has been going, and
/// its steps so far (the web's `ActiveRun`).
fn active_run(
    s: &Ui,
    turn: &SessionTurn,
    steps: &[ToolStep],
    observation: &SessionObservation,
    now: i64,
    look: &Look,
) -> El {
    // The label looks at this run's events only.
    let own: Vec<SessionActivity> = observation
        .activity
        .iter()
        .filter(|event| event.run_id.as_deref() == Some(turn.id.as_str()))
        .cloned()
        .collect();
    let run = Run {
        turn_id: &turn.id,
        steps,
        working: Some(Working {
            label: active_run_label(observation.live.as_ref(), steps, &own),
            elapsed: format_duration(now - turn.created_at),
        }),
    };
    col()
        .key("rd-working")
        .w_full()
        .child(tool_steps(s, &run, now, look))
}

fn error_line(key: &str, message: &str, t: &Theme) -> El {
    row()
        .key(key)
        .w_full()
        .gap(6.0)
        .center_y()
        .live_region(LiveRegion::Polite)
        .child(
            icon(&icons::CIRCLE_ALERT, 14.0)
                .color(t.error)
                .a11y_hidden(),
        )
        .child(
            text(message.to_owned())
                .font(font(13.0, 400.0))
                .color(t.error)
                .wrap()
                .shrink(),
        )
}
