//! Quotes in the chat: the bar inside a message that quotes an earlier one,
//! the action that quotes a message, and the quote waiting above the draft.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/quote.tsx` and
//! the `.message-quote`, `.message-actions` and `.composer-quote` rules in
//! `chat.css`.

use raphie_core::contracts::{Quote, QuoteAuthor};
use rune::{Color, El, Tx, col, icon, row, text};

use super::Look;
use super::roster::plain;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{one_line, pressable};

/// The key of the element that shows a quoted message, so a quote can
/// bring it into view.
pub fn message_key(turn_id: &str, author: QuoteAuthor) -> String {
    match author {
        QuoteAuthor::Owner => format!("rd-turn-{turn_id}"),
        QuoteAuthor::Bot => format!("rd-reply-{turn_id}"),
    }
}

/// Who wrote the quoted message, and the colour on its edge.
fn author(s: &Ui, quote: &Quote, t: &Theme) -> (String, Color) {
    match quote.author {
        QuoteAuthor::Bot => (
            s.model
                .selected_bot()
                .map_or("Raphie", |bot| bot.name.as_str())
                .to_owned(),
            t.accent,
        ),
        QuoteAuthor::Owner => ("You".to_owned(), t.muted_foreground),
    }
}

/// The message a message quotes, inside it: its author and how it starts,
/// with an edge in the author's colour. Pressing it shows the original.
pub fn bar(s: &Ui, quote: &Quote, look: &Look) -> El {
    let t = &look.theme;
    let (who, edge) = author(s, quote, t);
    let target = message_key(&quote.turn_id, quote.author);
    let name = if quote.author == QuoteAuthor::Bot {
        edge
    } else {
        t.foreground
    };
    let bar = col()
        .key(format!("rd-quote-{}", quote.turn_id))
        .role("button")
        .label(format!(
            "Quoting {who}: {}. Show the message",
            quote.excerpt
        ))
        .help(quote.excerpt.clone())
        .w_full()
        .min_w(0.0)
        .gap(1.0)
        .pl(9.0)
        .pr(9.0)
        .py(5.0)
        .fill(edge.alpha(0.12))
        .hover(edge.alpha(0.2))
        // A coloured left edge: `[top, right, bottom, left]` widths.
        .border_sides([0.0, 0.0, 0.0, 3.0], edge)
        .corners([4.0, 8.0, 8.0, 4.0])
        .child(text(who).font(font(12.0, 600.0)).color(name))
        .child(one_line(
            plain(&quote.excerpt),
            font(12.5, 400.0),
            t.muted_foreground,
        ));
    bar.on_press_tx(move |_: &mut Ui, tx: &mut Tx| {
        tx.scroll_into_view(target.clone());
    })
}

/// The action that quotes a message, shown while the message is pointed at.
pub fn action(key: String, turn_id: &str, author: QuoteAuthor, text_: &str, t: &Theme) -> El {
    let (turn_id, text_) = (turn_id.to_owned(), text_.to_owned());
    let button = row()
        .key(key)
        .role("button")
        .label("Quote")
        .px(7.0)
        .py(3.0)
        .gap(4.0)
        .center_y()
        .radius(7.0)
        .fill(t.card)
        .border(1.0, t.border)
        .hover(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        // Hidden until the message is pointed at or focused.
        .group_opacity(0.0, 1.0)
        .child(
            icon(&icons::CORNER_UP_LEFT, 12.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(
            text("Quote")
                .font(font(11.5, 500.0))
                .color(t.muted_foreground)
                .a11y_hidden(),
        );
    // One handler: a second would replace the first. Quoting puts the caret
    // in the draft that will quote.
    button.on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
        s.quote(&turn_id, author, &text_);
        tx.focus("rd-composer", false);
    })
}

/// How long Copy shows its check after copying, in milliseconds.
const COPIED_FOR_MS: i64 = 1500;

/// Under a finished reply, shown while it is pointed at: copy its text,
/// reply to it (the next message quotes it), and when it was said, with what
/// it cost on hover. A reply with no words has only its time. Mirrors
/// `reply-actions.tsx` on the web.
pub fn reply_actions(
    s: &Ui,
    turn_id: &str,
    text_: &str,
    said: Option<(i64, Option<String>)>,
    t: &Theme,
) -> El {
    let button = |key: String, label: &'static str, glyph: &'static rune::Icon| {
        row()
            .key(key)
            .role("button")
            .label(label)
            .help(label)
            // The web's `icon-xs`: 24 px.
            .size(24.0, 24.0)
            .center()
            .radius(7.0)
            .hover(t.hover)
            .focus_ring(2.0, 2.0, t.accent)
            .child(icon(glyph, 12.0).color(t.muted_foreground).a11y_hidden())
    };
    let copied = text_.to_owned();
    let copy_id = turn_id.to_owned();
    // Just copied: a check for a moment, as on the web.
    let just_copied = s
        .copied
        .as_ref()
        .is_some_and(|(id, at)| id == turn_id && crate::format::now_ms() - at < COPIED_FOR_MS);
    let (copy_label, copy_glyph) = if just_copied {
        ("Copied", &icons::CHECK)
    } else {
        ("Copy", &icons::COPY)
    };
    let (reply_id, reply_text) = (turn_id.to_owned(), text_.to_owned());
    let mut actions = row()
        .key(format!("rd-reply-actions-{turn_id}"))
        .mt(6.0)
        .ml(-4.0)
        .gap(2.0)
        .center_y()
        // Hidden until the message is pointed at or focused.
        .group_opacity(0.0, 1.0);
    // A reply with no words has only its time.
    if !text_.trim().is_empty() {
        actions = actions
            .child(
                button(format!("rd-copy-bot-{turn_id}"), copy_label, copy_glyph).on_press_tx(
                    move |s: &mut Ui, tx: &mut Tx| {
                        tx.copy(copied.clone());
                        s.copied = Some((copy_id.clone(), crate::format::now_ms()));
                        // Back to Copy once the moment has passed.
                        tx.wake_after(std::time::Duration::from_millis(COPIED_FOR_MS as u64 + 50));
                    },
                ),
            )
            .child(
                button(
                    format!("rd-quote-bot-{turn_id}"),
                    "Reply",
                    &icons::CORNER_UP_LEFT,
                )
                // Replying puts the caret in the draft that will quote.
                .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
                    s.quote(&reply_id, QuoteAuthor::Bot, &reply_text);
                    tx.focus("rd-composer", false);
                }),
            );
    }
    if let Some((at, usage)) = said {
        let mut time = text(crate::format::clock(at))
            .key(format!("rd-reply-time-{turn_id}"))
            .font(font(11.5, 400.0))
            .color(t.faint)
            .single_line()
            .ml(6.0);
        if let Some(usage) = usage {
            time = time.help(usage);
        }
        actions = actions.child(time);
    }
    actions
}

/// The message the draft will quote, above it, with a way to drop it.
pub fn in_composer(s: &Ui, look: &Look) -> Option<El> {
    let t = &look.theme;
    let quote = s.quoting.as_ref()?;
    let (who, edge) = author(s, quote, t);
    let name = if quote.author == QuoteAuthor::Bot {
        edge
    } else {
        t.foreground
    };
    let clear = row()
        .key("rd-composer-quote-clear")
        .role("button")
        .label("Don't quote this message")
        .help("Don't quote")
        .size(22.0, 22.0)
        .center()
        .radius(6.0)
        .hover(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        .child(
            icon(&icons::X, 12.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        );
    Some(
        row()
            .key("rd-composer-quote")
            .w_full()
            .min_w(0.0)
            .mb(10.0)
            .gap(8.0)
            .center_y()
            .pl(9.0)
            .pr(4.0)
            .py(4.0)
            .fill(t.muted)
            .border_sides([0.0, 0.0, 0.0, 3.0], edge)
            .corners([4.0, 10.0, 10.0, 4.0])
            .child(
                icon(&icons::CORNER_UP_LEFT, 13.0)
                    .color(t.muted_foreground)
                    .a11y_hidden(),
            )
            .child(text(who).font(font(12.5, 600.0)).color(name))
            .child(
                one_line(plain(&quote.excerpt), font(12.5, 400.0), t.muted_foreground)
                    .grow(1.0)
                    .min_w(0.0),
            )
            .child(pressable(clear, true, |s: &mut Ui| s.quoting = None)),
    )
}
