//! An image attachment shown enlarged over the whole window, after a press
//! on its picture. The web has no such view yet; this is the desktop's.
//!
//! The picture is fitted inside the window, whole, on a dark backdrop with
//! its name below. A press anywhere, the close button or Escape (handled in
//! `lib.rs`) closes it.

use rune::{Color, El, SurfaceFit, col, el, icon, row};

use super::Look;
use crate::icons;
use crate::state::{Ui, Viewer};
use crate::theme::font;
use crate::widgets::one_line;

pub fn viewer(s: &Ui, viewer: &Viewer, look: &Look) -> Option<El> {
    let t = &look.theme;
    // Gone from memory (let go, or its bot deleted): show nothing.
    let picture = s.picture(&viewer.bot_id, &viewer.id)?;
    let close = |s: &mut Ui| s.viewer = None;
    // The backdrop is dark in both themes, as photo viewers are.
    let ink = Color::WHITE;
    Some(
        col()
            .key("rd-viewer")
            .role("dialog")
            .label(viewer.name.clone())
            .absolute(0.0, 0.0)
            .w_full()
            .h_full()
            .padding(24.0)
            .gap(12.0)
            .fill(Color::BLACK.alpha(0.96))
            .on_press(close)
            .child(
                row().w_full().justify_end().child(
                    // White on the dark backdrop, whatever the theme.
                    row()
                        .key("rd-viewer-close")
                        .role("button")
                        .label("Close")
                        .help("Close (Esc)")
                        .size(34.0, 34.0)
                        .center()
                        .radius(8.0)
                        .hover(ink.alpha(0.12))
                        .press(ink.alpha(0.2))
                        .focus_ring(2.0, 1.0, t.accent)
                        .child(icon(&icons::X, 18.0).color(ink).a11y_hidden())
                        .on_press(close),
                ),
            )
            .child(
                // `Fit` shows the whole picture, as large as the space allows.
                el().key("rd-viewer-picture")
                    .w_full()
                    .grow(1.0)
                    .min_h(0.0)
                    .pixels_fit(picture.pixels(), SurfaceFit::Fit)
                    // `Fit` rounds the picture itself, not the empty sides.
                    .radius(6.0)
                    .a11y_hidden(),
            )
            .child(row().w_full().justify_center().child(one_line(
                viewer.name.clone(),
                font(13.0, 550.0),
                ink.alpha(0.9),
            ))),
    )
}
