//! The bot roster down the left edge: the brand, one row per bot, the
//! selected bot's conversations, and the connection status with sign-out.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/bot-sidebar.tsx` and
//! the `.bot-roster` rules in `bot-workspace.css`.

use raphie_core::contracts::BotProfile;
use raphie_core::engine::Command;
use raphie_core::model::StreamStatus;
use rune::{El, Icon, LiveRegion, ScrollSpec, TextCase, col, icon, row, text};

use super::Look;
use super::sessions::sessions;
use crate::avatar::bot_avatar;
use crate::icons;
use crate::sections::Page;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{
    build_badge, build_badge_width, count_badge, icon_button, one_line, pressable, status_dot,
};

pub fn roster(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    // The brand starts right of the window's own buttons when there are any.
    let brand_inset = (look.lights + 12.0).max(20.0);
    let width = s.visible_roster_width();
    let wordmark = font(17.0, 650.0).tracking(-0.2);
    // The build badge says its word only when the brand has room for it; a
    // narrow roster shows the badge's icon alone rather than run past its edge.
    let brand_width = brand_inset
        + 30.0
        + 9.0
        + rune::text::measure("raphie", &[], wordmark, None).0
        + 9.0
        + build_badge_width(s.flavor, s.release_channel)
        // At least this much of the roster stays clear to the badge's right.
        + 12.0;
    let compact = brand_width > width;
    let bots = &s.model.bots;
    let mut list = col().w_full();
    for bot in bots {
        list = list.child(bot_row(s, bot, look));
    }
    let mut bots_list = col()
        .key("rd-bots")
        .role("navigation")
        .label("Your bots")
        .w_full()
        .scroll(ScrollSpec {
            stick_bottom: false,
        })
        .child(list);
    // The bots take what they need, up to two fifths of the window, and
    // scroll past that; the selected bot's conversations fill the rest.
    if s.workspace_height > 0.0 {
        bots_list = bots_list.max_h((s.workspace_height * 0.4).floor());
    }
    col()
        .key("rd-roster")
        .w(width)
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
                .child(text("raphie").font(wordmark).color(t.foreground))
                // An `Option` is a list of none or one, which is what
                // `children` takes.
                .children(build_badge(t, s.flavor, s.release_channel, compact)),
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
                .child(pressable(
                    label_action(t, &icons::PLUS, "New bot").key("rd-new-bot"),
                    true,
                    |s: &mut Ui| s.open_settings(Some(Page::NewBot)),
                )),
        )
        .child(bots_list)
        .child(sessions(s, look))
        .child(footer(s, look))
}

fn bot_row(s: &Ui, bot: &BotProfile, look: &Look) -> El {
    let t = &look.theme;
    let tone = look.tones.of(&bot.id);
    let selected = s.model.bot_id.as_deref() == Some(bot.id.as_str());
    // How many of this bot's conversations have something for the owner.
    // Another bot's are known from the inbox's last round.
    let waiting = s.attention_in(&bot.id);

    let mut name = row()
        .w_full()
        .gap(8.0)
        .justify_between()
        .center_y()
        .child(one_line(bot.name.clone(), font(13.0, 550.0), t.foreground).shrink());
    if waiting > 0 {
        // The web shows the number alone; a screen reader hears what it counts.
        let needs = if waiting == 1 {
            "1 conversation needs you".to_owned()
        } else {
            format!("{waiting} conversations need you")
        };
        name = name.child(
            count_badge(t, waiting)
                .key(format!("rd-bot-{}-count", bot.id))
                .label(needs),
        );
    }
    let id = bot.id.clone();
    let row = row()
        .key(format!("rd-bot-{}", bot.id))
        .role("button")
        .label(bot.name.clone())
        .w_full()
        .px(22.0)
        .py(5.0)
        .gap(12.0)
        .center_y()
        .child(
            row()
                .size(28.0, 28.0)
                .center()
                .radius(8.0)
                .fill(tone.body.alpha(if selected { 0.22 } else { 0.12 }))
                .child(bot_avatar(&bot.id, tone, 24.0)),
        )
        .child(col().grow(1.0).min_w(0.0).child(name));
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

/// The small ghost button at the end of a roster label (the web's
/// `.roster-label-action`, an `icon-xs` button): 21 points with a 10.5-point
/// glyph, pulled into the label's padding so the row stays as tall as its
/// text.
pub fn label_action(t: &Theme, glyph: &'static Icon, label: &str) -> El {
    row()
        .role("button")
        .label(label)
        .help(label)
        .size(21.0, 21.0)
        .mx(-4.0)
        .my(-6.0)
        .center()
        .radius(5.25)
        .hover(t.hover)
        .press(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        .child(icon(glyph, 10.5).color(t.muted_foreground).a11y_hidden())
}

/// A preview without Markdown markers, on one line (the web's `sessionPreview`).
pub fn plain(preview: &str) -> String {
    preview
        .replace(['*', '_', '`', '#'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Connection status on the left; account, settings and sign-out on the
/// right.
fn footer(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    // "Not answering" when the last check found Raphie down, and
    // "Reconnecting…" while the open conversation's stream is down.
    let answering = s.model.reach.is_up();
    let streaming = s
        .model
        .conversation
        .as_ref()
        .is_none_or(|c| c.stream != StreamStatus::Reconnecting);
    let online = answering && streaming;
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
                    text(if !answering {
                        "Not answering"
                    } else if streaming {
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
        .child(
            row()
                .gap(4.0)
                .center_y()
                .child(
                    icon_button(t, &icons::USER_ROUND, 15.0, "Account")
                        .key("rd-account-settings")
                        .on_press(|s: &mut Ui| s.open_settings(Some(Page::Account))),
                )
                .child(
                    icon_button(t, &icons::SETTINGS, 15.0, "Settings (⌘,)")
                        .key("rd-settings")
                        .on_press(|s: &mut Ui| s.open_settings(None)),
                )
                .child(pressable(
                    icon_button(t, &icons::LOG_OUT, 15.0, "Sign out").key("rd-sign-out"),
                    true,
                    |s: &mut Ui| s.command(Command::SignOut),
                )),
        )
}
