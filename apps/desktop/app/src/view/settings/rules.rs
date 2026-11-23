//! Standing rules, one a line: what the owner wants done every time. Shown
//! on Settings → You for every bot and on a bot's Profile for that bot.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/rules-field.tsx`.
//! The parsing and the limits live in `raphie_core::rules`.

use raphie_core::rules::{MAX_RULES, rules_of, rules_problem};
use rune::{El, TextEdit, Tx, col, text, text_input};

use super::profile::section;
use crate::state::Ui;
use crate::theme::{Theme, font};

/// One rules card: where it is, what it says, and the text being edited.
pub struct Rules<'a> {
    /// The editor's key; its box and count line are named after it.
    pub key: &'static str,
    pub title: &'static str,
    pub note: &'static str,
    pub placeholder: &'static str,
    pub edit: &'a TextEdit,
    pub busy: bool,
}

/// The card. `access` tells Rune where the text lives, as for
/// `text_field`; it is used twice, so it must be `Clone`.
pub fn rules_field(
    t: &Theme,
    rules: Rules,
    access: impl for<'a> Fn(&'a mut Ui) -> &'a mut TextEdit + Clone + 'static,
) -> El {
    let Rules {
        key,
        title,
        note,
        placeholder,
        edit,
        busy,
    } = rules;
    let listed = rules_of(&edit.text);
    let problem = rules_problem(&listed);
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
            // Return starts the next rule instead of submitting.
            .on_submit(move |s: &mut Ui, _: &mut Tx| line(s).insert("\n"));
    }
    let border = if problem.is_some() {
        t.error
    } else if edit.focused && !busy {
        t.accent
    } else {
        t.border
    };
    let count = match &problem {
        Some(problem) => text(problem.clone()).color(t.error),
        None => text(format!(
            "One rule a line · {} of {MAX_RULES} · Rules say how to work and grant nothing.",
            listed.len()
        ))
        .color(t.muted_foreground),
    };
    section(
        t,
        title,
        note,
        col()
            .w_full()
            .gap(10.0)
            .child(
                col()
                    .key(format!("{key}-box"))
                    .w_full()
                    .min_h(128.0)
                    .padding(12.0)
                    .radius(8.0)
                    .fill(t.background.alpha(0.5))
                    .border(1.0, border)
                    .child(editor)
                    // A press on the empty part of the box puts the caret in.
                    .on_press_tx(move |_: &mut Ui, tx: &mut Tx| tx.focus(key, false)),
            )
            .child(
                count
                    .key(format!("{key}-count"))
                    .font(font(11.0, 400.0))
                    .wrap(),
            ),
    )
}
