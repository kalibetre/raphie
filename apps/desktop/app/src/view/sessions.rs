//! The selected bot's conversations, in the roster below its bots: a label
//! with a new-conversation button, then search, filter chips and one row
//! per session.
//!
//! Mirrors `ConversationList` in `bot-sidebar.tsx`'s `.roster-conversations`
//! section, `domains/conversations/presentation/sessions/` and the
//! `.library-*` rules in `bot-workspace.css`.

use raphie_core::contracts::SessionSummary;
use raphie_core::engine::Command;
use rune::{Color, El, ScrollSpec, TextCase, Tx, col, icon, row, text, text_input};

use super::Look;
use super::roster::{label_action, plain};
use crate::format;
use crate::icons;
use crate::state::{Filter, Ui};
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, button, centered, one_line, pressable};

/// The section under the bots: it takes the roster's remaining height, and
/// everything below its label scrolls.
pub fn sessions(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let model = &s.model;
    let query = s.search.text.trim().to_lowercase();
    let waiting = model
        .session_list()
        .filter(|session| session.waiting)
        .count();
    // The sessions that pass the search box and the chosen chip.
    let shown: Vec<&SessionSummary> = model
        .session_list()
        .filter(|session| session.title.to_lowercase().contains(&query))
        .filter(|session| match s.filter {
            Filter::All => true,
            Filter::NewReplies => s.unread(session) > 0,
            Filter::Approvals => session.waiting,
        })
        .collect();
    let unread = model
        .session_list()
        .filter(|session| s.unread(session) > 0)
        .count();

    let selected = model.conversation.as_ref().map(|c| c.session_id.as_str());
    let now = format::now_ms();
    let mut list = col()
        .key("rd-sessions")
        .role("navigation")
        .label("Conversations")
        .w_full()
        .gap(2.0);
    for session in &shown {
        list = list.child(session_row(
            session,
            selected == Some(session.id.as_str()),
            s.unread(session),
            now,
            t,
        ));
    }

    // No "N conversations" line under the chips, as on the web: the
    // filters already say what is shown, and the sidebar keeps the room.
    let mut page = col()
        .w_full()
        .px(12.0)
        .pt(6.0)
        .pb(12.0)
        .child(search_box(s, t))
        .child(
            row()
                .w_full()
                .mt(8.0)
                .mb(6.0)
                .gap(6.0)
                .child(chip(
                    t,
                    "rd-filter-all",
                    "All",
                    None,
                    s.filter == Filter::All,
                    Filter::All,
                ))
                .child(chip(
                    t,
                    "rd-filter-new",
                    "New replies",
                    Some(unread).filter(|count| *count > 0),
                    s.filter == Filter::NewReplies,
                    Filter::NewReplies,
                ))
                .child(chip(
                    t,
                    "rd-filter-approvals",
                    "Approvals",
                    Some(waiting).filter(|count| *count > 0),
                    s.filter == Filter::Approvals,
                    Filter::Approvals,
                )),
        )
        .child(list);
    if shown.is_empty() {
        page = page.child(empty(s, &query, t));
    }
    // Later pages exist: offer the next one.
    if let Some(after) = model.sessions_next.clone() {
        page = page.child(
            pressable(
                button(
                    t,
                    Kind::Outline,
                    Size::Regular,
                    None,
                    "Load more conversations",
                )
                .key("rd-more-sessions")
                .w_full(),
                true,
                move |s: &mut Ui| {
                    s.command(Command::LoadMoreSessions {
                        after: after.clone(),
                    });
                },
            )
            .mt(10.0),
        );
    }

    let name = model
        .selected_bot()
        .map_or("Raphie", |bot| bot.name.as_str());
    let title = format!("{name}’s conversations");
    col()
        .key("rd-conversations")
        .role("region")
        .label(title.clone())
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .mt(8.0)
        .pt(14.0)
        // Only a top edge: `[top, right, bottom, left]` widths.
        .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        .child(
            row()
                .w_full()
                .px(22.0)
                .pb(4.0)
                .gap(8.0)
                .justify_between()
                .center_y()
                .child(
                    one_line(title, font(10.0, 400.0).tracking(1.0), t.muted_foreground)
                        // Drawn in capitals; screen readers hear the name as it is.
                        .text_case(TextCase::Uppercase)
                        .shrink(),
                )
                .child(pressable(
                    label_action(t, &icons::SQUARE_PEN, "New conversation")
                        .key("rd-new-conversation"),
                    true,
                    |s: &mut Ui| s.select_session(None),
                )),
        )
        .child(
            col()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(page),
        )
}

fn search_box(s: &Ui, t: &Theme) -> El {
    let focused = s.search.focused;
    let input = text_input(&s.search, font(12.0, 400.0))
        .single_line()
        .key("rd-search-input")
        .label("Search conversations")
        .grow(1.0)
        .min_w(0.0)
        .color(t.foreground)
        .placeholder("Search conversations…", t.faint)
        .caret(t.foreground, t.selection())
        .on_edit(|s: &mut Ui| &mut s.search);
    let mut search = row()
        .key("rd-search")
        .w_full()
        .px(10.0)
        .py(7.0)
        .gap(8.0)
        .center_y()
        .radius(10.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(icon(&icons::SEARCH, 15.0).color(t.faint).a11y_hidden())
        .child(input)
        .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-search-input", false));
    if focused {
        search = search.outline(2.0, 2.0, t.accent);
    }
    if !s.search.text.is_empty() {
        search = search.child(pressable(
            row()
                .key("rd-search-clear")
                .role("button")
                .label("Clear conversation search")
                .size(21.0, 21.0)
                .center()
                .radius(7.0)
                .hover(t.hover)
                .child(
                    icon(&icons::X, 13.0)
                        .color(t.muted_foreground)
                        .a11y_hidden(),
                ),
            true,
            |s: &mut Ui| s.search.clear(),
        ));
    }
    search
}

/// A filter chip (the web's `.library-filter`); the selected one is tinted.
fn chip(t: &Theme, key: &str, label: &str, count: Option<usize>, on: bool, filter: Filter) -> El {
    let ink = if on { t.accent } else { t.muted_foreground };
    let mut chip = row()
        .key(key)
        .role("button")
        .label(label)
        .h(24.5)
        .px(7.0)
        .gap(3.5)
        .center()
        // Half the height: fully rounded ends.
        .radius(12.25)
        .hover(t.hover)
        .child(text(label).font(font(11.0, 500.0)).color(ink).a11y_hidden());
    if on {
        chip = chip.fill(t.accent_soft).border(1.0, t.accent.alpha(0.25));
    }
    if let Some(count) = count {
        chip = chip.child(
            text(count.to_string())
                .font(font(10.0, 500.0))
                .color(ink.alpha(0.75))
                .a11y_hidden(),
        );
    }
    pressable(chip, true, move |s: &mut Ui| s.filter = filter)
}

/// One conversation: title and age, the last thing said, and what it is
/// doing if anything (the web's `SessionCard`).
fn session_row(session: &SessionSummary, selected: bool, unread: u32, now: i64, t: &Theme) -> El {
    // The most urgent status only; none when nothing needs saying.
    let status: Option<(String, Color)> = if session.waiting {
        Some(("Needs approval".into(), t.attention))
    } else if session.working {
        Some(("Working…".into(), t.accent))
    } else if session.failed {
        Some(("Failed".into(), t.error))
    } else if unread == 1 {
        Some(("1 new reply".into(), t.accent))
    } else if unread > 1 {
        Some((format!("{unread} new replies"), t.accent))
    } else {
        None
    };
    // A dot before the title and a bolder title mark replies not read yet.
    let mut top = row().w_full().gap(6.0).center_y();
    if unread > 0 {
        top = top.child(
            row()
                .key(format!("rd-session-{}-dot", session.id))
                .size(6.0, 6.0)
                .radius(3.0)
                .fill(t.accent)
                .a11y_hidden(),
        );
    }
    let weight = if unread > 0 { 650.0 } else { 500.0 };
    let mut entry = col()
        .key(format!("rd-session-{}", session.id))
        .role("button")
        .label(session.title.clone())
        .w_full()
        .px(10.0)
        .py(8.0)
        .gap(2.0)
        .radius(8.0)
        .child(
            top.child(
                one_line(session.title.clone(), font(13.0, weight), t.foreground)
                    .grow(1.0)
                    .min_w(0.0),
            )
            .child(
                text(format::ago(session.last_at, now))
                    .font(font(11.0, 400.0))
                    .color(t.faint),
            ),
        )
        .child(one_line(
            plain(&session.preview),
            font(12.0, 400.0).lh(17.0),
            t.muted_foreground,
        ));
    if let Some((label, color)) = status {
        entry = entry.child(text(label).font(font(11.0, 400.0).lh(16.0)).color(color));
    }
    entry = if selected {
        entry.fill(t.accent_soft.alpha(0.7))
    } else {
        entry.hover(t.hover)
    };
    let id = session.id.clone();
    pressable(entry, true, move |s: &mut Ui| s.select_session(Some(&id)))
}

/// What the list says when it has no rows (the web's `.library-empty`).
fn empty(s: &Ui, query: &str, t: &Theme) -> El {
    let message = if !query.is_empty() {
        "No matching conversations."
    } else if s.filter == Filter::All {
        "Your conversations will appear here."
    } else {
        "You’re all caught up."
    };
    col()
        .key("rd-sessions-empty")
        .w_full()
        .px(24.0)
        .py(40.0)
        .gap(14.0)
        .items_center()
        .radius(14.0)
        .border(1.0, t.border)
        .border_dash(4.0, 3.0)
        .child(
            icon(&icons::MESSAGE_SQUARE_TEXT, 24.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(centered(message, font(13.0, 400.0), t.muted_foreground))
}
