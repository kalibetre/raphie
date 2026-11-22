//! The bar over the conversation: which bot, which conversation, and the
//! buttons to archive it, start a new one and open the inbox.
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
    let conversation = model.conversation.as_ref();
    let title = conversation
        .and_then(|c| c.observation.as_ref())
        .map(|o| o.session.title.clone())
        .or_else(|| conversation.map(|_| "Loading…".to_owned()))
        .unwrap_or_else(|| "New conversation".to_owned());

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

    let mut actions = row().gap(8.0).center_y();
    // An open conversation can be archived, or brought back; it stays open
    // either way.
    if let Some(open) = conversation {
        let archived = model.open_archived();
        let (glyph, label) = if archived {
            (&icons::ARCHIVE_RESTORE, "Unarchive conversation")
        } else {
            (&icons::ARCHIVE, "Archive conversation")
        };
        let session_id = open.session_id.clone();
        actions = actions.child(pressable(
            icon_button(t, glyph, 17.0, label).key("rd-archive"),
            true,
            move |s: &mut Ui| s.archive(&session_id, !archived),
        ));
    }
    let actions = actions
        .child(pressable(
            icon_button(t, &icons::SQUARE_PEN, 17.0, "New conversation").key("rd-new"),
            true,
            |s: &mut Ui| s.select_session(None),
        ))
        .child(bell(s, t));

    // `grow` takes the room between the two sides, and the title centres in
    // it, with "Archived" beside it for an archived conversation (the web's
    // `.header-archived`).
    let mut heading = row()
        .grow(1.0)
        .min_w(0.0)
        .gap(8.0)
        .center_y()
        .justify_center()
        .child(
            text(title)
                .key("rd-title")
                .role("heading")
                .font(font(14.0, 560.0))
                .color(t.foreground)
                .truncate()
                .align(Align::Center)
                .shrink(),
        );
    if conversation.is_some() && model.open_archived() {
        heading = heading.child(
            row()
                .key("rd-title-archived")
                .px(7.0)
                .py(1.0)
                .radius(9.0)
                .border(1.0, t.border)
                .child(
                    text("Archived")
                        .font(font(11.0, 500.0))
                        .color(t.muted_foreground),
                ),
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
