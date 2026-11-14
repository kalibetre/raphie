//! The conversations panel on the right: search, filter chips and one row
//! per session of the selected bot.
//!
//! Mirrors `apps/web/src/presentation/workspace/workspace-panel.tsx`,
//! `domains/conversations/presentation/sessions/` and the `.library-*` rules
//! in `bot-workspace.css`.

use raphie_core::contracts::SessionSummary;
use raphie_core::engine::Command;
use rune::{El, ScrollSpec, Tx, col, icon, row, text, text_input};

use super::Look;
use super::roster::plain;
use crate::format;
use crate::icons;
use crate::state::{Filter, Ui};
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, button, centered, count_badge, one_line, pressable};

/// The panel's width, the web's default.
const WIDTH: f32 = 340.0;

pub fn panel(s: &Ui, look: &Look) -> El {
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
        .filter(|session| s.filter == Filter::All || session.waiting)
        .collect();

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
            now,
            t,
        ));
    }

    let results = if query.is_empty() {
        format!("{} · Most recent first", conversations(shown.len()))
    } else {
        format!(
            "{} matching “{}”",
            conversations(shown.len()),
            s.search.text.trim()
        )
    };
    let mut page = col()
        .w_full()
        .px(10.0)
        .pt(10.0)
        .pb(16.0)
        .child(search_box(s, t))
        .child(
            row()
                .w_full()
                .mt(10.0)
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
                    "rd-filter-approvals",
                    "Approvals",
                    Some(waiting).filter(|count| *count > 0),
                    s.filter == Filter::Approvals,
                    Filter::Approvals,
                )),
        )
        .child(
            text(results)
                .key("rd-results")
                .font(font(11.0, 400.0))
                .color(t.muted_foreground)
                .wrap()
                .mx(4.0)
                .mt(10.0)
                .mb(6.0),
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

    col()
        .key("rd-panel")
        .w(WIDTH)
        .h_full()
        .fill(t.sidebar)
        .border_sides([0.0, 0.0, 0.0, 1.0], t.border)
        .child(tab_strip(waiting, look))
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

fn conversations(count: usize) -> String {
    if count == 1 {
        "1 conversation".to_owned()
    } else {
        format!("{count} conversations")
    }
}

/// The strip of panel tabs. The web has room for more tabs here; the only
/// one so far is Conversations, so it is always the selected one.
fn tab_strip(waiting: usize, look: &Look) -> El {
    let t = &look.theme;
    let mut tab = row()
        .w(176.0)
        .h(31.5)
        .px(10.5)
        .gap(7.0)
        .center_y()
        .radius(10.5)
        .fill(t.accent_soft)
        .border(1.0, t.accent.alpha(0.25))
        .child(
            icon(&icons::MESSAGE_SQUARE_TEXT, 14.0)
                .color(t.accent)
                .a11y_hidden(),
        )
        .child(one_line("Conversations", font(10.5, 500.0), t.accent).grow(1.0));
    if waiting > 0 {
        tab = tab.child(count_badge(t, waiting));
    }
    row()
        .w_full()
        .h(49.0)
        .px(10.5)
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        // Empty parts of the strip move the window, like the header's.
        .window_drag()
        .child(tab)
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
        .px(12.0)
        .py(10.0)
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
fn session_row(session: &SessionSummary, selected: bool, now: i64, t: &Theme) -> El {
    // The most urgent status only; none when nothing needs saying.
    let status = if session.waiting {
        Some(("Needs approval", t.attention))
    } else if session.working {
        Some(("Working…", t.accent))
    } else if session.failed {
        Some(("Failed", t.error))
    } else {
        None
    };
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
            row()
                .w_full()
                .gap(6.0)
                .center_y()
                .child(
                    one_line(session.title.clone(), font(13.0, 500.0), t.foreground)
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
