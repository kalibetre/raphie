//! The open conversation: the owner's messages as bubbles on the right,
//! replies as Markdown on the page, and tool actions waiting for approval.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/chat.tsx`,
//! `domains/approvals/presentation/` and the message, `.steps` and
//! `.decision` rules in `chat.css`.

use raphie_core::contracts::{Decision, RunPhase, SessionApproval, SessionTurn, TurnStatus};
use raphie_core::model::Conversation;
use rune::{El, LiveRegion, ScrollSpec, TextCase, col, icon, row, text};
use rune_kit::{Loader, Markdown};

use super::Look;
use crate::format;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
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
        items.push(working("rd-loading", "Loading conversation…", look).pt(40.0));
        return items;
    };

    let turns = conversation.turns();
    let live = conversation.live_text();
    // The reply being written belongs to the newest pending turn.
    let pending = turns
        .iter()
        .rev()
        .find(|turn| turn.status == TurnStatus::Pending);
    for turn in &turns {
        items.push(owner_message(turn, t));
        let streaming = pending
            .is_some_and(|p| p.id == turn.id)
            .then_some(live)
            .flatten();
        if let Some(reply) = reply(turn, streaming, look) {
            items.push(reply);
        }
    }

    let approvals = conversation.pending_approvals();
    if !approvals.is_empty() {
        items.push(waiting_for_approval(&approvals, s, t));
    } else if pending.is_some() {
        // No reply text yet, or more to come: say what Raphie is doing.
        let label = phase_label(observation.phase, live.is_some_and(|text| !text.is_empty()));
        items.push(working("rd-working", label, look));
    }
    if let Some(error) = &observation.error {
        items.push(error_line("rd-reply-error", &error.message, t));
    }
    items
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
    row().key(key).w_full().justify_end().child(
        col()
            .max_w(560.0)
            .px(14.0)
            .py(9.0)
            .fill(t.muted)
            .border(1.0, t.border)
            // A speech bubble: every corner round but the bottom-right.
            .corners([16.0, 16.0, 4.0, 16.0])
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

/// What Raphie answered to `turn`, if there is anything to show yet.
fn reply(turn: &SessionTurn, live: Option<&str>, look: &Look) -> Option<El> {
    let t = &look.theme;
    let key = format!("rd-reply-{}", turn.id);
    let markdown = |source: &str, streaming: bool| {
        col().key(key.clone()).w_full().px(2.0).child(
            Markdown::new(source)
                .style(t.markdown(&look.kit))
                .streaming(streaming)
                .selectable(true)
                .build(&look.kit),
        )
    };
    if let Some(answer) = &turn.answer {
        return Some(markdown(answer, false));
    }
    match turn.status {
        TurnStatus::Pending => live
            .filter(|text| !text.is_empty())
            .map(|text| markdown(text, true)),
        TurnStatus::Error if turn.cancelled == Some(true) => Some(
            text("Stopped · message not completed")
                .key(key)
                .font(font(11.5, 400.0))
                .color(t.faint),
        ),
        TurnStatus::Error => Some(error_line(
            &key,
            "Raphie could not complete this reply. Send a new message to retry.",
            t,
        )),
        TurnStatus::Done | TurnStatus::Unknown => None,
    }
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

/// What the run is doing, in the web's words (`activeRunLabel`).
fn phase_label(phase: RunPhase, writing: bool) -> &'static str {
    match phase {
        RunPhase::Queued => "Queued…",
        RunPhase::Tool => "Running tool…",
        RunPhase::Writing => "Writing reply…",
        _ if writing => "Writing reply…",
        _ => "Waiting for model…",
    }
}

/// A spinner and a quiet line: Raphie is busy.
fn working(key: &str, label: &str, look: &Look) -> El {
    let t = &look.theme;
    row()
        .key(key)
        .gap(7.0)
        .center_y()
        .live_region(LiveRegion::Polite)
        .child(
            Loader::new()
                .size(14.0)
                .color(t.muted_foreground)
                .build(&look.kit),
        )
        .child(
            text(label.to_owned())
                .font(font(13.0, 400.0))
                .color(t.muted_foreground),
        )
}

/// The tool actions that need the owner, as the web's step list: a heading,
/// then each action with its exact arguments and the decision bar.
fn waiting_for_approval(approvals: &[&SessionApproval], s: &Ui, t: &Theme) -> El {
    let mut steps = col().w_full().mt(6.0);
    for (index, approval) in approvals.iter().enumerate() {
        let last = index + 1 == approvals.len();
        steps = steps.child(step(
            approval,
            s.model.deciding.contains(&approval.id),
            last,
            t,
        ));
    }
    col()
        .key("rd-approvals")
        .w_full()
        .child(
            row()
                .gap(7.0)
                .center_y()
                .live_region(LiveRegion::Polite)
                .child(
                    icon(&icons::SHIELD_QUESTION_MARK, 14.0)
                        .color(t.attention)
                        .a11y_hidden(),
                )
                .child(
                    text("Waiting for your approval")
                        .font(font(13.0, 560.0))
                        .color(t.attention),
                ),
        )
        .child(steps)
}

/// One proposed action: icon in the left gutter, details on the right.
fn step(approval: &SessionApproval, deciding: bool, last: bool, t: &Theme) -> El {
    let mut gutter = col().w(20.0).items_center().child(
        row()
            .size(20.0, 20.0)
            .mt(1.0)
            .center()
            .radius(10.0)
            .fill(t.attention_soft)
            .child(
                icon(&icons::SHIELD_QUESTION_MARK, 13.0)
                    .color(t.attention)
                    .a11y_hidden(),
            ),
    );
    if !last {
        // The line that joins this step to the next one.
        gutter = gutter.child(rune::el().w(1.0).grow(1.0).fill(t.border));
    }
    let name = row()
        .w_full()
        .min_h(22.0)
        .gap(10.0)
        .center_y()
        .child(
            row()
                .gap(6.0)
                .center_y()
                .grow(1.0)
                .min_w(0.0)
                .child(
                    text(approval.server.clone())
                        .font(font(13.0, 400.0))
                        .color(t.muted_foreground),
                )
                .child(
                    text(approval.tool.clone())
                        .font(mono(12.0))
                        .color(t.foreground),
                ),
        )
        .child(
            text("needs approval")
                .font(font(11.5, 400.0))
                .color(t.attention),
        );
    let body = col()
        .grow(1.0)
        .min_w(0.0)
        .pb(8.0)
        .child(name)
        .child(
            text("Arguments")
                .font(font(11.0, 400.0).tracking(0.6))
                .color(t.faint)
                .text_case(TextCase::Uppercase)
                .mt(8.0)
                .mb(4.0),
        )
        .child(
            // The exact arguments the action will run with.
            col()
                .key(format!("rd-approval-args-{}", approval.id))
                .w_full()
                .max_h(260.0)
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .radius(8.0)
                .fill(t.card)
                .border(1.0, t.border)
                .child(
                    text(approval.arguments_pretty())
                        .font(mono(12.0))
                        .color(t.foreground)
                        .selectable(true)
                        .selection_color(t.selection())
                        .wrap_anywhere()
                        .px(12.0)
                        .py(10.0),
                ),
        )
        .child(decision(approval, deciding, t));
    row()
        .key(format!("rd-approval-{}", approval.id))
        .role("group")
        .label(format!(
            "Approval needed: {} {}",
            approval.server, approval.tool
        ))
        .w_full()
        .gap(10.0)
        .child(gutter)
        .child(body)
}

/// When the approval expires, and the two answers (the web's `.decision`).
fn decision(approval: &SessionApproval, deciding: bool, t: &Theme) -> El {
    let approve_id = approval.id.clone();
    let reject_id = approval.id.clone();
    row()
        .w_full()
        .mt(10.0)
        .px(12.0)
        .py(10.0)
        .gap(8.0)
        .center_y()
        .radius(10.0)
        .fill(t.card)
        .border(1.0, t.attention_soft)
        .child(
            text(format!("Expires {}", format::clock(approval.expires_at)))
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .grow(1.0),
        )
        .child(pressable(
            button(t, Kind::Outline, Size::Small, Some(&icons::X), "Reject")
                .key(format!("rd-reject-{}", approval.id)),
            !deciding,
            move |s: &mut Ui| s.decide(&reject_id, Decision::Rejected),
        ))
        .child(pressable(
            button(
                t,
                Kind::Primary,
                Size::Small,
                Some(&icons::CHECK),
                "Approve once",
            )
            .key(format!("rd-approve-{}", approval.id)),
            !deciding,
            move |s: &mut Ui| s.decide(&approve_id, Decision::Approved),
        ))
}
