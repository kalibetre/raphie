//! Settings → Sandbox: how a bot runs commands. A short form (provider,
//! the host-network acknowledgement, idle minutes, disk quota), then what
//! the active provider is, what it keeps, and its limits.
//!
//! Mirrors `sandbox-settings.tsx` and `sandbox-form.tsx`. The form's state
//! is in `crate::sandbox`; the checks and the longer sentences' numbers in
//! `raphie_core::sandbox`.
//!
//! Two differences from the web. Its provider list shows unavailable
//! providers greyed out; this list cannot show an option that cannot be
//! chosen, so it leaves them out (the rows under it still say why each is
//! unavailable). And where the web only disables Save for a bad number,
//! the save bar here says what is wrong.

use raphie_core::contracts::{SandboxInfo, SandboxProvider};
use raphie_core::engine::Command;
use raphie_core::sandbox::{bytes, files_summary};
use rune::{El, Tx, row, text};
use rune_kit::{Select, SelectAppearance};

use super::parts::{SaveBar, Scope, group, group_with, page, save_bar, setting, status};
use crate::icons;
use crate::sandbox::SandboxDraft;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, switch, text_field};

/// The width of the form's controls (the web's `12rem` at its 14 px root).
const CONTROL: f32 = 168.0;

pub fn sandbox(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    // The error names the bot it was for, so an old failure for another bot
    // is not shown here.
    let failed = s
        .model
        .sandbox_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    // The page is shown once the details are here and the form holds this
    // bot's settings.
    let ready = s
        .model
        .sandbox
        .get(bot_id)
        .filter(|_| s.sandbox.bot_id() == Some(bot_id));
    let body = match ready {
        Some(info) => {
            let mut groups = Vec::new();
            if failed {
                // Details loaded earlier stay; say they may be out of date.
                groups.push(
                    text("Sandbox details could not refresh. Showing the last received policy.")
                        .key("rd-sandbox-stale")
                        .role("alert")
                        .font(font(12.5, 500.0))
                        .color(t.error)
                        .wrap(),
                );
            }
            groups.push(form(s, info, look, overlays));
            groups.push(provider(info, t));
            groups.push(workspace(bot_id, info, t));
            groups.push(limits(info, t));
            groups
        }
        None => vec![loading(bot_id, failed, t)],
    };
    page(
        "rd-page-sandbox",
        "Sandbox",
        &BotSection::Sandbox.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

/// The details are on their way, or could not be fetched.
fn loading(bot_id: &str, failed: bool, t: &Theme) -> El {
    if !failed {
        return status(t, "Execution provider", "Loading sandbox details…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Execution provider",
        "Could not load sandbox details. Check your connection to Raphie.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-sandbox-retry"),
            true,
            move |s: &mut Ui| {
                s.model.sandbox_error = None;
                s.command(Command::LoadSandbox {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// "Sandbox settings": the four things the owner chooses.
fn form(s: &Ui, info: &SandboxInfo, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let draft: &SandboxDraft = &s.sandbox;
    let busy = s.model.saving_sandbox;
    let container = draft.provider == SandboxProvider::Container;

    // Only providers this machine can run, plus the one in the form, so
    // the list never loses the current choice.
    let offered: Vec<(SandboxProvider, &str)> = info
        .providers
        .iter()
        .filter(|entry| entry.available || entry.id == draft.provider)
        .map(|entry| (entry.id, entry.name.as_str()))
        .collect();
    let names: Vec<&str> = offered.iter().map(|(_, name)| *name).collect();
    let current = offered
        .iter()
        .find(|(id, _)| *id == draft.provider)
        .map(|(_, name)| *name);
    // The handler outlives this frame, so it owns its copy of the names.
    let choices: Vec<(SandboxProvider, String)> = offered
        .iter()
        .map(|(id, name)| (*id, (*name).to_owned()))
        .collect();
    let mut rows = vec![setting(
        t,
        None,
        "Provider",
        "Choose the provider for this bot’s workspace.",
        Some(
            Select::new("rd-sandbox-provider", &names)
                .label("Sandbox provider")
                .appearance(SelectAppearance::Field)
                .width(CONTROL)
                .current(current)
                .open(draft.choosing_provider)
                .disabled(busy)
                .on_toggle(|s: &mut Ui| s.sandbox.choosing_provider = !s.sandbox.choosing_provider)
                .on_close(|s: &mut Ui| s.sandbox.choosing_provider = false)
                .on_choose(move |s: &mut Ui, chosen: &str, _: &mut Tx| {
                    if let Some((id, _)) = choices.iter().find(|(_, name)| name == chosen) {
                        s.sandbox.provider = *id;
                    }
                    s.sandbox.choosing_provider = false;
                })
                .build(&look.kit, overlays),
        ),
    )];
    for entry in info.providers.iter().filter(|entry| !entry.available) {
        rows.push(setting(
            t,
            None,
            &format!("{} · Unavailable", entry.name),
            entry.reason.as_deref().unwrap_or(""),
            None,
        ));
    }
    // Shown for Container, and while a saved acknowledgement can still be
    // withdrawn.
    if container || draft.acknowledged {
        rows.push(setting(
            t,
            None,
            "I understand host and local network access",
            "Required before enabling Container. Container programs can reach services on this machine and the local network, including Raphie’s API. This acknowledgement allows that access for this bot; it does not block traffic. Host credentials are not provided. To withdraw acknowledgement, select just-bash, turn this off and save.",
            Some(pressable(
                switch(
                    t,
                    draft.acknowledged,
                    "Acknowledge host and local network access",
                )
                .key("rd-sandbox-acknowledge"),
                !busy,
                |s: &mut Ui| s.sandbox.acknowledged = !s.sandbox.acknowledged,
            )),
        ));
    }
    let submit = |s: &mut Ui, _: &mut Tx| s.save_sandbox();
    rows.push(setting(
        t,
        None,
        "Idle minutes",
        "Applies to the container provider. Stops the container after 1–1440 idle minutes. Has no effect on just-bash.",
        Some(row().w(CONTROL).child(text_field(
            t,
            Field {
                key: "rd-sandbox-idle",
                label: "Idle minutes",
                placeholder: "",
                edit: &draft.idle,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.sandbox.idle,
            submit,
        ))),
    ));
    rows.push(setting(
        t,
        None,
        "Disk quota (MiB)",
        "Applies to the container provider. Leave empty for no limit (the default). Has no effect on just-bash.",
        Some(row().w(CONTROL).child(text_field(
            t,
            Field {
                key: "rd-sandbox-quota",
                label: "Disk quota (MiB)",
                placeholder: "No limit",
                edit: &draft.quota,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.sandbox.quota,
            submit,
        ))),
    ));
    group(
        t,
        "Sandbox settings",
        "Saved for this bot across restarts. Providers keep separate files; switching does not move or delete them.",
        rows,
    )
}

/// "Execution provider": what is running the bot's commands now. This is
/// the saved provider, not the one chosen in the form above.
fn provider(info: &SandboxInfo, t: &Theme) -> El {
    let container = info.provider.id == SandboxProvider::Container;
    let acknowledged = info.settings.host_network_acknowledged;
    let waiting = container && !acknowledged;
    let chip = row()
        .key("rd-sandbox-state")
        .px(7.0)
        .py(3.5)
        .radius(7.0)
        .border(1.0, t.border)
        .child(
            text(if waiting {
                "Acknowledgement required"
            } else {
                "Active"
            })
            .font(font(10.5, 400.0))
            .color(t.foreground),
        );
    let about = if !container {
        format!(
            "Active · Version {} · Shell commands over a virtual filesystem",
            info.provider.version
        )
    } else if acknowledged {
        "Active · Native programs in a per-bot container".to_owned()
    } else {
        "Awaiting acknowledgement · Native container provider".to_owned()
    };
    group(
        t,
        "Execution provider",
        if container {
            "The provider runs commands against this bot’s durable workspace."
        } else {
            "The active just-bash provider has fixed, read-only limits."
        },
        vec![
            setting(
                t,
                Some(&icons::BOX),
                &info.provider.name,
                &about,
                Some(chip),
            ),
            setting(
                t,
                None,
                "Available capabilities",
                if container {
                    "Real files, git and native programs with open network. Host and local network services are reachable. Authenticated integrations use host-side MCP with their own approvals."
                } else {
                    "Supported shell commands and file processing. Network access, host files and native programs are unavailable. MCP integrations run separately with their own approvals."
                },
                None,
            ),
            setting(
                t,
                None,
                "Isolation",
                if container {
                    "Non-root container with a read-only system, limited memory, CPU and processes. Only this bot’s folder is mounted. Containers share a kernel; this is not VM isolation. Host/LAN network access is not blocked."
                } else {
                    "Logical filesystem separation in a disposable worker. This is not OS or VM isolation."
                },
                None,
            ),
        ],
    )
}

/// "Persistent workspace": where the bot's files live and what survives.
fn workspace(bot_id: &str, info: &SandboxInfo, t: &Theme) -> El {
    let container = info.provider.id == SandboxProvider::Container;
    let bot_id = bot_id.to_owned();
    let browse = pressable(
        button(
            t,
            Kind::Outline,
            Size::Small,
            Some(&icons::FOLDER_OPEN),
            "Browse files",
        )
        .key("rd-sandbox-browse"),
        true,
        move |s: &mut Ui| {
            s.open_settings(Some(Page::Bot {
                bot_id: bot_id.clone(),
                section: BotSection::Workspace,
            }));
        },
    );
    let persistence = if container {
        format!(
            "Files survive failed and interrupted commands and restarts. There is no rollback. Processes stop after {} idle minutes or on command timeout/abort; files remain. An interrupted command has an unknown outcome: inspect files before retrying.",
            info.settings.idle_minutes
        )
    } else {
        "A zero shell exit commits file changes. Failed or interrupted executions discard their changes. Shell state and temporary files do not persist.".to_owned()
    };
    group_with(
        t,
        "Persistent workspace",
        "",
        Some(browse),
        vec![
            setting(
                t,
                None,
                &info.root,
                "Shared by this bot’s conversations and preserved across restarts. Other bots have separate files.",
                None,
            ),
            setting(
                t,
                None,
                if container {
                    "File persistence"
                } else {
                    "Checkpoint policy"
                },
                &persistence,
                None,
            ),
            setting(
                t,
                None,
                "Current activity",
                &format!(
                    "{} running or waiting · {} admitted operations per bot · {} simultaneous workers across the runtime",
                    info.executions.admitted,
                    info.executions.capacity,
                    info.executions.runtime_concurrency
                ),
                None,
            ),
        ],
    )
}

/// "Execution limits": time, sizes, files and history.
fn limits(info: &SandboxInfo, t: &Theme) -> El {
    let container = info.provider.id == SandboxProvider::Container;
    let seconds = info.limits.timeout_ms / 1000;
    let history = if container {
        "Interrupted operations are recorded and never replayed automatically. Durable receipts are retained up to 10,000 entries; new writes stop at capacity. File browsing does not consume receipts.".to_owned()
    } else {
        format!(
            "{} used of {}. Retained receipts prevent duplicate writes during recovery. New executions stop at capacity.",
            bytes(info.usage.receipt_bytes.unwrap_or(0)),
            bytes(info.limits.receipts_bytes.unwrap_or(0))
        )
    };
    group(
        t,
        "Execution limits",
        "A busy workspace queues its own conversations in order.",
        vec![
            setting(
                t,
                None,
                "Time",
                &format!(
                    "{seconds} seconds{}",
                    if container {
                        " per operation; container startup also has a CLI deadline"
                    } else {
                        ", including worker startup"
                    }
                ),
                None,
            ),
            setting(
                t,
                None,
                "Command and output",
                &format!(
                    "{} command source · {} output",
                    bytes(info.limits.source_bytes),
                    bytes(info.limits.output_bytes)
                ),
                None,
            ),
            setting(t, None, "Files", &files_summary(info), None),
            setting(t, None, "Execution history", &history, None),
        ],
    )
}

/// The bar under the page while the form has edits, is saving, or has
/// something to say.
pub fn sandbox_save_bar(s: &Ui, look: &Look) -> Option<El> {
    let draft = &s.sandbox;
    // `?` leaves when the form holds no bot yet.
    draft.bot_id()?;
    let dirty = draft.is_dirty();
    let saving = s.model.saving_sandbox;
    let elsewhere = dirty
        && s.sandbox_latest()
            .is_some_and(|latest| draft.changed_elsewhere(latest));
    // The most useful problem first: a conflict, then what the host said,
    // then what is wrong with the form itself.
    let error: Option<String> = if elsewhere {
        Some("Sandbox settings changed elsewhere. Your draft is preserved. Copy any edits you want to keep, then Discard to load the latest revision.".into())
    } else if let Some(error) = &s.model.sandbox_save_error {
        Some(error.clone())
    } else if dirty {
        draft.problem().map(str::to_owned)
    } else {
        None
    };
    let message = s.model.sandbox_message.as_ref();
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
            key: "rd-sandbox",
            error,
            status,
            save_label: if saving { "Saving…" } else { "Save changes" },
            can_save: s.can_save_sandbox(),
            can_discard: dirty && !saving,
            extra: None,
        },
        |s: &mut Ui| s.discard_sandbox(),
        |s: &mut Ui| s.save_sandbox(),
    ))
}
