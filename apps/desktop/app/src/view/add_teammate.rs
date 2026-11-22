//! A new bot joins the team the way the first one did: the owner names it,
//! says what it will handle and picks its colour, then chooses how it works.
//! Once created it opens and asks for a way to think on its own screen.
//!
//! Mirrors `apps/web/src/presentation/workspace/add-teammate.tsx`.

use rune::color::hex;
use rune::{Color, El, Tx, col, el, row, text};

use super::Look;
use super::onboarding::{card, flow, heading, lede};
use crate::avatar::{PALETTE_NAMES, bot_avatar, tone_of};
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{Field, Kind, Size, button, icon_button, pressable, text_field};

const STEPS: [&str; 3] = ["Meet your new teammate", "How they work", "A way to think"];

pub fn add_teammate(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let close = pressable(
        icon_button(t, &icons::X, 16.0, "Close").key("rd-add-close"),
        true,
        |s: &mut Ui| s.cancel_new_bot(),
    );
    let (at, step) = if s.adding_work {
        (1, work(s, look))
    } else {
        (0, meet(s, look))
    };
    flow(s, look, &STEPS, at, Some(close), step)
}

/// The new bot, in the colour being chosen.
fn avatar(s: &Ui) -> El {
    let color = s
        .profile
        .color
        .clone()
        .unwrap_or_else(|| PALETTE_NAMES[1].1.to_owned());
    let tone =
        tone_of(&color).unwrap_or_else(|| tone_of(PALETTE_NAMES[1].1).expect("a valid colour"));
    bot_avatar("new-bot", tone, 64.0)
}

fn field_label(t: &Theme, words: &str) -> El {
    text(words.to_owned())
        .font(font(12.5, 400.0))
        .color(t.muted_foreground)
}

fn meet(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let named = !s.profile.name.text.trim().is_empty();
    let chosen = s.profile.color.clone().unwrap_or_default();
    let mut swatches = row().gap(8.0).flex_wrap().justify_center().mt(4.0).mb(6.0);
    for (name, color) in PALETTE_NAMES {
        let mut swatch = el()
            .key(format!("rd-add-color-{}", name.to_lowercase()))
            .role("radio")
            .label(name)
            .help(name)
            .size(26.0, 26.0)
            .radius(13.0)
            .fill(hex(color).unwrap_or(Color::WHITE))
            .focus_ring(2.0, 2.0, t.accent)
            .on_press(move |s: &mut Ui| s.profile.color = Some(color.to_owned()));
        if chosen.eq_ignore_ascii_case(color) {
            swatch = swatch.outline(2.0, 2.0, t.foreground);
        }
        swatches = swatches.child(swatch);
    }
    let next = |s: &mut Ui| {
        if s.profile.name.text.trim().is_empty() {
            return;
        }
        s.adding_work = true;
        // Start from the first built-in personality, as the web does,
        // unless one is already chosen.
        let presets = s.model.personality_presets.as_deref().unwrap_or_default();
        let current = s.profile.personality.text.trim();
        if !presets.iter().any(|preset| preset.personality == current)
            && let Some(first) = presets.first()
        {
            s.profile.personality = rune::TextEdit::new(first.personality.clone());
        }
    };
    col()
        .items_center()
        .child(
            card()
                .child(avatar(s))
                .child(heading(t, "Meet your new teammate"))
                .child(lede(
                    t,
                    "Give them a name, a colour and something to look after.",
                ))
                .child(
                    col()
                        .w_full()
                        .mt(8.0)
                        .gap(6.0)
                        .child(field_label(t, "Name"))
                        .child(text_field(
                            t,
                            Field {
                                key: "rd-add-name",
                                label: "Name",
                                placeholder: "Researcher",
                                edit: &s.profile.name,
                                disabled: false,
                                compact: false,
                            },
                            |s: &mut Ui| &mut s.profile.name,
                            move |s: &mut Ui, _: &mut Tx| next(s),
                        ))
                        .child(field_label(t, "What will they handle?").mt(8.0))
                        .child(text_field(
                            t,
                            Field {
                                key: "rd-add-description",
                                label: "What will they handle?",
                                placeholder: "Reads up on things and writes them down",
                                edit: &s.profile.description,
                                disabled: false,
                                compact: false,
                            },
                            |s: &mut Ui| &mut s.profile.description,
                            move |s: &mut Ui, _: &mut Tx| next(s),
                        ))
                        .child(
                            text("Your other teammates read this to know when to hand work over.")
                                .font(font(12.0, 400.0))
                                .color(t.faint)
                                .wrap(),
                        ),
                )
                .child(swatches),
        )
        .child(actions(
            t,
            pressable(
                button(t, Kind::Ghost, Size::Regular, None, "Cancel").key("rd-add-cancel"),
                true,
                |s: &mut Ui| s.cancel_new_bot(),
            ),
            pressable(
                button(t, Kind::Primary, Size::Large, None, "Next").key("rd-add-next"),
                named,
                next,
            ),
        ))
}

fn work(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let name = s.profile.name.text.trim().to_owned();
    let creating = s.model.creating_bot;
    let current = s.profile.personality.text.trim().to_owned();
    let mut presets = col()
        .key("rd-add-presets")
        .role("group")
        .label("Personality")
        .w_full()
        .gap(8.0)
        .mt(8.0);
    for preset in s.model.personality_presets.iter().flatten() {
        let on = preset.personality == current;
        let personality = preset.personality.clone();
        presets = presets.child(
            col()
                .key(format!("rd-add-preset-{}", preset.id))
                .role("radio")
                .label(preset.name.clone())
                .checked(on)
                .w_full()
                .gap(2.0)
                .px(14.0)
                .py(12.0)
                .radius(11.0)
                .fill(t.card)
                .border(
                    if on { 2.0 } else { 1.0 },
                    if on { t.foreground } else { t.border },
                )
                .hover(t.hover)
                .focus_ring(2.0, 2.0, t.accent)
                .child(
                    text(preset.name.clone())
                        .font(font(13.5, 600.0))
                        .color(t.foreground),
                )
                .child(
                    text(preset.summary.clone())
                        .font(font(12.5, 400.0))
                        .color(t.muted_foreground),
                )
                .on_press(move |s: &mut Ui| {
                    s.profile.personality = rune::TextEdit::new(personality.clone());
                }),
        );
    }
    let mut body = card()
        .child(avatar(s))
        .child(heading(t, &format!("How should {name} work?")))
        .child(lede(
            t,
            "Pick a starting personality. You can put it in your own words later in Settings.",
        ))
        .child(presets);
    if let Some(error) = &s.model.profile_error {
        body = body.child(
            text(error.clone())
                .font(font(13.0, 400.0))
                .color(t.error)
                .wrap(),
        );
    }
    col().items_center().child(body).child(actions(
        t,
        pressable(
            button(
                t,
                Kind::Ghost,
                Size::Regular,
                Some(&icons::ARROW_LEFT),
                "Back",
            )
            .key("rd-add-back"),
            !creating,
            |s: &mut Ui| s.adding_work = false,
        ),
        pressable(
            button(
                t,
                Kind::Primary,
                Size::Large,
                None,
                &if creating {
                    "Adding…".to_owned()
                } else {
                    format!("Add {name}")
                },
            )
            .key("rd-add-create"),
            !creating,
            |s: &mut Ui| s.save_profile(),
        ),
    ))
}

fn actions(_t: &Theme, left: El, right: El) -> El {
    row()
        .w_full()
        .max_w(440.0)
        .mt(8.0)
        .justify_between()
        .center_y()
        .child(left)
        .child(right)
}
