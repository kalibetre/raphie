//! The bar over the chat: which bot, the session's title when it is not
//! the chat, and the button that opens the inbox.
//!
//! Mirrors `apps/web/src/presentation/workspace/workspace-header.tsx` and the
//! `.bot-workspace-header` rules in `bot-workspace.css`.

use rune::{Align, El, row, text};

use super::Look;
use crate::avatar::bot_avatar;
use crate::icons;
use crate::state::Ui;
use crate::theme::font;
use crate::widgets::{count_badge, icon_button, one_line, pressable};

pub fn header(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let model = &s.model;
    let bot = model.selected_bot();
    let bot_id = bot.map_or("default", |b| b.id.as_str());
    // The chat is named by its bot alone; any other session by its title.
    let title = model
        .conversation
        .as_ref()
        .and_then(|c| c.observation.as_ref())
        .filter(|o| !o.session.chat)
        .map(|o| o.session.title.clone());

    let narrow = s.narrow();
    // In a narrow window the roster is a screen of its own: back to it.
    let toggle = if narrow {
        pressable(
            icon_button(t, &icons::ARROW_LEFT, 16.0, "Back to your team (⌘B)").key("rd-back-home"),
            true,
            |s: &mut Ui| s.go_home(),
        )
    } else {
        let button = if s.roster_open {
            icon_button(t, &icons::CHEVRONS_LEFT, 16.0, "Hide sidebar (⌘B)")
        } else {
            icon_button(t, &icons::CHEVRONS_RIGHT, 16.0, "Show sidebar (⌘B)")
        };
        pressable(button.key("rd-toggle-roster"), true, |s: &mut Ui| {
            s.roster_open = !s.roster_open;
        })
    };
    let mut identity = row().gap(10.0).center_y().child(toggle);
    // A narrow bar keeps its room for the title; the name says who it is.
    if !narrow {
        identity = identity.child(bot_avatar(bot_id, look.tones.of(bot_id), 24.0));
    }
    if let Some(bot) = bot {
        // One line: the bar is as short as the one over a Settings page.
        // The bot's description is in the roster, and here on hover.
        let mut name = row()
            .max_w(if narrow { 110.0 } else { 180.0 })
            .child(one_line(bot.name.clone(), font(13.0, 550.0), t.foreground).shrink());
        if !bot.description.is_empty() {
            name = name.help(bot.description.clone());
        }
        identity = identity.child(name);
    }

    let actions = row().gap(8.0).center_y().child(bell(s, t));

    // `grow` takes the room between the two sides, and the title centres in
    // it.
    let mut heading = row()
        .grow(1.0)
        .min_w(0.0)
        .gap(8.0)
        .center_y()
        .justify_center();
    if let Some(title) = title {
        heading = heading.child(
            text(title)
                .key("rd-title")
                .role("heading")
                .font(font(14.0, 560.0))
                .color(t.foreground)
                .truncate()
                .align(Align::Center)
                .shrink(),
        );
    }

    // With the roster hidden, the bar starts right of the window's buttons.
    let left = if s.roster_open && !narrow {
        24.0
    } else {
        (look.lights + 16.0).max(24.0)
    };
    row()
        .key("rd-header")
        .w_full()
        // The height of the bar over a Settings page, so both sit level
        // with the window's buttons.
        .h(44.0)
        .pl(left)
        .pr(if narrow { 12.0 } else { 24.0 })
        .gap(if narrow { 8.0 } else { 16.0 })
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        // Empty parts of the bar move the window; its buttons still press.
        .window_drag()
        .child(identity)
        .child(heading)
        .child(actions)
}

/// The bell: opens the inbox, with a count of what waits in it.
fn bell(s: &Ui, t: &crate::theme::Theme) -> El {
    let (_, count) = s.notifications();
    let label = if count == 0 {
        "Notifications".to_owned()
    } else {
        format!("Notifications, {count} updates")
    };
    let mut bell = pressable(
        icon_button(t, &icons::BELL, 17.0, &label).key("rd-bell"),
        true,
        |s: &mut Ui| s.inbox_open = true,
    );
    if count > 0 {
        // "99+" keeps a busy day's count inside the badge.
        let shown = count.min(99);
        bell = bell.child(
            count_badge(t, shown)
                .key("rd-bell-count")
                .pin(None, Some(-3.0), Some(-5.0), None)
                .a11y_hidden(),
        );
    }
    bell
}
