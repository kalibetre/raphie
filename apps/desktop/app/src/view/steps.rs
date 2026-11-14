//! The tools a run used: a one-line summary that unfolds into a list of
//! steps, each with its arguments, result and, when it needs the owner, the
//! decision bar.
//!
//! Mirrors `apps/web/src/domains/approvals/presentation/tool-steps.tsx` and
//! `tool-decision.tsx`, and the `.steps`, `.step` and `.decision` rules in
//! `chat.css`.

use std::f32::consts::FRAC_PI_2;

use raphie_core::contracts::{Channel, Decision, Scope, SessionApproval};
use raphie_core::projections::{
    ApprovalState, StepState, ToolStep, approval_state, format_duration, pretty, step_state,
};
use rune::{El, Icon, LiveRegion, ScrollSpec, TextCase, col, el, icon, row, text};
use rune_kit::Loader;

use super::Look;
use crate::format;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::widgets::{Kind, Size, button, pressable};

/// One run's tool activity, as the conversation shows it.
pub struct Run<'a> {
    /// The turn the run answers; its id keys the block.
    pub turn_id: &'a str,
    pub steps: &'a [ToolStep],
    /// What the run is doing right now, with how long it has been going.
    /// `None` once the run has finished.
    pub working: Option<Working>,
}

pub struct Working {
    pub label: String,
    pub elapsed: String,
}

pub fn tool_steps(s: &Ui, run: &Run, now: i64, look: &Look) -> El {
    let needs_you = run
        .steps
        .iter()
        .any(|step| step_state(step, now) == StepState::Pending);
    // Settled work stays folded; a pending approval forces it open because
    // it needs the owner.
    let expanded = needs_you || s.open_runs.contains(run.turn_id);
    let mut block = col()
        .key(format!("rd-steps-{}", run.turn_id))
        .role("group")
        .label("Tool activity")
        .w_full()
        .child(header(run, needs_you, expanded, look));
    if expanded && !run.steps.is_empty() {
        let mut list = col().w_full().mt(6.0);
        for (index, step) in run.steps.iter().enumerate() {
            let last = index + 1 == run.steps.len();
            list = list.child(step_row(s, step, last, now, look));
        }
        block = block.child(list);
    }
    // Screen readers hear a run start to need the owner.
    if needs_you {
        block = block.live_region(LiveRegion::Polite);
    }
    block
}

/// "Used 2 tools · 4s", "Running calendar · list…  12s elapsed" or
/// "Waiting for your approval": press it to unfold the steps.
fn header(run: &Run, needs_you: bool, expanded: bool, look: &Look) -> El {
    let t = &look.theme;
    let count = run.steps.len();
    let label = if needs_you {
        "Waiting for your approval".to_owned()
    } else if let Some(working) = &run.working {
        working.label.clone()
    } else {
        // From the first step's start to the last step's end.
        let first = run.steps.first().map_or(0, |step| step.started_at);
        let last = run
            .steps
            .iter()
            .map(|step| step.done_at.unwrap_or(step.started_at))
            .max()
            .unwrap_or(first);
        let tools = if count == 1 { "tool" } else { "tools" };
        format!("Used {count} {tools} · {}", format_duration(last - first))
    };
    let ink = if needs_you {
        t.attention
    } else {
        t.muted_foreground
    };
    let lead = if needs_you {
        icon(&icons::SHIELD_QUESTION_MARK, 14.0).color(ink)
    } else if run.working.is_some() {
        Loader::new().size(14.0).color(ink).build(&look.kit)
    } else {
        icon(&icons::WRENCH, 14.0).color(ink)
    };
    let weight = if needs_you { 560.0 } else { 400.0 };
    let mut header = row()
        .key(format!("rd-steps-toggle-{}", run.turn_id))
        .role("button")
        .label(label.clone())
        .pl(2.0)
        .pr(6.0)
        .py(3.0)
        .gap(7.0)
        .center_y()
        .radius(6.0)
        .child(lead.a11y_hidden())
        .child(
            text(label)
                .font(font(13.0, weight))
                .color(ink)
                .a11y_hidden(),
        );
    if let (Some(working), false) = (&run.working, needs_you) {
        header = header.child(
            text(format!("{} elapsed", working.elapsed))
                .font(font(11.5, 400.0))
                .color(t.faint)
                .a11y_hidden(),
        );
    }
    // Nothing to unfold without steps, and nothing to fold while one of
    // them waits for the owner.
    let foldable = count > 0 && !needs_you;
    if foldable {
        let turn_id = run.turn_id.to_owned();
        header = header
            .child(
                icon(&icons::CHEVRON_RIGHT, 14.0)
                    .color(ink)
                    // Points right when folded, down when unfolded.
                    .icon_rotation(if expanded { FRAC_PI_2 } else { 0.0 })
                    .a11y_hidden(),
            )
            .hover(t.hover.alpha(0.6))
            .focus_ring(2.0, 2.0, t.accent)
            .on_press(move |s: &mut Ui| Ui::toggle(&mut s.open_runs, &turn_id));
    }
    // A row keeps the header as wide as its text, not the whole column.
    row().w_full().child(header)
}

/// One tool call: its state icon in the left gutter, details on the right.
fn step_row(s: &Ui, step: &ToolStep, last: bool, now: i64, look: &Look) -> El {
    let t = &look.theme;
    let state = step_state(step, now);
    let approval = step.approval.as_ref();

    // The icon and its colours say how the step went.
    let (glyph, ink, fill): (Option<&'static Icon>, _, _) = match state {
        StepState::Pending => (
            Some(&icons::SHIELD_QUESTION_MARK),
            t.attention,
            t.attention_soft,
        ),
        StepState::Running => (None, t.muted_foreground, t.muted),
        StepState::Done => (Some(&icons::CHECK), t.accent, t.accent_soft),
        StepState::Rejected => (Some(&icons::X), t.error, t.muted),
        StepState::Uncertain => (Some(&icons::CIRCLE_ALERT), t.error, t.muted),
    };
    let badge = match glyph {
        Some(glyph) => icon(glyph, 13.0).color(ink),
        // A running step spins.
        None => Loader::new().size(13.0).color(ink).build(&look.kit),
    };
    let mut gutter = col().w(20.0).items_center().child(
        row()
            .size(20.0, 20.0)
            .mt(1.0)
            .center()
            .radius(10.0)
            .fill(fill)
            .child(badge.a11y_hidden()),
    );
    if !last {
        // The line that joins this step to the next one.
        gutter = gutter.child(el().w(1.0).grow(1.0).fill(t.border));
    }

    let status = match (state, approval) {
        (StepState::Pending, _) => "needs approval".to_owned(),
        (StepState::Uncertain, _) => "outcome unknown".to_owned(),
        (_, Some(approval)) => decided(approval, now),
        (StepState::Done, None) => {
            format_duration(step.done_at.unwrap_or(step.started_at) - step.started_at)
        }
        _ => "running".to_owned(),
    };
    let mut name = row().gap(6.0).center_y().grow(1.0).min_w(0.0);
    if let Some(server) = &step.server {
        name = name.child(
            text(server.clone())
                .font(font(13.0, 400.0))
                .color(t.muted_foreground),
        );
    }
    name = name.child(text(step.tool.clone()).font(mono(12.0)).color(t.foreground));
    let step_id = step.id.clone();
    let summary = row()
        .key(format!("rd-step-toggle-{}", step.id))
        .role("button")
        .label(format!("{} {status}", step.tool))
        .w_full()
        .min_h(22.0)
        .gap(10.0)
        .center_y()
        .radius(6.0)
        .child(name)
        .child(
            text(status)
                .font(font(11.5, 400.0))
                .color(if state == StepState::Pending {
                    t.attention
                } else {
                    t.faint
                }),
        )
        .on_press(move |s: &mut Ui| Ui::toggle(&mut s.open_steps, &step_id));

    let mut body = col().grow(1.0).min_w(0.0).pb(8.0).child(summary);
    // A step waiting for the owner always shows what it would run.
    let open = state == StepState::Pending || s.open_steps.contains(&step.id);
    if open {
        // The approval holds the exact arguments; the journal's copy may be cut.
        let args = approval
            .map(|approval| approval.arguments_json.as_str())
            .or(step.args.as_deref());
        if let Some(args) = args {
            body = body.child(section_label("Arguments", t)).child(code_box(
                &format!("rd-step-args-{}", step.id),
                pretty(args),
                t,
            ));
        }
        if let Some(result) = &step.result {
            body = body.child(section_label("Result", t)).child(code_box(
                &format!("rd-step-result-{}", step.id),
                result.clone(),
                t,
            ));
        }
        if state == StepState::Uncertain {
            body = body.child(
                text("This action may have executed. Check the external service before asking again.")
                    .font(font(12.5, 400.0))
                    .color(t.attention)
                    .wrap()
                    .mt(8.0)
                    .live_region(LiveRegion::Polite),
            );
        }
    }
    if let (StepState::Pending, Some(approval)) = (state, approval) {
        body = body.child(decision(
            approval,
            s.model.deciding.contains(&approval.id),
            t,
        ));
    }
    row()
        .key(format!("rd-step-{}", step.id))
        .w_full()
        .gap(10.0)
        .child(gutter)
        .child(body)
}

/// "approved via telegram", "rejected", "expired".
fn decided(approval: &SessionApproval, now: i64) -> String {
    let outcome = match approval_state(approval, now) {
        ApprovalState::Pending => "pending",
        ApprovalState::Approved => "approved",
        ApprovalState::Rejected => "rejected",
        ApprovalState::Expired => "expired",
        ApprovalState::Uncertain => "uncertain",
    };
    let via = match approval.decided_via {
        Some(Channel::Web) => " via web",
        Some(Channel::Discord) => " via discord",
        Some(Channel::Telegram) => " via telegram",
        Some(Channel::Unknown) | None => "",
    };
    format!("{outcome}{via}")
}

/// "ARGUMENTS", "RESULT".
fn section_label(label: &str, t: &Theme) -> El {
    text(label)
        .font(font(11.0, 400.0).tracking(0.6))
        .color(t.faint)
        // Drawn in capitals; screen readers get the word as written.
        .text_case(TextCase::Uppercase)
        .mt(8.0)
        .mb(4.0)
}

/// Monospaced text in a bordered box that scrolls once it is tall.
fn code_box(key: &str, content: String, t: &Theme) -> El {
    col()
        .key(key)
        .w_full()
        .max_h(260.0)
        .scroll(ScrollSpec {
            stick_bottom: false,
        })
        .radius(8.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(
            text(content)
                .font(mono(12.0))
                .color(t.foreground)
                .selectable(true)
                .selection_color(t.selection())
                .wrap_anywhere()
                .px(12.0)
                .py(10.0),
        )
}

/// When the approval expires, and the answers (the web's `.decision`).
fn decision(approval: &SessionApproval, deciding: bool, t: &Theme) -> El {
    // Each closure needs its own copy of the id (see `learning-rust.md`,
    // "Cloning on purpose").
    let reject_id = approval.id.clone();
    let approve_id = approval.id.clone();
    let mut bar = row()
        .key(format!("rd-approval-{}", approval.id))
        .role("group")
        .label(format!(
            "Approval needed: {} {}",
            approval.server, approval.tool
        ))
        .w_full()
        .mt(10.0)
        .px(12.0)
        .py(10.0)
        .gap(8.0)
        .flex_wrap()
        .center_y()
        .radius(10.0)
        .fill(t.card)
        .border(1.0, t.attention_soft)
        .child(
            text(format!("Expires {}", format::clock(approval.expires_at)))
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .grow(1.0),
        )
        .child(pressable(
            button(t, Kind::Outline, Size::Small, Some(&icons::X), "Reject")
                .key(format!("rd-reject-{}", approval.id)),
            !deciding,
            move |s: &mut Ui| s.decide(&reject_id, Decision::Rejected, Scope::Once),
        ))
        .child(pressable(
            button(
                t,
                Kind::Primary,
                Size::Small,
                Some(&icons::CHECK),
                "Approve once",
            )
            .key(format!("rd-approve-{}", approval.id)),
            !deciding,
            move |s: &mut Ui| s.decide(&approve_id, Decision::Approved, Scope::Once),
        ));
    // Commands can also be allowed for the rest of the conversation.
    if approval.allows_session_scope() {
        let session_id = approval.id.clone();
        bar = bar.child(pressable(
            button(t, Kind::Outline, Size::Small, None, "Approve for session")
                .key(format!("rd-approve-session-{}", approval.id))
                .help(format!(
                    "Allow these exact arguments for {} in this bot conversation: {}",
                    approval.tool, approval.arguments_json
                )),
            !deciding,
            move |s: &mut Ui| s.decide(&session_id, Decision::Approved, Scope::Session),
        ));
    }
    bar
}
