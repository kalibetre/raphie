//! A new conversation: the bot's empty desk, and work it can take on.
//! Choosing one puts the request in the composer to edit and send; nothing
//! is sent until the owner sends it.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/welcome.tsx` and
//! the `.welcome` rules in `chat.css`.

use rune::{El, Icon, Tx, col, icon, row, text};

use super::Look;
use crate::avatar::bot_avatar;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{centered, one_line};

/// Each job's icon, title, detail and the request it puts in the composer,
/// as on the web.
const JOBS: [(&Icon, &str, &str, &str); 4] = [
    (
        &icons::CALENDAR_CLOCK,
        "Send me a morning briefing",
        "Your day, every morning",
        "Send me a short briefing of my day every morning.",
    ),
    (
        &icons::MAIL,
        "Keep an eye on my inbox",
        "Draft replies for my OK",
        "Keep an eye on my inbox and draft replies for me to check before anything is sent.",
    ),
    (
        &icons::SEARCH,
        "Research something",
        "And write it up",
        "Research this for me and write up what you find: ",
    ),
    (
        &icons::MESSAGE_SQUARE,
        "Help me think something through",
        "No setup needed",
        "Help me think something through: ",
    ),
];

/// Below this width the jobs stack in one column, as on the web.
const TWO_COLUMNS: f32 = 520.0;

pub fn welcome(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let bot_id = s.model.selected_bot().map_or("default", |b| b.id.as_str());
    // The pane beside the roster, less its padding, up to the jobs' width.
    let pane = s.main_width();
    let room = (pane - 64.0).clamp(0.0, 560.0);
    let columns = if pane >= TWO_COLUMNS { 2 } else { 1 };
    // Equal columns: a flexible row would size each card by its text.
    let card_width = (room - 8.0 * (columns as f32 - 1.0)) / columns as f32;
    let mut grid = col().key("rd-jobs").w_full().max_w(560.0).mt(24.0).gap(8.0);
    for pair in JOBS.chunks(columns) {
        let mut line = row().w_full().gap(8.0);
        for job in pair {
            line = line.child(job_card(job, t).w(card_width));
        }
        grid = grid.child(line);
    }
    col()
        .key("rd-empty")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .padding(32.0)
        // Extra room below keeps the greeting where the web has it, centred
        // in the pane as if the composer floated over it.
        .pb(74.0)
        .center()
        .child(bot_avatar(bot_id, look.tones.of(bot_id), 64.0).mb(14.0))
        .child(
            text("I’m ready when you are.")
                .role("heading")
                .font(font(26.0, 600.0).tracking(-0.5))
                .color(t.foreground)
                .mt(8.0)
                .mb(6.0),
        )
        .child(centered(
            "Give me something to look after, or just ask.",
            font(14.0, 400.0).lh(22.4),
            t.muted_foreground,
        ))
        .child(grid)
}

/// One kind of work: pressing it puts its request in the composer.
fn job_card(job: &(&'static Icon, &'static str, &'static str, &'static str), t: &Theme) -> El {
    let (glyph, title, detail, request) = *job;
    row()
        .key(format!("rd-job-{}", title.len()))
        .role("button")
        .label(title)
        .min_w(0.0)
        .px(14.0)
        .py(12.0)
        .gap(10.0)
        .items_start()
        .radius(11.0)
        .fill(t.card)
        .border(1.0, t.border)
        .hover(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        .child(
            icon(glyph, 16.0)
                .color(t.muted_foreground)
                .mt(2.0)
                .a11y_hidden(),
        )
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .gap(1.0)
                .child(one_line(title, font(13.5, 550.0), t.foreground))
                .child(one_line(detail, font(12.0, 400.0), t.muted_foreground)),
        )
        .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
            s.suggest(request);
            tx.focus("rd-composer", false);
        })
}
