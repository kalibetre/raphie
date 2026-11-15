//! The composer: a floating card to type in, with a round send button that
//! becomes Stop while Raphie works.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/composer.tsx`
//! and the `.composer` rules in `chat.css`.
//!
//! Files join a message three ways: the paperclip (the system's file
//! picker, one file at a time), dragging them onto the conversation, or
//! pasting an image or copied files into the text.

use raphie_core::attachments::MAX_FILES;
use rune::{ClipboardContent, El, Tx, auto_grow, col, icon, row, text, text_input};

use super::Look;
use super::attachments::{Action, file_card};
use super::conversation::READING_WIDTH;
use super::model_picker::model_picker;
use super::permissions::permissions;
use crate::icons;
use crate::state::Ui;
use crate::theme::font;
use crate::widgets::{centered, icon_button, pressable};

pub fn composer(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let empty = s.composer.text.trim().is_empty();
    // A run is going in this conversation, so it can be stopped.
    let running = s.busy();
    let busy = running || s.model.sending;
    let draft = &s.model.attachments;
    // Only the selected bot's files: uploads belong to one bot.
    let bot_id = s.model.bot_id.as_deref();
    let files = draft.files_for(bot_id);
    // Nothing can be added, removed or sent while either is on its way.
    let locked = s.model.sending || draft.uploading;
    let has_content = !empty || !files.is_empty();

    let input = text_input(&s.composer, font(14.5, 400.0).lh(21.0))
        .key("rd-composer")
        .label("Message")
        .w_full()
        .color(t.foreground)
        .placeholder("Message Raphie…", t.muted_foreground)
        .caret(t.foreground, t.selection())
        .on_edit(|s: &mut Ui| &mut s.composer)
        // A pasted image or copied file is attached; text pastes as usual.
        .on_input_paste(|s: &mut Ui, content: &ClipboardContent, _: &mut Tx| {
            s.paste_attachment(content)
        })
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
        has_content && !locked,
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
    if !running || has_content {
        actions = actions.child(send);
    }
    let attach = icon_button(
        t,
        &icons::PAPERCLIP,
        16.0,
        "Attach a file (up to four, 8 MiB each)",
    )
    .key("rd-attach");
    // `pressable` takes a handler without `Tx`; opening the picker needs
    // one, so the disabled look is applied here by hand.
    let attach = if !locked && files.len() < MAX_FILES {
        attach.on_press_tx(|_: &mut Ui, tx: &mut Tx| Ui::choose_attachment(tx))
    } else {
        attach.disabled(true).layer_opacity(0.5)
    };

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
        // The border turns to the accent while files are dragged over.
        .border(
            1.0,
            if s.drop_hover {
                t.accent
            } else if s.composer.focused {
                t.border.mix(t.accent, 0.4)
            } else {
                t.border
            },
        );
    if !files.is_empty() {
        // The web scrolls the cards sideways; here they wrap onto new rows.
        let mut chips = row()
            .key("rd-attachments")
            .role("list")
            .label("Attached files")
            .w_full()
            .mb(12.0)
            .gap(8.0)
            .flex_wrap();
        for file in files {
            let key = format!("rd-attachment-{}", file.id);
            let picture = bot_id.and_then(|bot| Some((bot, s.picture(bot, &file.id)?)));
            chips = chips.child(file_card(t, &key, file, picture, &Action::Remove, !locked));
        }
        card = card.child(chips);
    }
    let mut card = card
        // The text grows from one line to ten, then scrolls.
        .child(auto_grow(input, 1, 10))
        .child(
            // The toolbar wraps, as the web's does: in a narrow window the
            // chips keep their names and the send button moves to a second
            // row instead of squeezing them.
            row()
                .w_full()
                .mt(10.0)
                .min_h(32.0)
                .gap(6.0)
                .center_y()
                .flex_wrap()
                // The paperclip sits 6 left of the text's edge so its
                // glyph, not its hover square, lines up with the text.
                .child(attach.ml(-6.0))
                // The model cannot change while Raphie works or a message
                // is on its way.
                .child(model_picker(s, !busy && !locked, look, overlays))
                .child(permissions(s, look, overlays))
                // Takes the room that is left and puts the buttons at its
                // right end, on whichever row they land.
                .child(row().grow(1.0).justify_end().child(actions)),
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
        .pb(14.0);
    if let Some(error) = &draft.error {
        wrap = wrap.child(
            text(error.clone())
                .key("rd-attach-error")
                .role("alert")
                .font(font(12.5, 400.0))
                .color(t.error)
                .wrap()
                .mb(8.0),
        );
    }
    wrap = wrap.child(card);
    if draft.uploading {
        wrap = wrap.child(
            centered("Uploading to workspace…", font(11.5, 400.0), t.faint)
                .key("rd-attach-uploading")
                .role("status")
                .w_full()
                .mt(8.0),
        );
    }
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
