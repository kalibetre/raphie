//! One attached file as a small card: what kind it is, its name and size,
//! and one action (remove it from the composer, or save it from a message).
//!
//! Mirrors `attachment-card.tsx` and the `.attachment-card` rules in
//! `chat.css`. An image shows its picture once it has arrived, and the
//! image icon until then or if it cannot be shown. On a sent message an
//! image's card puts the picture across the top, 128 points tall.

use raphie_core::attachments::{file_size, is_image};
use raphie_core::contracts::Attachment;
use rune::{El, Icon, Image, SurfaceFit, col, el, icon, row, text};

use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{one_line, pressable};

/// What the button at the card's end does.
pub enum Action {
    /// In the composer: take the file off the message.
    Remove,
    /// On a sent message: save the file to Downloads.
    Download,
}

/// `key` names the card; its button is `{key}-action`. `enabled` is false
/// while the button could not do anything (a send or a save in progress).
/// `picture` is the image's decoded picture once there is one, with the bot
/// whose file it is; pressing it shows it enlarged.
pub fn file_card(
    t: &Theme,
    key: &str,
    file: &Attachment,
    picture: Option<(&str, &Image)>,
    action: &Action,
    enabled: bool,
) -> El {
    let image = is_image(file);
    let kind: &'static Icon = if image {
        &icons::IMAGE
    } else {
        &icons::FILE_TEXT
    };
    let (glyph, glyph_size, label): (&'static Icon, f32, String) = match action {
        Action::Remove => (&icons::X, 15.0, format!("Remove {}", file.name)),
        Action::Download => (&icons::DOWNLOAD, 16.0, format!("Download {}", file.name)),
    };
    let button = row()
        .key(format!("{key}-action"))
        .role("button")
        .label(label.clone())
        .help(label)
        .size(30.0, 30.0)
        .center()
        .radius(6.0)
        .hover(t.muted)
        .press(t.muted)
        .focus_ring(2.0, 1.0, t.accent)
        .child(
            icon(glyph, glyph_size)
                .color(t.muted_foreground)
                .a11y_hidden(),
        );
    // The closures own copies of the id and name: they outlive this call.
    let id = file.id.clone();
    let name = file.name.clone();
    let button = match action {
        Action::Remove => pressable(button, enabled, move |s: &mut Ui| {
            s.model.attachments.remove(&id);
        }),
        Action::Download => pressable(button, enabled, move |s: &mut Ui| {
            s.save_attachment(&id, &name);
        }),
    };
    // The square (or, on a message, the band) that shows what it is.
    let preview = |shape: El| -> El {
        let shape = shape
            .key(format!("{key}-preview"))
            .center()
            .radius(6.0)
            .clip_rounded(6.0)
            .fill(t.muted);
        match picture {
            // `Fill` covers the box and crops the overflow, like the web's
            // `object-fit: cover`.
            Some((bot_id, picture)) => {
                let (bot_id, id, name) = (bot_id.to_owned(), file.id.clone(), file.name.clone());
                shape
                    .child(
                        el().w_full()
                            .h_full()
                            .pixels_fit(picture.pixels(), SurfaceFit::Fill),
                    )
                    .role("button")
                    .label(format!("View {}", file.name))
                    .help("View larger")
                    .focus_ring(2.0, 1.0, t.accent)
                    .on_press(move |s: &mut Ui| s.open_viewer(&bot_id, &id, &name))
            }
            // Only a picture of the kind: the name beside it says it all.
            None => shape
                .child(icon(kind, 20.0).color(t.muted_foreground))
                .a11y_hidden(),
        }
    };
    let info = col()
        .grow(1.0)
        .min_w(0.0)
        .gap(3.0)
        // The whole name on hover, since it is cut to one line.
        .help(file.name.clone())
        .child(one_line(file.name.clone(), font(12.0, 550.0), t.foreground))
        .child(
            text(file_size(file.size))
                .font(font(11.0, 400.0))
                .color(t.muted_foreground),
        );
    let card = |layout: El| {
        layout
            .key(key.to_owned())
            .w(210.0)
            .min_w(0.0)
            .padding(5.0)
            .gap(9.0)
            .radius(10.0)
            .fill(t.card)
            .border(1.0, t.border)
    };
    // A sent image: the picture across the top, the name and button below.
    if image && matches!(action, Action::Download) {
        return card(col()).child(preview(el().w_full().h(128.0))).child(
            row()
                .w_full()
                .pl(4.0)
                .gap(9.0)
                .center_y()
                .child(info)
                .child(button),
        );
    }
    card(row())
        .center_y()
        .child(preview(el().size(48.0, 48.0)))
        .child(info)
        .child(button)
}
