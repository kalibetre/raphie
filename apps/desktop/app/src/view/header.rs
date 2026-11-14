//! The bar over the conversation: which bot, which conversation, and the
//! buttons for a new conversation and the conversations panel.
//!
//! Mirrors `apps/web/src/presentation/workspace/workspace-header.tsx` and the
//! `.bot-workspace-header` rules in `bot-workspace.css`.

use rune::{Align, El, col, row, text};

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

    let toggle = if s.roster_open {
        icon_button(t, &icons::CHEVRONS_LEFT, 16.0, "Hide sidebar (⌘B)")
    } else {
        icon_button(t, &icons::CHEVRONS_RIGHT, 16.0, "Show sidebar (⌘B)")
    };
    let mut identity = row()
        .gap(10.0)
        .center_y()
        .child(pressable(
            toggle.key("rd-toggle-roster"),
            true,
            |s: &mut Ui| {
                s.roster_open = !s.roster_open;
            },
        ))
        .child(bot_avatar(bot_id, look.tones.of(bot_id), 32.0));
    if let Some(bot) = bot {
        let mut name = col().max_w(180.0).gap(5.0).child(one_line(
            bot.name.clone(),
            font(13.0, 550.0),
            t.foreground,
        ));
        if !bot.description.is_empty() {
            name = name.child(one_line(
                bot.description.clone(),
                font(10.0, 400.0),
                t.muted_foreground,
            ));
        }
        identity = identity.child(name);
    }

    // How many of this bot's conversations wait for an approval.
    let waiting = model
        .session_list()
        .filter(|session| session.waiting)
        .count();
    let mut panel_toggle = pressable(
        icon_button(
            t,
            &icons::PANEL_RIGHT,
            16.0,
            if s.panel_open {
                "Hide conversations"
            } else {
                "Show conversations"
            },
        )
        .key("rd-toggle-panel"),
        true,
        |s: &mut Ui| s.panel_open = !s.panel_open,
    );
    if waiting > 0 {
        // A small count on the button's top-right corner.
        panel_toggle = panel_toggle.child(
            count_badge(t, waiting)
                .pin(None, Some(-3.0), Some(-5.0), None)
                .a11y_hidden(),
        );
    }
    let actions = row()
        .gap(8.0)
        .center_y()
        .child(pressable(
            icon_button(t, &icons::SQUARE_PEN, 17.0, "New conversation").key("rd-new"),
            true,
            |s: &mut Ui| s.select_session(None),
        ))
        .child(panel_toggle);

    // With the roster hidden, the bar starts right of the window's buttons.
    let left = if s.roster_open {
        24.0
    } else {
        (look.lights + 16.0).max(24.0)
    };
    row()
        .key("rd-header")
        .w_full()
        .h(72.0)
        .pl(left)
        .pr(24.0)
        .gap(16.0)
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        // Empty parts of the bar move the window; its buttons still press.
        .window_drag()
        .child(identity)
        .child(
            // `grow` takes the room between the two sides, and the title
            // centres in it.
            text(title)
                .key("rd-title")
                .role("heading")
                .font(font(14.0, 560.0))
                .color(t.foreground)
                .truncate()
                .align(Align::Center)
                .grow(1.0)
                .min_w(0.0),
        )
        .child(actions)
}
