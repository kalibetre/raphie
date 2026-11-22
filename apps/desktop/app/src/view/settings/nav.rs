//! The Settings navigation: every bot's pages, then the app's own pages.
//!
//! Mirrors `settings-nav.tsx`. Unfolding a bot only reveals its pages; it
//! never navigates.

use std::f32::consts::FRAC_PI_2;

use raphie_core::contracts::BotProfile;
use rune::{El, ScrollSpec, col, el, icon, row, text};

use crate::avatar::bot_avatar;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{icon_button, one_line, pressable};

/// As wide as the bot roster it replaces.
const WIDTH: f32 = 264.0;

pub fn nav(s: &Ui, current: &Page, look: &Look) -> El {
    let t = &look.theme;
    // The title starts right of the window's own buttons when there are any.
    let title_inset = (look.lights + 12.0).max(14.0);
    let mut bots = col().w_full().gap(3.5);
    for bot in &s.model.bots {
        bots = bots.child(bot_group(s, bot, current, look));
    }
    let app = col()
        .w_full()
        .gap(3.5)
        .child(
            entry(t, "rd-nav-owner", "You", *current == Page::Owner, 7.0)
                .on_press(|s: &mut Ui| s.open_settings(Some(Page::Owner))),
        )
        .child(
            entry(
                t,
                "rd-nav-account",
                "Account",
                *current == Page::Account,
                7.0,
            )
            .on_press(|s: &mut Ui| s.open_settings(Some(Page::Account))),
        )
        .child(
            entry(
                t,
                "rd-nav-appearance",
                "Appearance",
                *current == Page::Appearance,
                7.0,
            )
            .on_press(|s: &mut Ui| s.open_settings(Some(Page::Appearance))),
        )
        .child(
            entry(
                t,
                "rd-nav-diagnostics",
                "Diagnostics",
                *current == Page::Diagnostics,
                7.0,
            )
            .on_press(|s: &mut Ui| s.open_settings(Some(Page::Diagnostics))),
        )
        .child(
            entry(t, "rd-nav-about", "About", *current == Page::About, 7.0)
                .on_press(|s: &mut Ui| s.open_settings(Some(Page::About))),
        );
    // In a narrow window the navigation is a screen of its own, and closes
    // Settings from its title row.
    let narrow = s.narrow();
    let mut title = row()
        .w_full()
        .h(53.0)
        .pt(7.0)
        .pl(title_inset)
        .pr(14.0)
        .pb(16.0)
        .gap(9.0)
        .center_y()
        .window_drag()
        .child(bot_avatar("default", look.tones.of("default"), 22.0))
        .child(
            text("Settings")
                .font(font(15.75, 600.0).tracking(-0.2))
                .color(t.foreground)
                .grow(1.0),
        );
    if narrow {
        title = title.child(pressable(
            icon_button(t, &icons::X, 16.0, "Close settings").key("rd-close-settings"),
            true,
            |s: &mut Ui| s.close_settings(),
        ));
    }
    let nav = col()
        .key("rd-settings-nav")
        .role("navigation")
        .label("Settings");
    let nav = if narrow { nav.w_full() } else { nav.w(WIDTH) };
    nav.h_full()
        .fill(t.sidebar)
        .border_sides([0.0, 1.0, 0.0, 0.0], t.border)
        // Level with the window's buttons, like the roster's brand.
        .child(title)
        .child(
            col()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(
                    col()
                        .w_full()
                        .px(7.0)
                        .gap(3.5)
                        .child(
                            // "Bots", with the button that starts a new one.
                            row()
                                .w_full()
                                .justify_between()
                                .center_y()
                                .child(group_label(t, "Bots"))
                                .child(
                                    icon_button(t, &icons::PLUS, 14.0, "Create a bot")
                                        .key("rd-nav-new-bot")
                                        .size(24.5, 24.5)
                                        .on_press(|s: &mut Ui| {
                                            s.open_settings(Some(Page::NewBot));
                                        }),
                                ),
                        )
                        .child(bots)
                        .child(group_label(t, "App").mt(14.0))
                        .child(app),
                ),
        )
        .child(
            row().w_full().px(7.0).py(7.0).child(
                row()
                    .key("rd-back-to-conversations")
                    .role("button")
                    .label("Back to conversations")
                    .w_full()
                    .h(28.0)
                    .px(7.0)
                    .gap(7.0)
                    .center_y()
                    .radius(7.0)
                    .hover(t.hover)
                    .focus_ring(2.0, -2.0, t.accent)
                    .child(
                        icon(&icons::ARROW_LEFT, 14.0)
                            .color(t.foreground)
                            .a11y_hidden(),
                    )
                    .child(
                        text("Back to conversations")
                            .font(font(12.25, 400.0))
                            .color(t.foreground)
                            .a11y_hidden(),
                    )
                    .on_press(|s: &mut Ui| s.close_settings()),
            ),
        )
}

/// "Bots", "App".
fn group_label(t: &Theme, label: &str) -> El {
    row().h(28.0).px(7.0).center_y().child(
        text(label)
            .font(font(10.5, 500.0))
            .color(t.muted_foreground),
    )
}

/// One bot: a row that unfolds its pages.
fn bot_group(s: &Ui, bot: &BotProfile, current: &Page, look: &Look) -> El {
    let t = &look.theme;
    let open = s.expanded_bots.contains(&bot.id);
    // Which of this bot's pages is showing, if any.
    let here = match current {
        // A sub-page marks the listed page it was reached from.
        Page::Bot { bot_id, section } if bot_id == &bot.id => {
            Some(section.parent().unwrap_or(*section))
        }
        _ => None,
    };
    let id = bot.id.clone();
    let mut trigger = row()
        .key(format!("rd-nav-bot-{}", bot.id))
        .role("button")
        .label(format!("{} settings", bot.name))
        .w_full()
        .h(28.0)
        .px(7.0)
        .gap(7.0)
        .center_y()
        .radius(7.0)
        .hover(t.hover)
        .focus_ring(2.0, -2.0, t.accent)
        .child(bot_avatar(&bot.id, look.tones.of(&bot.id), 18.0))
        .child(one_line(bot.name.clone(), font(12.25, 400.0), t.foreground).shrink());
    if bot.id == "default" {
        trigger = trigger.child(
            text("default")
                .font(font(10.5, 400.0))
                .color(t.muted_foreground),
        );
    }
    trigger = trigger
        // Pushes the chevron to the right edge.
        .child(el().grow(1.0))
        .child(
            icon(&icons::CHEVRON_RIGHT, 14.0)
                .color(t.muted_foreground)
                .icon_rotation(if open { FRAC_PI_2 } else { 0.0 })
                .a11y_hidden(),
        )
        .on_press(move |s: &mut Ui| Ui::toggle(&mut s.expanded_bots, &id));
    // Folded over the current page: mark the bot itself.
    if here.is_some() && !open {
        trigger = trigger.fill(t.hover);
    }
    let mut group = col().w_full().gap(3.5).child(trigger);
    if open {
        let mut pages = col()
            .grow(1.0)
            .min_w(0.0)
            .gap(3.5)
            .pl(8.0)
            // The line that ties the pages to their bot.
            .border_sides([0.0, 0.0, 0.0, 1.0], t.border);
        for section in BotSection::ALL {
            let bot_id = bot.id.clone();
            pages = pages.child(
                entry(
                    t,
                    &format!("rd-nav-{}-{}", bot.id, section.web_id()),
                    section.label(),
                    here == Some(section),
                    7.0,
                )
                .on_press(move |s: &mut Ui| {
                    s.open_settings(Some(Page::Bot {
                        bot_id: bot_id.clone(),
                        section,
                    }));
                }),
            );
        }
        group = group.child(row().w_full().pl(14.0).child(pages));
    }
    group
}

/// One page in the navigation; the current one is filled.
fn entry(t: &Theme, key: &str, label: &str, current: bool, pad: f32) -> El {
    let weight = if current { 500.0 } else { 400.0 };
    let mut entry = row()
        .key(key)
        .role("button")
        .label(label)
        .w_full()
        .h(24.5)
        .px(pad)
        .center_y()
        .radius(7.0)
        .focus_ring(2.0, -2.0, t.accent)
        .child(
            text(label)
                .font(font(12.25, weight))
                .color(t.foreground)
                .a11y_hidden(),
        );
    entry = if current {
        entry.fill(t.hover)
    } else {
        entry.hover(t.hover)
    };
    entry
}
