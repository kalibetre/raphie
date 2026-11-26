//! Settings → Work: what a bot is keeping track of, open and done, and the
//! dialog that opens or edits an item.
//!
//! Mirrors `work-settings.tsx` and `work-item-card.tsx`, and the
//! `.automation-*` and `.work-item*` rules in
//! `shared/styles/settings/automation.css`. The dialog's state is in
//! `crate::work`.

use raphie_core::contracts::{WorkActor, WorkItem, WorkStatus};
use raphie_core::engine::Command;
use rune::{El, Tx, col, row, text, text_input};
use rune_kit::Dialog;

use super::parts::{Scope, group_with, page, status};
use crate::format::date_time;
use crate::icons;
use crate::sections::BotSection;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, text_field};

pub fn work(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.work.get(bot_id) {
        Some(lists) => {
            let busy = s.model.changing_work;
            let mut body = vec![
                open_group(&lists.open, name, busy, t),
                closed_group(&lists.closed, name, busy, t),
            ];
            // While the dialog is open it shows the error itself.
            if let (false, Some(error)) = (s.work_form.open, &s.model.work_change_error) {
                body.push(error_line(t, error).key("rd-work-error"));
            }
            body
        }
        None => vec![loading(s, bot_id, t)],
    };
    dialog(s, name, look, overlays);
    page(
        "rd-page-work",
        "Work",
        &BotSection::Work.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

/// The items are on their way, or could not be fetched.
fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let failed = s
        .model
        .work_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "Work", "Loading work…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Work",
        "Could not load work items.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-work-retry"),
            true,
            move |s: &mut Ui| {
                s.model.work_error = None;
                s.command(Command::LoadWork {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

fn error_line(t: &Theme, error: &str) -> El {
    text(error.to_owned())
        .role("alert")
        .font(font(12.5, 500.0))
        .color(t.error)
        .wrap()
}

/// Quiet wrapped text, the web's `.automation-note`.
fn note(t: &Theme, content: impl Into<String>) -> El {
    text(content)
        .font(font(12.0, 400.0).lh(19.2))
        .color(t.muted_foreground)
        .wrap()
}

/// The web's `.automation-empty`.
fn empty(t: &Theme, content: String) -> El {
    row().w_full().padding(20.0).child(
        text(content)
            .font(font(13.0, 400.0))
            .color(t.muted_foreground)
            .wrap()
            .shrink(),
    )
}

/// "Open": the items still going, and "New item".
fn open_group(items: &[WorkItem], bot: &str, busy: bool, t: &Theme) -> El {
    let add = pressable(
        button(
            t,
            Kind::Primary,
            Size::Small,
            Some(&icons::PLUS),
            "New item",
        )
        .key("rd-work-new"),
        true,
        |s: &mut Ui| s.open_work_form(None),
    );
    let mut rows: Vec<El> = items.iter().map(|item| card(item, bot, busy, t)).collect();
    if rows.is_empty() {
        rows.push(empty(
            t,
            format!(
                "Nothing open. {bot} opens an item when something you ask for will take longer than one reply."
            ),
        ));
    }
    group_with(
        t,
        "Open",
        &format!(
            "{bot} updates these as it works. Ask about any of them in the chat, or change one here."
        ),
        Some(add),
        rows,
    )
}

/// "Done": finished and dropped items.
fn closed_group(items: &[WorkItem], bot: &str, busy: bool, t: &Theme) -> El {
    let mut rows: Vec<El> = items.iter().map(|item| card(item, bot, busy, t)).collect();
    if rows.is_empty() {
        rows.push(empty(t, "Nothing closed yet.".to_owned()));
    }
    group_with(
        t,
        "Done",
        "Finished and dropped items, newest first.",
        None,
        rows,
    )
}

fn status_label(status: WorkStatus) -> &'static str {
    match status {
        WorkStatus::Active => "Active",
        WorkStatus::Waiting => "Waiting",
        WorkStatus::Done => "Done",
        WorkStatus::Dropped => "Dropped",
    }
}

/// One item: where it stands, the bot's notes, its latest result, who
/// opened and closed it, and what can be done to it.
fn card(item: &WorkItem, bot: &str, busy: bool, t: &Theme) -> El {
    let key = |part: &str| format!("rd-work-{}-{part}", item.id);
    let by = |actor: WorkActor| match actor {
        WorkActor::Bot => bot.to_owned(),
        WorkActor::Owner => "you".to_owned(),
    };
    let set = |status: WorkStatus| {
        let id = item.id.clone();
        move |s: &mut Ui| s.set_work_status(&id, status)
    };
    // Active reads as work in progress, like a working session.
    let (fill, ink) = if item.status == WorkStatus::Active {
        (t.accent_soft, t.accent)
    } else {
        (t.muted, t.muted_foreground)
    };
    let badge = row().px(6.0).py(2.0).radius(6.0).fill(fill).child(
        text(status_label(item.status))
            .key(key("badge"))
            .font(font(11.0, 400.0).lh(16.0))
            .color(ink),
    );
    let mut card = col()
        .key(format!("rd-work-{}", item.id))
        .w_full()
        .px(20.0)
        .py(18.0)
        .child(
            row()
                .w_full()
                .gap(12.0)
                .justify_between()
                .center_y()
                .mb(6.0)
                .child(
                    text(item.title.clone())
                        .font(font(14.0, 600.0))
                        .color(t.foreground)
                        .wrap()
                        .shrink(),
                )
                .child(badge),
        );
    if let (WorkStatus::Waiting, Some(waiting)) = (item.status, &item.waiting_on) {
        card = card.child(
            text(format!("Waiting on {waiting}"))
                .key(key("waiting"))
                .font(font(12.0, 400.0).lh(19.2))
                .color(t.attention)
                .wrap(),
        );
    }
    if !item.notes.is_empty() {
        card = card.child(
            text(item.notes.clone())
                .font(font(13.0, 400.0).lh(20.8))
                .color(t.foreground)
                .wrap()
                .mt(4.0)
                .mb(8.0),
        );
    }
    if let Some(result) = &item.result {
        card = card.child(note(
            t,
            format!("Latest: {} · {}", result.text, date_time(result.at)),
        ));
    }
    let mut meta = format!(
        "{} · Opened by {}, {}",
        item.id,
        by(item.opened.by),
        date_time(item.opened.at)
    );
    if let Some(closed) = &item.closed {
        let how = if item.status == WorkStatus::Done {
            "Done"
        } else {
            "Dropped"
        };
        meta.push_str(&format!(
            " · {how} by {}, {}",
            by(closed.by),
            date_time(closed.at)
        ));
    }
    card = card.child(note(t, meta).key(key("meta")));

    let mut buttons = row().w_full().gap(8.0).flex_wrap().center_y().mt(12.0);
    if item.status.is_open() {
        let edit = item.id.clone();
        buttons = buttons
            .child(pressable(
                button(t, Kind::Outline, Size::Small, None, "Mark done").key(key("done")),
                !busy,
                set(WorkStatus::Done),
            ))
            .child(pressable(
                button(t, Kind::Ghost, Size::Small, None, "Edit").key(key("edit")),
                !busy,
                move |s: &mut Ui| s.open_work_form(Some(&edit)),
            ))
            .child(pressable(
                button(t, Kind::Ghost, Size::Small, None, "Drop").key(key("drop")),
                !busy,
                set(WorkStatus::Dropped),
            ));
    } else {
        buttons = buttons.child(pressable(
            button(t, Kind::Ghost, Size::Small, None, "Reopen").key(key("reopen")),
            !busy,
            set(WorkStatus::Active),
        ));
    }
    card.child(buttons)
}

/// "New item" or "Edit item": a title and notes in a modal.
fn dialog(s: &Ui, bot: &str, look: &Look, overlays: &mut Vec<El>) {
    let t = &look.theme;
    let form = &s.work_form;
    if !form.open {
        return;
    }
    let busy = s.model.changing_work;
    let caption = |content: &str| text(content).font(font(12.0, 550.0)).color(t.foreground);
    let editing = form.id.is_some();

    // Notes run to a few lines, so they are a text area in a box.
    let mut notes = text_input(&form.notes, font(12.25, 400.0).lh(19.0))
        .key("rd-work-notes-input")
        .label("Notes")
        .w_full()
        .color(t.foreground)
        .placeholder(
            "What it is about, and anything to keep in mind.",
            t.muted_foreground,
        )
        .caret(t.foreground, t.selection())
        .disabled(busy);
    if !busy {
        notes = notes
            .on_edit(|s: &mut Ui| &mut s.work_form.notes)
            // In a paragraph, Return starts a new line.
            .on_submit(|s: &mut Ui, _: &mut Tx| s.work_form.notes.insert("\n"));
    }
    let notes_box = col()
        .key("rd-work-notes")
        .w_full()
        .min_h(80.0)
        .padding(10.0)
        .radius(7.0)
        .fill(t.background.alpha(0.5))
        .border(1.0, t.border)
        .child(notes);

    let mut body = col()
        .key("rd-work-form")
        .w_full()
        .px(16.0)
        .pb(16.0)
        .gap(10.0)
        .child(caption("Title"))
        .child(text_field(
            t,
            Field {
                key: "rd-work-title",
                label: "Title",
                placeholder: "Flights to Lisbon",
                edit: &form.title,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.work_form.title,
            |s: &mut Ui, _: &mut Tx| s.save_work_form(),
        ))
        .child(caption("Notes"))
        .child(notes_box);
    // What is wrong with the form first, then what the runtime refused.
    let error = form
        .error
        .map(str::to_owned)
        .or_else(|| s.model.work_change_error.clone());
    if let Some(error) = error {
        body = body.child(error_line(t, &error).key("rd-work-form-error"));
    }
    body = body.child(
        row()
            .w_full()
            .gap(8.0)
            .flex_wrap()
            .center_y()
            .child(pressable(
                button(
                    t,
                    Kind::Primary,
                    Size::Regular,
                    None,
                    if editing { "Save" } else { "Add item" },
                )
                .key("rd-work-save"),
                !busy && form.is_complete(),
                |s: &mut Ui| s.save_work_form(),
            ))
            .child(pressable(
                button(t, Kind::Ghost, Size::Regular, None, "Cancel").key("rd-work-cancel"),
                !busy,
                |s: &mut Ui| s.close_work_form(),
            )),
    );

    let description = if editing {
        format!("{bot} reads the title and notes the next time it works on this.")
    } else {
        format!("Something for {bot} to keep track of. It sees new items with your next message.")
    };
    Dialog::new("rd-work", if editing { "Edit item" } else { "New item" })
        .description(&description)
        .width(560.0)
        .fit()
        .open(true)
        .on_close(|s: &mut Ui| s.close_work_form())
        .child(body)
        .build(&look.kit, overlays);
}
