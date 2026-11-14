//! The web workspace's design tokens, so the desktop app looks like it.
//!
//! In sync with `apps/web/src/shared/styles/tokens.css`: the names are the CSS
//! custom properties (`--background` is `background`, `--muted-foreground` is
//! `muted_foreground`), and the values are copied from there. Change a colour
//! in both places. Sizes that the web sets per component (a 72 pt header, a
//! 264 pt roster) live next to the component in `view/`.

use rune::color::hex;
use rune::{Color, Family, Shadow, TextStyle};
use rune_kit::{Kit, MarkdownStyle, PaletteSeed};

/// Every colour the views use. Built fresh on each `view` call for the
/// current appearance; it is a handful of numbers, so that costs nothing.
pub struct Theme {
    pub dark: bool,
    /// The conversation's backdrop.
    pub background: Color,
    /// The bot roster and the conversations panel.
    pub sidebar: Color,
    /// Raised surfaces: the composer, cards, code blocks.
    pub card: Color,
    pub foreground: Color,
    /// Quiet fills: the owner's message bubble, inline code.
    pub muted: Color,
    pub hover: Color,
    pub muted_foreground: Color,
    /// The quietest text: timestamps, hints.
    pub faint: Color,
    pub border: Color,
    /// The main button: near-black in light mode, near-white in dark.
    pub primary: Color,
    pub primary_foreground: Color,
    /// Raphie's green: links, focus rings, "working" and "done".
    pub accent: Color,
    pub accent_soft: Color,
    /// Amber: something is waiting for the owner.
    pub attention: Color,
    pub attention_soft: Color,
    pub error: Color,
    /// `--shadow`: cards.
    pub shadow: [Shadow; 2],
    /// `--composer-shadow`: the floating composer.
    pub composer_shadow: [Shadow; 2],
}

impl Theme {
    pub fn new(dark: bool) -> Theme {
        if dark { Theme::dark() } else { Theme::light() }
    }

    fn light() -> Theme {
        Theme {
            dark: false,
            background: color("#f7f5ef"),
            sidebar: color("#ebe8de"),
            card: color("#fdfcf8"),
            foreground: color("#24231f"),
            muted: color("#efece4"),
            hover: color("#e2ded2"),
            muted_foreground: color("#6f6b61"),
            faint: color("#656156"),
            border: color("#dcd8cc"),
            primary: color("#24231f"),
            primary_foreground: color("#f7f5ef"),
            accent: color("#4a7a57"),
            accent_soft: color("#dfe8dc"),
            attention: color("#a2670f"),
            attention_soft: color("#f6e8cc"),
            error: color("#b13e32"),
            shadow: [drop(1.0, 2.0, "#2a24140a"), drop(8.0, 24.0, "#2a24140d")],
            composer_shadow: [drop(2.0, 4.0, "#2a24141a"), drop(12.0, 32.0, "#2a24142e")],
        }
    }

    fn dark() -> Theme {
        Theme {
            dark: true,
            background: color("#1c1b18"),
            sidebar: color("#161512"),
            card: color("#24231f"),
            foreground: color("#ebe8df"),
            muted: color("#2a2924"),
            hover: color("#33312b"),
            muted_foreground: color("#a29d91"),
            faint: color("#a29d91"),
            border: color("#36342e"),
            primary: color("#ebe8df"),
            primary_foreground: color("#1c1b18"),
            accent: color("#7fb08b"),
            accent_soft: color("#263228"),
            attention: color("#e0a54a"),
            attention_soft: color("#3a2f1b"),
            error: color("#e07a6e"),
            shadow: [drop(1.0, 2.0, "#00000066"), drop(8.0, 24.0, "#00000055")],
            composer_shadow: [drop(2.0, 4.0, "#00000099"), drop(12.0, 32.0, "#000000aa")],
        }
    }

    /// The highlight behind selected text.
    pub fn selection(&self) -> Color {
        self.accent.alpha(0.28)
    }

    /// A rune-kit `Kit` in these colours, for the two kit components the app
    /// uses as they are: `Markdown` and `Loader`.
    pub fn kit(&self) -> Kit {
        Kit::from_palette(PaletteSeed {
            bg: self.background,
            fg: self.foreground,
            accent: self.accent,
        })
    }

    /// Replies, styled as `.markdown` in the web's `chat.css`.
    pub fn markdown(&self, kit: &Kit) -> MarkdownStyle {
        let heading = TextStyle::new(15.0, 700.0).lh(22.5);
        MarkdownStyle::from_kit(kit)
            .text(self.foreground)
            .muted(self.muted_foreground)
            .link(self.accent)
            .link_underline(self.accent.alpha(0.45))
            .inline_code_bg(self.muted)
            .code_block(self.card, self.border)
            .code_block_padding(14.0, 12.0)
            .code_block_font(mono(12.5).lh(19.0))
            // 14 px at the web's `line-height: 1.65`.
            .body_font(font(14.0, 400.0).lh(23.0))
            .heading_font(1, heading)
            .heading_font(2, heading)
            .heading_font(3, heading)
            .strong_weight(700.0)
            .list(22.0, 3.0)
            .rule(self.border)
            .table(self.border, self.muted)
            .selection(self.selection())
    }
}

/// Inter (Rune's built-in sans, the web's font) at the web's default
/// `line-height: 1.5`, so rows come out the same height as in the browser.
pub const fn font(size: f32, weight: f32) -> TextStyle {
    TextStyle::new(size, weight).lh(size * 1.5)
}

/// The platform's monospace (SF Mono on macOS), as the web's `code` uses.
pub const fn mono(size: f32) -> TextStyle {
    TextStyle::new(size, 400.0)
        .family(Family::SystemMono)
        .lh(size * 1.5)
}

/// A `#rrggbb` or `#rrggbbaa` literal from this file.
fn color(literal: &str) -> Color {
    // `expect` panics with this message if the literal is malformed. That is
    // right for a typo in a constant: it fails the first test that draws.
    hex(literal).expect("theme colours are valid hex")
}

/// One layer of a CSS `box-shadow: 0 <y> <blur> <colour>`.
fn drop(y: f32, blur: f32, literal: &str) -> Shadow {
    Shadow {
        y,
        blur,
        color: color(literal),
        // `..Default::default()` fills the fields not named here (x, spread,
        // inset) with their defaults.
        ..Shadow::default()
    }
}
