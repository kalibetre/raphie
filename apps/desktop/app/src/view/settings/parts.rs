//! The pieces every Settings page is built from: the tinted header, titled
//! groups, rows inside a group's card, and the save bar.
//!
//! Mirrors `settings-page.tsx`, `settings-group.tsx` and `save-bar.tsx`, and
//! the rules in
//! `shared/styles/settings/page.css` and `forms.css`.

use raphie_core::engine::Command;
use rune::{Color, El, Icon, Shadow, col, el, icon, row, text};

use crate::avatar::{Tone, bot_avatar};
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Kind, Size, button, centered, pressable};

/// The widest a Settings page gets, padding included.
const PAGE_WIDTH: f32 = 808.0;

/// Whose settings a page changes: one bot's, or the whole app's.
pub enum Scope<'a> {
    Bot {
        id: &'a str,
        name: &'a str,
    },
    App,
    /// A bot that does not exist yet ("Create a bot").
    NewBot,
}

/// A page: its header, then its groups, in a centred column.
pub fn page(key: &str, title: &str, lede: &str, scope: Scope, groups: Vec<El>, look: &Look) -> El {
    sub_page(key, title, lede, scope, None, groups, look)
}

/// A [`page`] reached from inside another one. `back` is the link to that
/// page, shown over the title (see [`back_link`]).
pub fn sub_page(
    key: &str,
    title: &str,
    lede: &str,
    scope: Scope,
    back: Option<El>,
    groups: Vec<El>,
    look: &Look,
) -> El {
    col()
        .key(key)
        .w_full()
        .max_w(PAGE_WIDTH)
        .px(44.0)
        .pt(36.0)
        .pb(32.0)
        .gap(28.0)
        .child(hero(title, lede, scope, back, look))
        .children(groups)
}

/// "← Memory": the way back from a sub-page (the web's `.settings-back`).
/// Give it a handler with [`pressable`].
pub fn back_link(t: &Theme, label: &str) -> El {
    row()
        .role("button")
        .label(format!("Back to {label}"))
        .h(28.0)
        .px(8.0)
        .gap(4.0)
        .center_y()
        .radius(7.0)
        .hover(t.hover)
        .press(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        // Its text lines up with the title under it, not its padding.
        .ml(-8.0)
        .mb(4.0)
        .self_start()
        .child(
            icon(&crate::icons::ARROW_LEFT, 14.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(
            text(label)
                .font(font(12.5, 500.0))
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
}

/// The top of every page. Bot pages wash in the bot's colour, so whose
/// settings these are is visible before any field; app pages use the accent.
fn hero(title: &str, lede: &str, scope: Scope, back: Option<El>, look: &Look) -> El {
    let t = &look.theme;
    let (tone, avatar_id, tag) = match scope {
        Scope::Bot { id, name } => (look.tones.of(id), id, format!("{name} only")),
        Scope::App => (
            Tone {
                body: t.accent,
                eye: t.accent,
            },
            "default",
            "App-wide".to_owned(),
        ),
        Scope::NewBot => (
            Tone {
                body: t.accent,
                eye: t.accent,
            },
            "default",
            "New bot".to_owned(),
        ),
    };
    let wash = tone.body;
    row()
        .w_full()
        .pl(22.0)
        .pr(20.0)
        .py(18.0)
        .gap(16.0)
        .justify_between()
        .items_start()
        .radius(16.0)
        .fill(t.card)
        .border(1.0, t.border.mix(wash, 0.34))
        // Children are laid out inside the border and cut to its corners.
        .border_layout()
        .clip_rounded(15.0)
        // The colour fades in from the top-left corner.
        .radial_gradient(
            [0.0, 0.0],
            [860.0, 150.0],
            [(0.0, wash.alpha(0.26)), (0.62, wash.alpha(0.0))],
        )
        .child(
            // A soft blob peeking in from the top-right corner.
            el().pin(None, Some(-48.0), Some(-34.0), None)
                .size(120.0, 120.0)
                .radius(56.0)
                .fill(wash.alpha(0.2))
                .a11y_hidden(),
        )
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .gap(4.0)
                // `children` takes any number of elements; an `Option` is
                // none or one.
                .children(back)
                .child(
                    text(title)
                        .role("heading")
                        .font(font(22.0, 600.0).tracking(-0.5).lh(26.4))
                        .color(t.foreground),
                )
                .child(
                    text(lede)
                        .font(font(13.0, 400.0).lh(20.0))
                        .color(t.muted_foreground)
                        .wrap()
                        .max_w(560.0),
                ),
        )
        .child(
            // "Raphie only" or "App-wide".
            row()
                .pl(3.0)
                .pr(11.0)
                .py(3.0)
                .gap(8.0)
                .center_y()
                .radius(14.0)
                .fill(t.card.mix(wash, 0.18))
                .border(1.0, wash.alpha(0.4))
                .child(bot_avatar(avatar_id, look.tones.of(avatar_id), 22.0))
                .child(text(tag).font(font(11.5, 560.0)).color(t.foreground)),
        )
}

/// A titled group: a heading with a note, then a card of rows.
pub fn group(t: &Theme, title: &str, note: &str, rows: Vec<El>) -> El {
    group_with(t, title, note, None, rows)
}

/// A [`group`] with a control beside its title ("Browse memories").
pub fn group_with(t: &Theme, title: &str, note: &str, action: Option<El>, rows: Vec<El>) -> El {
    let head = group_heading(t, title, note, action);
    let mut card = col()
        .w_full()
        .radius(14.0)
        .fill(t.card)
        .border(1.0, t.border)
        .border_layout()
        // Rows with a fill of their own are cut to the card's corners.
        .clip_rounded(13.0)
        .shadow(1.0, 2.0, t.shadow[0].color);
    for (index, row) in rows.into_iter().enumerate() {
        // A hairline between rows, not above the first.
        card = card.child(if index == 0 {
            row
        } else {
            row.border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        });
    }
    col().w_full().gap(10.0).child(head).child(card)
}

/// A group's title and note, with an optional control beside them. For a
/// section that lists its content without a card ("Run history").
pub fn group_heading(t: &Theme, title: &str, note: &str, action: Option<El>) -> El {
    let mut heading = col().grow(1.0).min_w(0.0).gap(3.0).child(
        text(title)
            .role("heading")
            .font(font(13.5, 600.0).tracking(-0.1))
            .color(t.foreground),
    );
    // A group may have no note ("Persistent workspace").
    if !note.is_empty() {
        heading = heading.child(
            text(note)
                .font(font(12.5, 400.0).lh(19.4))
                .color(t.muted_foreground)
                .wrap(),
        );
    }
    // The action sits level with the bottom of the heading, as on the web.
    let mut head = row().w_full().px(2.0).gap(12.0).items_end().child(heading);
    if let Some(action) = action {
        head = head.child(action);
    }
    head
}

/// One setting inside a group: an optional icon tile, a title over a
/// description, then its control on the right.
pub fn setting(
    t: &Theme,
    glyph: Option<&'static Icon>,
    title: &str,
    description: &str,
    control: Option<El>,
) -> El {
    let mut line = row().w_full().px(18.0).py(14.0).gap(16.0).center_y();
    if let Some(glyph) = glyph {
        line = line.child(
            row()
                .size(32.0, 32.0)
                .center()
                .radius(9.0)
                .fill(t.muted)
                .child(icon(glyph, 16.0).color(t.muted_foreground).a11y_hidden()),
        );
    }
    line = line.child(
        col()
            .grow(1.0)
            .min_w(0.0)
            .gap(2.0)
            .child(text(title).font(font(13.5, 560.0)).color(t.foreground))
            .child(
                text(description)
                    .font(font(12.5, 400.0))
                    .color(t.muted_foreground)
                    .wrap(),
            ),
    );
    match control {
        Some(control) => line.child(control),
        None => line,
    }
}

/// A card that says what is happening instead of a page's content: loading,
/// failed, or nothing here yet (the web's `SettingsStatus`).
pub fn status(t: &Theme, title: &str, message: &str, action: Option<El>) -> El {
    let mut card = col()
        .key("rd-settings-status")
        .w_full()
        .padding(24.0)
        .gap(8.0)
        .items_center()
        .radius(12.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(text(title).font(font(14.0, 600.0)).color(t.foreground))
        .child(centered(message, font(12.5, 400.0), t.muted_foreground));
    if let Some(action) = action {
        card = card.child(action.mt(6.0));
    }
    card
}

/// A bot's settings are still loading, or the load failed and can be tried
/// again. `what` is the plural the page is about ("models", "providers").
pub fn settings_loading(s: &Ui, bot_id: &str, title: &str, what: &str, t: &Theme) -> El {
    // The error names the bot it was for, so an old failure for another bot
    // is not shown here.
    let failed = s
        .model
        .settings_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, title, &format!("Loading {what}…"), None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        title,
        &format!("Could not load {what}. Check your connection to Raphie."),
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-settings-retry"),
            true,
            move |s: &mut Ui| {
                s.model.settings_error = None;
                s.command(Command::LoadSettings {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// A read-only value on a row's right (the web's `.settings-value`).
pub fn value(content: impl Into<String>, color: Color) -> El {
    text(content).font(font(12.5, 500.0)).color(color)
}

/// What a [`save_bar`] says and allows. `key` prefixes the keys of its
/// parts (`rd-profile` gives `rd-profile-save`, `rd-profile-status`, ...).
pub struct SaveBar<'a> {
    pub key: &'a str,
    /// Why saving failed or cannot happen, shown in red above the status.
    pub error: Option<String>,
    pub status: String,
    pub save_label: &'a str,
    pub can_save: bool,
    pub can_discard: bool,
    /// One more button after Save, such as Cancel on "Create a bot".
    pub extra: Option<El>,
}

/// The bar docked under a page once there is something to save or report,
/// so clean pages stay quiet. `discard` and `save` are `fn` pointers: plain
/// functions or closures that capture nothing.
pub fn save_bar(t: &Theme, bar: SaveBar, discard: fn(&mut Ui), save: fn(&mut Ui)) -> El {
    let line =
        |content: String, color: Color| text(content).font(font(12.5, 500.0)).color(color).wrap();
    let key = bar.key;
    let mut copy = col().grow(1.0).min_w(0.0).gap(2.0);
    if let Some(error) = bar.error {
        copy = copy.child(line(error, t.error).key(format!("{key}-error")));
    }
    copy = copy.child(
        row()
            .gap(8.0)
            .center_y()
            .child(el().size(6.0, 6.0).radius(3.0).fill(t.accent).a11y_hidden())
            .child(
                line(bar.status, t.foreground)
                    .key(format!("{key}-status"))
                    .shrink(),
            ),
    );
    row()
        .key("rd-save-bar")
        .w_full()
        .px(44.0)
        .py(14.0)
        .gap(12.0)
        .center_y()
        .fill(t.card)
        .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        // A soft shadow upwards, so the page seems to slide under it.
        .box_shadow(Shadow {
            y: -12.0,
            blur: 28.0,
            spread: -20.0,
            color: Color::BLACK.alpha(0.3),
            ..Shadow::default()
        })
        .child(copy)
        // The web puts the extra action before Discard. `children` takes any
        // number of elements; an `Option` is none or one.
        .children(bar.extra)
        .child(pressable(
            button(t, Kind::Ghost, Size::Regular, None, "Discard").key(format!("{key}-discard")),
            bar.can_discard,
            discard,
        ))
        .child(pressable(
            button(t, Kind::Primary, Size::Regular, None, bar.save_label)
                .key(format!("{key}-save")),
            bar.can_save,
            save,
        ))
}

/// The amber box that says something needs the owner (the web's
/// `.channel-alert`).
pub fn alert(t: &Theme, key: &str, title: &str, message: &str) -> El {
    alert_with(t, key, title, message, None)
}

/// [`alert`] with buttons under its message.
pub fn alert_with(t: &Theme, key: &str, title: &str, message: &str, actions: Option<El>) -> El {
    let mut body = col()
        .grow(1.0)
        .min_w(0.0)
        .gap(3.0)
        .child(text(title).font(font(13.0, 600.0)).color(t.foreground))
        .child(
            text(message)
                .key(format!("{key}-message"))
                .font(font(13.0, 400.0).lh(19.5))
                .color(t.foreground)
                .wrap(),
        );
    if let Some(actions) = actions {
        body = body.child(actions.mt(8.0));
    }
    row()
        .key(key)
        .role("alert")
        .w_full()
        .padding(14.0)
        .gap(12.0)
        .items_start()
        .radius(10.0)
        .fill(t.attention_soft)
        .border(1.0, t.border.mix(t.attention, 0.35))
        .child(
            row()
                .size(32.0, 32.0)
                .center()
                .radius(8.0)
                .fill(t.attention.alpha(0.14))
                .child(
                    icon(&icons::TRIANGLE_ALERT, 18.0)
                        .color(t.attention)
                        .a11y_hidden(),
                ),
        )
        .child(body)
}
