//! The app's icon, drawn by the app itself.
//!
//! No image file is kept in the repository. `scripts/bundle.sh` runs the
//! debug program once with `RAPHIE_ICON=dev` (or `release`) and Rune's
//! `--snap`, which renders [`spec`] to a PNG with no window, and macOS's
//! own tools turn that into the bundle's `.icns`. The debug program draws
//! both icons because only debug builds have Rune's `--snap`.
//!
//! The icon is the brand face on a dark tile: sage for the release build,
//! amber for the dev build, so the two are told apart in the Dock.

use raphie_core::flavor::Flavor;
use rune::color::hex;
use rune::{AppSpec, Color, Cx, El, col, el};

use crate::avatar::{Tone, bot_avatar};

/// The side of the drawing, in points. macOS's largest icon is 1024 px.
const CANVAS: f32 = 1024.0;

/// Apple's icon grid: the tile fills 824 of the 1024, leaving a clear
/// margin, and its corners have this radius.
const TILE: f32 = 824.0;
const TILE_RADIUS: f32 = 185.0;

/// The side of the face's box. The face itself fills about two thirds of it.
const FACE: f32 = 760.0;

/// True when this run was asked to draw the icon instead of opening the app.
pub fn requested() -> bool {
    std::env::var_os("RAPHIE_ICON").is_some()
}

/// Which icon was asked for: `RAPHIE_ICON=release` draws the release one,
/// any other value the dev one.
fn requested_flavor() -> Flavor {
    match std::env::var("RAPHIE_ICON").as_deref() {
        Ok("release") => Flavor::Release,
        _ => Flavor::Dev,
    }
}

/// A one-screen app that is only the icon. Its state is the flavor whose
/// icon it draws.
pub fn spec() -> AppSpec<Flavor> {
    AppSpec {
        // No floor, so the 1024 square is not stretched to a window's
        // usual minimum.
        min_size: Some((0.0, 0.0)),
        ..AppSpec::new("Raphie icon", (CANVAS, CANVAS), requested_flavor, view)
    }
}

/// The face's colours for a flavor.
pub fn tone(flavor: Flavor) -> Tone {
    let body = match flavor {
        // The web's Sage and Amber avatar colours.
        Flavor::Release => "#b5c99b",
        Flavor::Dev => "#e3b477",
    };
    Tone {
        body: color(body),
        eye: color("#273329"),
    }
}

// `_cx` is Rune's per-frame context; this drawing needs nothing from it.
fn view(flavor: &Flavor, _cx: &mut Cx<Flavor>) -> El {
    // Nothing is filled outside the tile, so the corners stay transparent.
    col().w_full().h_full().center().child(
        col()
            .size(TILE, TILE)
            .radius(TILE_RADIUS)
            // The dark theme's sidebar colour.
            .fill(color("#161512"))
            .center()
            .child(el().child(bot_avatar("default", tone(*flavor), FACE))),
    )
}

fn color(value: &str) -> Color {
    hex(value).unwrap_or(Color::BLACK)
}
