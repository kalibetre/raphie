//! The composer's command permissions: a button naming how this
//! conversation treats commands, and the two modes to choose between.
//!
//! Mirrors `mcp-permissions.tsx`. The rules (what is known, what may be
//! changed, stale answers) are in the core (`raphie_core::permissions`).

use raphie_core::contracts::ApprovalMode;
use raphie_core::permissions::mode_label;
use rune::{El, col, icon, row, text};
use rune_kit::{Placement, popover, scrim};

use super::Look;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{pressable, toolbar_chip};

/// The element the list hangs from.
const TRIGGER: &str = "rd-permissions";

/// The button in the composer's toolbar. When open, its list is added to
/// `overlays`, which draw above the page.
pub fn permissions(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let mode = s.shown_command_mode();
    // "Loading" while the mode is not known, as the web reads it out.
    let spoken = match mode {
        Some(_) => mode_label(mode),
        None => "Loading",
    };
    let trigger = toolbar_chip(
        t,
        TRIGGER,
        &icons::SHIELD,
        format!("Command permissions: {spoken}"),
        mode_label(mode),
        s.permissions_open,
        // Full access is never on by accident: it reads in amber.
        mode == Some(ApprovalMode::FullAccess),
    )
    .on_press(|s: &mut Ui| s.permissions_open = !s.permissions_open);
    if s.permissions_open {
        // A press anywhere outside closes the list.
        overlays.push(scrim("rd-permissions-scrim", |s: &mut Ui| {
            s.permissions_open = false;
        }));
        let surface = popover::raised(&look.kit, panel(s, mode, t), 10.0)
            .fill(t.card)
            .border(1.0, t.border);
        overlays.push(popover::anchored(
            &look.kit,
            surface,
            TRIGGER,
            Placement::TopStart,
            10.0,
        ));
    }
    trigger
}

fn panel(s: &Ui, mode: Option<ApprovalMode>, t: &Theme) -> El {
    // A new conversation's mode is this client's own; only an open one
    // waits on the runtime.
    let open = s.model.conversation.is_some();
    let state = &s.model.command_mode;
    let (loading, load_failed, saving, save_failed) = if open {
        (
            state.loading,
            state.load_failed,
            state.saving,
            state.save_failed,
        )
    } else {
        (false, false, false, false)
    };
    let can_choose = mode.is_some() && !load_failed && !saving;
    let note = |content: &str| {
        text(content.to_owned())
            .font(font(12.0, 400.0).lh(19.0))
            .color(t.muted_foreground)
            .wrap()
    };
    let mut body = col()
        .key("rd-permissions-list")
        .role("dialog")
        .label("Command permissions")
        .w(320.0)
        .padding(16.0)
        .gap(12.0)
        .child(
            row()
                .gap(8.0)
                .center_y()
                .child(
                    icon(&icons::SHIELD_CHECK, 16.0)
                        .color(t.foreground)
                        .a11y_hidden(),
                )
                .child(
                    text("Command permissions")
                        .font(font(14.0, 600.0))
                        .color(t.foreground),
                ),
        )
        .child(note("Choose how this conversation uses commands."))
        .child(
            col()
                .role("group")
                .label("Command access mode")
                .w_full()
                .gap(4.0)
                .child(option(
                    t,
                    "rd-permissions-ask",
                    ApprovalMode::Ask,
                    "Ask",
                    "Review each command before it runs.",
                    mode,
                    can_choose,
                ))
                .child(option(
                    t,
                    "rd-permissions-full",
                    ApprovalMode::FullAccess,
                    "Full access",
                    "Allow commands without asking in this conversation.",
                    mode,
                    can_choose,
                )),
        )
        .child(note(
            "Sandbox restrictions and external approvals still apply.",
        ));
    let status = |content: &str| {
        text(content.to_owned())
            .font(font(12.0, 400.0))
            .color(t.foreground)
            .wrap()
    };
    if loading {
        body = body.child(
            status("Loading Command permissions…")
                .key("rd-permissions-loading")
                .role("status"),
        );
    }
    if load_failed {
        body = body.child(
            row()
                .w_full()
                .gap(6.0)
                .center_y()
                .child(
                    status("Could not load Command permissions.")
                        .key("rd-permissions-load-error")
                        .role("alert")
                        .color(t.error),
                )
                .child(
                    text("Retry")
                        .key("rd-permissions-retry")
                        .role("button")
                        .font(font(12.0, 400.0))
                        .color(t.error)
                        .focus_ring(1.0, 1.0, t.accent)
                        .on_press(|s: &mut Ui| s.retry_command_mode()),
                ),
        );
    }
    if save_failed {
        body = body.child(
            status("Could not save Command permissions. Please retry.")
                .key("rd-permissions-save-error")
                .role("alert")
                .color(t.error),
        );
    }
    body
}

/// One mode: its name, what it means, and a tick when it is in force.
fn option(
    t: &Theme,
    key: &str,
    value: ApprovalMode,
    title: &str,
    description: &str,
    mode: Option<ApprovalMode>,
    enabled: bool,
) -> El {
    let chosen = mode == Some(value);
    let line = row()
        .key(key.to_owned())
        .role("button")
        .label(title)
        .checked(chosen)
        .w_full()
        .px(8.0)
        .py(8.0)
        .gap(12.0)
        .radius(6.0)
        .hover(t.hover)
        .press(t.hover)
        .focus_ring(1.0, 1.0, t.accent)
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .child(
                    text(title.to_owned())
                        .font(font(14.0, 500.0))
                        .color(t.foreground),
                )
                .child(
                    text(description.to_owned())
                        .font(font(12.0, 400.0).lh(19.0))
                        .color(t.muted_foreground)
                        .wrap(),
                ),
        )
        // `then` builds the tick only for the mode in force; `children`
        // takes the none-or-one it gives.
        .children(chosen.then(|| {
            icon(&icons::CHECK, 15.0)
                .color(t.foreground)
                .a11y_hidden()
                .mt(2.0)
        }));
    pressable(line, enabled, move |s: &mut Ui| s.set_command_mode(value))
}
