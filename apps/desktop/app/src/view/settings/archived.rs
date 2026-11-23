//! Settings → Archived: one bot's archived conversations, searchable by
//! title. Opening one leaves Settings for it; Unarchive puts it back in the
//! sidebar.
//!
//! Mirrors `archived-conversations.tsx` and `settings/archived.css`.

use raphie_core::contracts::SessionSummary;
use rune::{El, col, row, text};

use super::inspect::{empty, filter_box, meta};
use super::parts::{Scope, page};
use crate::format;
use crate::icons;
use crate::sections::BotSection;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::view::sessions::session_card;
use crate::widgets::{Kind, Size, button, icon_button, pressable};

pub fn archived(s: &Ui, bot_id: &str, look: &Look) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.archived.get(bot_id) {
        Some(sessions) => list(s, bot_id, sessions, t),
        None => text("Loading archived conversations…")
            .key("rd-archived-status")
            .font(font(12.5, 400.0))
            .color(t.muted_foreground),
    };
    page(
        "rd-page-archived",
        "Archived",
        &BotSection::Archived.lede(name),
        Scope::Bot { id: bot_id, name },
        vec![body],
        look,
    )
}

/// The search box, a count, and one row per archived conversation.
fn list(s: &Ui, bot_id: &str, sessions: &[SessionSummary], t: &Theme) -> El {
    let query = s.archived_search.text.trim().to_lowercase();
    let shown: Vec<&SessionSummary> = sessions
        .iter()
        .filter(|session| session.title.to_lowercase().contains(&query))
        .collect();
    let noun = if shown.len() == 1 {
        "conversation"
    } else {
        "conversations"
    };
    let count = if query.is_empty() {
        format!("{} {noun} · Most recent first", shown.len())
    } else {
        format!(
            "{} {noun} matching “{}”",
            shown.len(),
            s.archived_search.text.trim()
        )
    };
    let section = col()
        .key("rd-archived")
        .w_full()
        .child(filter_box(
            t,
            "rd-archived-search",
            "Search archived conversations",
            "Search archived conversations…",
            &s.archived_search,
            |s: &mut Ui| &mut s.archived_search,
        ))
        .child(meta(t, "rd-archived-count", count, String::new()));
    if shown.is_empty() {
        return section.child(empty(
            t,
            "rd-archived-empty",
            &icons::ARCHIVE,
            None,
            if query.is_empty() {
                "No archived conversations. Archive one from its row in the sidebar or from its title bar."
            } else {
                "No matching conversations."
            },
        ));
    }
    let now = format::now_ms();
    let mut card = col()
        .key("rd-archived-list")
        .w_full()
        .px(4.0)
        .py(4.0)
        .radius(14.0)
        .fill(t.card)
        .border(1.0, t.border);
    for (index, session) in shown.into_iter().enumerate() {
        let mut line = archived_row(s, bot_id, session, now, t);
        if index > 0 {
            line = line.border_sides([1.0, 0.0, 0.0, 0.0], t.border);
        }
        card = card.child(line);
    }
    section.child(card)
}

/// One archived conversation: its card opens it, the button brings it back.
fn archived_row(s: &Ui, bot_id: &str, session: &SessionSummary, now: i64, t: &Theme) -> El {
    let (bot, id) = (bot_id.to_owned(), session.id.clone());
    let open = pressable(
        session_card(session, false, 0, now, t)
            .key(format!("rd-archived-{}", session.id))
            .radius(10.0)
            .hover(t.hover),
        true,
        move |s: &mut Ui| s.open_conversation(&bot, &id),
    )
    .grow(1.0)
    .min_w(0.0);
    let label = format!("Unarchive {}", session.title);
    // A narrow window keeps only the icon; its name stays for readers.
    let restore = if s.narrow() {
        icon_button(t, &icons::ARCHIVE_RESTORE, 14.0, &label)
    } else {
        button(
            t,
            Kind::Outline,
            Size::Small,
            Some(&icons::ARCHIVE_RESTORE),
            "Unarchive",
        )
        .label(label)
    };
    let (bot, id) = (bot_id.to_owned(), session.id.clone());
    row()
        .w_full()
        .pr(8.0)
        .gap(8.0)
        .center_y()
        .child(open)
        .child(pressable(
            restore.key(format!("rd-archived-{}-restore", session.id)),
            true,
            move |s: &mut Ui| s.archive(&bot, &id, false),
        ))
}
