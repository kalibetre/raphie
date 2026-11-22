//! Settings: a navigation column on the left, and the chosen page under a
//! breadcrumb bar on the right.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/settings.tsx`,
//! `settings-main.tsx` and the `.settings-topbar` rules in
//! `shared/styles/settings/bot.css`. Each page is its own module here.

mod about;
mod account;
mod activity;
mod appearance;
mod channels;
mod diagnostics;
mod history;
mod inspect;
mod jobs;
mod mcp;
mod memories;
mod memory;
mod models;
mod nav;
mod owner;
mod parts;
mod profile;
mod providers;
mod sandbox;
mod skills;
mod workspace;

use rune::{El, Icon, ScrollSpec, col, icon, row, text};

use super::Look;
use crate::avatar::bot_avatar;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::font;
use crate::widgets::{icon_button, one_line, pressable};

pub fn settings(s: &Ui, page: &Page, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let content = match page {
        Page::Owner => owner::owner(s, look, overlays),
        Page::Account => account::account(s, look),
        Page::Appearance => appearance::appearance(s, look),
        Page::About => about::about(s, look),
        // Adding a teammate is a full-window flow, drawn instead of Settings.
        Page::NewBot => col(),
        Page::Diagnostics => diagnostics::diagnostics(s, look),
        Page::Bot {
            bot_id,
            section: BotSection::Profile,
        } => profile::profile(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::History,
        } => history::history(s, bot_id, look),
        Page::Bot {
            bot_id,
            section: BotSection::Models,
        } => models::models(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::Providers,
        } => providers::providers(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::Memory,
        } => memory::memory(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::Activity,
        } => activity::activity(s, bot_id, look),
        Page::Bot {
            bot_id,
            section: BotSection::Jobs,
        } => jobs::jobs(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::Workspace,
        } => workspace::workspace(s, bot_id, look),
        Page::Bot {
            bot_id,
            section: BotSection::Sandbox,
        } => sandbox::sandbox(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::Channels,
        } => channels::channels(s, bot_id, look),
        Page::Bot {
            bot_id,
            section: BotSection::Mcp,
        } => mcp::mcp(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::Skills,
        } => skills::skills(s, bot_id, look, overlays),
        Page::Bot {
            bot_id,
            section: BotSection::MemoryBrowse,
        } => memories::memories(s, bot_id, look),
    };
    // Pages with a form dock a save bar under the scrolling page.
    let footer = match page {
        Page::Bot {
            section: BotSection::Profile,
            ..
        } => profile::save_bar(s, look),
        Page::Owner => owner::owner_save_bar(s, look),
        Page::Bot {
            section: BotSection::Skills,
            ..
        } => skills::skill_save_bar(s, look),
        Page::Bot {
            section: BotSection::Memory,
            ..
        } => memory::memory_save_bar(s, look),
        Page::Bot {
            section: BotSection::Sandbox,
            ..
        } => sandbox::sandbox_save_bar(s, look),
        _ => None,
    };
    let mut main = col()
        .key("rd-settings-main")
        .grow(1.0)
        .h_full()
        .min_w(0.0)
        .min_h(0.0)
        .child(top_bar(s, page, look))
        .child(
            col()
                .key("rd-settings-scroll")
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                // The page column is centred in the pane.
                .child(col().w_full().items_center().child(content)),
        );
    if let Some(footer) = footer {
        main = main.child(footer);
    }
    let mut shell = row()
        .key("rd-settings")
        .w_full()
        .h_full()
        .fill(t.background)
        // The width decides whether the navigation docks beside the page.
        .on_layout(|s: &mut Ui, rect: [f32; 4]| {
            s.workspace_width = rect[2];
            s.workspace_height = rect[3];
        });
    // A narrow window shows the navigation or a page, one at a time.
    if s.narrow() {
        return if s.settings_nav_home {
            shell.child(nav::nav(s, page, look))
        } else {
            shell.child(main)
        };
    }
    if s.roster_open {
        shell = shell.child(nav::nav(s, page, look));
    }
    shell.child(main)
}

/// The bar over the page: sidebar toggle, "Settings › Bot › Page", close.
fn top_bar(s: &Ui, page: &Page, look: &Look) -> El {
    let t = &look.theme;
    let narrow = s.narrow();
    let toggle = if narrow {
        icon_button(t, &icons::ARROW_LEFT, 16.0, "Back to Settings (⌘B)")
    } else if s.roster_open {
        icon_button(
            t,
            &icons::CHEVRONS_LEFT,
            16.0,
            "Hide settings navigation (⌘B)",
        )
    } else {
        icon_button(
            t,
            &icons::CHEVRONS_RIGHT,
            16.0,
            "Show settings navigation (⌘B)",
        )
    };
    let divider = || {
        icon(&icons::CHEVRON_RIGHT, 12.0)
            .color(t.faint)
            .a11y_hidden()
    };
    let mut crumbs = row()
        .role("navigation")
        .label("Settings location")
        .gap(10.0)
        .center_y()
        .grow(1.0)
        .min_w(0.0)
        .child(
            row()
                .gap(7.0)
                .center_y()
                .child(
                    icon(&icons::SETTINGS_2, 14.0)
                        .color(t.muted_foreground)
                        .a11y_hidden(),
                )
                .child(
                    text("Settings")
                        .font(font(12.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(divider());
    // A bot's page names the bot in a pill before the page.
    if let Page::Bot { bot_id, .. } = page {
        let name = s
            .model
            .bots
            .iter()
            .find(|bot| &bot.id == bot_id)
            .map_or(bot_id.as_str(), |bot| bot.name.as_str());
        crumbs = crumbs
            .child(
                row()
                    .max_w(180.0)
                    .pl(5.0)
                    .pr(10.0)
                    .py(4.0)
                    .gap(7.0)
                    .center_y()
                    .radius(13.0)
                    .fill(t.card)
                    .border(1.0, t.border)
                    .child(bot_avatar(bot_id, look.tones.of(bot_id), 18.0))
                    .child(one_line(name.to_owned(), font(12.0, 550.0), t.foreground)),
            )
            .child(divider());
    }
    crumbs = crumbs.child(
        row()
            .gap(7.0)
            .center_y()
            .child(
                icon(page_icon(page), 14.0)
                    .color(t.foreground)
                    .a11y_hidden(),
            )
            .child(
                text(page.label())
                    .key("rd-settings-page-name")
                    .font(font(12.0, 400.0))
                    .color(t.foreground),
            ),
    );
    // A narrow bar names only the page: the way back says where it is.
    if narrow {
        crumbs = row()
            .role("navigation")
            .label("Settings location")
            .grow(1.0)
            .min_w(0.0)
            .child(
                one_line(page.label(), font(13.0, 560.0), t.foreground)
                    .key("rd-settings-page-name"),
            );
    }
    // With the navigation hidden, the bar starts right of the window's buttons.
    let left = if s.roster_open && !narrow {
        24.0
    } else {
        (look.lights + 16.0).max(24.0)
    };
    row()
        .key("rd-settings-topbar")
        .w_full()
        // Shorter than the web's 60: at 44 the breadcrumb sits level with
        // the window's buttons and the "Settings" title beside it.
        .h(44.0)
        .pl(left)
        .pr(24.0)
        .gap(10.0)
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        // Empty parts of the bar move the window.
        .window_drag()
        .child(pressable(
            toggle.key("rd-toggle-settings-nav"),
            true,
            |s: &mut Ui| {
                if s.narrow() {
                    s.settings_nav_home = true;
                } else {
                    s.roster_open = !s.roster_open;
                }
            },
        ))
        .child(crumbs)
        .child(pressable(
            icon_button(t, &icons::X, 16.0, "Close settings").key("rd-close-settings"),
            true,
            |s: &mut Ui| s.close_settings(),
        ))
}

/// The icon the web shows beside each page's name.
pub fn page_icon(page: &Page) -> &'static Icon {
    match page {
        Page::Owner => &icons::CIRCLE_USER_ROUND,
        Page::Account => &icons::LOG_OUT,
        Page::Appearance => &icons::PALETTE,
        Page::About => &icons::INFO,
        Page::NewBot => &icons::BOT,
        Page::Diagnostics => &icons::RADIO,
        Page::Bot { section, .. } => match section {
            BotSection::Profile => &icons::USER_ROUND,
            BotSection::History => &icons::HISTORY,
            BotSection::Providers => &icons::KEY_ROUND,
            BotSection::Models => &icons::BRAIN,
            BotSection::Memory => &icons::BOOK_OPEN,
            BotSection::MemoryBrowse => &icons::LIBRARY,
            BotSection::Mcp => &icons::PLUG,
            BotSection::Skills => &icons::GRADUATION_CAP,
            BotSection::Channels => &icons::MESSAGES_SQUARE,
            BotSection::Sandbox => &icons::BOX,
            BotSection::Workspace => &icons::FOLDER_OPEN,
            BotSection::Jobs => &icons::CLOCK,
            BotSection::Activity => &icons::LIST_TREE,
        },
    }
}
