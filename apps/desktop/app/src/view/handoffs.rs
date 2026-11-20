//! Tasks bots hand each other: the card under the reply that sent a brief,
//! the brief and the result in place of an owner message, the bots at work
//! in the composer, the note in place of the composer in a handed-off
//! session, the "@" menu, and "@Name" shown as the bot it names.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/handoffs/`
//! (`handoff-cards.tsx`, `handoff-delegates.tsx`, `mention-menu.tsx`,
//! `mention-markdown.tsx`) and `apps/web/src/shared/styles/handoffs.css`.

use raphie_core::contracts::{
    BotRef, HandedOffBy, Handoff, HandoffOutcome, SessionTurn, TurnHandoff,
};
use raphie_core::handoffs::{
    DelegateGroup, RequestStatus, SentRequest, delegate_groups, delegate_label, duration,
    open_handoffs, request_status, requests_from_turn,
};
use raphie_core::mentions::{MentionPart, split_mentions};
use rune::{
    Color, El, Link, LinkPaint, LoopSpec, Path, PillStyle, Shape, Span, Tx, canvas, col, el, icon,
    row, text,
};
use rune_kit::{Markdown, MarkdownStyle, Placement, popover, scrim};

use super::Look;
use crate::avatar::{bot_avatar, bot_icon};
use crate::format;
use crate::icons;
use crate::state::{MENTION_SCHEME, Ui};
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, button, one_line, pressable};

/// A brief's or a result's status, in its colours (the web's
/// `.handoff-status[data-status]`).
fn status_pill(status: RequestStatus, t: &Theme) -> El {
    let (ink, fill) = match status {
        RequestStatus::Working => (t.accent, t.accent_soft),
        RequestStatus::Waiting => (t.attention, t.attention_soft),
        RequestStatus::Failed => (t.error, t.muted),
        RequestStatus::Completed | RequestStatus::Cancelled => (t.muted_foreground, t.muted),
    };
    let mut pill = row()
        .px(6.0)
        .py(2.0)
        .gap(4.0)
        .center_y()
        .radius(6.0)
        .fill(fill);
    if status.open() {
        pill = pill.child(el().size(6.0, 6.0).radius(3.0).fill(ink).a11y_hidden());
    }
    pill.child(
        text(status.label())
            .font(font(11.0, 400.0).lh(16.0))
            .color(ink),
    )
}

/// A bot's face at `size` points.
fn face(bot_id: &str, size: f32, look: &Look) -> El {
    bot_avatar(bot_id, look.tones.of(bot_id), size)
}

/// The card's frame: bordered, rounded, on the card colour.
fn card(key: String, label: String, t: &Theme) -> El {
    col()
        .key(key)
        .role("group")
        .label(label)
        .w_full()
        .radius(12.0)
        .fill(t.card)
        .border(1.0, t.border)
        .border_layout()
}

/// The card's first row: who, what, and its status at the right.
fn card_head(bot_id: Option<&str>, label: String, title: &str, look: &Look) -> El {
    let t = &look.theme;
    let mut head = row().w_full().px(14.0).py(10.0).gap(8.0).center_y();
    if let Some(bot_id) = bot_id {
        head = head.child(face(bot_id, 20.0, look));
    }
    head.child(text(label).font(font(13.0, 600.0)).color(t.foreground))
        .child(
            one_line(title.to_owned(), font(12.0, 400.0), t.muted_foreground)
                .min_w(0.0)
                .shrink(),
        )
}

/// The key of a brief's card, so the composer's list can scroll to it.
pub fn card_key(handoff_id: &str, index: usize) -> String {
    format!("rd-handoff-{handoff_id}-{index}")
}

/// The briefs this turn sent, under its reply. One card per brief; several
/// handed off at once share a card, so a busy turn stays one block.
pub fn cards(s: &Ui, turn_id: &str, look: &Look) -> Option<El> {
    let sent = requests_from_turn(s.handoffs(), turn_id);
    match sent.len() {
        0 => None,
        1 => Some(request_card(s, &sent[0], look)),
        _ => Some(shared_card(&sent, look)),
    }
}

fn request_card(s: &Ui, sent: &SentRequest<'_>, look: &Look) -> El {
    let t = &look.theme;
    let handoff = sent.handoff;
    let status = request_status(sent);
    let verb = if sent.index == 0 {
        "Asked"
    } else {
        "Follow-up to"
    };
    let mut card = card(
        card_key(&handoff.id, sent.index),
        format!("Handoff to {}", handoff.to.name),
        t,
    )
    .child(
        card_head(
            Some(&handoff.to.id),
            format!("{verb} {}", handoff.to.name),
            &handoff.title,
            look,
        )
        .child(row().grow(1.0))
        .child(status_pill(status, t)),
    )
    // The brief, quoted (the web's `.handoff-brief`, four lines at most).
    .child(
        row().w_full().px(14.0).child(
            text(sent.request.brief.clone())
                .font(font(13.0, 400.0).lh(20.0))
                .color(t.muted_foreground)
                .wrap()
                .max_lines(4)
                .w_full()
                .pl(12.0)
                .py(6.0)
                .border_sides([0.0, 0.0, 0.0, 2.0], t.border)
                .border_layout(),
        ),
    );
    if status == RequestStatus::Waiting {
        card = card.child(waiting_row(handoff, t));
    }
    let mut foot = row()
        .w_full()
        .px(14.0)
        .py(10.0)
        .gap(6.0)
        .center_y()
        .flex_wrap()
        .child(
            text(match sent.request.finished_at {
                Some(at) => format!(
                    "Sent {} · took {}",
                    format::clock(sent.request.sent_at),
                    duration(at - sent.request.sent_at)
                ),
                None => format!("Sent {}", format::clock(sent.request.sent_at)),
            })
            .font(font(12.0, 400.0))
            .color(t.faint),
        );
    if let Some((id, why)) = &s.model.handoff_error
        && *id == handoff.id
    {
        foot = foot.child(text(why.clone()).font(font(12.0, 400.0)).color(t.error));
    }
    foot = foot.child(row().grow(1.0));
    if status.open() && handoff.to_session_id.is_some() {
        let cancelling = s.model.cancelling_handoff.as_deref() == Some(handoff.id.as_str());
        let id = handoff.id.clone();
        foot = foot.child(pressable(
            button(t, Kind::Ghost, Size::Small, None, "Cancel")
                .key(format!("rd-handoff-cancel-{}", handoff.id)),
            !cancelling,
            move |s: &mut Ui| s.cancel_handoff(&id),
        ));
    }
    card.child(foot.child(view_in(&handoff.to, handoff.to_session_id.as_deref(), t)))
}

/// "Research is waiting for your approval." with a way to it.
fn waiting_row(handoff: &Handoff, t: &Theme) -> El {
    let bot = handoff.to.id.clone();
    let session = handoff.to_session_id.clone();
    row().w_full().px(14.0).pt(10.0).child(
        row()
            .key(format!("rd-handoff-waiting-{}", handoff.id))
            .w_full()
            .px(10.0)
            .py(6.0)
            .gap(8.0)
            .center_y()
            .radius(8.0)
            .fill(t.attention_soft)
            .child(
                icon(&icons::SHIELD_ALERT, 14.0)
                    .color(t.attention)
                    .a11y_hidden(),
            )
            .child(
                text(format!("{} is waiting for your approval.", handoff.to.name))
                    .font(font(12.5, 400.0))
                    .color(t.attention)
                    .wrap()
                    .shrink(),
            )
            .child(row().grow(1.0))
            .child(
                button(t, Kind::Outline, Size::Small, None, "Review")
                    .key(format!("rd-handoff-review-{}", handoff.id))
                    .on_press(move |s: &mut Ui| s.open_bot(&bot, session.as_deref())),
            ),
    )
}

/// Under a reply that read another bot's session for a task (the web's
/// `HandoffSources`): "Read from Research · task  [View in Research ›]",
/// one pill per session, each opening it.
pub fn sources(turn: &SessionTurn, look: &Look) -> Option<El> {
    if turn.read_sessions.is_empty() {
        return None;
    }
    let t = &look.theme;
    let mut list = row()
        .key(format!("rd-read-{}", turn.id))
        .role("list")
        .label("Sessions this reply read")
        .mt(10.0)
        .gap(6.0)
        .flex_wrap();
    for read in &turn.read_sessions {
        let tone = look.tones.of(&read.bot.id).body;
        let id = read.bot.id.clone();
        let session = read.session_id.clone();
        let words = format!("Read from {}", read.bot.name);
        let from = words.len() - read.bot.name.len();
        let action = row()
            .gap(2.0)
            .center_y()
            .pl(10.0)
            .pr(6.0)
            .py(2.0)
            .radius(999.0)
            .fill(tone.alpha(0.22))
            .child(
                text(format!("View in {}", read.bot.name))
                    .font(font(12.0, 500.0).lh(18.0))
                    .color(t.foreground),
            )
            .child(
                icon(&icons::CHEVRON_RIGHT, 14.0)
                    .color(t.foreground)
                    .a11y_hidden(),
            );
        let pill = row()
            .key(format!("rd-read-{}", read.handoff_id))
            .role("button")
            .label(format!("View in {}: {}", read.bot.name, read.title))
            .gap(8.0)
            .center_y()
            .pl(6.0)
            .pr(4.0)
            .py(4.0)
            .radius(999.0)
            .fill(t.card)
            .border(1.0, t.border)
            .hover(t.hover)
            .press(t.hover)
            .focus_ring(1.0, 2.0, t.accent)
            .child(face(&read.bot.id, 20.0, look))
            .child(
                rune::rich(
                    words.clone(),
                    vec![
                        Span::new(from, words.len())
                            .weight(600.0)
                            .color(t.foreground),
                    ],
                )
                .font(font(12.0, 400.0).lh(18.0))
                .color(t.muted_foreground)
                .single_line(),
            )
            .child(
                text(format!("· {}", read.title))
                    .font(font(12.0, 400.0).lh(18.0))
                    .color(t.muted_foreground)
                    .truncate()
                    .shrink(),
            )
            .child(action)
            .on_press(move |s: &mut Ui| s.open_bot(&id, Some(&session)));
        list = list.child(pill);
    }
    Some(list)
}

/// "View in Research ›": the other bot's session, once it has one.
fn view_in(bot: &BotRef, session: Option<&str>, t: &Theme) -> El {
    let label = format!("View in {}", bot.name);
    let id = bot.id.clone();
    let session = session.map(str::to_owned);
    pressable(
        button(t, Kind::Outline, Size::Small, None, &label)
            .key(format!("rd-handoff-view-{}", bot.id))
            .child(
                icon(&icons::CHEVRON_RIGHT, 14.0)
                    .color(t.foreground)
                    .a11y_hidden(),
            ),
        session.is_some(),
        move |s: &mut Ui| s.open_bot(&id, session.as_deref()),
    )
}

fn shared_card(sent: &[SentRequest<'_>], look: &Look) -> El {
    let t = &look.theme;
    let mut names: Vec<&str> = Vec::new();
    for item in sent {
        if !names.contains(&item.handoff.to.name.as_str()) {
            names.push(&item.handoff.to.name);
        }
    }
    let mut list = col()
        .key(format!("rd-handoff-list-{}", sent[0].handoff.id))
        .role("list")
        .w_full()
        .radius(10.0)
        .border(1.0, t.border)
        .border_layout();
    for (i, item) in sent.iter().enumerate() {
        let bot = item.handoff.to.id.clone();
        let session = item.handoff.to_session_id.clone();
        let mut line = row()
            .key(card_key(&item.handoff.id, item.index))
            .role("listitem")
            .w_full()
            .pl(10.0)
            .pr(6.0)
            .py(6.0)
            .gap(10.0)
            .center_y()
            .child(face(&item.handoff.to.id, 20.0, look))
            .child(
                col()
                    .grow(1.0)
                    .min_w(0.0)
                    .child(
                        text(item.handoff.to.name.clone())
                            .font(font(13.0, 600.0))
                            .color(t.foreground),
                    )
                    .child(
                        one_line(
                            item.handoff.title.clone(),
                            font(12.0, 400.0),
                            t.muted_foreground,
                        )
                        .help(item.request.brief.clone()),
                    ),
            )
            .child(status_pill(request_status(item), t))
            .child(pressable(
                button(t, Kind::Ghost, Size::Small, None, "Open").child(
                    icon(&icons::CHEVRON_RIGHT, 14.0)
                        .color(t.foreground)
                        .a11y_hidden(),
                ),
                session.is_some(),
                move |s: &mut Ui| s.open_bot(&bot, session.as_deref()),
            ));
        if i > 0 {
            line = line.border_sides([1.0, 0.0, 0.0, 0.0], t.border);
        }
        list = list.child(line);
    }
    card(
        format!("rd-handoffs-{}", sent[0].handoff.id),
        format!("Handoffs to {}", names.join(", ")),
        t,
    )
    .child(card_head(
        None,
        format!("Handed off {} tasks", sent.len()),
        &names.join(", "),
        look,
    ))
    .child(row().w_full().px(14.0).pb(12.0).child(list))
}

/// In place of an owner message: the brief another bot handed off, or the
/// result of a task this bot handed off.
pub fn turn(s: &Ui, turn: &SessionTurn, handoff: &TurnHandoff, look: &Look) -> El {
    match handoff.kind {
        raphie_core::contracts::HandoffKind::Result => result(s, turn, handoff, look),
        _ => brief(s, turn, handoff, look),
    }
}

fn brief(s: &Ui, turn: &SessionTurn, handoff: &TurnHandoff, look: &Look) -> El {
    let t = &look.theme;
    // A later brief from the same bot is its follow-up.
    let follow_up = s.model.conversation.as_ref().is_some_and(|c| {
        c.turns().iter().any(|other| {
            other.created_at < turn.created_at
                && other
                    .handoff
                    .as_ref()
                    .is_some_and(|h| h.kind == raphie_core::contracts::HandoffKind::Task)
        })
    });
    let marker = row()
        .px(12.0)
        .py(4.0)
        .gap(7.0)
        .center_y()
        .radius(13.0)
        .fill(t.muted)
        .child(
            icon(&icons::CORNER_UP_RIGHT, 13.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(
            text(if follow_up {
                "Follow-up from"
            } else {
                "Handed off by"
            })
            .font(font(12.0, 400.0))
            .color(t.muted_foreground),
        )
        .child(
            text(handoff.bot.name.clone())
                .font(font(12.0, 600.0))
                .color(t.foreground),
        )
        .child(
            text(format::clock(turn.created_at))
                .font(font(12.0, 400.0))
                .color(t.faint),
        );
    col()
        .key(format!("rd-turn-{}", turn.id))
        .w_full()
        .gap(10.0)
        .child(row().w_full().justify_center().child(marker))
        .child(
            col()
                .key(format!("rd-brief-{}", turn.id))
                .role("group")
                .label(format!("Brief from {}", handoff.bot.name))
                .w_full()
                .px(14.0)
                .py(10.0)
                .gap(6.0)
                .radius(12.0)
                .fill(t.card)
                .border(1.0, t.border)
                .border_layout()
                .child(
                    row()
                        .gap(7.0)
                        .center_y()
                        .child(face(&handoff.bot.id, 18.0, look))
                        .child(
                            text(handoff.bot.name.clone())
                                .font(font(12.0, 600.0))
                                .color(t.foreground),
                        )
                        .child(
                            text("asked")
                                .font(font(12.0, 400.0))
                                .color(t.muted_foreground),
                        ),
                )
                .child(markdown(s, &turn.text, look)),
        )
}

fn result(s: &Ui, turn: &SessionTurn, handoff: &TurnHandoff, look: &Look) -> El {
    let t = &look.theme;
    let outcome = handoff.outcome.unwrap_or(HandoffOutcome::Completed);
    let verb = match outcome {
        HandoffOutcome::Completed => "finished",
        HandoffOutcome::Cancelled => "stopped",
        HandoffOutcome::Failed | HandoffOutcome::Unknown => "could not finish",
    };
    let open = s.open_reports.contains(&turn.id);
    // The sending bot's record names the other bot's session.
    let session = s
        .handoffs()
        .iter()
        .find(|item| item.id == handoff.id)
        .and_then(|item| item.to_session_id.clone());
    let mut card = card(
        format!("rd-turn-{}", turn.id),
        format!("Result from {}", handoff.bot.name),
        t,
    )
    .child(
        card_head(
            Some(&handoff.bot.id),
            format!("{} {verb}", handoff.bot.name),
            &handoff.title,
            look,
        )
        .child(row().grow(1.0))
        .child(status_pill(RequestStatus::of_outcome(outcome), t)),
    );
    if open {
        card = card.child(
            col()
                .key(format!("rd-report-{}", turn.id))
                .w_full()
                .px(16.0)
                .py(14.0)
                .fill(t.background)
                .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
                .border_layout()
                .child(markdown(s, &turn.text, look)),
        );
    }
    let turn_id = turn.id.clone();
    let mut foot = row()
        .w_full()
        .px(14.0)
        .py(10.0)
        .gap(6.0)
        .center_y()
        .child(
            text(format::clock(turn.created_at))
                .font(font(12.0, 400.0))
                .color(t.faint),
        )
        .child(row().grow(1.0))
        .child(
            button(
                t,
                Kind::Ghost,
                Size::Small,
                None,
                if open { "Hide report" } else { "Show report" },
            )
            .key(format!("rd-report-toggle-{}", turn.id))
            .expanded(open)
            .child(
                icon(
                    if open {
                        &icons::CHEVRON_UP
                    } else {
                        &icons::CHEVRON_DOWN
                    },
                    14.0,
                )
                .color(t.foreground)
                .a11y_hidden(),
            )
            .on_press(move |s: &mut Ui| Ui::toggle(&mut s.open_reports, &turn_id)),
        );
    if session.is_some() {
        foot = foot.child(view_in(&handoff.bot, session.as_deref(), t));
    }
    card.child(foot)
}

/// Markdown with "@Name" for known bots linked, so they show as the bot.
pub fn markdown(s: &Ui, source: &str, look: &Look) -> El {
    styled_markdown(s, source, look.theme.markdown(&look.kit), look)
}

/// [`markdown`] in `style`.
pub fn styled_markdown(s: &Ui, source: &str, style: MarkdownStyle, look: &Look) -> El {
    let bots = s.bot_refs();
    let tones: Vec<(String, Color)> = bots
        .iter()
        .map(|bot| (bot.id.clone(), look.tones.of(&bot.id).body))
        .collect();
    let ink = look.theme.foreground;
    Markdown::new(linked_mentions(source, &bots))
        .style(style)
        .selectable(true)
        .link_style(move |url| {
            let id = url.strip_prefix(MENTION_SCHEME)?;
            let tone = tones.iter().find(|(seen, _)| seen == id)?.1;
            Some((
                Span::new(0, 0)
                    .weight(500.0)
                    .color(ink)
                    .bg(tone.alpha(0.26), 3.0),
                LinkPaint::new().bg(tone.alpha(0.4)),
            ))
        })
        .on_link_tx(|s: &mut Ui, url: &str, tx: &mut Tx| s.press_link(url, tx))
        .build(&look.kit)
}

/// `source` with each "@Name" for a known bot written as a link to it,
/// outside code blocks.
pub fn linked_mentions(source: &str, bots: &[BotRef]) -> String {
    let mut out = String::with_capacity(source.len());
    let mut in_code = false;
    for line in source.split_inclusive('\n') {
        if line.trim_start().starts_with("```") {
            in_code = !in_code;
        }
        if in_code || !line.contains('@') {
            out.push_str(line);
            continue;
        }
        for part in split_mentions(line, bots) {
            match part {
                MentionPart::Text(text) => out.push_str(text),
                MentionPart::Mention(bot, _) => {
                    out.push_str(&format!("[{}]({MENTION_SCHEME}{})", bot.name, bot.id));
                }
            }
        }
    }
    out
}

/// An owner message with each "@Name" for a known bot drawn as that bot's
/// chip, which opens the bot.
pub fn message_text(s: &Ui, content: &str, look: &Look) -> El {
    let t = &look.theme;
    let bots = s.bot_refs();
    // A named bot shows as its face and name, without the "@", as on the web.
    let mut shown = String::with_capacity(content.len());
    let mut chips = Vec::new();
    for part in split_mentions(content, &bots) {
        match part {
            MentionPart::Text(text) => shown.push_str(text),
            MentionPart::Mention(bot, written) => {
                let start = shown.len();
                shown.push_str(&written[1..]);
                chips.push((start..shown.len(), bot.clone()));
            }
        }
    }
    let mut message = text(shown)
        .font(font(14.0, 400.0).lh(23.0))
        .color(t.foreground)
        .wrap()
        .selectable(true)
        .selection_color(t.selection());
    if chips.is_empty() {
        return message;
    }
    let names: Vec<Span> = chips
        .iter()
        .map(|(range, _)| Span::new(range.start, range.end).weight(500.0))
        .collect();
    message = message.spans(names);
    for (range, bot) in chips {
        let tone = look.tones.of(&bot.id);
        message = message
            .pill(
                range.clone(),
                PillStyle::new()
                    .bg(tone.body.alpha(0.26))
                    // A pill paints its face and its name in one colour:
                    // the bot's, taken most of the way to the text's so the
                    // name stays as readable as the sentence around it.
                    .fg(tone.body.mix(t.foreground, 0.7))
                    .icon(bot_icon(&bot.id)),
            )
            .link(
                Link::new(range, format!("{MENTION_SCHEME}{}", bot.id))
                    .label(format!("Open {}", bot.name))
                    .hover(LinkPaint::new().bg(tone.body.alpha(0.4))),
            );
    }
    message.on_link(|s: &mut Ui, url: &str, tx: &mut Tx| s.press_link(url, tx))
}

/// The size of a bot's orbit in the composer, and its face inside it.
const ORBIT: f32 = 26.0;
const ORBIT_FACE: f32 = 18.0;

/// A ring around a bot's face: a faint track with an arc of the bot's
/// colour that turns while it works, or a whole amber ring while it waits.
fn orbit(group: &DelegateGroup<'_>, index: usize, look: &Look) -> El {
    let t = &look.theme;
    let tone = look.tones.of(&group.bot.id).body;
    let centre = ORBIT / 2.0;
    let radius = centre - 2.0;
    let circle = |from: f32, to: f32| {
        let steps = ((to - from) * 120.0).ceil().max(2.0) as usize;
        let at = |turn: f32| {
            let angle = turn * std::f32::consts::TAU;
            [centre + radius * angle.sin(), centre - radius * angle.cos()]
        };
        let mut path = Path::new().move_to(at(from));
        for step in 1..=steps {
            path = path.line_to(at(from + (to - from) * step as f32 / steps as f32));
        }
        path
    };
    let ring = if group.waiting {
        canvas(Shape::new().stroke_path(
            &circle(0.0, 1.0).close(),
            2.0,
            rune::LineCap::Round,
            t.attention,
        ))
        .size(ORBIT, ORBIT)
    } else {
        // The web's arc is a quarter of the ring, on a track at 30%.
        let track = canvas(Shape::new().stroke_path(
            &circle(0.0, 1.0).close(),
            2.0,
            rune::LineCap::Round,
            tone.alpha(0.3),
        ))
        .size(ORBIT, ORBIT);
        let arc = canvas(Shape::new().stroke_path(
            &circle(0.0, 0.24),
            2.0,
            rune::LineCap::Round,
            tone.mix(t.foreground, 0.25),
        ))
        .size(ORBIT, ORBIT)
        .absolute(0.0, 0.0)
        .looping(LoopSpec {
            delay: index as f64 * 0.8,
            ..LoopSpec::rotation(2.4)
        });
        el().size(ORBIT, ORBIT).child(track).child(arc)
    };
    let ground = if group.waiting {
        t.attention_soft
    } else {
        t.card
    };
    let mut orbit = el()
        .size(ORBIT, ORBIT)
        .radius(ORBIT / 2.0)
        .fill(ground)
        .child(ring.absolute(0.0, 0.0).a11y_hidden())
        .child(
            face(&group.bot.id, ORBIT_FACE, look)
                .absolute((ORBIT - ORBIT_FACE) / 2.0, (ORBIT - ORBIT_FACE) / 2.0),
        );
    if index > 0 {
        orbit = orbit.ml(-9.0);
    }
    orbit
}

/// The element the list of bots at work hangs from.
const DELEGATES: &str = "rd-delegates";

/// Bots working for this conversation, in the composer's toolbar. Stays in
/// view after the handoff's card has scrolled away. When open, its list is
/// added to `overlays`.
pub fn delegates(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> Option<El> {
    let t = &look.theme;
    let session = s.model.conversation.as_ref().map(|c| c.session_id.as_str());
    let open = open_handoffs(s.handoffs(), session);
    let groups = delegate_groups(&open);
    if groups.is_empty() {
        return None;
    }
    let waiting = groups.iter().any(|group| group.waiting);
    let label = delegate_label(&groups);
    let mut orbits = row().center_y();
    for (index, group) in groups.iter().take(3).enumerate() {
        orbits = orbits.child(orbit(group, index, look));
    }
    if groups.len() > 3 {
        orbits = orbits.child(
            row()
                .size(22.0, 22.0)
                .ml(-6.0)
                .center()
                .radius(11.0)
                .fill(t.muted)
                .border(1.0, t.border)
                .child(
                    text(format!("+{}", groups.len() - 3))
                        .font(font(10.0, 600.0))
                        .color(t.muted_foreground),
                ),
        );
    }
    let ink = if waiting {
        t.attention
    } else {
        t.muted_foreground
    };
    let mut trigger = row()
        .key(DELEGATES)
        .role("button")
        .label(format!("Handed-off tasks: {label}"))
        .expanded(s.delegates_open)
        .min_w(0.0)
        .shrink()
        .h(30.0)
        .pl(3.0)
        .pr(10.0)
        .gap(7.0)
        .center_y()
        .radius(15.0)
        .focus_ring(1.0, 1.0, t.accent)
        .child(orbits)
        .child(one_line(label, font(12.0, 400.0), ink).min_w(0.0).shrink())
        .on_press(|s: &mut Ui| s.delegates_open = !s.delegates_open);
    trigger = if waiting {
        trigger.fill(t.attention_soft)
    } else if s.delegates_open {
        trigger.fill(t.hover)
    } else {
        trigger.hover(t.hover)
    };
    if s.delegates_open {
        overlays.push(scrim("rd-delegates-scrim", |s: &mut Ui| {
            s.delegates_open = false;
        }));
        let surface = popover::raised(&look.kit, delegate_list(&groups, look), 10.0)
            .fill(t.card)
            .border(1.0, t.border);
        overlays.push(popover::anchored(
            &look.kit,
            surface,
            DELEGATES,
            Placement::TopStart,
            10.0,
        ));
    }
    Some(trigger)
}

fn delegate_list(groups: &[DelegateGroup<'_>], look: &Look) -> El {
    let t = &look.theme;
    let mut list = col()
        .key("rd-delegates-list")
        .role("dialog")
        .label("Handed-off tasks")
        .w(380.0)
        .padding(6.0)
        .child(
            text("Handed off from this conversation")
                .font(font(11.0, 600.0))
                .color(t.muted_foreground)
                .mx(8.0)
                .mt(4.0)
                .mb(6.0),
        );
    for group in groups {
        let count = group.handoffs.len();
        list = list.child(
            row()
                .px(8.0)
                .pt(8.0)
                .pb(2.0)
                .gap(8.0)
                .center_y()
                .child(face(&group.bot.id, 18.0, look))
                .child(
                    text(group.bot.name.clone())
                        .font(font(12.5, 600.0))
                        .color(t.foreground),
                )
                .child(
                    text(format!(
                        "{count} {}",
                        if count == 1 { "task" } else { "tasks" }
                    ))
                    .font(font(12.0, 400.0))
                    .color(t.faint),
                ),
        );
        for handoff in &group.handoffs {
            let card = card_key(&handoff.id, handoff.requests.len().saturating_sub(1));
            let status = if handoff.waiting {
                RequestStatus::Waiting
            } else {
                RequestStatus::Working
            };
            let mut line = row()
                .w_full()
                .pl(34.0)
                .pr(8.0)
                .py(4.0)
                .gap(8.0)
                .center_y()
                .child(
                    row()
                        .key(format!("rd-delegate-{}", handoff.id))
                        .role("button")
                        .label(handoff.title.clone())
                        .help("Show the handoff in this conversation")
                        .grow(1.0)
                        .min_w(0.0)
                        .padding(4.0)
                        .radius(6.0)
                        .hover(t.hover)
                        .child(one_line(
                            handoff.title.clone(),
                            font(13.0, 400.0),
                            t.foreground,
                        ))
                        .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
                            s.delegates_open = false;
                            tx.scroll_into_view(card.clone());
                        }),
                )
                .child(status_pill(status, t));
            if handoff.waiting {
                let bot = handoff.to.id.clone();
                let session = handoff.to_session_id.clone();
                line = line.child(
                    button(t, Kind::Outline, Size::Small, None, "Review")
                        .key(format!("rd-delegate-review-{}", handoff.id))
                        .on_press(move |s: &mut Ui| s.open_bot(&bot, session.as_deref())),
                );
            }
            list = list.child(line);
        }
    }
    list
}

/// Above the composer in a task another bot handed off (the web's
/// `.handoff-note`): the owner continues it here, while that bot's own
/// requests still report back to it.
pub fn note(_s: &Ui, from: &HandedOffBy, look: &Look) -> El {
    let t = &look.theme;
    let id = from.id.clone();
    // Back to the conversation that handed the task off. Sessions from
    // before it was recorded open the bot's last conversation.
    let session = from.session_id.clone();
    let words = format!(
        "{} handed off this task and gets the results of its requests. What you write here stays here.",
        from.name
    );
    row()
        .key("rd-handoff-note")
        .role("note")
        .w_full()
        .px(4.0)
        .mb(8.0)
        .gap(8.0)
        .center_y()
        .child(face(&from.id, 18.0, look))
        .child(
            rune::rich(
                words,
                vec![
                    Span::new(0, from.name.len())
                        .weight(600.0)
                        .color(t.foreground),
                ],
            )
            .font(font(12.0, 400.0).lh(17.5))
            .color(t.muted_foreground)
            .grow(1.0)
            .min_w(0.0)
            .shrink(),
        )
        .child(
            button(
                t,
                Kind::Ghost,
                Size::Tiny,
                None,
                &format!("Open {}", from.name),
            )
            .key("rd-handoff-note-open")
            .on_press(move |s: &mut Ui| s.open_bot(&id, session.as_deref())),
        )
}

/// The composer's "@" menu: the other bots matching what was typed, above
/// the text, while an "@" is being typed.
pub fn mention_menu(s: &Ui, look: &Look, overlays: &mut Vec<El>) {
    let t = &look.theme;
    let options = s.mention_options();
    if options.is_empty() {
        return;
    }
    let active = s.mention_highlight(options.len());
    let mut list = col()
        .key("rd-mentions")
        .role("listbox")
        .label("Hand this to another bot")
        .min_w(220.0)
        .padding(4.0);
    for (i, bot) in options.iter().enumerate() {
        let chosen = bot.clone();
        let mut option = row()
            .key(format!("rd-mention-{}", bot.id))
            .role("option")
            .label(bot.name.clone())
            .checked(i == active)
            .w_full()
            .px(8.0)
            .py(6.0)
            .gap(8.0)
            .center_y()
            .radius(8.0)
            .hover(t.hover)
            .child(face(&bot.id, 20.0, look))
            .child(
                text(bot.name.clone())
                    .font(font(13.0, 400.0))
                    .color(t.foreground),
            )
            .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
                s.choose_mention(&chosen);
                tx.focus("rd-composer", false);
            });
        if i == active {
            option = option.fill(t.hover);
        }
        list = list.child(option);
    }
    list = list.child(
        text("Hands the task to this bot")
            .font(font(11.0, 400.0))
            .color(t.faint)
            .mx(8.0)
            .mt(4.0)
            .mb(2.0),
    );
    let surface = popover::raised(&look.kit, list, 12.0)
        .fill(t.card)
        .border(1.0, t.border);
    overlays.push(popover::anchored(
        &look.kit,
        surface,
        "rd-composer-card",
        Placement::TopStart,
        8.0,
    ));
}
