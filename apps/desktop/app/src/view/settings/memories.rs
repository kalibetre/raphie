//! Settings → Memory → Browse memory: what a bot remembers, with where each
//! memory came from, and the controls to correct or forget one.
//!
//! Mirrors `memory-browse.tsx`, `memory-evidence-browser.tsx` and
//! `memory-evidence-card.tsx`, and `shared/styles/settings/memory.css`. The
//! list is in the core (`raphie_core::memory::MemoryBrowser`); the search
//! box and the open editor are in `crate::state::MemoriesView`.
//!
//! One difference from the web: "Open source session" leaves Settings for
//! that conversation in this window, where the web follows a link.

use raphie_core::contracts::{MemoryEvidence, MemoryKind, MemoryProvider, MemoryStatus};
use raphie_core::engine::Command;
use raphie_core::memory::{MemoryBrowser, source_session};
use rune::{El, Span, Tx, col, icon, row, text, text_input};

use super::parts::{Scope, back_link, group, status, sub_page};
use crate::format::date_time;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, centered, pressable, text_field};

pub fn memories(s: &Ui, bot_id: &str, look: &Look) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.memory.get(bot_id) {
        Some(memory) if memory.configuration.enabled => browser(s, bot_id, memory, t),
        Some(_) => status(
            t,
            "Memory is off",
            "Turn on memory in Settings → Memory to save and browse memories.",
            None,
        ),
        None => loading(s, bot_id, t),
    };
    let parent = bot_id.to_owned();
    let back = pressable(
        back_link(t, BotSection::Memory.label()).key("rd-memories-back"),
        true,
        move |s: &mut Ui| {
            s.open_settings(Some(Page::Bot {
                bot_id: parent.clone(),
                section: BotSection::Memory,
            }));
        },
    );
    sub_page(
        "rd-page-memories",
        BotSection::MemoryBrowse.label(),
        &BotSection::MemoryBrowse.lede(name),
        Scope::Bot { id: bot_id, name },
        Some(back),
        vec![body],
        look,
    )
}

/// The memory settings, which say what this back end allows, are on their
/// way or could not be fetched.
fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let failed = s
        .model
        .memory_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "Saved memories", "Loading memories…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Saved memories",
        "Memory is unavailable. Check your connection to Raphie.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry")
                .key("rd-memories-retry-settings"),
            true,
            move |s: &mut Ui| {
                s.model.memory_error = None;
                s.command(Command::LoadMemory {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// The search box, what the list is showing, and the list.
fn browser(s: &Ui, bot_id: &str, memory: &MemoryStatus, t: &Theme) -> El {
    let list: &MemoryBrowser = &s.model.memories;
    let can_browse = memory.capabilities.browse;
    let can_manage = memory.capabilities.revise && memory.capabilities.forget;
    // The built-in back end searches as the owner types.
    let live = memory.configuration.provider == MemoryProvider::Builtin;
    let scope = &memory.configuration.scope;
    let filtering = !s.memories.query.text.trim().is_empty();
    // Every memory is listed, rather than the matches of a search.
    let browsing = can_browse && !filtering;
    // A live search waiting for the typing to pause counts as on its way.
    let busy = list.busy() || s.memories.search_pending();

    let caption = text(if can_browse {
        "Filter saved memories"
    } else {
        "Search memories"
    })
    .font(font(13.0, 560.0))
    .color(t.foreground);
    let note = |content: &str| {
        text(content)
            .font(font(12.5, 400.0))
            .color(t.muted_foreground)
            .wrap()
    };

    let (glyph, label) = if browsing {
        (&icons::REFRESH_CW, "Refresh")
    } else {
        (&icons::SEARCH, "Search")
    };
    let mut search = row()
        .w_full()
        .gap(8.0)
        .center_y()
        .child(
            text_field(
                t,
                Field {
                    key: "rd-memories-query",
                    label: if can_browse {
                        "Filter saved memories"
                    } else {
                        "Search memories"
                    },
                    placeholder: "A preference, person or experience…",
                    edit: &s.memories.query,
                    disabled: false,
                    compact: true,
                },
                |s: &mut Ui| &mut s.memories.query,
                |s: &mut Ui, _: &mut Tx| s.load_memories(None),
            )
            // The box takes the room the buttons leave.
            .grow(1.0)
            .min_w(0.0),
        )
        .child(pressable(
            button(t, Kind::Outline, Size::Regular, Some(glyph), label).key("rd-memories-search"),
            !list.busy() && (filtering || can_browse),
            |s: &mut Ui| s.load_memories(None),
        ));
    if filtering {
        search = search.child(pressable(
            button(t, Kind::Ghost, Size::Regular, None, "Clear search").key("rd-memories-clear"),
            !list.busy(),
            |s: &mut Ui| s.clear_memory_search(),
        ));
    }

    let mut form = col()
        .key("rd-memories-form")
        .w_full()
        .padding(18.0)
        .gap(12.0)
        .child(caption)
        .child(search)
        .child(note(if live {
            "Type to search, or clear the filter to browse all saved memories. Search returns up to eight matching records."
        } else {
            "Press Search or Enter to query the provider."
        }))
        .child(feedback(list, browsing, busy, t));

    if let Some(shown) = &list.evidence {
        if shown.is_empty() {
            form = form.child(empty(browsing, t));
        }
        for item in shown {
            form = form.child(card(s, bot_id, item, can_manage, t));
        }
    }
    // More pages only exist while every memory is listed.
    if let (true, Some(next)) = (browsing, &list.next) {
        let next = next.clone();
        form = form.child(
            pressable(
                button(
                    t,
                    Kind::Outline,
                    Size::Regular,
                    None,
                    if list.loading {
                        "Loading…"
                    } else {
                        "Load more"
                    },
                )
                .key("rd-memories-more"),
                !list.busy(),
                // `Fn` closures may run more than once, so the cursor is
                // cloned for each run rather than moved out.
                move |s: &mut Ui| s.load_memories(Some(next.clone())),
            )
            .self_start(),
        );
    }

    group(
        t,
        if can_browse {
            "Saved memories"
        } else {
            "Search memories"
        },
        &if can_browse {
            format!(
                "Scope: {scope}. Newest saved evidence first. Open a source to see the original conversation."
            )
        } else {
            format!(
                "Scope: {scope}. This provider supports search; browsing all records is not available through Raphie yet."
            )
        },
        vec![form],
    )
}

/// The line that says what the list shows: a count, a load on its way, or
/// what went wrong, with Retry beside it.
fn feedback(list: &MemoryBrowser, browsing: bool, busy: bool, t: &Theme) -> El {
    let plural = |count: u64| if count == 1 { "memory" } else { "memories" };
    let message = if let Some(error) = &list.error {
        error.clone()
    } else if busy {
        "Loading memories…".to_owned()
    } else if let Some(shown) = &list.evidence {
        let count = shown.len() as u64;
        match list.total {
            Some(total) if browsing => {
                format!("Showing {count} of {total} saved {}", plural(total))
            }
            _ => format!("{count} matching {}", plural(count)),
        }
    } else {
        "Enter keywords, then press Search to query the provider.".to_owned()
    };
    let mut line = row().w_full().gap(12.0).justify_between().center_y().child(
        text(message)
            .key("rd-memories-status")
            .font(font(12.0, 400.0))
            .color(t.muted_foreground)
            .wrap()
            .shrink(),
    );
    if list.error.is_some() {
        line = line.child(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-memories-retry"),
            !list.busy(),
            |s: &mut Ui| s.load_memories(None),
        ));
    }
    line
}

/// Nothing saved yet, or nothing matches.
fn empty(browsing: bool, t: &Theme) -> El {
    let (title, hint) = if browsing {
        (
            "No memories saved yet",
            "Lasting preferences and useful facts the agent remembers will appear here. You can also explicitly ask it to remember something.",
        )
    } else {
        (
            "No matching memories",
            "Try a word from the saved information, or clear the filter to browse.",
        )
    };
    col()
        .key("rd-memories-empty")
        .w_full()
        .px(16.0)
        .py(28.0)
        .gap(10.0)
        .items_center()
        .child(
            icon(&icons::BOOK_OPEN, 24.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(text(title).font(font(14.0, 600.0)).color(t.foreground))
        .child(centered(hint, font(12.5, 400.0), t.muted_foreground))
}

/// One memory: what kind it is and when, what it says, where it came from,
/// and the controls to change it.
fn card(s: &Ui, bot_id: &str, item: &MemoryEvidence, can_manage: bool, t: &Theme) -> El {
    let id = &item.id;
    let quiet = |content: String| {
        text(content)
            .font(font(11.0, 400.0))
            .color(t.muted_foreground)
    };
    let meta = row()
        .w_full()
        .gap(10.0)
        .flex_wrap()
        .center_y()
        .child(
            row()
                .px(6.0)
                .py(2.0)
                .radius(5.0)
                .border(1.0, t.border)
                .child(
                    text(match item.kind {
                        MemoryKind::Fact => "Fact",
                        MemoryKind::Experience => "Experience",
                    })
                    .font(font(11.0, 400.0))
                    .color(t.foreground),
                ),
        )
        .child(quiet(if item.event_time > 0 {
            date_time(item.event_time)
        } else {
            "Time not supplied".to_owned()
        }))
        .child(quiet(format!("revision {}", item.revision)));

    let mut card = col()
        .key(format!("rd-memory-{id}"))
        .w_full()
        .padding(16.0)
        .gap(10.0)
        .radius(8.0)
        .border(1.0, t.border)
        .child(meta)
        .child(
            text(item.content.clone())
                .font(font(14.0, 400.0).lh(21.0))
                .color(t.foreground)
                .wrap(),
        )
        .child(source(s, bot_id, item, t));
    if can_manage {
        card = card.child(controls(s, item, t));
    }
    card
}

/// "Source and record ID", folded until asked for.
fn source(s: &Ui, bot_id: &str, item: &MemoryEvidence, t: &Theme) -> El {
    let open = s.memories.open_sources.contains(&item.id);
    let id = item.id.clone();
    let summary = row()
        .key(format!("rd-memory-{}-source", item.id))
        .role("button")
        .label("Source and record ID")
        .gap(4.0)
        .center_y()
        .radius(4.0)
        .focus_ring(2.0, 2.0, t.accent)
        .self_start()
        .child(
            icon(&icons::CHEVRON_RIGHT, 12.0)
                .color(t.muted_foreground)
                // Points down while open.
                .icon_rotation(if open {
                    std::f32::consts::FRAC_PI_2
                } else {
                    0.0
                })
                .a11y_hidden(),
        )
        .child(
            text("Source and record ID")
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .on_press(move |s: &mut Ui| Ui::toggle(&mut s.memories.open_sources, &id));
    let mut details = col().w_full().gap(8.0).child(summary);
    if !open {
        return details;
    }
    details = details
        .child(
            text(item.id.clone())
                .font(mono(11.0))
                .color(t.muted_foreground)
                .wrap(),
        )
        .child(
            text(item.source.clone())
                .font(font(11.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    // A memory saved from a conversation can take the owner back to it.
    if let Some(session) = source_session(&item.source) {
        let link = "Open source session";
        let (bot_id, session) = (bot_id.to_owned(), session.to_owned());
        details = details.child(
            text(link)
                .key(format!("rd-memory-{}-session", item.id))
                .role("link")
                .font(font(12.0, 400.0))
                .color(t.foreground)
                // One span over the whole label draws the underline.
                .spans(vec![Span::new(0, link.len()).underline(t.foreground)])
                .focusable(true)
                .self_start()
                .on_press(move |s: &mut Ui| s.open_conversation(&bot_id, &session)),
        );
    }
    details
}

/// Correct and Forget, or the editor or the confirmation one of them opened.
fn controls(s: &Ui, item: &MemoryEvidence, t: &Theme) -> El {
    let busy = s.model.memories.busy();
    let editing = s.memories.editing.as_deref() == Some(item.id.as_str());
    let forgetting = s.memories.forgetting.as_deref() == Some(item.id.as_str());
    let key = |part: &str| format!("rd-memory-{}-{part}", item.id);
    let actions = || row().w_full().gap(8.0).flex_wrap().center_y();

    if editing {
        let mut editor = text_input(&s.memories.correction, font(12.25, 400.0).lh(19.0))
            .key(key("correction"))
            .label("Corrected evidence")
            .w_full()
            .color(t.foreground)
            .caret(t.foreground, t.selection())
            .disabled(busy);
        if !busy {
            editor = editor
                .on_edit(|s: &mut Ui| &mut s.memories.correction)
                // In a paragraph, Return starts a new line.
                .on_submit(|s: &mut Ui, _: &mut Tx| s.memories.correction.insert("\n"));
        }
        return col()
            .w_full()
            .gap(10.0)
            .child(
                text("Corrected evidence")
                    .font(font(13.0, 560.0))
                    .color(t.foreground),
            )
            .child(
                col()
                    .w_full()
                    .min_h(100.0)
                    .padding(10.0)
                    .radius(6.0)
                    .fill(t.background)
                    .border(1.0, t.border)
                    .child(editor),
            )
            .child(
                actions()
                    .child(pressable(
                        button(t, Kind::Primary, Size::Regular, None, "Save correction")
                            .key(key("save")),
                        s.can_save_correction(),
                        |s: &mut Ui| s.save_correction(),
                    ))
                    .child(pressable(
                        button(t, Kind::Ghost, Size::Regular, None, "Cancel").key(key("cancel")),
                        !busy,
                        |s: &mut Ui| s.memories.editing = None,
                    )),
            );
    }
    if forgetting {
        return col()
            .w_full()
            .gap(10.0)
            .child(
                text("Remove this evidence from current memory? Chat history is kept separately.")
                    .font(font(12.5, 400.0))
                    .color(t.muted_foreground)
                    .wrap(),
            )
            .child(
                actions()
                    .child(pressable(
                        button(t, Kind::Destructive, Size::Regular, None, "Confirm forget")
                            .key(key("confirm")),
                        !busy,
                        |s: &mut Ui| s.forget_memory(),
                    ))
                    .child(pressable(
                        button(t, Kind::Ghost, Size::Regular, None, "Cancel").key(key("cancel")),
                        !busy,
                        |s: &mut Ui| s.memories.forgetting = None,
                    )),
            );
    }
    let (correct, forget) = (item.id.clone(), item.id.clone());
    actions()
        .child(pressable(
            button(t, Kind::Outline, Size::Small, None, "Correct").key(key("correct")),
            !busy,
            move |s: &mut Ui| s.correct_memory(&correct),
        ))
        .child(pressable(
            button(t, Kind::Ghost, Size::Small, None, "Forget").key(key("forget")),
            !busy,
            move |s: &mut Ui| s.memories.forgetting = Some(forget.clone()),
        ))
}
