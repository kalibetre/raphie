//! Under a finished reply: what the bot changed about itself or the owner's
//! profile in it, as a pill with a way to see or undo the change. A change
//! that did not save shows nothing.
//!
//! Mirrors `self-update-notes.tsx` and the `.self-update-note*` rules in
//! `chat.css`. Which save a step made is worked out in
//! `raphie_core::self_updates`.

use raphie_core::projections::ToolStep;
use raphie_core::self_updates::{
    SelfUpdateKind, SelfUpdateNote, owner_saved, personality_edit, self_update_notes,
};
use rune::{Cursor, El, icon, row, text};

use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};

/// The notes for one reply's tool steps, or `None` when it changed nothing.
pub fn notes(s: &Ui, steps: &[ToolStep], t: &Theme) -> Option<El> {
    let pills: Vec<El> = self_update_notes(steps)
        .iter()
        .filter_map(|note| match note.kind {
            SelfUpdateKind::Personality => personality(s, note, t),
            SelfUpdateKind::Owner => owner(s, note, t),
        })
        .collect();
    if pills.is_empty() {
        return None;
    }
    Some(row().w_full().gap(6.0).flex_wrap().children(pills))
}

/// "Updated its personality · See change · Undo".
fn personality(s: &Ui, note: &SelfUpdateNote, t: &Theme) -> Option<El> {
    let bot_id = s.model.bot_id.clone()?;
    let profile = s.model.bots.iter().find(|bot| bot.id == bot_id)?;
    let history = s.model.bot_history.get(&bot_id)?;
    let found = personality_edit(history, note)?;
    let see = {
        let bot_id = bot_id.clone();
        action(
            t,
            format!("rd-self-update-{}-see", note.id),
            "See change",
            true,
            move |s: &mut Ui| {
                s.open_settings(Some(Page::Bot {
                    bot_id: bot_id.clone(),
                    section: BotSection::History,
                }));
            },
        )
    };
    let mut pill = pill(t, &note.id, &icons::SPARKLES, "Updated its personality").child(see);
    // Undo only while the bot's change is still the current revision, and
    // there is one before it to go back to.
    let current = profile.revision == found.edit.revision;
    if let (true, Some(before)) = (current, found.before) {
        let personality = before.personality.clone();
        pill = pill.child(action(
            t,
            format!("rd-self-update-{}-undo", note.id),
            "Undo",
            !s.model.saving_profile,
            move |s: &mut Ui| s.restore_personality(&bot_id, personality.clone()),
        ));
    }
    Some(pill)
}

/// "Updated what it knows about you · Review", while the owner's profile is
/// still as the bot saved it.
fn owner(s: &Ui, note: &SelfUpdateNote, t: &Theme) -> Option<El> {
    let saved = s.model.owner.as_ref()?;
    if !owner_saved(saved, note) {
        return None;
    }
    Some(
        pill(
            t,
            &note.id,
            &icons::USER_ROUND,
            "Updated what it knows about you",
        )
        .child(action(
            t,
            format!("rd-self-update-{}-review", note.id),
            "Review",
            true,
            |s: &mut Ui| s.open_settings(Some(Page::Owner)),
        )),
    )
}

/// The rounded outline with its icon and what happened.
fn pill(t: &Theme, id: &str, glyph: &'static rune::Icon, what: &str) -> El {
    row()
        .key(format!("rd-self-update-{id}"))
        .role("note")
        .px(11.0)
        .py(4.0)
        .gap(7.0)
        .center_y()
        .radius(999.0)
        .border(1.0, t.border)
        .child(icon(glyph, 13.0).color(t.muted_foreground).a11y_hidden())
        .child(
            text(what.to_owned())
                .font(font(12.0, 400.0))
                .color(t.foreground),
        )
}

/// "· See change": a quiet link in the accent colour after a dot.
fn action(
    t: &Theme,
    key: String,
    label: &'static str,
    enabled: bool,
    press: impl Fn(&mut Ui) + 'static,
) -> El {
    let link = text(label)
        .key(key)
        .role("button")
        .label(label)
        .font(font(12.0, 400.0))
        .color(t.accent)
        .focusable(enabled)
        .focus_ring(2.0, 2.0, t.accent);
    let link = if enabled {
        link.cursor(Cursor::Pointer).on_press(press)
    } else {
        link.disabled(true).layer_opacity(0.5)
    };
    row()
        .gap(7.0)
        .center_y()
        .child(
            text("·")
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(link)
}
