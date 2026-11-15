//! Settings → Memory: whether a bot remembers between conversations, which
//! back end keeps its memories, and what that back end can do.
//!
//! Mirrors `memory-settings.tsx`, `memory-hindsight-fields.tsx` and
//! `memory-capabilities.tsx`, and the `.settings-form` rules in
//! `shared/styles/settings/forms.css`. The form's state lives in
//! `crate::memory`; its checks in `raphie_core::memory`.
//!
//! One difference from the web: the back ends it lists as "planned"
//! (Honcho, Obsidian) are left out here, because this list cannot show an
//! option that cannot be chosen.

use raphie_core::contracts::{MemoryProvider, MemoryStatus, Reflection};
use rune::{El, Tx, col, row, text};
use rune_kit::{Select, SelectAppearance};

use super::parts::{SaveBar, Scope, group, group_with, page, save_bar, setting, status, value};
use crate::icons;
use crate::memory::MemoryDraft;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, checkbox, pressable, switch, text_field};

const BUILTIN: &str = "Raphie · built-in";
const HINDSIGHT: &str = "Hindsight";

pub fn memory(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    // The form is shown once the settings are here and it holds this bot's.
    let ready = s
        .model
        .memory
        .get(bot_id)
        .filter(|_| s.memory.bot_id() == Some(bot_id));
    let body = match ready {
        Some(status) => vec![
            backend(s, bot_id, status, look, overlays),
            capabilities(status, t),
        ],
        None => vec![loading(s, bot_id, t)],
    };
    page(
        "rd-page-memory",
        "Memory",
        &BotSection::Memory.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

/// The settings are on their way, or could not be fetched.
fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    // The error names the bot it was for, so an old failure for another bot
    // is not shown here.
    let failed = s
        .model
        .memory_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "Memory backend", "Loading memory settings…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Memory backend",
        "Memory settings are unavailable. Check your connection to Raphie.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-memory-retry"),
            true,
            move |s: &mut Ui| {
                s.model.memory_error = None;
                s.command(raphie_core::engine::Command::LoadMemory {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// The group that holds the form: the switch, the back end, its fields.
fn backend(s: &Ui, bot_id: &str, status: &MemoryStatus, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let draft: &MemoryDraft = &s.memory;
    let saved = &status.configuration;
    let busy = s.model.saving_memory || s.model.testing_memory;
    let dirty = draft.is_dirty();
    let external = draft.provider == MemoryProvider::Hindsight;

    let browse_bot = bot_id.to_owned();
    let browse = pressable(
        button(t, Kind::Outline, Size::Small, None, "Browse memories").key("rd-memory-browse"),
        true,
        move |s: &mut Ui| {
            s.open_settings(Some(Page::Bot {
                bot_id: browse_bot.clone(),
                section: BotSection::MemoryBrowse,
            }));
        },
    );

    let enable = setting(
        t,
        None,
        "Enable memory",
        "Let the agent remember lasting preferences and useful facts you share, and recall them in future sessions. It retains selected memories rather than copies of whole conversations.",
        Some(pressable(
            switch(t, draft.enabled, "Enable memory").key("rd-memory-enabled"),
            !busy,
            |s: &mut Ui| s.memory.enabled = !s.memory.enabled,
        )),
    );

    let caption = |content: &str| text(content).font(font(13.0, 560.0)).color(t.foreground);
    let note = |content: &str| {
        text(content)
            .font(font(12.5, 400.0))
            .color(t.muted_foreground)
            .wrap()
    };
    let options = [BUILTIN, HINDSIGHT];
    let mut form = col()
        .key("rd-memory-form")
        .w_full()
        .padding(18.0)
        .gap(12.0)
        .child(caption("Backend"))
        .child(
            Select::new("rd-memory-backend", &options)
                .label("Backend")
                .appearance(SelectAppearance::Field)
                .width(280.0)
                .current(Some(if external { HINDSIGHT } else { BUILTIN }))
                .open(draft.choosing_backend)
                .disabled(busy)
                .on_toggle(|s: &mut Ui| s.memory.choosing_backend = !s.memory.choosing_backend)
                .on_close(|s: &mut Ui| s.memory.choosing_backend = false)
                .on_choose(|s: &mut Ui, chosen: &str, _: &mut Tx| {
                    s.memory.provider = if chosen == HINDSIGHT {
                        MemoryProvider::Hindsight
                    } else {
                        MemoryProvider::Builtin
                    };
                    s.memory.choosing_backend = false;
                })
                .build(&look.kit, overlays),
        )
        .child(note(if external {
            "Connect your Hindsight server and a dedicated bank. Selected memories leave this device when retained or queried."
        } else {
            "Stored locally in this backend’s SQLite database. Search is lexical; the conversation model synthesizes reflections from evidence. No background consolidation yet."
        }))
        .child(caption("Owner / assistant scope"))
        .child(text_field(
            t,
            Field {
                key: "rd-memory-scope",
                label: "Owner / assistant scope",
                placeholder: "",
                edit: &draft.scope,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.memory.scope,
            |s: &mut Ui, _: &mut Tx| s.save_memory(),
        ))
        .child(note(
            "Only this scope is available to the agent. Changing it leaves the previous scope’s memories intact.",
        ));
    if external {
        form = hindsight_fields(form, draft, saved.has_credential, busy, t);
    }

    // A test tries the setup as it is saved, so edits must be saved first.
    let test_label = if s.model.testing_memory {
        "Testing…"
    } else {
        "Test saved connection"
    };
    let mut actions = row()
        .w_full()
        .gap(8.0)
        .flex_wrap()
        .center_y()
        .child(pressable(
            button(t, Kind::Outline, Size::Regular, None, test_label).key("rd-memory-test"),
            !busy && !dirty && saved.enabled,
            |s: &mut Ui| s.test_memory(),
        ));
    if dirty {
        actions = actions.child(note("Save before testing; tests use the saved setup.").shrink());
    }
    form = form.child(actions);
    if let (Some(message), false) = (&s.model.memory_message, dirty) {
        form = form.child(note(message).key("rd-memory-message"));
    }

    group_with(
        t,
        "Memory backend",
        "One active backend. Switching preserves existing data; it does not copy or merge memories.",
        Some(browse),
        vec![enable, form],
    )
}

/// The endpoint, bank and key fields that only apply to Hindsight.
fn hindsight_fields(form: El, draft: &MemoryDraft, has_key: bool, busy: bool, t: &Theme) -> El {
    let caption = |content: &str| text(content).font(font(13.0, 560.0)).color(t.foreground);
    let key_caption = if has_key {
        "API key · saved"
    } else {
        "API key · optional for a local server"
    };
    let mut form = form
        .child(caption("Hindsight endpoint"))
        .child(text_field(
            t,
            Field {
                key: "rd-memory-endpoint",
                label: "Hindsight endpoint",
                placeholder: "http://127.0.0.1:8888",
                edit: &draft.endpoint,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.memory.endpoint,
            |s: &mut Ui, _: &mut Tx| s.save_memory(),
        ))
        .child(caption("Bank ID"))
        .child(text_field(
            t,
            Field {
                key: "rd-memory-bank",
                label: "Bank ID",
                placeholder: "",
                edit: &draft.bank_id,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.memory.bank_id,
            |s: &mut Ui, _: &mut Tx| s.save_memory(),
        ))
        .child(caption(key_caption))
        .child(text_field(
            t,
            Field {
                key: "rd-memory-key",
                label: "API key",
                placeholder: if has_key {
                    "Leave blank to keep saved key"
                } else {
                    "Enter an API key"
                },
                // A secure field: it draws dots, never the key.
                edit: &draft.key,
                disabled: busy || draft.clear_key,
                compact: true,
            },
            |s: &mut Ui| &mut s.memory.key,
            |s: &mut Ui, _: &mut Tx| s.save_memory(),
        ))
        .child(
            text("Encrypted with the backend’s OS credential store. Re-enter or clear it when changing the destination.")
                .font(font(12.5, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    if has_key {
        form = form.child(pressable(
            checkbox(t, draft.clear_key, "Clear saved API key").key("rd-memory-clear-key"),
            !busy,
            |s: &mut Ui| {
                s.memory.clear_key = !s.memory.clear_key;
                // A key typed before ticking the box is dropped, not sent.
                s.memory.key.clear();
            },
        ));
    }
    form
}

/// What the active back end can do for this bot.
fn capabilities(status: &MemoryStatus, t: &Theme) -> El {
    let provider = status.capabilities.reflect == Reflection::Provider;
    let revise = status.capabilities.revise;
    group(
        t,
        "Available on this backend",
        "What the saved backend offers. It changes when you save a different one.",
        vec![
            setting(
                t,
                Some(&icons::DATABASE),
                "Retain and recall",
                "Explicit memory tools, source references and a bounded search result.",
                None,
            ),
            setting(
                t,
                Some(&icons::NETWORK),
                if provider {
                    "Provider reflection"
                } else {
                    "Model-assisted reflection"
                },
                if provider {
                    "Hindsight reasons over memories and manages consolidation. Use a dedicated bank; scope tags are retrieval filters, not tenant isolation."
                } else {
                    "The agent reasons from local evidence and cites its IDs. Derived reflections are not stored as facts."
                },
                None,
            ),
            setting(
                t,
                Some(&icons::ERASER),
                "Correct and forget",
                if revise {
                    "Edit or remove built-in evidence from Browse memory, or ask the agent. Chat transcripts and backups are separate."
                } else {
                    "Manage corrections and deletions directly in Hindsight. These actions are not available through Raphie yet."
                },
                Some(value(
                    if revise { "Available" } else { "External" },
                    t.muted_foreground,
                )),
            ),
        ],
    )
}

/// The bar under the page once the form has edits, is saving, or a save
/// failed.
pub fn memory_save_bar(s: &Ui, look: &Look) -> Option<El> {
    let dirty = s.memory.is_dirty();
    let saving = s.model.saving_memory;
    // What the host said first, then what is wrong with the form itself.
    let error = match &s.model.memory_save_error {
        Some(error) => Some(error.clone()),
        None if dirty => s.memory_problem().map(str::to_owned),
        None => None,
    };
    if !(dirty || saving || error.is_some()) {
        return None;
    }
    Some(save_bar(
        &look.theme,
        SaveBar {
            key: "rd-memory",
            error,
            status: if dirty {
                "Unsaved memory changes".to_owned()
            } else {
                "Saved".to_owned()
            },
            save_label: if saving {
                "Saving…"
            } else {
                "Save memory settings"
            },
            can_save: s.can_save_memory(),
            can_discard: dirty && !saving,
            extra: None,
        },
        |s: &mut Ui| s.discard_memory(),
        |s: &mut Ui| s.save_memory(),
    ))
}
