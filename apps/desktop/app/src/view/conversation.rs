//! The open conversation: the owner's messages as bubbles on the right,
//! replies as Markdown on the page, and under each message the tools the
//! run used.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/chat.tsx` and
//! `active-run.tsx`, and the message rules in `chat.css`.

use raphie_core::contracts::{
    AskStatus, BackgroundRequest, ControlAction, QueueMode, QuoteAuthor, SessionActivity,
    SessionAsk, SessionCard, SessionObservation, SessionTurn, TurnStatus,
};
use raphie_core::model::Conversation;
use raphie_core::projections::{
    ToolStep, active_run_label, completed_at, format_cost, format_duration, run_usage,
    steps_by_turn,
};
use rune::{El, LiveRegion, ScrollSpec, col, icon, row, text};
use rune_kit::{Loader, Markdown};

use super::Look;
use super::asks;
use super::attachments::{Action, file_card};
use super::cards;
use super::compaction;
use super::handoffs;
use super::self_updates;
use super::steps::{Run, Working, code_box, tool_steps};
use super::work_tab;
use crate::avatar::bot_avatar;
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
        // Replies count as read only at the end of the conversation.
        .on_at_bottom(|s: &mut Ui, at: bool| {
            s.at_bottom = at;
            s.mark_read();
        })
        .child(
            col().w_full().items_center().child(
                col()
                    .w_full()
                    .max_w(READING_WIDTH)
                    // The web's `.conversation-content`: 28 px all round,
                    // and 20 by 16 in a narrow window, where width is scarce.
                    .px(if s.narrow() { 16.0 } else { 28.0 })
                    .py(if s.narrow() { 20.0 } else { 28.0 })
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

    let failed = failed_runs(runs.iter().map(|(turn, _)| *turn));
    // Receipts of the background work's settled questions, each placed in
    // the chat where it was settled: above the first turn after it.
    let mut receipts: Vec<(&SessionAsk, &str, i64)> = observation
        .background
        .iter()
        .flat_map(|request| {
            request
                .asks
                .iter()
                .filter(|ask| ask.status != AskStatus::Pending)
                .map(|ask| {
                    (
                        ask,
                        request.title.as_str(),
                        ask.settled_at.unwrap_or(ask.created_at),
                    )
                })
        })
        .collect();
    receipts.sort_by_key(|(_, _, at)| *at);
    let mut receipts = receipts.into_iter().peekable();
    for (turn, steps) in &runs {
        while let Some((ask, title, _)) = receipts.next_if(|(_, _, at)| *at <= turn.created_at) {
            items.push(asks::in_transcript(ask, title, t));
        }
        // Above the turn whose run summarized the messages before it.
        if let Some(divider) = compaction::divider(s, turn, look) {
            items.push(divider);
        }
        // Failed runs of one scheduled job in a row read as one failure.
        match failed.get(turn.id.as_str()) {
            Some(Failed::Hidden) => continue,
            Some(Failed::Latest { attempts, first }) => {
                items.push(scheduled_failure(s, turn, *attempts, *first, look));
                continue;
            }
            None => {}
        }
        let asks: Vec<&SessionAsk> = observation
            .asks
            .iter()
            .filter(|ask| ask.turn_id == turn.id)
            .collect();
        let cards: Vec<&SessionCard> = observation
            .cards
            .iter()
            .filter(|card| card.turn_id == turn.id)
            .collect();
        let streaming = writing
            .is_some_and(|w| w.id == turn.id)
            .then_some(live)
            .flatten();
        items.extend(owner_turn(s, turn, steps, &asks, &cards, now, look));
        if let Some(reply) = reply(s, turn, steps, streaming, observation, now, look) {
            // A reply goes by when it was said, not when the owner asked:
            // one written after an answer belongs below that answer's receipt.
            let said = completed_at(&turn.id, &observation.activity).unwrap_or(turn.created_at);
            while let Some((ask, title, _)) = receipts.next_if(|(_, _, at)| *at <= said) {
                items.push(asks::in_transcript(ask, title, t));
            }
            items.push(reply);
        }
    }
    // What each running turn is doing now, after the messages.
    for (turn, steps) in &runs {
        if is_running(turn) {
            items.push(active_run(s, turn, steps, observation, now, look));
        }
    }
    for (ask, title, _) in receipts {
        items.push(asks::in_transcript(ask, title, t));
    }
    // What the bot's background work waits on the owner for, last.
    if let Some(markers) = background_markers(&observation.background, t) {
        items.push(markers);
    }
    items
}

/// The bot's name, who asks the questions of its own conversation.
fn bot_name(s: &Ui) -> &str {
    s.model
        .selected_bot()
        .map_or("Raphie", |bot| bot.name.as_str())
}

/// What the bot's background work waits on the owner for, marked at the end
/// of its chat: one line for each question or approval. The dock on the
/// composer asks them.
fn background_markers(requests: &[BackgroundRequest], t: &Theme) -> Option<El> {
    let now = format::now_ms();
    let live = |a: &&raphie_core::contracts::SessionApproval| {
        a.status == raphie_core::contracts::ApprovalStatus::Pending && a.expires_at > now
    };
    // Settled questions are receipts, placed where they were settled.
    let waiting = requests.iter().any(|request| {
        request
            .asks
            .iter()
            .any(|ask| ask.status == AskStatus::Pending)
            || request.tool_approvals.iter().any(|a| live(&a))
    });
    if !waiting {
        return None;
    }
    let mut markers = col()
        .key("rd-background")
        .role("region")
        .label("Background work needs you")
        .w_full()
        .gap(2.0);
    for request in requests {
        for ask in request
            .asks
            .iter()
            .filter(|ask| ask.status == AskStatus::Pending)
        {
            markers = markers.child(asks::in_transcript(ask, &request.title, t));
        }
        // Only the live ones, as the dock has them.
        for approval in request.tool_approvals.iter().filter(live) {
            markers = markers.child(asks::marker(
                format!("rd-approval-marker-{}", approval.id),
                format!(
                    "{} needs approval to run {} · {}",
                    request.title,
                    approval.tool,
                    format::clock(approval.created_at)
                ),
                t,
            ));
        }
    }
    Some(markers)
}

/// A turn Raphie is working on now (not one waiting in the queue).
fn is_running(turn: &SessionTurn) -> bool {
    turn.status == TurnStatus::Pending && turn.queue_mode.is_none()
}

/// The owner's side of a turn: the message, then what became of it (queue
/// controls, the tools a finished run used, a stop or failure line).
fn owner_turn(
    s: &Ui,
    turn: &SessionTurn,
    steps: &[ToolStep],
    asks: &[&SessionAsk],
    cards: &[&SessionCard],
    now: i64,
    look: &Look,
) -> Option<El> {
    let t = &look.theme;
    // One file is saved at a time, so the buttons wait while one is.
    let can_save = s.model.saving_attachment.is_none();
    let mut block: Vec<El> = Vec::new();
    let working = turn.status == TurnStatus::Pending;
    // A turn with a reply shows its tool work under the reply, signed by
    // the bot; one without shows it here.
    let in_reply = turn.status == TurnStatus::Done && turn.answer.is_some();
    // A work item's run wasn't written by the owner: only the bot's reply
    // shows, under its provenance tab. One that ended with no reply keeps
    // its tab here, so it still says which work it was.
    let work = turn.work.is_some() || turn.scheduled.is_some();
    let unanswered = work && !working && !in_reply;
    if !work {
        block.push(owner_message(s, turn, can_save, look));
    } else if unanswered && let Some(tab) = work_tab::tab(turn, t) {
        block.push(tab);
    }
    if let Some(mode) = turn.queue_mode {
        block.push(queue_controls(turn, mode, t));
    }
    if !working && !in_reply && !steps.is_empty() {
        let run = Run {
            turn_id: &turn.id,
            steps,
            working: None,
            decide: false,
        };
        block.push(tool_steps(s, &run, now, look));
    }
    if !working
        && !in_reply
        && let Some(notes) = self_updates::notes(s, steps, t)
    {
        block.push(notes);
    }
    if !working {
        for ask in asks {
            block.push(asks::in_transcript(ask, bot_name(s), t));
        }
    }
    // A turn that ended without a reply still shows the cards it made.
    if !working && !in_reply {
        for shown in cards {
            block.push(cards::card(s, shown, now, look));
        }
    }
    if turn.cancelled == Some(true) {
        block.push(
            text("Stopped · message not completed")
                .key(format!("rd-stopped-{}", turn.id))
                .font(font(11.5, 400.0))
                .color(t.faint),
        );
    } else if turn.status == TurnStatus::Error {
        let reason = turn.failure.as_ref().map_or(
            "Check Diagnostics, then send a new message to retry.",
            |failure| failure.message.as_str(),
        );
        block.push(
            col()
                .w_full()
                .gap(6.0)
                .child(signature(s, Some(turn.created_at), None, look))
                .child(error_line(
                    &format!("rd-failed-{}", turn.id),
                    &format!("I couldn’t finish this reply. {reason}"),
                    t,
                ))
                .children(failure_details(s, turn, look)),
        );
    }
    if block.is_empty() {
        return None;
    }
    let block = col().w_full().gap(14.0).children(block);
    // A quote of it, or a job notice, finds it where the reply would be.
    Some(if unanswered {
        block.key(super::quote::message_key(&turn.id, QuoteAuthor::Bot))
    } else {
        block
    })
}

/// The owner's message: a bubble on the right.
fn owner_message(s: &Ui, turn: &SessionTurn, can_save: bool, look: &Look) -> El {
    let t = &look.theme;
    if let Some(handoff) = &turn.handoff {
        return handoffs::turn(s, turn, handoff, look);
    }
    let key = format!("rd-turn-{}", turn.id);
    // A queued message is tinted until Raphie picks it up.
    let queued = turn.queue_mode.is_some();
    let (fill, border) = if queued {
        (t.card.mix(t.accent, 0.16), t.border.mix(t.accent, 0.45))
    } else {
        (t.muted, t.border)
    };
    let mut bubble = col()
        .max_w(560.0)
        // Allowed to be narrower than its widest line, so a small window
        // wraps the text and the file cards instead of cutting them off.
        .shrink()
        .px(14.0)
        .py(9.0)
        .gap(10.0)
        .fill(fill)
        .border(1.0, border)
        // A speech bubble: every corner round but the bottom-right.
        .corners([16.0, 16.0, 4.0, 16.0])
        // The time the message was sent, on hover.
        .help(format::clock(turn.created_at));
    if let Some(quote) = &turn.quote {
        bubble = bubble.child(super::quote::bar(s, quote, look));
    }
    // A message can be files alone.
    if !turn.text.is_empty() {
        bubble = bubble.child(handoffs::message_text(s, &turn.text, look));
    }
    if !turn.attachments.is_empty() {
        let mut files = row()
            .key(format!("rd-files-{}", turn.id))
            .role("list")
            .label("Message attachments")
            .gap(8.0)
            // Each card keeps its own height beside a taller image card.
            .items_start()
            .flex_wrap();
        for file in &turn.attachments {
            let key = format!("rd-file-{}-{}", turn.id, file.id);
            let picture = s
                .model
                .bot_id
                .as_deref()
                .and_then(|bot| Some((bot, s.picture(bot, &file.id)?)));
            files = files.child(file_card(
                t,
                &key,
                file,
                picture,
                &Action::Download,
                can_save,
            ));
        }
        bubble = bubble.child(files);
    }
    let mut line = row()
        .key(key)
        .w_full()
        .justify_end()
        .gap(8.0)
        .center_y()
        .hover_group();
    // Quoting it, beside the bubble while the message is pointed at.
    if !turn.text.trim().is_empty() && !queued {
        line = line.child(super::quote::action(
            format!("rd-quote-owner-{}", turn.id),
            &turn.id,
            QuoteAuthor::Owner,
            &turn.text,
            t,
        ));
    }
    line.child(bubble)
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

/// What the bot answered to `turn`, if there is anything to show yet: the
/// finished reply signed with the bot's name and time, then what it did, or
/// the text written so far.
fn reply(
    s: &Ui,
    turn: &SessionTurn,
    steps: &[ToolStep],
    live: Option<&str>,
    observation: &SessionObservation,
    now: i64,
    look: &Look,
) -> Option<El> {
    let t = &look.theme;
    let activity = &observation.activity;
    let (source, streaming) = match (&turn.answer, live) {
        (Some(answer), _) => (answer.as_str(), false),
        (None, Some(text)) if !text.is_empty() => (text, true),
        _ => return None,
    };
    let done = turn.status == TurnStatus::Done;
    // When a finished reply was said, and what it cost, for its actions row.
    let mut said: Option<(i64, Option<String>)> = None;
    let mut reply = col()
        .key(format!("rd-reply-{}", turn.id))
        .w_full()
        .px(2.0)
        .hover_group();
    if done {
        // Tokens and cost are for the curious, not the conversation.
        let usage = run_usage(&turn.id, activity).map(|usage| {
            let calls = if usage.calls == 1 { "call" } else { "calls" };
            format!(
                "{} tokens across {} model {calls} · {}, provider-reported",
                usage.tokens,
                usage.calls,
                format_cost(usage.cost)
            )
        });
        // A job's post has no model call: it was said when it was posted.
        said = completed_at(&turn.id, activity)
            .or((turn.work.is_some() || turn.scheduled.is_some()).then_some(turn.created_at))
            .map(|at| (at, usage));
        reply = reply.child(signature(s, None, None, look).key(format!("rd-meta-{}", turn.id)));
    }
    if let Some(tab) = work_tab::tab(turn, t) {
        reply = reply.child(tab);
    }
    // The briefs this turn handed off, above what it said about them.
    if let Some(cards) = handoffs::cards(s, &turn.id, look) {
        reply = reply.child(cards.mb(10.0));
    }
    reply = reply.child(if streaming {
        Markdown::new(source)
            .style(t.markdown(&look.kit))
            .streaming(true)
            .selectable(true)
            .build(&look.kit)
    } else {
        handoffs::markdown(s, source, look)
    });
    if done {
        for shown in observation
            .cards
            .iter()
            .filter(|card| card.turn_id == turn.id)
        {
            reply = reply.child(cards::card(s, shown, now, look));
        }
    }
    if done && let Some(sources) = handoffs::sources(turn, look) {
        reply = reply.child(sources);
    }
    if done && !steps.is_empty() {
        let run = Run {
            turn_id: &turn.id,
            steps,
            working: None,
            decide: false,
        };
        reply = reply.child(tool_steps(s, &run, now, look).mt(6.0));
    }
    if done && let Some(notes) = self_updates::notes(s, steps, t) {
        reply = reply.child(notes);
    }
    // Copy and Reply take the whole reply, so they sit under it, with when
    // it was said, while it is pointed at.
    if done {
        reply = reply.child(super::quote::reply_actions(s, &turn.id, source, said, t));
    }
    Some(reply)
}

/// A reply's signature: the bot's face, its name and, when given, the time,
/// with what the reply cost on hover when it is known. A finished reply
/// shows its time under it instead, beside Copy and Reply.
fn signature(s: &Ui, at: Option<i64>, usage: Option<String>, look: &Look) -> El {
    let t = &look.theme;
    let (id, name) = s.model.selected_bot().map_or(("default", "Raphie"), |bot| {
        (bot.id.as_str(), bot.name.as_str())
    });
    let mut header = row()
        .gap(8.0)
        .mb(4.0)
        .center_y()
        .child(bot_avatar(id, look.tones.of(id), 22.0))
        .child(
            text(name.to_owned())
                .font(font(13.5, 600.0))
                .color(t.foreground),
        );
    if let Some(at) = at {
        let mut time = text(format::clock(at))
            .font(font(11.5, 400.0))
            .color(t.faint);
        if let Some(usage) = usage {
            time = time.help(usage);
        }
        header = header.child(time);
    }
    header
}

/// The provider's own words about a failure, folded under "Details".
fn failure_details(s: &Ui, turn: &SessionTurn, look: &Look) -> Option<El> {
    let t = &look.theme;
    let detail = turn.failure.as_ref().and_then(|f| f.detail.clone())?;
    let id = format!("failure:{}", turn.id);
    let open = s.open_steps.contains(&id);
    let toggle_id = id.clone();
    let mut block = col().w_full().gap(6.0).child(
        row()
            .key(format!("rd-failed-more-{}", turn.id))
            .role("button")
            .label("Details")
            .gap(4.0)
            .center_y()
            .child(
                icon(
                    if open {
                        &icons::CHEVRON_DOWN
                    } else {
                        &icons::CHEVRON_RIGHT
                    },
                    12.0,
                )
                .color(t.faint)
                .a11y_hidden(),
            )
            .child(text("Details").font(font(12.0, 400.0)).color(t.faint))
            .on_press(move |s: &mut Ui| Ui::toggle(&mut s.open_steps, &toggle_id)),
    );
    if open {
        block = block.child(code_box(
            &format!("rd-failed-detail-{}", turn.id),
            detail,
            t,
        ));
    }
    Some(block)
}

/// How a run of a scheduled job that failed is shown.
enum Failed {
    /// An earlier failure of a run of failures: said by the latest.
    Hidden,
    /// The latest failure, and how many tries the run had since `first`.
    Latest { attempts: usize, first: i64 },
}

/// Consecutive failed runs of one scheduled job read as one failure.
fn failed_runs<'a>(
    turns: impl Iterator<Item = &'a SessionTurn>,
) -> std::collections::HashMap<&'a str, Failed> {
    let mut out = std::collections::HashMap::new();
    let mut group: Vec<&SessionTurn> = Vec::new();
    let mut close = |group: &mut Vec<&'a SessionTurn>| {
        if let (Some(first), Some(latest)) = (group.first(), group.last()) {
            let first = first.created_at;
            let attempts = group.len();
            for turn in &group[..group.len() - 1] {
                out.insert(turn.id.as_str(), Failed::Hidden);
            }
            out.insert(latest.id.as_str(), Failed::Latest { attempts, first });
        }
        group.clear();
    };
    for turn in turns {
        let failed = turn.scheduled.is_some()
            && turn.status == TurnStatus::Error
            && turn.cancelled != Some(true);
        let same = group
            .first()
            .and_then(|g| g.scheduled.as_ref())
            .map(|j| &j.name)
            == turn.scheduled.as_ref().map(|j| &j.name);
        if !failed || !same {
            close(&mut group);
        }
        if failed {
            group.push(turn);
        }
    }
    close(&mut group);
    out
}

/// A scheduled job that failed, once or several times in a row, said once.
fn scheduled_failure(s: &Ui, turn: &SessionTurn, attempts: usize, first: i64, look: &Look) -> El {
    let t = &look.theme;
    let name = turn
        .scheduled
        .as_ref()
        .map_or("A scheduled job", |job| job.name.as_str());
    let tries = if attempts > 1 {
        format!(", after {attempts} tries.")
    } else {
        ".".to_owned()
    };
    let when = if attempts > 1 {
        if format::clock(first) == format::clock(turn.created_at) {
            format!("{attempts} attempts at {}", format::clock(first))
        } else {
            format!(
                "{attempts} attempts, {} to {}",
                format::clock(first),
                format::clock(turn.created_at)
            )
        }
    } else {
        format!("Due {}", format::clock(turn.created_at))
    };
    let why = turn
        .failure
        .as_ref()
        .map(|failure| format!(" · {}", failure.message))
        .unwrap_or_default();
    col()
        .key(format!("rd-scheduled-failure-{}", turn.id))
        .w_full()
        .gap(6.0)
        .live_region(LiveRegion::Polite)
        .child(signature(s, Some(turn.created_at), None, look))
        .child(
            text(format!("I couldn’t run {name}{tries}"))
                .font(font(14.0, 400.0))
                .color(t.foreground)
                .wrap(),
        )
        .child(
            row()
                .w_full()
                .px(12.0)
                .py(10.0)
                .gap(10.0)
                .items_start()
                .radius(10.0)
                .fill(t.attention_soft.mix(t.card, 0.55))
                .border(1.0, t.attention.mix(t.border, 0.65))
                .child(
                    icon(&icons::CALENDAR_CLOCK, 14.0)
                        .color(t.attention)
                        .mt(2.0)
                        .a11y_hidden(),
                )
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
                        .gap(2.0)
                        .child(
                            text(format!("{name} didn’t run"))
                                .font(font(13.0, 600.0))
                                .color(t.foreground),
                        )
                        .child(
                            text(format!("{when}{why}"))
                                .font(font(12.0, 400.0))
                                .color(t.muted_foreground)
                                .wrap(),
                        ),
                ),
        )
        .children(failure_details(s, turn, look))
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
    let asks: Vec<&SessionAsk> = observation
        .asks
        .iter()
        .filter(|ask| ask.turn_id == turn.id)
        .collect();
    // While it waits on a question the dock asks it: no spinner here, only
    // the steps it settled.
    let asking = asks.iter().any(|ask| ask.status == AskStatus::Pending);
    let run = Run {
        turn_id: &turn.id,
        steps,
        working: (!asking).then(|| Working {
            label: active_run_label(observation.live.as_ref(), steps, &own),
            elapsed: format_duration(now - turn.created_at),
        }),
        decide: false,
    };
    let mut block = col().key("rd-working").w_full();
    if !asking || !steps.is_empty() {
        block = block.child(tool_steps(s, &run, now, look));
    }
    // Cards the turn has shown so far, then what it is waiting to hear.
    for shown in observation
        .cards
        .iter()
        .filter(|card| card.turn_id == turn.id)
    {
        block = block.child(cards::card(s, shown, now, look));
    }
    for ask in asks {
        block = block.child(asks::in_transcript(ask, bot_name(s), &look.theme));
    }
    block
}

fn error_line(key: &str, message: &str, t: &Theme) -> El {
    row()
        .key(key)
        .w_full()
        .gap(6.0)
        .live_region(LiveRegion::Polite)
        .child(
            icon(&icons::CIRCLE_ALERT, 14.0)
                .color(t.error)
                .mt(2.0)
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
