//! The pieces every Settings page is built from: the tinted header, titled
//! groups, and rows inside a group's card.
//!
//! Mirrors `settings-page.tsx` and `settings-group.tsx`, and the rules in
//! `shared/styles/settings/page.css` and `forms.css`.

use raphie_core::engine::Command;
use rune::{Color, El, Icon, col, el, icon, row, text};

use crate::avatar::{Tone, bot_avatar};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Kind, Size, button, centered, pressable};

/// The widest a Settings page gets, padding included.
const PAGE_WIDTH: f32 = 808.0;

/// Whose settings a page changes: one bot's, or the whole app's.
pub enum Scope<'a> {
    Bot { id: &'a str, name: &'a str },
    App,
}

/// A page: its header, then its groups, in a centred column.
pub fn page(key: &str, title: &str, lede: &str, scope: Scope, groups: Vec<El>, look: &Look) -> El {
    col()
        .key(key)
        .w_full()
        .max_w(PAGE_WIDTH)
        .px(44.0)
        .pt(36.0)
        .pb(32.0)
        .gap(28.0)
        .child(hero(title, lede, scope, look))
        .children(groups)
}

/// The top of every page. Bot pages wash in the bot's colour, so whose
/// settings these are is visible before any field; app pages use the accent.
fn hero(title: &str, lede: &str, scope: Scope, look: &Look) -> El {
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
    let mut card = col()
        .w_full()
        .radius(14.0)
        .fill(t.card)
        .border(1.0, t.border)
        .border_layout()
        .shadow(1.0, 2.0, t.shadow[0].color);
    for (index, row) in rows.into_iter().enumerate() {
        // A hairline between rows, not above the first.
        card = card.child(if index == 0 {
            row
        } else {
            row.border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        });
    }
    col()
        .w_full()
        .gap(10.0)
        .child(
            col()
                .px(2.0)
                .gap(3.0)
                .child(
                    text(title)
                        .role("heading")
                        .font(font(13.5, 600.0).tracking(-0.1))
                        .color(t.foreground),
                )
                .child(
                    text(note)
                        .font(font(12.5, 400.0).lh(19.4))
                        .color(t.muted_foreground)
                        .wrap(),
                ),
        )
        .child(card)
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
