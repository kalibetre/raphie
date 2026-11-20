//! Where the bot stopped reading earlier messages word for word: a rule
//! with "Earlier messages summarized · View summary", and the summary under
//! it once opened. The messages above stay in the transcript.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/compaction-divider.tsx`
//! and the `.compaction-*` rules in `chat.css`.

use raphie_core::contracts::SessionTurn;
use rune::{El, col, icon, row, text};

use super::Look;
use super::handoffs;
use crate::icons;
use crate::state::Ui;
use crate::theme::font;

pub fn divider(s: &Ui, turn: &SessionTurn, look: &Look) -> Option<El> {
    let compaction = turn.compaction.as_ref()?;
    let t = &look.theme;
    let open = s.open_summaries.contains(&turn.id);
    let line = || col().h(1.0).grow(1.0).min_w(16.0).fill(t.border);
    let action = row()
        .gap(2.0)
        .center_y()
        .pl(8.0)
        .pr(6.0)
        .py(1.0)
        .radius(999.0)
        .fill(t.muted)
        .child(
            text(if open { "Hide summary" } else { "View summary" })
                .font(font(12.0, 500.0).lh(18.0))
                .color(t.foreground),
        )
        .child(
            icon(
                if open {
                    &icons::CHEVRON_DOWN
                } else {
                    &icons::CHEVRON_RIGHT
                },
                13.0,
            )
            .color(t.foreground)
            .a11y_hidden(),
        );
    let turn_id = turn.id.clone();
    let pill = row()
        .key(format!("rd-summary-{}", turn.id))
        .role("button")
        .label(if open {
            "Hide the summary of earlier messages"
        } else {
            "View the summary of earlier messages"
        })
        .gap(8.0)
        .center_y()
        .shrink()
        .min_w(0.0)
        .pl(12.0)
        .pr(4.0)
        .py(3.0)
        .radius(999.0)
        .fill(t.background)
        .border(1.0, t.border)
        .hover(t.hover)
        .press(t.hover)
        .focus_ring(1.0, 2.0, t.accent)
        .child(
            text("Earlier messages summarized")
                .font(font(12.0, 400.0).lh(18.0))
                .color(t.muted_foreground)
                .truncate()
                .shrink(),
        )
        .child(action)
        .on_press(move |s: &mut Ui| Ui::toggle(&mut s.open_summaries, &turn_id));
    let mut block = col().w_full().gap(10.0).child(
        row()
            .w_full()
            .gap(12.0)
            .center_y()
            .child(line())
            .child(pill)
            .child(line()),
    );
    if open {
        let why = match compaction.reason.as_str() {
            "overflow" => "The model's context was full.",
            "manual" => "You asked for it.",
            _ => "The conversation was getting long for the model.",
        };
        block = block.child(
            col()
                .key(format!("rd-summary-text-{}", turn.id))
                .w_full()
                .gap(8.0)
                .px(16.0)
                .py(12.0)
                .radius(12.0)
                .fill(t.card)
                .border(1.0, t.border)
                .child(
                    text(format!(
                        "{why} The bot now reads this summary instead of the messages above; they stay here for you."
                    ))
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground)
                    .wrap(),
                )
                .child(handoffs::markdown(s, &compaction.summary, look)),
        );
    }
    Some(block)
}
