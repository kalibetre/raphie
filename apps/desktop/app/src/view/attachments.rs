//! One attached file as a small card: what kind it is, its name and size,
//! and one action (remove it from the composer, or save it from a message).
//!
//! Mirrors `attachment-card.tsx` and the `.attachment-card` rules in
//! `chat.css`. The web also draws an image's picture in the card; here an
//! image shows the image icon.

use raphie_core::attachments::{file_size, is_image};
use raphie_core::contracts::Attachment;
use rune::{El, Icon, col, icon, row, text};

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
pub fn file_card(t: &Theme, key: &str, file: &Attachment, action: &Action, enabled: bool) -> El {
    let kind: &'static Icon = if is_image(file) {
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
    row()
        .key(key.to_owned())
        .w(210.0)
        .min_w(0.0)
        .padding(5.0)
        .gap(9.0)
        .center_y()
        .radius(10.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(
            row()
                .size(48.0, 48.0)
                .center()
                .radius(6.0)
                .fill(t.muted)
                .child(icon(kind, 20.0).color(t.muted_foreground).a11y_hidden()),
        )
        .child(
            col()
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
                ),
        )
        .child(button)
}
