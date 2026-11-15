//! The pieces Diagnostics and Activity share: a heading with its buttons,
//! a filter box, a line of counts, an empty state, and a row that unfolds
//! into its details.
//!
//! Mirrors the `.panel-heading`, `.search-field`, `.journal-meta`,
//! `.activity-empty` and `.event` rules in `shared/styles/activity.css`.

use rune::{El, Icon, TextEdit, Tx, col, el, icon, row, text, text_input};

use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::steps::code_box;
use crate::widgets::{centered, one_line};

/// A list's title and note, with its buttons on the right.
pub fn heading(t: &Theme, title: &str, title_size: f32, note: &str, buttons: El) -> El {
    row()
        .w_full()
        .gap(8.0)
        .justify_between()
        .items_start()
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .gap(2.0)
                .child(
                    text(title)
                        .role("heading")
                        .font(font(title_size, 600.0))
                        .color(t.foreground),
                )
                .child(
                    text(note)
                        .font(font(12.0, 400.0))
                        .color(t.muted_foreground)
                        .wrap(),
                ),
        )
        .child(buttons)
}

/// The filter box. `access` tells Rune where the typed text lives.
pub fn filter_box(
    t: &Theme,
    key: &str,
    label: &str,
    placeholder: &str,
    edit: &TextEdit,
    access: fn(&mut Ui) -> &mut TextEdit,
) -> El {
    let input_key = format!("{key}-input");
    let input = text_input(edit, font(13.0, 400.0))
        .single_line()
        .key(input_key.clone())
        .label(label)
        .grow(1.0)
        .min_w(0.0)
        .color(t.foreground)
        .placeholder(placeholder, t.faint)
        .caret(t.foreground, t.selection())
        .on_edit(access);
    row()
        .key(key)
        .w_full()
        .h(32.0)
        .px(10.0)
        .mt(12.0)
        .gap(8.0)
        .center_y()
        .radius(8.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(icon(&icons::SEARCH, 14.0).color(t.faint).a11y_hidden())
        .child(input)
        // A press on the box's padding focuses the text inside it.
        .on_press_tx(move |_: &mut Ui, tx: &mut Tx| tx.focus(input_key.clone(), false))
}

/// The faint line under the filter: a count on the left, a fact on the
/// right.
pub fn meta(t: &Theme, key: &str, left: String, right: String) -> El {
    let quiet = |content: String| text(content).font(font(11.0, 400.0)).color(t.faint);
    row()
        .w_full()
        .px(2.0)
        .mt(10.0)
        .mb(6.0)
        .gap(8.0)
        .justify_between()
        .child(quiet(left).key(key))
        .child(quiet(right))
}

/// What the list says when it has nothing to show.
pub fn empty(t: &Theme, key: &str, glyph: &'static Icon, title: Option<&str>, message: &str) -> El {
    let mut state = col()
        .key(key)
        .w_full()
        .px(12.0)
        .py(40.0)
        .gap(8.0)
        .items_center()
        .child(icon(glyph, 24.0).color(t.faint).a11y_hidden());
    if let Some(title) = title {
        state = state.child(
            text(title)
                .key(format!("{key}-title"))
                .font(font(12.5, 600.0))
                .color(t.faint),
        );
    }
    state.child(centered(message, font(12.5, 400.0), t.faint))
}

/// One row of a list.
pub struct Entry<'a> {
    /// The row's key; its unfolded details are keyed `<key>-detail`.
    pub key: String,
    /// What happened, cut with an ellipsis if it does not fit.
    pub summary: &'a str,
    /// A quiet fact after the summary, such as a duration.
    pub timing: Option<String>,
    /// When, on the right.
    pub time: String,
    /// Draws the dot in red.
    pub failed: bool,
    pub open: bool,
    /// The facts shown when unfolded: a label and its value.
    pub facts: Vec<(&'static str, String)>,
    /// JSON shown under the facts, laid out for reading.
    pub code: String,
}

/// A row that unfolds into its facts and JSON when pressed (the web's
/// `<details class="event">`). `toggle` flips whether it is unfolded.
pub fn entry(t: &Theme, entry: Entry, toggle: impl Fn(&mut Ui) + 'static) -> El {
    let dot = el()
        .size(6.0, 6.0)
        .radius(3.0)
        .fill(if entry.failed { t.error } else { t.accent })
        .a11y_hidden();
    let mut main = row().grow(1.0).min_w(0.0).gap(8.0).center_y().child(
        one_line(entry.summary.to_owned(), font(12.5, 400.0), t.foreground)
            .grow(1.0)
            .min_w(0.0),
    );
    if let Some(timing) = entry.timing {
        main = main.child(
            text(timing)
                .font(font(12.5, 400.0))
                .color(t.muted_foreground),
        );
    }
    main = main.child(text(entry.time).font(font(11.0, 400.0)).color(t.faint));
    let mut summary = row()
        .key(entry.key.clone())
        .role("button")
        .label(entry.summary.to_owned())
        .expanded(entry.open)
        .focusable(true)
        .w_full()
        .padding(6.0)
        .gap(10.0)
        .center_y()
        .radius(7.0)
        .focus_ring(2.0, -2.0, t.accent)
        .child(dot)
        .child(main)
        .on_press(toggle);
    // An unfolded row stays filled; a folded one fills under the pointer.
    summary = if entry.open {
        summary.fill(t.hover)
    } else {
        summary.hover(t.hover)
    };
    let mut block = col().w_full().child(summary);
    if !entry.open {
        return block;
    }
    let mut facts = col().w_full().gap(3.0).mb(8.0);
    for (label, value) in entry.facts {
        facts = facts.child(
            row()
                .w_full()
                .gap(8.0)
                .items_start()
                .child(text(label).font(font(11.5, 400.0)).color(t.faint).w(74.0))
                .child(
                    text(value)
                        .font(font(11.5, 400.0))
                        .color(t.foreground)
                        .selectable(true)
                        .selection_color(t.selection())
                        .wrap_anywhere()
                        .grow(1.0)
                        .min_w(0.0),
                ),
        );
    }
    block = block.child(
        col()
            .key(format!("{}-detail", entry.key))
            .w_full()
            .pl(16.0)
            .mt(4.0)
            .mb(10.0)
            .child(facts)
            .child(code_box(&format!("{}-code", entry.key), entry.code, t)),
    );
    block
}
