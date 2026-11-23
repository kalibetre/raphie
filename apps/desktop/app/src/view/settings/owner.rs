//! Settings → You: who every bot is talking to. Shared by every bot.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/owner-settings.tsx`
//! and the `.owner-time-zone` rules in `shared/styles/settings/bot.css`.
//! The form's rules live in `crate::owner`.

use raphie_core::engine::Command;
use rune::{El, Tx, col, row, text, text_input};
use rune_kit::{Combobox, ComboboxOption};

use super::instructions::{Instructions, instructions_field};
use super::parts::{SaveBar, Scope, page, save_bar, status};
use super::profile::{label, section};
use super::rules::{Rules, rules_field};
use crate::owner::{ABOUT_LIMIT, NOT_SET, device_zone, time_zones, zone_label};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, text_field};

const LEDE: &str =
    "Who every bot is talking to: your name, your time zone and a few lines about you.";

pub fn owner(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let groups = if s.owner.saved.is_some() {
        vec![
            you(s, look, overlays),
            about(s, t),
            rules(s, t),
            instructions(s, t),
        ]
    } else if let Some(error) = &s.model.owner_error {
        let retry = pressable(
            button(t, Kind::Outline, Size::Small, None, "Try again").key("rd-owner-retry"),
            true,
            |s: &mut Ui| {
                s.model.owner_error = None;
                s.command(Command::LoadOwner);
            },
        );
        vec![status(t, "Could not load your profile", error, Some(retry))]
    } else {
        vec![status(t, "Loading…", "Fetching your profile.", None)]
    };
    page("rd-page-owner", "You", LEDE, Scope::App, groups, look)
}

/// "You": name, what bots call the owner, and their time zone.
fn you(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let busy = s.model.saving_owner;
    let draft = &s.owner;
    let first_name = draft.name.text.split_whitespace().next().unwrap_or("");
    let call_me_hint = if first_name.is_empty() {
        "A first name or nickname"
    } else {
        first_name
    };
    let submit = |s: &mut Ui, _: &mut Tx| s.save_owner();
    section(
        t,
        "You",
        "Every bot knows this about you. It describes you and grants nothing.",
        col()
            .w_full()
            .gap(10.0)
            .child(label(t, "Name"))
            .child(text_field(
                t,
                Field {
                    key: "rd-owner-name",
                    label: "Name",
                    placeholder: "Your name",
                    edit: &draft.name,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.owner.name,
                submit,
            ))
            .child(label(t, "What bots call you"))
            .child(text_field(
                t,
                Field {
                    key: "rd-owner-call-me",
                    label: "What bots call you",
                    placeholder: call_me_hint,
                    edit: &draft.call_me,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.owner.call_me,
                submit,
            ))
            .child(label(t, "Time zone"))
            .child(time_zone(s, look, overlays))
            .child(
                text("Bots see the time of each message here, so “tomorrow at 9” means your 9.")
                    .font(font(11.0, 400.0))
                    .color(t.muted_foreground)
                    .wrap(),
            ),
    )
}

/// The searchable list of time zones, and a button for this machine's.
fn time_zone(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let busy = s.model.saving_owner;
    let chosen = &s.owner.time_zone;
    let mut options = vec![ComboboxOption::new(NOT_SET, "Not set")];
    // A saved zone this machine does not list stays choosable.
    let zones = time_zones();
    if !chosen.is_empty() && !zones.contains(chosen) {
        options.push(ComboboxOption::new(chosen.clone(), zone_label(chosen)));
    }
    options.extend(
        zones
            .iter()
            .map(|zone| ComboboxOption::new(zone.clone(), zone_label(zone))),
    );
    let current = if chosen.is_empty() {
        NOT_SET
    } else {
        chosen.as_str()
    };
    let picker = Combobox::new(
        "rd-owner-time-zone",
        &s.owner.zones,
        &options,
        |s: &mut Ui| &mut s.owner.zones,
    )
    .label("Time zone")
    .current(Some(current))
    .search_placeholder("Search time zones")
    .empty_message("No time zone matches.")
    .width(320.0)
    .max_height(280.0)
    .disabled(busy)
    .on_choose(|s: &mut Ui, id: &str, _: &mut Tx| {
        s.owner.time_zone = if id == NOT_SET {
            String::new()
        } else {
            id.to_owned()
        };
        s.model.owner_message = None;
    })
    .build(&look.kit, overlays);
    let mut line = row().w_full().gap(8.0).center_y().child(picker);
    if let Some(here) = device_zone().filter(|here| here != chosen) {
        let label = format!("Use {}", zone_label(&here));
        line = line.child(pressable(
            button(t, Kind::Ghost, Size::Small, None, &label).key("rd-owner-device-zone"),
            !busy,
            move |s: &mut Ui| {
                s.owner.time_zone = here.clone();
                s.model.owner_message = None;
            },
        ));
    }
    line
}

/// "About you": a few lines in the owner's words.
fn about(s: &Ui, t: &Theme) -> El {
    let busy = s.model.saving_owner;
    let mut editor = text_input(&s.owner.about, font(13.0, 400.0).lh(22.0))
        .key("rd-owner-about")
        .label("About you")
        .w_full()
        .color(t.foreground)
        .placeholder(
            "I run a small design studio. Mornings are for deep work, so keep anything non-urgent until after lunch.",
            t.muted_foreground,
        )
        .caret(t.foreground, t.selection())
        .disabled(busy);
    if !busy {
        editor = editor
            .on_edit(|s: &mut Ui| &mut s.owner.about)
            // In a paragraph, Return starts a new line instead of submitting.
            .on_submit(|s: &mut Ui, _: &mut Tx| s.owner.about.insert("\n"));
    }
    let count = s.owner.about.text.chars().count();
    let over = count > ABOUT_LIMIT;
    section(
        t,
        "About you",
        "A few lines every bot should know: your work, your days, how you like to be helped.",
        col()
            .w_full()
            .gap(10.0)
            .child(
                col()
                    .key("rd-owner-about-box")
                    .w_full()
                    .min_h(160.0)
                    .padding(12.0)
                    .radius(8.0)
                    .fill(t.background.alpha(0.5))
                    .border(
                        1.0,
                        if s.owner.about.focused && !busy {
                            t.accent
                        } else {
                            t.border
                        },
                    )
                    .child(editor)
                    // A press on the empty part of the box puts the caret in.
                    .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-owner-about", false)),
            )
            .child(
                text(format!(
                    "{} / 2,000 · Don’t put passwords or keys here.",
                    thousands(count)
                ))
                .key("rd-owner-about-count")
                .font(font(11.0, 400.0))
                .color(if over { t.error } else { t.muted_foreground })
                .wrap(),
            ),
    )
}

/// "Rules for every bot": what the owner wants done every time.
fn rules(s: &Ui, t: &Theme) -> El {
    rules_field(
        t,
        Rules {
            key: "rd-owner-rules",
            title: "Rules for every bot",
            note: "What you want done every time, whichever bot you are talking to. Each bot reads these in every conversation, before its own rules.",
            placeholder: "Give times on a 12-hour clock, in my time zone.\nLeave all-day events out of my schedule.",
            edit: &s.owner.rules,
            busy: s.model.saving_owner,
        },
        |s: &mut Ui| &mut s.owner.rules,
    )
}

/// "Instructions for every bot": Raphie's own until changed, with a way
/// back to them.
fn instructions(s: &Ui, t: &Theme) -> El {
    let busy = s.model.saving_owner;
    let raphies = s
        .owner
        .saved
        .as_ref()
        .is_some_and(|saved| saved.instructions_default);
    let reset = (!raphies).then(|| {
        pressable(
            button(t, Kind::Ghost, Size::Small, None, "Reset to Raphie’s")
                .key("rd-owner-instructions-reset"),
            // Not over unsaved edits: save or discard them first.
            !busy && !s.owner.is_dirty(),
            |s: &mut Ui| s.reset_owner_instructions(),
        )
    });
    instructions_field(
        t,
        Instructions {
            key: "rd-owner-instructions",
            title: "Instructions for every bot",
            note: "How every bot works with the tools Raphie gives them all, such as cards and questions, and anything else you want every bot to know about its tools. Each bot reads these in every conversation, before its own instructions, and the bots you allow to update your profile add to them when you ask.",
            placeholder: "When I ask about my day, show it as a timeline card.",
            edit: &s.owner.instructions,
            busy,
            status: Some(if raphies {
                "Raphie’s own, updated with each release until changed"
            } else {
                "Changed from Raphie’s own"
            }),
            action: reset,
        },
        |s: &mut Ui| &mut s.owner.instructions,
    )
}

/// `1234` as "1,234", as the web's `toLocaleString` writes it.
fn thousands(n: usize) -> String {
    if n < 1000 {
        n.to_string()
    } else {
        format!("{},{:03}", n / 1000, n % 1000)
    }
}

/// The bar docked under the page while there is something to save or to
/// say.
pub fn owner_save_bar(s: &Ui, look: &Look) -> Option<El> {
    s.owner.saved.as_ref()?;
    let dirty = s.owner.is_dirty();
    let saving = s.model.saving_owner;
    let error = if let Some(error) = &s.model.owner_save_error {
        Some(error.clone())
    } else if dirty {
        s.owner.problem()
    } else {
        None
    };
    let message = s.model.owner_message.as_ref();
    if !(dirty || saving || message.is_some() || error.is_some()) {
        return None;
    }
    let status = match message {
        _ if dirty => "Unsaved changes".to_owned(),
        Some(message) => message.clone(),
        None => "Saved".to_owned(),
    };
    Some(save_bar(
        &look.theme,
        SaveBar {
            key: "rd-owner",
            error,
            status,
            save_label: if saving { "Saving…" } else { "Save changes" },
            can_save: s.can_save_owner(),
            can_discard: dirty && !saving,
            extra: None,
        },
        |s: &mut Ui| s.discard_owner(),
        |s: &mut Ui| s.save_owner(),
    ))
}
