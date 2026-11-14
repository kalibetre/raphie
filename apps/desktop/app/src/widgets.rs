//! The small controls every screen shares, drawn like the web workspace's
//! (its shadcn `Button` and `Input`, and a few classes from its CSS).
//!
//! The web's root font size is 14 px, so its Tailwind sizes (written in rem)
//! come out at 14/16 of their usual pixels: an `h-8` button is 28 pt tall,
//! `text-sm` is 12.25 pt. That is where the odd numbers below come from.
//!
//! Each is a plain function that returns an element. Rune elements are
//! builders: `row().h(32.0).fill(colour)` makes a new value at each step, so a
//! function can return a half-finished element and the caller can keep going
//! (`.key("rd-send")`, a press handler).

use rune::{Align, Color, El, Icon, TextEdit, Tx, col, el, icon, row, text, text_input};

use crate::state::Ui;
use crate::theme::{Theme, font};

/// How a button is painted (the web's `variant`).
#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    /// Filled with the primary colour: the one main action.
    Primary,
    /// A bordered button on the page colour: the alternative.
    Outline,
    /// No fill until hovered: toolbar actions.
    Ghost,
}

/// A button's height and padding (the web's `size`).
#[derive(Clone, Copy, PartialEq)]
pub enum Size {
    /// 28 pt: beside other controls (`size="sm"`).
    Small,
    /// 31.5 pt (the default).
    Regular,
    /// 38.5 pt: the sign-in form (`h-11`).
    Large,
}

/// A button with a label and an optional icon before it. It only looks like
/// a button until the caller gives it a handler with [`pressable`].
pub fn button(t: &Theme, kind: Kind, size: Size, glyph: Option<&'static Icon>, label: &str) -> El {
    let (height, pad, gap, radius) = match size {
        // A small button with an icon has a little less padding.
        Size::Small if glyph.is_some() => (28.0, 8.75, 5.25, 7.0),
        Size::Small => (28.0, 10.5, 5.25, 7.0),
        Size::Regular => (31.5, 14.0, 7.0, 7.0),
        Size::Large => (38.5, 14.0, 7.0, 10.5),
    };
    let ink = match kind {
        Kind::Primary => t.primary_foreground,
        Kind::Outline | Kind::Ghost => t.foreground,
    };
    let mut e = row()
        .role("button")
        .label(label)
        .h(height)
        .px(pad)
        .gap(gap)
        .center()
        .radius(radius);
    e = paint(t, e, kind);
    if let Some(glyph) = glyph {
        e = e.child(icon(glyph, 14.0).color(ink).a11y_hidden());
    }
    e.child(text(label).font(BUTTON_FONT).color(ink).a11y_hidden())
}

/// Tailwind's `text-sm font-medium` at the web's root size.
const BUTTON_FONT: rune::TextStyle = rune::TextStyle::new(12.25, 500.0).lh(17.5);

/// A square button showing only an icon; `label` names it for screen readers
/// and is its tooltip.
pub fn icon_button(t: &Theme, glyph: &'static Icon, glyph_size: f32, label: &str) -> El {
    let e = row()
        .role("button")
        .label(label)
        .help(label)
        .size(28.0, 28.0)
        .center()
        .radius(7.0)
        .child(icon(glyph, glyph_size).color(t.foreground).a11y_hidden());
    paint(t, e, Kind::Ghost)
}

/// The fill, border, hover and focus look of one button kind.
fn paint(t: &Theme, e: El, kind: Kind) -> El {
    let e = match kind {
        Kind::Primary => e
            .fill(t.primary)
            // `hover` and `press` draw a colour over the fill.
            .hover(t.background.alpha(0.1))
            .press(t.background.alpha(0.2)),
        Kind::Outline => e
            .fill(t.background)
            .border(1.0, outline_border(t))
            .hover(t.hover.alpha(0.6))
            .press(t.hover),
        Kind::Ghost => e.hover(t.hover).press(t.hover),
    };
    // The web's `:focus-visible`: a ring only when focus came from the keyboard.
    e.focus_ring(2.0, 2.0, t.accent)
}

fn outline_border(t: &Theme) -> Color {
    // The web gives dark-mode outline buttons a stronger edge, since the
    // border colour nearly matches the card there.
    if t.dark {
        t.foreground.alpha(0.2)
    } else {
        t.border
    }
}

/// Makes `e` do `action` when pressed, or look and act disabled.
///
/// `impl Fn(&mut Ui) + 'static` reads: any closure that takes the state by
/// mutable reference and borrows nothing short-lived (`'static`), because
/// Rune keeps it until the next frame and runs it then.
pub fn pressable(e: El, enabled: bool, action: impl Fn(&mut Ui) + 'static) -> El {
    if enabled {
        e.on_press(action)
    } else {
        // The web's `disabled:opacity-50`.
        e.disabled(true).layer_opacity(0.5)
    }
}

/// A small rounded count, like the web's `.reply-count`.
pub fn count_badge(t: &Theme, count: usize) -> El {
    row()
        .min_w(17.0)
        .px(5.0)
        .py(1.0)
        .center()
        .radius(9.0)
        .fill(t.accent_soft)
        .child(
            text(count.to_string())
                .font(font(10.0, 550.0))
                .color(t.accent),
        )
}

/// The green "connected" dot with its soft ring (`.status-dot`), amber when
/// `online` is false.
pub fn status_dot(t: &Theme, online: bool) -> El {
    let (dot, ring) = if online {
        (t.accent, t.accent_soft)
    } else {
        (t.attention, t.attention_soft)
    };
    el().size(7.0, 7.0)
        .radius(3.5)
        .fill(dot)
        .outline(3.0, 0.0, ring)
        .a11y_hidden()
}

/// What a [`text_field`] shows. A struct rather than five more arguments, so
/// the call site names each one. `<'a>` says the struct only borrows these
/// values, for as long as the borrow called `'a` lasts.
pub struct Field<'a> {
    pub key: &'a str,
    /// The field's name for screen readers.
    pub label: &'a str,
    pub placeholder: &'a str,
    /// The text and caret, read from `Ui`.
    pub edit: &'a TextEdit,
    pub disabled: bool,
    /// The settings forms' shorter field (the web's default `Input`);
    /// otherwise the sign-in form's taller one.
    pub compact: bool,
}

/// A one-line text field in a bordered box, like the sign-in form's inputs.
///
/// `access` tells Rune where the field's state lives so typing can change
/// it; `submit` runs on Return. Both are `fn` pointers (plain functions or
/// closures that capture nothing), which keeps this signature free of
/// generics.
pub fn text_field(
    t: &Theme,
    field: Field,
    access: fn(&mut Ui) -> &mut TextEdit,
    submit: fn(&mut Ui, &mut Tx),
) -> El {
    let Field {
        key,
        label,
        placeholder,
        edit,
        disabled,
        compact,
    } = field;
    let (height, radius) = if compact { (31.5, 7.0) } else { (38.5, 10.5) };
    let input_key = format!("{key}-input");
    let mut input = text_input(edit, font(12.25, 400.0))
        .single_line()
        .key(input_key.clone())
        .label(label)
        .grow(1.0)
        .min_w(0.0)
        .color(t.foreground)
        .placeholder(placeholder, t.muted_foreground)
        .caret(t.foreground, t.selection())
        .disabled(disabled);
    if !disabled {
        input = input.on_edit(access).on_submit(submit);
    }
    let focused = edit.focused && !disabled;
    let mut field = row()
        .key(key)
        .w_full()
        .h(height)
        .px(10.5)
        .center_y()
        .radius(radius)
        .fill(t.background.alpha(0.5))
        .border(1.0, if focused { t.accent } else { t.border })
        .child(input);
    if focused {
        // The web's focus ring: three soft points outside the border.
        field = field.outline(3.0, 0.0, t.accent.alpha(0.3));
    }
    if disabled {
        field.layer_opacity(0.5)
    } else {
        // A press on the box's padding focuses the text inside it.
        field.on_press_tx(move |_: &mut Ui, tx: &mut Tx| tx.focus(input_key.clone(), false))
    }
}

/// A caption over a control, like the web form's `<label>`.
pub fn labelled(t: &Theme, label: &str, control: El) -> El {
    col()
        .w_full()
        .gap(5.25)
        .child(text(label).font(BUTTON_FONT).color(t.foreground))
        .child(control)
}

/// One line of quiet text, cut with an ellipsis if it does not fit.
pub fn one_line(content: impl Into<String>, style: rune::TextStyle, color: Color) -> El {
    text(content).font(style).color(color).truncate()
}

/// Wrapped, centred text.
pub fn centered(content: impl Into<String>, style: rune::TextStyle, color: Color) -> El {
    text(content)
        .font(style)
        .color(color)
        .wrap()
        .align(Align::Center)
}
