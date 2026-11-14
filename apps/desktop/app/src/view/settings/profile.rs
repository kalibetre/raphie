//! Settings → Profile: a bot's name, description, colour and personality,
//! with a save bar that appears once something changed.
//!
//! Mirrors `bot-profile-form.tsx`, `bot-profile-fields.tsx`,
//! `bot-color-picker.tsx` and `save-bar.tsx`, and the `.bot-editor-*`,
//! `.bot-color-*`, `.soul-editor` and `.save-bar` rules in
//! `shared/styles/settings/`. The form's rules live in `crate::profile`.

use raphie_core::contracts::BotProfile;
use rune::color::hex;
use rune::{Color, El, Shadow, Tx, col, el, icon, row, text, text_input};

use super::parts::{Scope, page};
use crate::avatar::{PALETTE_NAMES, Tones, bot_avatar, tone_of};
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, text_field};

pub fn profile(s: &Ui, bot_id: &str, look: &Look) -> El {
    let t = &look.theme;
    let lede = |name: &str| {
        format!("The identity, color and personality {name} brings to your conversations.")
    };
    // `let ... else` covers a bot that was deleted while Settings was open.
    let Some(bot) = s.model.bots.iter().find(|bot| bot.id == bot_id) else {
        let gone = section(
            t,
            "Bot",
            "This bot no longer exists.",
            col().key("rd-profile-gone"),
        );
        return page(
            "rd-page-profile",
            "Profile",
            &lede(bot_id),
            Scope::Bot {
                id: bot_id,
                name: bot_id,
            },
            vec![gone],
            look,
        );
    };
    let saving = s.model.saving_profile;
    let identity = section(
        t,
        "Identity",
        "How this bot appears in your sidebar and conversations.",
        col()
            .w_full()
            .gap(10.0)
            .child(label(t, "Name"))
            .child(text_field(
                t,
                Field {
                    key: "rd-profile-name",
                    label: "Name",
                    placeholder: "Research assistant",
                    edit: &s.profile.name,
                    disabled: saving,
                    compact: true,
                },
                |s: &mut Ui| &mut s.profile.name,
                |s: &mut Ui, _: &mut Tx| s.save_profile(),
            ))
            .child(label(t, "Description"))
            .child(text_field(
                t,
                Field {
                    key: "rd-profile-description",
                    label: "Description",
                    placeholder: "What this bot helps you with",
                    edit: &s.profile.description,
                    disabled: saving,
                    compact: true,
                },
                |s: &mut Ui| &mut s.profile.description,
                |s: &mut Ui, _: &mut Tx| s.save_profile(),
            ))
            .child(color_picker(s, bot, look)),
    );
    let personality = section(
        t,
        "Personality",
        "Tone, values and working style, shared across this bot’s conversations.",
        col().w_full().gap(10.0).child(soul_editor(s, t)).child(
            text("Personality guides behavior. Models, connections and memory are configured separately.")
                .font(font(11.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        ),
    );
    page(
        "rd-page-profile",
        "Profile",
        &lede(&bot.name),
        Scope::Bot {
            id: &bot.id,
            name: &bot.name,
        },
        vec![identity, personality],
        look,
    )
}

/// A card with a heading and a line of explanation over its fields (the
/// web's `.bot-editor-section`).
fn section(t: &Theme, title: &str, note: &str, body: El) -> El {
    col()
        .w_full()
        .padding(18.0)
        .radius(14.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(
            text(title)
                .role("heading")
                .font(font(13.0, 550.0))
                .color(t.foreground)
                .mb(8.0),
        )
        .child(
            text(note)
                .font(font(12.0, 400.0).lh(21.6))
                .color(t.muted_foreground)
                .wrap()
                .mb(20.0),
        )
        .child(body)
}

fn label(t: &Theme, content: &str) -> El {
    text(content)
        .font(font(12.0, 560.0))
        .color(t.foreground)
        .mt(8.0)
}

/// The bot's face in the chosen colour, the palette to choose from, and a
/// field for any other colour.
fn color_picker(s: &Ui, bot: &BotProfile, look: &Look) -> El {
    let t = &look.theme;
    let chosen = s.profile.color.as_deref();
    // What Raphie would pick if the owner chose nothing: the roster's
    // colours worked out as if this bot had no colour of its own.
    let automatic = {
        let mut others = s.model.bots.clone();
        if let Some(this) = others.iter_mut().find(|other| other.id == bot.id) {
            this.color = None;
        }
        Tones::assign(&others).of(&bot.id)
    };
    let tone = chosen.and_then(tone_of).unwrap_or(automatic);
    let ring = |e: El, on: bool| {
        // The web marks the pressed choice with an outline 3 points out.
        if on {
            e.outline(2.0, 3.0, t.foreground)
        } else {
            e
        }
    };

    // The web draws no ring on its Automatic button; "Automatic color"
    // beside the face says it is chosen.
    let mut options = row().w_full().gap(8.0).flex_wrap().center_y().child(
        button(t, Kind::Outline, Size::Small, None, "Automatic")
            .key("rd-profile-color-automatic")
            .on_press(|s: &mut Ui| {
                s.profile.color = None;
                s.profile.message = None;
            }),
    );
    for (name, color) in PALETTE_NAMES {
        let on = chosen == Some(color);
        let mut swatch = row()
            .key(format!("rd-profile-color-{}", name.to_lowercase()))
            .role("button")
            .label(name)
            .help(name)
            .size(32.0, 32.0)
            .center()
            .radius(16.0)
            .fill(hex(color).unwrap_or(Color::WHITE))
            .border(1.0, hue("#27332933"))
            .focus_ring(2.0, 2.0, t.accent)
            .on_press(move |s: &mut Ui| {
                s.profile.color = Some(color.to_owned());
                s.profile.message = None;
            });
        if on {
            swatch = swatch.child(
                icon(&icons::CHECK, 16.0)
                    .color(hue("#273329"))
                    .a11y_hidden(),
            );
        }
        options = options.child(ring(swatch, on));
    }

    let custom = row()
        .gap(10.0)
        .center_y()
        .mt(20.0)
        .mb(12.0)
        .child(
            // A sample of the colour in use.
            row()
                .size(36.0, 32.0)
                .padding(2.0)
                .radius(6.0)
                .fill(t.card)
                .border(1.0, t.border)
                .border_layout()
                .child(el().w_full().h_full().radius(3.0).fill(tone.body)),
        )
        .child(row().w(120.0).child(text_field(
            t,
            Field {
                key: "rd-profile-custom-color",
                label: "Custom color",
                placeholder: "#b5c99b",
                edit: &s.profile.custom_color,
                disabled: s.model.saving_profile,
                compact: true,
            },
            |s: &mut Ui| &mut s.profile.custom_color,
            |s: &mut Ui, _: &mut Tx| use_custom(s),
        )))
        .child(pressable(
            button(t, Kind::Outline, Size::Small, None, "Use").key("rd-profile-custom-use"),
            true,
            use_custom,
        ))
        .child(
            text("Custom color")
                .font(font(12.0, 560.0))
                .color(t.foreground),
        );

    col()
        .w_full()
        .mt(12.0)
        .child(text("Bot color").font(font(12.0, 550.0)).color(t.foreground))
        .child(
            row()
                .gap(12.0)
                .center_y()
                .my(16.0)
                .child(bot_avatar(&bot.id, tone, 32.0))
                .child(
                    text(match chosen {
                        Some(color) => color.to_uppercase(),
                        None => "Automatic color".to_owned(),
                    })
                    .key("rd-profile-color-name")
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground),
                ),
        )
        .child(options)
        .child(custom)
        .child(
            text("Used for this bot’s avatar and settings. Automatic avoids colors already in use. A custom color is six hex digits, like #b5c99b.")
                .font(font(11.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        )
}

/// Takes the typed custom colour, or says why not.
fn use_custom(s: &mut Ui) {
    if !s.profile.use_custom_color() {
        s.model.profile_error = Some("A custom color is six hex digits, like #b5c99b.".into());
    } else {
        s.model.profile_error = None;
    }
}

/// A fixed colour from the web's CSS (not a theme token).
fn hue(literal: &str) -> Color {
    hex(literal).unwrap_or(Color::BLACK)
}

/// The personality as a text file: a "SOUL.md" bar over a monospaced editor.
fn soul_editor(s: &Ui, t: &Theme) -> El {
    let revision = s.profile.saved.as_ref().map_or(String::new(), |saved| {
        format!("Revision {}", saved.revision)
    });
    let mut editor = text_input(&s.profile.soul, mono(12.0).lh(22.8))
        .key("rd-profile-soul")
        .label("Personality")
        .w_full()
        .color(t.foreground)
        .caret(t.foreground, t.selection())
        .disabled(s.model.saving_profile);
    if !s.model.saving_profile {
        editor = editor
            .on_edit(|s: &mut Ui| &mut s.profile.soul)
            // In a document, Return starts a new line instead of submitting.
            .on_submit(|s: &mut Ui, _: &mut Tx| s.profile.soul.insert("\n"));
    }
    col()
        .w_full()
        .radius(8.0)
        .border(1.0, t.border)
        .border_layout()
        .clip_rounded(7.0)
        .child(
            row()
                .w_full()
                .px(14.0)
                .py(11.0)
                .gap(10.0)
                .justify_between()
                .center_y()
                .fill(t.muted)
                .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
                .child(text("SOUL.md").font(mono(10.0)).color(t.foreground))
                .child(
                    text(revision)
                        .key("rd-profile-revision")
                        .font(font(10.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(
            col()
                .key("rd-profile-soul-box")
                .w_full()
                .min_h(270.0)
                .padding(16.0)
                .fill(t.card)
                .child(editor)
                // A press on the empty part of the box puts the caret in.
                .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-profile-soul", false)),
        )
}

/// The bar docked under the page while there is something to save or to
/// say. `None` on a clean page, so it stays quiet.
pub fn save_bar(s: &Ui, look: &Look) -> Option<El> {
    let t = &look.theme;
    let draft = &s.profile;
    let saved = draft.saved.as_ref()?;
    let dirty = draft.is_dirty();
    let saving = s.model.saving_profile;
    let elsewhere = dirty
        && s.profile_bot()
            .is_some_and(|latest| draft.changed_elsewhere(latest));
    // The most useful problem first: a conflict, then what the host said,
    // then what is wrong with the form itself.
    let error: Option<String> = if elsewhere {
        Some("This bot changed elsewhere. Your draft is preserved. Copy any edits you want to keep, then Discard to load the latest revision.".into())
    } else if let Some(error) = &s.model.profile_error {
        Some(error.clone())
    } else if dirty {
        draft.problem().map(str::to_owned)
    } else {
        None
    };
    let visible = dirty || saving || draft.message.is_some() || error.is_some();
    if !visible {
        return None;
    }
    let status = match &draft.message {
        Some(message) if !dirty => message.clone(),
        _ if dirty => "Unsaved changes".to_owned(),
        _ => format!("Revision {} · Saved to this bot.", saved.revision),
    };
    let line =
        |content: String, color: Color| text(content).font(font(12.5, 500.0)).color(color).wrap();
    let mut copy = col().grow(1.0).min_w(0.0).gap(2.0);
    if let Some(error) = error {
        copy = copy.child(line(error, t.error).key("rd-profile-error"));
    }
    copy = copy.child(
        row()
            .gap(8.0)
            .center_y()
            .child(el().size(6.0, 6.0).radius(3.0).fill(t.accent).a11y_hidden())
            .child(line(status, t.foreground).key("rd-profile-status").shrink()),
    );
    let save_label = if saving { "Saving…" } else { "Save changes" };
    Some(
        row()
            .key("rd-save-bar")
            .w_full()
            .px(44.0)
            .py(14.0)
            .gap(12.0)
            .center_y()
            .fill(t.card)
            .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
            // A soft shadow upwards, so the page seems to slide under it.
            .box_shadow(Shadow {
                y: -12.0,
                blur: 28.0,
                spread: -20.0,
                color: Color::BLACK.alpha(0.3),
                ..Shadow::default()
            })
            .child(copy)
            .child(pressable(
                button(t, Kind::Ghost, Size::Regular, None, "Discard").key("rd-profile-discard"),
                dirty && !saving,
                |s: &mut Ui| s.discard_profile(),
            ))
            .child(pressable(
                button(t, Kind::Primary, Size::Regular, None, save_label).key("rd-profile-save"),
                s.can_save_profile(),
                |s: &mut Ui| s.save_profile(),
            )),
    )
}
