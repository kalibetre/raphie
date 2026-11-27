//! The composer: a floating card to type in, with a round send button that
//! becomes Stop while Raphie works.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/composer.tsx`
//! and the `.composer` rules in `chat.css`.
//!
//! Files join a message three ways: the paperclip (the system's file
//! picker, one file at a time), dragging them onto the conversation, or
//! pasting an image or copied files into the text.
//!
//! What waits on the owner docks on top of the card (`dock.rs`), and the
//! card joins it with an amber edge.
//!
//! Beside Send, a small ring fills towards the model's context window, as
//! the web's `context-ring.tsx`; its tooltip gives the numbers.

use raphie_core::attachments::MAX_FILES;
use raphie_core::model_library::selected;
use raphie_core::projections::{context_fill, context_tokens, conversation_usage};
use rune::{
    ClipboardContent, El, LineCap, Path, Shape, Tx, auto_grow, canvas, col, icon, row, text,
    text_input,
};

use super::Look;
use super::attachments::{Action, file_card};
use super::conversation::READING_WIDTH;
use super::handoffs::{delegates, mention_menu, slash_menu};
use super::model_picker::model_picker;
use super::permissions::permissions;
use crate::icons;
use crate::state::Ui;
use crate::theme::font;
use crate::widgets::{centered, icon_button, pressable};

pub fn composer(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let empty = s.composer.text.trim().is_empty();
    // A run is going in this conversation, so it can be stopped.
    let running = s.busy();
    let busy = running || s.model.sending;
    let draft = &s.model.attachments;
    // Only the selected bot's files: uploads belong to one bot.
    let bot_id = s.model.bot_id.as_deref();
    let files = draft.files_for(bot_id);
    // Nothing can be added, removed or sent while either is on its way.
    let locked = s.model.sending || draft.uploading;
    let has_content = !empty || !files.is_empty();

    // The empty field names the bot.
    let name = s
        .model
        .selected_bot()
        .map_or("Raphie", |bot| bot.name.as_str());
    let verb = "Message";
    // While a question is on top of the dock, typing answers it.
    let empty_text = if s.docked_question().is_some() {
        "Or answer in your own words…".to_owned()
    } else {
        format!("{verb} {name}…")
    };
    let input = text_input(&s.composer, font(14.5, 400.0).lh(21.0))
        .key("rd-composer")
        .label(format!("{verb} {name}"))
        .w_full()
        .color(t.foreground)
        .placeholder(empty_text, t.muted_foreground)
        .caret(t.foreground, t.selection())
        .on_edit(|s: &mut Ui| &mut s.composer)
        // A pasted image or copied file is attached; text pastes as usual.
        .on_input_paste(|s: &mut Ui, content: &ClipboardContent, _: &mut Tx| {
            s.paste_attachment(content)
        })
        // An open "@" menu takes its keys first: arrows, Return, Tab, Escape.
        .on_input_key(|s: &mut Ui, key: &rune::KeyEvent, _: &mut Tx| {
            s.slash_key(key) || s.mention_key(key)
        })
        // Return sends; Shift-Return types a new line.
        .on_submit(|s: &mut Ui, _: &mut Tx| s.send());

    let send = pressable(
        row()
            .key("rd-send")
            .role("button")
            .label("Send message")
            .size(28.0, 28.0)
            .center()
            // Half the side: a circle.
            .radius(14.0)
            .fill(t.primary)
            .hover(t.background.alpha(0.1))
            .press(t.background.alpha(0.2))
            .focus_ring(2.0, 2.0, t.accent)
            .child(
                icon(&icons::ARROW_UP, 14.0)
                    .color(t.primary_foreground)
                    .a11y_hidden(),
            ),
        has_content && !locked,
        |s: &mut Ui| s.send(),
    );
    // While Raphie works: with nothing typed, Stop takes the send button's
    // place; with a message typed (it would queue), both show.
    let stop = row()
        .key("rd-stop")
        .role("button")
        .label("Stop task")
        .help("Stop task")
        .size(28.0, 28.0)
        .center()
        .radius(14.0)
        .fill(t.error.alpha(0.15))
        .hover(t.error.alpha(0.1))
        .press(t.error.alpha(0.2))
        .focus_ring(2.0, 2.0, t.accent)
        .child(icon(&icons::SQUARE, 13.0).color(t.error).a11y_hidden())
        .on_press(|s: &mut Ui| s.stop());
    let mut actions = row().gap(6.0).center_y().children(context_pie(s, look));
    if running {
        actions = actions.child(stop);
    }
    if !running || has_content {
        actions = actions.child(send);
    }
    let attach = icon_button(
        t,
        &icons::PAPERCLIP,
        16.0,
        "Attach a file (up to four, 8 MiB each)",
    )
    .key("rd-attach");
    // `pressable` takes a handler without `Tx`; opening the picker needs
    // one, so the disabled look is applied here by hand.
    let attach = if !locked && files.len() < MAX_FILES {
        attach.on_press_tx(|_: &mut Ui, tx: &mut Tx| Ui::choose_attachment(tx))
    } else {
        attach.disabled(true).layer_opacity(0.5)
    };

    // What waits on the owner, docked on top of the card.
    let (waiting, folded) = super::dock::items(s);
    let dock = super::dock::dock(s, &waiting, folded, look);
    let mut card = col()
        .key("rd-composer-card")
        .w_full()
        .pt(14.0)
        .pr(12.0)
        .pb(10.0)
        .pl(16.0)
        // Square on top under the dock, which it closes.
        .corners(if dock.is_some() {
            [0.0, 0.0, 18.0, 18.0]
        } else {
            [18.0; 4]
        })
        .fill(t.card)
        // The border warms towards the accent while typing, as on the web.
        // The border turns to the accent while files are dragged over, and
        // is amber under the dock, open or folded, so the two read as one.
        .border(
            1.0,
            if s.drop_hover {
                t.accent
            } else if dock.is_some() {
                t.attention
            } else if s.composer.focused {
                t.border.mix(t.accent, 0.4)
            } else {
                t.border
            },
        );
    if let Some(quote) = super::quote::in_composer(s, look) {
        card = card.child(quote);
    }
    if !files.is_empty() {
        // The web scrolls the cards sideways; here they wrap onto new rows.
        let mut chips = row()
            .key("rd-attachments")
            .role("list")
            .label("Attached files")
            .w_full()
            .mb(12.0)
            .gap(8.0)
            .flex_wrap();
        for file in files {
            let key = format!("rd-attachment-{}", file.id);
            let picture = bot_id.and_then(|bot| Some((bot, s.picture(bot, &file.id)?)));
            chips = chips.child(file_card(t, &key, file, picture, &Action::Remove, !locked));
        }
        card = card.child(chips);
    }
    let mut card = card
        // The text grows from one line to ten, then scrolls.
        .child(auto_grow(input, 1, 10))
        .child(
            // One row at any width: in a narrow window the model's name is
            // cut short first, so the send button never moves.
            row()
                .key("rd-composer-toolbar")
                .w_full()
                .mt(10.0)
                .min_h(32.0)
                .gap(4.0)
                .center_y()
                // The paperclip sits 6 left of the text's edge so its
                // glyph, not its hover square, lines up with the text.
                .child(attach.ml(-6.0))
                // The model cannot change while Raphie works or a message
                // is on its way.
                .child(model_picker(s, !busy && !locked, look, overlays))
                .child(permissions(s, look, overlays))
                // The bots working for this conversation, if any.
                .children(delegates(s, look, overlays))
                // Takes the room that is left and puts the context pie and
                // the buttons at its right end.
                .child(row().grow(1.0).justify_end().child(actions)),
        )
        // A press anywhere on the card puts the caret in the text.
        .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-composer", false));
    for shadow in t.composer_shadow {
        card = card.box_shadow(shadow);
    }
    if !slash_menu(s, look, overlays) {
        mention_menu(s, look, overlays);
    }

    let mut wrap = col()
        .w_full()
        .max_w(READING_WIDTH)
        // The web's `.composer-wrap`, which is 12 px a side in a narrow window.
        .px(if s.narrow() { 12.0 } else { 28.0 })
        .pt(4.0)
        .pb(if s.narrow() { 12.0 } else { 14.0 });
    if let Some(error) = &draft.error {
        wrap = wrap.child(
            text(error.clone())
                .key("rd-attach-error")
                .role("alert")
                .font(font(12.5, 400.0))
                .color(t.error)
                .wrap()
                .mb(8.0),
        );
    }
    // A task another bot handed off: the owner continues it here.
    if let Some(from) = s.handed_off_by() {
        wrap = wrap.child(super::handoffs::note(s, from, look));
    }
    wrap = wrap.children(dock).child(card);
    if draft.uploading {
        wrap = wrap.child(
            centered("Uploading to workspace…", font(11.5, 400.0), t.faint)
                .key("rd-attach-uploading")
                .role("status")
                .w_full()
                .mt(8.0),
        );
    }
    col()
        .key("rd-composer-area")
        .w_full()
        .items_center()
        .child(wrap)
}

/// How full the model's context is, as a small ring beside Send, or
/// nothing while the model's context window is not known. The ring fills
/// with the share of the window the conversation's latest model call used;
/// it is empty before the first.
fn context_pie(s: &Ui, look: &Look) -> Option<El> {
    let t = &look.theme;
    let active = s.active_model()?;
    let window = selected(&s.bot_models()?.models, &active)?.context_window;
    let (used, usage) = match &s.model.conversation {
        Some(conversation) => {
            let turns = conversation.turns();
            let runs: Vec<&str> = turns.iter().map(|turn| turn.id.as_str()).collect();
            let activity = conversation
                .observation
                .as_ref()
                .map_or(&[][..], |observation| &observation.activity[..]);
            (
                context_tokens(&runs, activity),
                conversation_usage(&runs, activity),
            )
        }
        None => (None, None),
    };
    let fill = context_fill(used, window, usage)?;
    let ink = if fill.nearly_full {
        t.attention
    } else {
        t.accent
    };
    let mut label = format!("{}.", fill.context);
    if let Some(spent) = &fill.spent {
        label.push_str(&format!(" {spent}."));
    }
    // An 18-point drawing: a circle in the border colour, and over it the
    // same circle from twelve o'clock, clockwise, as far as the share. The
    // circle is one closed stroke (Rune rounds its joints, so it has no
    // seams); the share is a filled band, so its ends are flat.
    let mut shape = Shape::new().stroke_path(&circle(), RING_WIDTH, LineCap::Round, t.border);
    if fill.share > 0.0 {
        shape = shape.fill_path(&band(fill.share as f32), ink);
    }
    let mut ring = row()
        .key("rd-context")
        .role("img")
        .label(label)
        .focusable(true)
        .size(28.0, 28.0)
        .center()
        .radius(8.0)
        .focus_ring(2.0, 2.0, t.accent)
        .help(fill.context)
        .help_above()
        .child(canvas(shape).size(18.0, 18.0).a11y_hidden());
    if let Some(spent) = fill.spent {
        ring = ring.help_row(spent);
    }
    Some(ring)
}

/// The centre of the ring's 18-point drawing, its radius and its width.
const CENTRE: f32 = 9.0;
const RADIUS: f32 = 7.0;
const RING_WIDTH: f32 = 2.5;

/// A point `radius` from the centre, `turn` of the way round clockwise
/// from twelve o'clock (y grows downwards).
fn on_circle(radius: f32, turn: f32) -> [f32; 2] {
    let angle = turn * std::f32::consts::TAU;
    [CENTRE + radius * angle.sin(), CENTRE - radius * angle.cos()]
}

/// How many points a `share` of the circle is drawn with: one every 3
/// degrees, smooth at this size.
fn steps(share: f32) -> usize {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let steps = (share * 120.0).ceil() as usize;
    steps.max(1)
}

/// The ring's whole circle.
fn circle() -> Path {
    let mut path = Path::new().move_to(on_circle(RADIUS, 0.0));
    for step in 1..steps(1.0) {
        path = path.line_to(on_circle(RADIUS, step as f32 / steps(1.0) as f32));
    }
    path.close()
}

/// The ring's width from twelve o'clock round to `share` of a turn: out
/// along the outer edge, back along the inner, with flat ends. A whole
/// turn stops just short, so the band stays a simple shape.
fn band(share: f32) -> Path {
    let share = share.min(0.9999);
    let (outer, inner) = (RADIUS + RING_WIDTH / 2.0, RADIUS - RING_WIDTH / 2.0);
    let count = steps(share);
    let turn = |step: usize| share * step as f32 / count as f32;
    let mut path = Path::new().move_to(on_circle(outer, 0.0));
    for step in 1..=count {
        path = path.line_to(on_circle(outer, turn(step)));
    }
    for step in (0..=count).rev() {
        path = path.line_to(on_circle(inner, turn(step)));
    }
    path.close()
}
