//! The app's icon, drawn by the app itself.
//!
//! No image file is kept in the repository. `scripts/bundle.sh` runs the
//! debug program once with `RAPHIE_ICON=dev` (or `release`, or `nightly`)
//! and Rune's
//! `--snap`, which renders [`spec`] to a PNG with no window, and macOS's
//! own tools turn that into the bundle's `.icns`. The debug program draws
//! both icons because only debug builds have Rune's `--snap`.
//!
//! The icon is the brand face on a dark tile: sage for a stable release,
//! sage under a night sky (a crescent moon and stars on deep indigo) for a
//! nightly, and amber with a "DEV" pill for the dev build, so they are told
//! apart in the Dock.

use raphie_core::flavor::Flavor;
use rune::color::hex;
use rune::{AppSpec, Color, Cx, El, Icon, col, el, icon, row, text};

use crate::avatar::{Tone, bot_avatar};
use crate::theme::font;

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

/// Which icon to draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Stable,
    Nightly,
    Dev,
}

impl Kind {
    fn flavor(self) -> Flavor {
        match self {
            Kind::Stable | Kind::Nightly => Flavor::Release,
            Kind::Dev => Flavor::Dev,
        }
    }
}

/// Which icon was asked for: `RAPHIE_ICON=release` draws the stable one,
/// `nightly` the nightly one, any other value the dev one.
fn requested_kind() -> Kind {
    match std::env::var("RAPHIE_ICON").as_deref() {
        Ok("release") => Kind::Stable,
        Ok("nightly") => Kind::Nightly,
        _ => Kind::Dev,
    }
}

/// A one-screen app that is only the icon. Its state is the icon it draws.
pub fn spec() -> AppSpec<Kind> {
    AppSpec {
        // No floor, so the 1024 square is not stretched to a window's
        // usual minimum.
        min_size: Some((0.0, 0.0)),
        ..AppSpec::new("Raphie icon", (CANVAS, CANVAS), requested_kind, view)
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
fn view(kind: &Kind, _cx: &mut Cx<Kind>) -> El {
    let mut tile = col()
        .size(TILE, TILE)
        .radius(TILE_RADIUS)
        // The dark theme's sidebar colour.
        .fill(color("#161512"))
        .center();
    if *kind == Kind::Nightly {
        tile = night_sky(tile);
    }
    tile = tile.child(el().child(bot_avatar("default", tone(kind.flavor()), FACE)));
    if *kind == Kind::Dev {
        tile = tile.child(dev_pill());
    }
    // Nothing is filled outside the tile, so the corners stay transparent.
    col().w_full().h_full().center().child(tile)
}

/// "DEV" in a light pill across the bottom of the tile, readable even at
/// the Dock's small sizes. A ring in the tile's colour keeps it apart from
/// the face it overlaps.
fn dev_pill() -> El {
    // A full-width row pinned near the bottom edge, out of the tile's flow,
    // so the face stays where it is; the row centres the pill.
    row()
        .pin(Some(0.0), None, Some(0.0), Some(64.0))
        .center()
        .child(
            row()
                .px(60.0)
                .py(6.0)
                .radius(90.0)
                // The dark theme's foreground, ringed in the tile's colour.
                .fill(color("#ebe8df"))
                .border(18.0, color("#161512"))
                .child(
                    text("DEV")
                        .font(font(120.0, 800.0).tracking(8.0))
                        .color(color("#161512")),
                ),
        )
}

/// Lucide's moon, filled: the crescent in the nightly icon's sky.
static CRESCENT: Icon = Icon {
    name: "rd-icon-crescent",
    view: 24.0,
    body: r#"<path fill="currentColor" d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>"#,
};

/// Stars as (left, top, diameter) in the tile's points, kept clear of the
/// face in the middle.
const STARS: [(f32, f32, f32); 9] = [
    (104.0, 118.0, 18.0),
    (232.0, 70.0, 11.0),
    (146.0, 262.0, 10.0),
    (566.0, 104.0, 10.0),
    (690.0, 330.0, 12.0),
    (86.0, 560.0, 14.0),
    (716.0, 604.0, 10.0),
    (616.0, 728.0, 15.0),
    (198.0, 716.0, 10.0),
];

/// The nightly tile: deep indigo, lighter toward the top, with a pale
/// crescent moon top right and a scatter of stars.
fn night_sky(tile: El) -> El {
    let mut tile = tile
        .fill(color("#10132e"))
        .gradient(color("#262c66"), color("#0c0e24"));
    for (left, top, size) in STARS {
        tile = tile.child(
            el().pin(Some(left), Some(top), None, None)
                .size(size, size)
                .radius(size / 2.0)
                .fill(color("#e6e4ff")),
        );
    }
    tile.child(
        el().pin(None, Some(64.0), Some(70.0), None)
            .child(icon(&CRESCENT, 170.0).color(color("#f2e2a2"))),
    )
}

fn color(value: &str) -> Color {
    hex(value).unwrap_or(Color::BLACK)
}
