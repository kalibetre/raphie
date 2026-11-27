//! What waits on the owner, docked on top of the composer: the oldest
//! question or approval with its choices, the rest as edges peeking behind
//! it. Answering one brings up the next.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/question-dock.tsx`
//! and the `.question-dock` rules in `chat.css`.

use std::f32::consts::FRAC_PI_2;

use raphie_core::dock::{DockItem, Waiting, dock_items};
use raphie_core::projections::pretty;
use rune::{El, ScrollSpec, Span, TextCase, col, el, icon, rich, row, text};

use super::Look;
use super::asks;
use super::steps::{code_box, decision};
use crate::format;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font, mono};

/// What waits on the owner in the open conversation, oldest first.
pub fn items(s: &Ui) -> Vec<DockItem<'_>> {
    let Some(observation) = s
        .model
        .conversation
        .as_ref()
        .and_then(|conversation| conversation.observation.as_ref())
    else {
        return Vec::new();
    };
    let name = s
        .model
        .selected_bot()
        .map_or("Raphie", |bot| bot.name.as_str());
    dock_items(observation, name, format::now_ms())
}

/// The dock for `items`, or nothing when none wait.
pub fn dock(s: &Ui, items: &[DockItem], look: &Look) -> Option<El> {
    let t = &look.theme;
    let top = items.first()?;
    let more = items.len() - 1;
    // The web's `max-height: min(46vh, 420px)`; the top scrolls past it.
    let tallest = if s.workspace_height > 0.0 {
        (s.workspace_height * 0.46).min(420.0)
    } else {
        420.0
    };
    let mut body = col()
        .key(format!("rd-dock-top-{}", top.id))
        .w_full()
        .min_w(0.0)
        .max_h(tallest)
        .scroll(ScrollSpec {
            stick_bottom: false,
        })
        .pt(10.0)
        .px(14.0)
        .pb(4.0)
        .fill(t.attention_soft)
        // No bottom edge: the composer below closes the box.
        .border_sides([1.0, 1.0, 0.0, 1.0], t.attention)
        .corners([14.0, 14.0, 0.0, 0.0])
        .child(header(top, more, t));
    body = body.child(match &top.waiting {
        Waiting::Question(ask) => asks::card(s, ask, look).mt(6.0).mb(8.0),
        Waiting::Approval(approval) => {
            let id = format!("dock-args:{}", approval.id);
            let open = s.open_steps.contains(&id);
            let lead = "Run ";
            let words = format!("{lead}{} on {}?", approval.tool, approval.server);
            let code = Span::new(lead.len(), lead.len() + approval.tool.len())
                .mono()
                .size(12.5)
                .bg(t.card, 3.0);
            let mut block = col()
                .key(format!("rd-dock-approval-{}", approval.id))
                .w_full()
                .min_w(0.0)
                .gap(6.0)
                .mt(6.0)
                .mb(8.0)
                .child(
                    rich(words, vec![code])
                        .font(font(13.5, 500.0).lh(19.5))
                        .color(t.foreground),
                )
                .child(
                    row()
                        .key(format!("rd-dock-args-{}", approval.id))
                        .role("button")
                        .label("Arguments")
                        .gap(4.0)
                        .center_y()
                        .child(
                            icon(&icons::CHEVRON_RIGHT, 12.0)
                                .color(t.muted_foreground)
                                .icon_rotation(if open { FRAC_PI_2 } else { 0.0 })
                                .a11y_hidden(),
                        )
                        .child(
                            text("Arguments")
                                .font(font(12.0, 400.0))
                                .color(t.muted_foreground)
                                .a11y_hidden(),
                        )
                        .on_press(move |s: &mut Ui| Ui::toggle(&mut s.open_steps, &id)),
                );
            if open {
                block = block.child(code_box(
                    &format!("rd-dock-args-code-{}", approval.id),
                    pretty(&approval.arguments_json),
                    t,
                ));
            }
            block.child(decision(approval, s.model.deciding.contains(&approval.id), t).mt(4.0))
        }
    });
    let mut dock = col()
        .key("rd-dock")
        .role("region")
        .label("Waiting on you")
        .w_full()
        .min_w(0.0)
        .pt(12.0);
    // Edges of what waits behind the top, deepest first so the nearer one
    // draws over it.
    if more > 1 {
        dock = dock.child(edge(16.0, 0.0, 0.6, t));
    }
    if more > 0 {
        dock = dock.child(edge(8.0, 6.0, 0.85, t));
    }
    Some(dock.child(body))
}

/// The title, the kind, and how many more wait.
fn header(top: &DockItem, more: usize, t: &Theme) -> El {
    let kind = match top.waiting {
        Waiting::Question(_) => "Question",
        Waiting::Approval(_) => "Approval",
    };
    let meta = [
        (more > 0).then(|| format!("+{more} waiting")),
        top.item_id.map(str::to_owned),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let mut header = row()
        .key("rd-dock-header")
        .w_full()
        .min_w(0.0)
        .gap(8.0)
        .center_y()
        .child(
            text(top.title.to_owned())
                .font(font(11.5, 600.0))
                .color(t.attention)
                .truncate()
                .shrink()
                .min_w(0.0)
                .help(top.title.to_owned()),
        )
        .child(
            text(kind)
                .key("rd-dock-kind")
                .font(font(10.0, 700.0).tracking(0.6).lh(14.0))
                .color(t.attention)
                // Drawn in capitals; screen readers hear the word as written.
                .text_case(TextCase::Uppercase)
                .px(5.0)
                .radius(4.0)
                .border(1.0, t.attention)
                .single_line(),
        );
    if !meta.is_empty() {
        // Pushed to the right end; the title gives up its room first.
        header = header.child(el().grow(1.0)).child(
            text(meta)
                .key("rd-dock-meta")
                .font(mono(10.5))
                .color(t.muted_foreground)
                .single_line(),
        );
    }
    header
}

/// One edge peeking above the top: inset `inset` from each side, `top` from
/// the dock's top, faded to `opacity`.
fn edge(inset: f32, top: f32, opacity: f32, t: &Theme) -> El {
    el().pin(Some(inset), Some(top), Some(inset), None)
        .h(24.0)
        .fill(t.attention_soft)
        .border_sides([1.0, 1.0, 0.0, 1.0], t.attention)
        .corners([10.0, 10.0, 0.0, 0.0])
        .layer_opacity(opacity)
        .a11y_hidden()
}
