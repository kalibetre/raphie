//! The composer: a floating card to type in, with a round send button that
//! becomes Stop while Raphie works.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/composer.tsx`
//! and the `.composer` rules in `chat.css`. The web's attach, model and
//! permission controls are not here because this app does not have those
//! features yet.

use rune::{El, Tx, auto_grow, col, icon, row, text_input};

use super::Look;
use super::conversation::READING_WIDTH;
use crate::icons;
use crate::state::Ui;
use crate::theme::font;
use crate::widgets::{centered, pressable};

pub fn composer(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let empty = s.composer.text.trim().is_empty();
    // A run is going in this conversation, so it can be stopped.
    let running = s.busy();
    let busy = running || s.model.sending;

    let input = text_input(&s.composer, font(14.5, 400.0).lh(21.0))
        .key("rd-composer")
        .label("Message")
        .w_full()
        .color(t.foreground)
        .placeholder("Message Raphie…", t.muted_foreground)
        .caret(t.foreground, t.selection())
        .on_edit(|s: &mut Ui| &mut s.composer)
        // Return sends; Shift-Return types a new line.
        .on_submit(|s: &mut Ui, _: &mut Tx| s.send());

    let send = pressable(
        row()
            .key("rd-send")
            .role("button")
            .label("Send message")
            .size(28.0, 28.0)
            .center()
            // Half the side: a circle.
            .radius(14.0)
            .fill(t.primary)
            .hover(t.background.alpha(0.1))
            .press(t.background.alpha(0.2))
            .focus_ring(2.0, 2.0, t.accent)
            .child(
                icon(&icons::ARROW_UP, 14.0)
                    .color(t.primary_foreground)
                    .a11y_hidden(),
            ),
        !empty && !s.model.sending,
        |s: &mut Ui| s.send(),
    );
    // While Raphie works: with nothing typed, Stop takes the send button's
    // place; with a message typed (it would queue), both show.
    let stop = row()
        .key("rd-stop")
        .role("button")
        .label("Stop task")
        .help("Stop task")
        .size(28.0, 28.0)
        .center()
        .radius(14.0)
        .fill(t.error.alpha(0.15))
        .hover(t.error.alpha(0.1))
        .press(t.error.alpha(0.2))
        .focus_ring(2.0, 2.0, t.accent)
        .child(icon(&icons::SQUARE, 13.0).color(t.error).a11y_hidden())
        .on_press(|s: &mut Ui| s.stop());
    let mut actions = row().gap(6.0).center_y();
    if running {
        actions = actions.child(stop);
    }
    if !running || !empty {
        actions = actions.child(send);
    }

    let mut card = col()
        .key("rd-composer-card")
        .w_full()
        .pt(14.0)
        .pr(12.0)
        .pb(10.0)
        .pl(16.0)
        .radius(18.0)
        .fill(t.card)
        // The border warms towards the accent while typing, as on the web.
        .border(
            1.0,
            if s.composer.focused {
                t.border.mix(t.accent, 0.4)
            } else {
                t.border
            },
        )
        // The text grows from one line to ten, then scrolls.
        .child(auto_grow(input, 1, 10))
        .child(
            row()
                .w_full()
                .mt(10.0)
                .min_h(32.0)
                .justify_end()
                .center_y()
                .child(actions),
        )
        // A press anywhere on the card puts the caret in the text.
        .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-composer", false));
    for shadow in t.composer_shadow {
        card = card.box_shadow(shadow);
    }

    let mut wrap = col()
        .w_full()
        .max_w(READING_WIDTH)
        .px(28.0)
        .pt(4.0)
        .pb(14.0)
        .child(card);
    if busy {
        wrap = wrap.child(
            centered(
                "Raphie is working. You can leave and come back.",
                font(11.5, 400.0),
                t.faint,
            )
            .key("rd-composer-hint")
            .w_full()
            .mt(8.0),
        );
    }
    col()
        .key("rd-composer-area")
        .w_full()
        .items_center()
        .child(wrap)
}
