//! Settings → Appearance: light, dark or the system's, and the version.
//!
//! Mirrors `appearance-settings.tsx` and the `.theme-*` rules in
//! `shared/styles/settings/page.css`. Each choice previews the workspace in
//! that palette.

use raphie_core::settings::ThemeChoice;
use rune::color::hex;
use rune::{Color, El, col, el, row, text};

use super::parts::{Scope, group, page, setting, value};
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;

/// The choices, with the web's labels.
const CHOICES: [(ThemeChoice, &str, &str); 3] = [
    (ThemeChoice::System, "System", "Follows your device"),
    (ThemeChoice::Light, "Light", "Warm paper"),
    (ThemeChoice::Dark, "Dark", "Evening ink"),
];

pub fn appearance(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let mut choices = row()
        .key("rd-theme-choices")
        .role("radiogroup")
        .label("Theme")
        .w_full()
        .padding(14.0)
        .gap(12.0);
    for (choice, label, hint) in CHOICES {
        choices = choices.child(theme_choice(t, choice, label, hint, s.theme == choice));
    }
    let theme = group(t, "Theme", "Saved on this computer.", vec![choices]);
    let about = group(
        t,
        "About",
        "Information about this installation.",
        vec![setting(
            t,
            Some(&icons::INFO),
            "Raphie Desktop version",
            "The version of this app.",
            // `env!` reads the crate's version from Cargo.toml at compile time.
            Some(value(env!("CARGO_PKG_VERSION"), t.muted_foreground)),
        )],
    );
    page(
        "rd-page-appearance",
        "Appearance",
        "How Raphie looks on this computer, for every bot.",
        Scope::App,
        vec![theme, about],
        look,
    )
}

/// One choice: a small picture of the workspace, a name and a hint.
fn theme_choice(t: &Theme, choice: ThemeChoice, label: &str, hint: &str, chosen: bool) -> El {
    let key = match choice {
        ThemeChoice::System => "rd-theme-system",
        ThemeChoice::Light => "rd-theme-light",
        ThemeChoice::Dark => "rd-theme-dark",
    };
    let mut card = col()
        .key(key)
        .role("radio")
        .label(label)
        // Three equal columns: each takes a third of what is left.
        .grow(1.0)
        .min_w(0.0)
        .px(8.0)
        .pt(8.0)
        .pb(12.0)
        .gap(2.0)
        .radius(14.0)
        .fill(t.background)
        .focus_ring(2.0, 2.0, t.accent)
        .child(preview(choice))
        .child(
            text(label)
                .font(font(13.0, 600.0))
                .color(t.foreground)
                .mx(4.0)
                .mt(10.0),
        )
        .child(
            text(hint)
                .font(font(11.5, 400.0))
                .color(t.muted_foreground)
                .mx(4.0),
        )
        .on_press(move |s: &mut Ui| s.set_theme(choice));
    card = if chosen {
        // The chosen one has an accent edge and a soft ring.
        card.border(1.0, t.accent).outline(3.0, 0.0, t.accent_soft)
    } else {
        card.border(1.0, t.border)
    };
    card
}

/// The little workspace picture: a sidebar rail and two lines of text, in
/// the palette the choice gives. The system one is half light, half dark.
fn preview(choice: ThemeChoice) -> El {
    // These are the web's fixed preview colours, not the current theme's:
    // the picture shows what you would get, whatever you have now.
    let hue = |literal: &str| hex(literal).unwrap_or(Color::BLACK);
    let (paper, rail, ink) = match choice {
        ThemeChoice::Dark => (hue("#1c1b18"), hue("#161512"), hue("#ebe8df")),
        _ => (hue("#f7f5ef"), hue("#ebe8de"), hue("#24231f")),
    };
    let system = choice == ThemeChoice::System;
    let line = if system {
        hue("#a29d9166")
    } else {
        ink.alpha(0.22)
    };
    // Positions are fractions of the picture's width, as in the web's CSS.
    let width = |fraction: f32| el().w_frac(fraction).h_full();
    let mut picture = el()
        .w_full()
        .h(86.0)
        .radius(10.0)
        .clip_rounded(10.0)
        .fill(paper)
        .border(1.0, Color::BLACK.alpha(0.06))
        .a11y_hidden();
    if system {
        // The right half is the dark palette.
        picture = picture.child(
            row()
                .pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
                .child(width(0.5))
                .child(width(0.5).fill(hue("#1c1b18"))),
        );
    }
    let rail_width = if system { 0.14 } else { 0.28 };
    picture
        .child(
            row()
                .pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
                .child(width(rail_width).fill(rail)),
        )
        .child(bar(22.0, 0.48, line))
        .child(bar(38.0, 0.32, hue("#7fb08b")))
}

/// One "line of text" in a preview, `top` points down, starting 36% across.
fn bar(top: f32, width: f32, color: Color) -> El {
    row()
        .pin(Some(0.0), Some(top), Some(0.0), None)
        .h(7.0)
        .child(el().w_frac(0.36))
        .child(el().w_frac(width).h(7.0).radius(4.0).fill(color))
}
