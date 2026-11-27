//! What background work waits on the owner for, as a card at the end of the
//! chat: the work item's title, a "Needs you" badge, its approvals and
//! questions, and a way to open the item.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/work-card.tsx`
//! and its `.work-card` rules in `bot-workspace.css`.

use rune::{El, col, icon, row, text};

use super::Look;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{Kind as ButtonKind, Size, button};

/// Below this width of the chat, the kind shows as its icon only: the title
/// needs the room (the web's 480px rule).
const NARROW_CARD: f32 = 520.0;

/// A card for one work item that needs the owner: `extra` holds its
/// approvals and questions.
pub fn needs_you(s: &Ui, key: String, title: &str, extra: Vec<El>, look: &Look) -> El {
    let t = &look.theme;
    let part = |name: &str| format!("{key}-{name}");
    let header = row()
        .key(part("head"))
        .w_full()
        .min_w(0.0)
        .px(14.0)
        .py(9.0)
        .gap(8.0)
        .center_y()
        .child(kind_label(s.narrow() || chat_width(s) < NARROW_CARD, t))
        .child(
            text(title.to_string())
                .font(font(13.5, 600.0))
                .color(t.foreground)
                .truncate()
                .shrink()
                .grow(1.0)
                .help(title.to_string()),
        )
        .child(badge(t));
    let footer = row()
        .key(part("foot"))
        .w_full()
        .px(10.0)
        .pb(8.0)
        .center_y()
        .child(
            button(
                t,
                ButtonKind::Ghost,
                Size::Tiny,
                Some(&icons::EXTERNAL_LINK),
                "Open item",
            )
            .key(part("open"))
            .on_press(|s: &mut Ui| {
                let bot_id = s.model.bot_id.clone().unwrap_or_else(|| "default".into());
                s.open_settings(Some(Page::Bot {
                    bot_id,
                    section: BotSection::Work,
                }));
            }),
        );
    let mut card = col()
        .key(key.clone())
        .w_full()
        .min_w(0.0)
        .radius(12.0)
        .fill(t.card)
        .border(1.0, t.border)
        .label(format!("Background work: {title}"))
        .child(header);
    if !extra.is_empty() {
        card = card.child(row().w_full().h(1.0).fill(t.border)).child(
            col()
                .key(part("body"))
                .w_full()
                .min_w(0.0)
                .px(14.0)
                .py(12.0)
                .gap(10.0)
                .children(extra),
        );
    }
    card.child(footer)
}

/// The icon and, unless the chat is narrow, the words for what made the card.
fn kind_label(narrow: bool, t: &Theme) -> El {
    let mut label = row().gap(6.0).center_y().child(
        icon(&icons::LIST_CHECKS, 13.0)
            .color(t.accent)
            .a11y_hidden(),
    );
    if !narrow {
        label = label.child(
            text("Background work")
                .font(font(12.5, 500.0))
                .color(t.accent)
                .single_line(),
        );
    }
    label
}

fn badge(t: &Theme) -> El {
    row()
        .px(8.0)
        .py(2.0)
        .gap(5.0)
        .center_y()
        .radius(999.0)
        .fill(t.attention_soft)
        .child(row().size(6.0, 6.0).radius(3.0).fill(t.attention))
        .child(
            text("Needs you")
                .font(font(11.5, 600.0))
                .color(t.attention)
                .single_line(),
        )
}

/// The chat column's width, or its widest before the window is first laid
/// out (the width is 0 until then).
fn chat_width(s: &Ui) -> f32 {
    let width = s.main_width();
    if width > 0.0 { width } else { 780.0 }
}
