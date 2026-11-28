//! Where a bot's message came from, when a work item's run brought it: a tab
//! under the bot's name with the item, the owner's request that started it
//! and a stamp with how the run ended. Pressing it opens the item.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/work-tab.tsx`
//! and its `.work-tab` rules in `bot-workspace.css`.

use raphie_core::contracts::{HandoffOutcome, SessionTurn, TurnStatus, TurnWorkKind};
use rune::{El, Family, TextStyle, icon, row, text};

use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};

/// The tab under a work item's message, or none for an ordinary reply.
pub fn tab(turn: &SessionTurn, t: &Theme) -> Option<El> {
    let work = turn.work.as_ref();
    if work.is_none() && turn.scheduled.is_none() {
        return None;
    }
    let title = turn
        .scheduled
        .as_ref()
        .map(|job| job.name.as_str())
        .or(work.map(|w| w.title.as_str()))
        .unwrap_or("Work");
    let reminder = work.is_some_and(|w| w.kind == TurnWorkKind::Reminder);
    // A scheduled job answers no one's message.
    let from = match (work.and_then(|w| w.request.as_deref()), &turn.scheduled) {
        (Some(request), _) => Some(format!("“{request}”")),
        (None, Some(_)) => Some("scheduled".to_owned()),
        _ => None,
    };
    // Only a finished message has an outcome to stamp.
    let (stamp, ink, fill) = match work.and_then(|w| w.outcome) {
        _ if reminder || turn.status != TurnStatus::Done => (None, t.accent, t.accent_soft),
        Some(HandoffOutcome::Failed) => (Some("FAILED"), t.error, t.error.alpha(0.13)),
        Some(HandoffOutcome::Cancelled) => (Some("CANCELLED"), t.muted_foreground, t.muted),
        _ => (Some("DONE"), t.accent, t.accent_soft),
    };
    let mut line = row()
        .min_w(0.0)
        .shrink()
        .gap(4.0)
        .center_y()
        .child(
            text("↳")
                .font(font(11.5, 400.0))
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(
            text(if reminder { "Open work item" } else { title }.to_owned())
                .font(font(11.5, 600.0))
                .color(t.foreground)
                .truncate()
                .shrink(),
        );
    if let Some(from) = &from {
        line = line.child(
            text(format!("· {from}"))
                .font(font(11.5, 400.0))
                .color(t.muted_foreground)
                .truncate()
                .shrink(),
        );
    }
    // As wide as it needs and no wider, cut to fit a narrow chat.
    let mut tab = row()
        .key(format!("rd-work-tab-{}", turn.id))
        .min_w(0.0)
        .shrink()
        .pl(7.0)
        .pr(9.0)
        .py(3.0)
        .gap(7.0)
        .center_y()
        .fill(fill)
        .border_sides([0.0, 0.0, 0.0, 2.0], ink)
        .corners([0.0, 6.0, 6.0, 0.0])
        .child(line);
    if let Some(stamp) = stamp {
        tab = tab.child(
            row()
                .label(format!("Run {}", stamp.to_lowercase()))
                .px(4.0)
                .radius(3.0)
                .border(1.5, ink)
                .rotate(-5f32.to_radians())
                .child(
                    text(stamp)
                        .font(
                            TextStyle::new(9.0, 700.0)
                                .family(Family::SystemMono)
                                .lh(14.0),
                        )
                        .color(ink)
                        .single_line()
                        .a11y_hidden(),
                ),
        );
    }
    // The tab is the link to its item: the way there shows when pointed at.
    let tip = [
        work.map(|w| w.item_id.as_str()),
        Some(title),
        from.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let tab = match work {
        Some(work) => {
            let id = work.item_id.clone();
            tab.role("button")
                .label(format!("Open {tip}"))
                .help(format!("Open {tip}"))
                .hover(fill.mix(t.foreground, 0.04))
                .focus_ring(2.0, 2.0, t.accent)
                .hover_group()
                .child(
                    icon(&icons::EXTERNAL_LINK, 11.0)
                        .color(t.muted_foreground)
                        .group_opacity(0.0, 1.0)
                        .a11y_hidden(),
                )
                .on_press(move |s: &mut Ui| s.open_work_item(&id))
        }
        None => tab.help(tip),
    };
    Some(row().w_full().mb(8.0).child(tab))
}
