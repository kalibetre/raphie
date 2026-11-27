//! A question a bot asked mid-turn, as the web's `AskCard` shows it: the
//! answers as buttons (or rows, when they carry details) while the turn
//! waits, then one line saying what was answered.

use raphie_core::contracts::{AskAnswer, AskStatus, SessionAsk};
use rune::{El, TextEdit, Tx, col, icon, row, text};

use super::Look;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{Field, Kind, Size, button, pressable, text_field};

pub fn card(s: &Ui, ask: &SessionAsk, look: &Look) -> El {
    let t = &look.theme;
    let sending = s.model.answering.get(&ask.id);
    let answer = ask.answer.as_ref().or(sending);
    let mut card = col()
        .key(format!("rd-ask-{}", ask.id))
        .w_full()
        .gap(8.0)
        .mt(8.0)
        .mb(4.0);
    if ask.status != AskStatus::Pending || answer.is_some() {
        return card
            .child(
                text(ask.question.clone())
                    .font(font(14.0, 400.0).lh(21.0))
                    .color(t.muted_foreground)
                    .wrap(),
            )
            .child(outcome(ask, answer, t));
    }
    card = card.role("group").label(ask.question.clone()).child(
        text(ask.question.clone())
            .font(font(14.0, 500.0).lh(21.0))
            .color(t.foreground)
            .wrap(),
    );
    // Answers with details read better as rows than as buttons in a line.
    card = card.child(if ask.options.iter().any(|o| o.detail.is_some()) {
        rows(ask, t)
    } else {
        buttons(ask, t)
    });
    card.child(own_words(s, ask, t))
}

/// "You picked Wed 14:00", "You answered …", or that nobody answered.
fn outcome(ask: &SessionAsk, answer: Option<&AskAnswer>, t: &Theme) -> El {
    let line = row()
        .key(format!("rd-ask-outcome-{}", ask.id))
        .gap(6.0)
        .center_y();
    let small = |content: String| {
        text(content)
            .font(font(13.0, 400.0))
            .color(t.muted_foreground)
    };
    let Some(answer) = answer else {
        return line.child(small("No answer · the bot went on without one".to_owned()));
    };
    let (lead, value) = match answer {
        AskAnswer::Choice { choice } => (
            "You picked",
            ask.options
                .get(*choice)
                .map_or_else(String::new, |o| o.label.clone()),
        ),
        AskAnswer::Text { text } => ("You answered", text.clone()),
    };
    line.child(col().w(6.0).h(6.0).radius(3.0).fill(t.accent))
        .child(small(lead.to_owned()))
        .child(
            text(value)
                .font(font(13.0, 600.0))
                .color(t.foreground)
                .shrink()
                .min_w(0.0),
        )
}

fn buttons(ask: &SessionAsk, t: &Theme) -> El {
    let mut line = row().gap(6.0).flex_wrap();
    for (choice, option) in ask.options.iter().enumerate() {
        let kind = if ask.danger && choice == 0 {
            Kind::Destructive
        } else {
            Kind::Outline
        };
        let id = ask.id.clone();
        line = line.child(pressable(
            button(t, kind, Size::Small, None, &option.label)
                .key(format!("rd-ask-{}-{choice}", ask.id)),
            true,
            move |s: &mut Ui| s.answer(&id, AskAnswer::Choice { choice }),
        ));
    }
    line
}

fn rows(ask: &SessionAsk, t: &Theme) -> El {
    let mut list = col()
        .w_full()
        .max_w(480.0)
        .radius(10.0)
        .fill(t.card)
        .border(1.0, t.border)
        .clip_rounded(10.0);
    for (choice, option) in ask.options.iter().enumerate() {
        let id = ask.id.clone();
        let line = row()
            .key(format!("rd-ask-{}-{choice}", ask.id))
            .role("button")
            .label(match &option.detail {
                Some(detail) => format!("{} {detail}", option.label),
                None => option.label.clone(),
            })
            .w_full()
            .min_w(0.0)
            .gap(10.0)
            .center_y()
            .px(12.0)
            .py(8.0)
            .hover(t.hover)
            .child(text(option.label.clone()).font(font(14.0, 500.0)).color(
                if ask.danger && choice == 0 {
                    t.error
                } else {
                    t.foreground
                },
            ))
            .child(
                text(option.detail.clone().unwrap_or_default())
                    .font(font(12.5, 400.0))
                    .color(t.muted_foreground)
                    .grow(1.0)
                    .shrink()
                    .min_w(0.0)
                    .truncate(),
            )
            .child(
                icon(&icons::CHEVRON_RIGHT, 14.0)
                    .color(t.muted_foreground)
                    .a11y_hidden(),
            );
        if choice > 0 {
            list = list.child(col().h(1.0).w_full().fill(t.border));
        }
        list = list.child(pressable(line, true, move |s: &mut Ui| {
            s.answer(&id, AskAnswer::Choice { choice });
        }));
    }
    list
}

/// A link that opens a field for the owner's own answer, or the field.
fn own_words(s: &Ui, ask: &SessionAsk, t: &Theme) -> El {
    let Some((_, edit)) = s.own_answer.as_ref().filter(|(id, _)| *id == ask.id) else {
        let id = ask.id.clone();
        let key = format!("rd-ask-own-{}", ask.id);
        return text("Answer in your own words")
            .key(format!("rd-ask-own-open-{}", ask.id))
            .role("button")
            .font(font(12.5, 400.0))
            .color(t.muted_foreground)
            .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
                s.own_answer = Some((id.clone(), TextEdit::new("")));
                tx.focus(format!("{key}-input"), false);
            });
    };
    let submit_id = ask.id.clone();
    let send_id = ask.id.clone();
    let empty = edit.text.trim().is_empty();
    row()
        .w_full()
        .max_w(480.0)
        .gap(6.0)
        .center_y()
        .child(col().grow(1.0).min_w(0.0).child(text_field(
            t,
            Field {
                key: &format!("rd-ask-own-{}", ask.id),
                label: "Your answer",
                placeholder: "Your answer",
                edit,
                disabled: false,
                compact: true,
            },
            |s: &mut Ui| &mut s.own_answer.as_mut().expect("an own answer is open").1,
            move |s: &mut Ui, _: &mut Tx| s.answer_in_own_words(&submit_id),
        )))
        .child(pressable(
            button(t, Kind::Primary, Size::Small, None, "Send")
                .key(format!("rd-ask-send-{}", ask.id)),
            !empty,
            move |s: &mut Ui| s.answer_in_own_words(&send_id),
        ))
}
