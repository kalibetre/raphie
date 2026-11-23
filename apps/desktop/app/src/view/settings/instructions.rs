//! Instructions a bot reads in every conversation on working with its
//! tools: those for every bot on Settings → You, and a bot's own on its
//! Profile. Kept by the owner here and by a bot when asked to note something.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/instructions-field.tsx`.

use rune::{El, TextEdit, Tx, col, row, text, text_input};

use super::profile::section;
use crate::profile::INSTRUCTIONS_LIMIT;
use crate::state::Ui;
use crate::theme::{Theme, font};

/// One instructions card: where it is, what it says, and the text being
/// edited.
pub struct Instructions<'a> {
    /// The editor's key; its box and count line are named after it.
    pub key: &'static str,
    pub title: &'static str,
    pub note: &'static str,
    pub placeholder: &'static str,
    pub edit: &'a TextEdit,
    pub busy: bool,
    /// Said in the editor's heading, as a personality says its revision.
    pub status: String,
}

/// The card. `access` tells Rune where the text lives, as for
/// `text_field`; it is used twice, so it must be `Clone`.
pub fn instructions_field(
    t: &Theme,
    instructions: Instructions,
    access: impl for<'a> Fn(&'a mut Ui) -> &'a mut TextEdit + Clone + 'static,
) -> El {
    let Instructions {
        key,
        title,
        note,
        placeholder,
        edit,
        busy,
        status,
    } = instructions;
    let length = edit.text.trim().chars().count();
    let long = length > INSTRUCTIONS_LIMIT;
    let mut editor = text_input(edit, font(13.0, 400.0).lh(22.0))
        .key(key)
        .label(title)
        .w_full()
        .color(t.foreground)
        .placeholder(placeholder, t.muted_foreground)
        .caret(t.foreground, t.selection())
        .disabled(busy);
    if !busy {
        let line = access.clone();
        editor = editor
            .on_edit(access)
            // Return starts a new line instead of submitting.
            .on_submit(move |s: &mut Ui, _: &mut Tx| line(s).insert("\n"));
    }
    let border = if long {
        t.error
    } else if edit.focused && !busy {
        t.accent
    } else {
        t.border
    };
    let count = text(format!(
        "{} / {} · They say how to work and grant nothing.",
        thousands(length),
        thousands(INSTRUCTIONS_LIMIT),
    ))
    .key(format!("{key}-count"))
    .font(font(11.0, 400.0))
    .color(if long { t.error } else { t.muted_foreground })
    .wrap();
    let foot = row()
        .w_full()
        .gap(12.0)
        .center_y()
        .flex_wrap()
        .child(col().grow(1.0).min_w(200.0).child(count));
    section(
        t,
        title,
        note,
        col()
            .w_full()
            .gap(10.0)
            // The personality's editor, so the two read as one kind of text.
            .child(
                col()
                    .w_full()
                    .radius(8.0)
                    .border(1.0, border)
                    .border_layout()
                    .clip_rounded(7.0)
                    .child(
                        row()
                            .w_full()
                            .px(14.0)
                            .py(11.0)
                            .gap(10.0)
                            .justify_end()
                            .center_y()
                            .fill(t.muted)
                            .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
                            .child(
                                text(status)
                                    .key(format!("{key}-status"))
                                    .font(font(10.0, 400.0))
                                    .color(t.muted_foreground),
                            ),
                    )
                    .child(
                        col()
                            .key(format!("{key}-box"))
                            .w_full()
                            .min_h(270.0)
                            .padding(16.0)
                            .fill(t.card)
                            .child(editor)
                            // A press on the empty part of the box puts the caret in.
                            .on_press_tx(move |_: &mut Ui, tx: &mut Tx| tx.focus(key, false)),
                    ),
            )
            .child(foot),
    )
}

/// 16000 as "16,000".
fn thousands(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}
