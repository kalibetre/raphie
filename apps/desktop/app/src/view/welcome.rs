//! A new conversation: the bot's face, a greeting and three ways to start.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/welcome.tsx` and
//! the `.welcome` rules in `chat.css`.

use rune::{El, Icon, Tx, col, icon, row, text};

use super::Look;
use crate::avatar::bot_avatar;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::centered;

/// The starters and their icons, as on the web.
const SUGGESTIONS: [(&Icon, &str); 3] = [
    (&icons::ACTIVITY, "Help me plan my day"),
    (&icons::MESSAGE_SQUARE, "Think through an idea"),
    (&icons::CIRCLE_QUESTION_MARK, "What can you help me with?"),
];

pub fn welcome(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let bot_id = s.model.selected_bot().map_or("default", |b| b.id.as_str());
    let mut suggestions = row()
        .w_full()
        .mt(26.0)
        .gap(8.0)
        .flex_wrap()
        .justify_center();
    for (glyph, label) in SUGGESTIONS {
        suggestions = suggestions.child(suggestion(glyph, label, t));
    }
    col()
        .key("rd-empty")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .padding(32.0)
        // Extra room below keeps the greeting where the web has it, centred
        // in the pane as if the composer floated over it.
        .pb(74.0)
        .center()
        .child(bot_avatar(bot_id, look.tones.of(bot_id), 64.0).mb(14.0))
        .child(
            text("A LITTLE CLARITY FOR YOUR DAY")
                .font(font(11.0, 400.0).tracking(1.4))
                .color(t.faint),
        )
        .child(
            text("What’s on your mind?")
                .role("heading")
                .font(font(28.0, 600.0).tracking(-0.6))
                .color(t.foreground)
                .mt(8.0)
                .mb(6.0),
        )
        .child(centered(
            "A place to think things through, get things done,\nand keep the details in view.",
            font(14.0, 400.0).lh(22.4),
            t.muted_foreground,
        ))
        .child(suggestions)
        .child(
            row()
                .mt(22.0)
                .gap(6.0)
                .center_y()
                .child(
                    icon(&icons::SHIELD_CHECK, 14.0)
                        .color(t.faint)
                        .a11y_hidden(),
                )
                .child(
                    text("You’re in control. Review connected actions before they run.")
                        .font(font(12.0, 400.0))
                        .color(t.faint),
                ),
        )
}

/// A starter: pressing it puts the text in the composer, ready to send.
fn suggestion(glyph: &'static Icon, label: &'static str, t: &Theme) -> El {
    row()
        .key(format!("rd-suggest-{}", label.len()))
        .role("button")
        .label(label)
        .px(12.0)
        .py(9.0)
        .gap(10.0)
        .center_y()
        .radius(10.0)
        .fill(t.card)
        .border(1.0, t.border)
        .hover(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        .child(
            row()
                .gap(8.0)
                .center_y()
                .child(icon(glyph, 17.0).color(t.faint).a11y_hidden())
                .child(
                    text(label)
                        .font(font(13.0, 400.0))
                        .color(t.foreground)
                        .a11y_hidden(),
                ),
        )
        .child(
            icon(&icons::ARROW_UP_RIGHT, 14.0)
                .color(t.faint)
                .a11y_hidden(),
        )
        .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
            s.suggest(label);
            tx.focus("rd-composer", false);
        })
}
