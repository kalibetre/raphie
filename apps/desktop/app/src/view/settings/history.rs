//! Settings → Profile → Revision history: every saved version of a bot's
//! profile, newest first, each unfolding into the personality it had.
//!
//! Mirrors `personality-history.tsx` and the `.revision-*` rules in
//! `shared/styles/settings/page.css`.

use raphie_core::contracts::{BotProfile, BotRevision};
use raphie_core::engine::Command;
use rune::{El, ScrollSpec, col, el, row, text};

use super::parts::{Scope, back_link, group, status, sub_page};
use crate::format::date_time;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::view::Look;
use crate::widgets::{Kind, Size, button, pressable};

pub fn history(s: &Ui, bot_id: &str, look: &Look) -> El {
    let t = &look.theme;
    let bot = s.model.bots.iter().find(|bot| bot.id == bot_id);
    let name = bot.map_or(bot_id, |bot| bot.name.as_str());
    let body = match (s.model.bot_history.get(bot_id), bot) {
        (Some(revisions), Some(bot)) => timeline(s, bot, revisions, t),
        _ => loading(s, bot_id, t),
    };
    let parent = bot_id.to_owned();
    let back = pressable(
        back_link(t, BotSection::Profile.label()).key("rd-history-back"),
        true,
        move |s: &mut Ui| {
            s.open_settings(Some(Page::Bot {
                bot_id: parent.clone(),
                section: BotSection::Profile,
            }));
        },
    );
    sub_page(
        "rd-page-history",
        BotSection::History.label(),
        &BotSection::History.lede(name),
        Scope::Bot { id: bot_id, name },
        Some(back),
        vec![body],
        look,
    )
}

/// The revisions are on their way, or could not be fetched.
fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let failed = s
        .model
        .bot_history_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "Revisions", "Loading revisions…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Revisions",
        "Couldn’t load revisions.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-history-retry"),
            true,
            move |s: &mut Ui| {
                s.model.bot_history_error = None;
                s.command(Command::LoadBotHistory {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// "Revisions": one row per saved version, tied together by a line down
/// the left with a dot at each.
fn timeline(s: &Ui, bot: &BotProfile, revisions: &[BotRevision], t: &Theme) -> El {
    let last = revisions.len().saturating_sub(1);
    let mut list = col().w_full().py(6.0);
    for (index, revision) in revisions.iter().enumerate() {
        list = list.child(entry(s, bot, revision, index == 0, index == last, t));
    }
    group(t, "Revisions", "The latest 50 saved versions.", vec![list])
}

fn entry(
    s: &Ui,
    bot: &BotProfile,
    revision: &BotRevision,
    first: bool,
    last: bool,
    t: &Theme,
) -> El {
    let number = revision.revision;
    let current = number == bot.revision;
    let open = s.open_revisions.contains(&number);
    // The line runs through every dot; it starts at the first dot and
    // stops at the last, so nothing hangs past either end.
    let line = |on: bool| {
        el().w(1.0)
            .fill(if on { t.border } else { t.border.alpha(0.0) })
            .a11y_hidden()
    };
    let mut dot = el().size(11.0, 11.0).radius(5.5).a11y_hidden();
    dot = if current {
        // The current revision's dot is filled, with a soft ring.
        dot.fill(t.accent).outline(4.0, 0.0, t.accent_soft)
    } else {
        dot.fill(t.card).border(2.0, t.muted_foreground.alpha(0.55))
    };
    let rail = col()
        .w(28.0)
        .items_center()
        .child(line(!first).h(19.0))
        .child(dot)
        .child(line(!last).grow(1.0));

    let mut heading = row()
        .key(format!("rd-revision-{number}"))
        .role("button")
        .label(format!("Revision {number}"))
        .expanded(open)
        .focusable(true)
        .w_full()
        .py(15.0)
        .gap(10.0)
        .center_y()
        .radius(6.0)
        .focus_ring(2.0, -2.0, t.accent)
        .child(
            text(format!("Revision {number}"))
                .font(font(13.0, 600.0))
                .color(t.foreground),
        );
    if current {
        heading = heading.child(
            row()
                .px(8.0)
                .py(2.0)
                .radius(10.0)
                .fill(t.accent_soft)
                .child(text("Current").font(font(10.5, 600.0)).color(t.accent)),
        );
    }
    heading = heading
        // Pushes the time to the right edge.
        .child(el().grow(1.0))
        .child(
            text(date_time(revision.updated_at))
                .font(font(12.0, 400.0))
                .color(t.muted_foreground),
        )
        .on_press(move |s: &mut Ui| {
            // `remove` says whether it was unfolded; if not, unfold it.
            if !s.open_revisions.remove(&number) {
                s.open_revisions.insert(number);
            }
        });
    // A hairline over every revision but the first.
    if !first {
        heading = heading.border_sides([1.0, 0.0, 0.0, 0.0], t.border);
    }
    let mut body = col().grow(1.0).min_w(0.0).child(heading);
    if open {
        let mut meta = revision.name.clone();
        if !revision.description.is_empty() {
            meta.push_str(&format!(" · {}", revision.description));
        }
        meta.push_str(&format!(
            " · Color: {}",
            revision.color.as_deref().unwrap_or("Automatic")
        ));
        body = body
            .child(
                text(meta)
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground)
                    .wrap()
                    .mb(8.0),
            )
            .child(
                // The personality as it was, scrolling once it is tall.
                col()
                    .key(format!("rd-revision-{number}-soul"))
                    .w_full()
                    .max_h(240.0)
                    .mb(16.0)
                    .scroll(ScrollSpec {
                        stick_bottom: false,
                    })
                    .radius(10.0)
                    .fill(t.muted)
                    .child(
                        text(revision.soul.clone())
                            .font(mono(12.0).lh(20.4))
                            .color(t.foreground)
                            .selectable(true)
                            .selection_color(t.selection())
                            .wrap_anywhere()
                            .px(14.0)
                            .py(12.0),
                    ),
            );
    }
    row()
        .w_full()
        .pl(12.0)
        .pr(18.0)
        .gap(6.0)
        .child(rail)
        .child(body)
}
