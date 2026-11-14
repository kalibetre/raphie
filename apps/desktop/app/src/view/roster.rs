//! The bot roster down the left edge: the brand, one row per bot, and the
//! connection status with sign-out.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/bot-sidebar.tsx` and
//! the `.bot-roster` rules in `bot-workspace.css`.

use raphie_core::contracts::BotProfile;
use raphie_core::engine::Command;
use raphie_core::model::StreamStatus;
use rune::{El, LiveRegion, ScrollSpec, TextCase, col, row, text};

use super::Look;
use crate::avatar::bot_avatar;
use crate::icons;
use crate::state::Ui;
use crate::theme::font;
use crate::widgets::{count_badge, icon_button, one_line, pressable, status_dot};

/// The roster's width, the web's default.
const WIDTH: f32 = 264.0;

pub fn roster(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    // The brand starts right of the window's own buttons when there are any.
    let brand_inset = (look.lights + 12.0).max(20.0);
    let bots = &s.model.bots;
    let mut list = col().w_full();
    for bot in bots {
        list = list.child(bot_row(s, bot, look));
    }
    col()
        .key("rd-roster")
        .w(WIDTH)
        .h_full()
        .pb(16.0)
        .fill(t.sidebar)
        // Only a right edge: `[top, right, bottom, left]` widths.
        .border_sides([0.0, 1.0, 0.0, 0.0], t.border)
        .child(
            // The brand band also moves the window. It is tighter than the
            // web's (24 above and below) so the brand sits level with the
            // window's buttons, like a title bar.
            row()
                .w_full()
                .pt(7.0)
                .pl(brand_inset)
                .pr(20.0)
                .pb(16.0)
                .gap(9.0)
                .center_y()
                .window_drag()
                .child(bot_avatar("default", look.tones.of("default"), 30.0))
                .child(
                    text("raphie")
                        .font(font(17.0, 650.0).tracking(-0.2))
                        .color(t.foreground),
                ),
        )
        .child(
            row()
                .w_full()
                .px(22.0)
                .pb(12.0)
                .justify_between()
                .center_y()
                .child(
                    text("Your bots")
                        .font(font(10.0, 400.0).tracking(1.0))
                        .color(t.muted_foreground)
                        // Drawn in capitals; screen readers get "Your bots".
                        .text_case(TextCase::Uppercase),
                )
                .child(
                    text(bots.len().to_string())
                        .font(font(10.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(
            col()
                .key("rd-bots")
                .role("navigation")
                .label("Your bots")
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(list),
        )
        .child(footer(s, look))
}

fn bot_row(s: &Ui, bot: &BotProfile, look: &Look) -> El {
    let t = &look.theme;
    let tone = look.tones.of(&bot.id);
    let selected = s.model.bot_id.as_deref() == Some(bot.id.as_str());
    // The session list on hand belongs to the selected bot, so only that
    // bot's row can say how many conversations wait and what was said last.
    let waiting = if selected {
        s.model
            .session_list()
            .filter(|session| session.waiting)
            .count()
    } else {
        0
    };
    let preview = if waiting == 1 {
        "1 conversation needs you".to_owned()
    } else if waiting > 1 {
        format!("{waiting} conversations need you")
    } else {
        let latest = selected
            .then(|| s.model.session_list().next())
            .flatten()
            .map(|session| plain(&session.preview))
            .filter(|preview| !preview.is_empty());
        latest.unwrap_or_else(|| {
            if bot.description.is_empty() {
                "Start a conversation".to_owned()
            } else {
                bot.description.clone()
            }
        })
    };

    let mut name = row()
        .w_full()
        .gap(8.0)
        .justify_between()
        .center_y()
        .child(one_line(bot.name.clone(), font(13.0, 550.0), t.foreground).shrink());
    if waiting > 0 {
        name = name.child(count_badge(t, waiting));
    }
    let id = bot.id.clone();
    let row = row()
        .key(format!("rd-bot-{}", bot.id))
        .role("button")
        .label(bot.name.clone())
        .w_full()
        .px(22.0)
        .py(12.0)
        .gap(12.0)
        .center_y()
        .child(
            row()
                .size(40.0, 40.0)
                .center()
                .radius(12.0)
                .fill(tone.body.alpha(if selected { 0.22 } else { 0.12 }))
                .child(bot_avatar(&bot.id, tone, 32.0)),
        )
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .gap(4.0)
                .child(name)
                .child(one_line(preview, font(11.0, 400.0), t.muted_foreground)),
        );
    // The selected row is washed in the bot's own colour; the others show
    // the hover colour under the pointer.
    let row = if selected {
        row.fill(tone.body.alpha(0.22))
    } else {
        row.hover(t.hover)
    };
    // `move` gives the closure its own copy of `id`, since it outlives this
    // function.
    pressable(row, true, move |s: &mut Ui| s.select_bot(&id))
}

/// A preview without Markdown markers, on one line (the web's `sessionPreview`).
pub fn plain(preview: &str) -> String {
    preview
        .replace(['*', '_', '`', '#'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Connection status on the left, sign-out on the right.
fn footer(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    // "Reconnecting…" while the open conversation's stream is down.
    let online = s
        .model
        .conversation
        .as_ref()
        .is_none_or(|c| c.stream != StreamStatus::Reconnecting);
    let origin = s
        .model
        .origin
        .as_ref()
        .map(ToString::to_string)
        .unwrap_or_default();
    row()
        .key("rd-account")
        .w_full()
        .mt(18.0)
        .px(22.0)
        .pt(12.0)
        .gap(8.0)
        .justify_between()
        .center_y()
        .child(
            row()
                .gap(7.0)
                .center_y()
                .help(origin)
                .child(status_dot(t, online))
                .child(
                    text(if online {
                        "Connected"
                    } else {
                        "Reconnecting…"
                    })
                    .key("rd-stream-status")
                    .font(font(11.0, 400.0))
                    .color(t.muted_foreground)
                    .live_region(LiveRegion::Polite),
                ),
        )
        .child(pressable(
            icon_button(t, &icons::LOG_OUT, 15.0, "Sign out").key("rd-sign-out"),
            true,
            |s: &mut Ui| s.command(Command::SignOut),
        ))
}
