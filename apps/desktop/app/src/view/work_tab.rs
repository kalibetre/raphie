//! Where a bot's message came from, when a work item's run brought it: a tab
//! under the bot's name with the item, the owner's request that started it
//! and a stamp with how the run ended, and the item's actions beside Quote.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/work-tab.tsx`
//! and its `.work-tab` rules in `bot-workspace.css`.

use raphie_core::contracts::{HandoffOutcome, SessionTurn};
use rune::{El, Family, TextStyle, row, text};

use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::widgets::{Kind, Size, button};

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
    // A scheduled job answers no one's message.
    let from = match (work.and_then(|w| w.request.as_deref()), &turn.scheduled) {
        (Some(request), _) => Some(format!("“{request}”")),
        (None, Some(_)) => Some("scheduled".to_owned()),
        _ => None,
    };
    let (stamp, ink, fill) = match work.and_then(|w| w.outcome) {
        Some(HandoffOutcome::Failed) => ("FAILED", t.error, t.error.alpha(0.13)),
        Some(HandoffOutcome::Cancelled) => ("CANCELLED", t.muted_foreground, t.muted),
        _ => ("DONE", t.accent, t.accent_soft),
    };
    let edge = if stamp == "DONE" { t.accent } else { ink };
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
            text(title.to_owned())
                .font(font(11.5, 600.0))
                .color(t.foreground)
                .single_line(),
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
    let tab = row()
        .key(format!("rd-work-tab-{}", turn.id))
        .min_w(0.0)
        .shrink()
        .pl(7.0)
        .pr(9.0)
        .py(3.0)
        .gap(7.0)
        .center_y()
        .fill(fill)
        .border_sides([0.0, 0.0, 0.0, 2.0], edge)
        .corners([0.0, 6.0, 6.0, 0.0])
        .help(match &from {
            Some(from) => format!("{title} · {from}"),
            None => title.to_owned(),
        })
        .child(line)
        .child(
            row()
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
                        .single_line(),
                ),
        );
    Some(row().w_full().mb(8.0).child(tab))
}

/// Open item and the item's id, beside Quote while the message is pointed at.
pub fn actions(turn_id: &str, item_id: &str, t: &Theme) -> Vec<El> {
    vec![
        button(
            t,
            Kind::Ghost,
            Size::Tiny,
            Some(&icons::EXTERNAL_LINK),
            "Open item",
        )
        .key(format!("rd-open-item-{turn_id}"))
        .group_opacity(0.0, 1.0)
        .on_press(|s: &mut Ui| {
            let bot_id = s.model.bot_id.clone().unwrap_or_else(|| "default".into());
            s.open_settings(Some(Page::Bot {
                bot_id,
                section: BotSection::Work,
            }));
        }),
        text(item_id.to_owned())
            .font(mono(10.5))
            .color(t.muted_foreground)
            .single_line()
            .group_opacity(0.0, 1.0),
    ]
}
