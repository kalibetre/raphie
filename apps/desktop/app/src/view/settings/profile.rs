//! Settings → Profile: a bot's name, description, colour and personality,
//! with a save bar that appears once something changed.
//!
//! Mirrors `bot-profile-form.tsx`, `bot-profile-fields.tsx`,
//! `bot-color-picker.tsx`, `reply-style-fields.tsx` and `save-bar.tsx`, and
//! the `.bot-editor-*`, `.bot-color-*`, `.personality-editor`,
//! `.reply-style-*` and `.save-bar` rules in
//! `shared/styles/settings/`. The form's rules live in `crate::profile`.

use raphie_core::contracts::{BotProfile, ReplyFormatting, ReplyLength, ReplyStyle, ReplyWarmth};
use rune::color::hex;
use rune::{Color, El, Tx, col, el, icon, row, text, text_input};
use rune_kit::Dialog;

use super::parts::{SaveBar, Scope, page, save_bar as save_bar_of};
use crate::avatar::{PALETTE_NAMES, Tones, bot_avatar, tone_of};
use crate::icons;
use crate::profile::NEW_BOT;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, text_field};

pub fn profile(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
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
    let (identity, personality) = fields(s, &bot.id, look);
    let history = {
        let bot_id = bot.id.clone();
        pressable(
            button(t, Kind::Ghost, Size::Small, None, "View revision history ↗")
                .key("rd-profile-history"),
            true,
            move |s: &mut Ui| {
                s.open_settings(Some(Page::Bot {
                    bot_id: bot_id.clone(),
                    section: BotSection::History,
                }));
            },
        )
        .self_start()
    };
    let mut groups = vec![identity, personality, replies(s, t), history];
    // The default bot stays: the runtime refuses to delete it.
    if bot.id != "default" {
        groups.push(delete_section(s, bot, t));
        delete_dialog(s, bot, look, overlays);
    }
    page(
        "rd-page-profile",
        "Profile",
        &lede(&bot.name),
        Scope::Bot {
            id: &bot.id,
            name: &bot.name,
        },
        groups,
        look,
    )
}

/// "Create a bot": the Profile form for a bot that does not exist yet.
pub fn new_bot(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let (identity, personality) = fields(s, NEW_BOT, look);
    let note = text("New bots start with their own memory and an empty workspace. Add a provider connection after creation.")
        .font(font(12.0, 400.0).lh(19.2))
        .color(t.muted_foreground)
        .wrap();
    page(
        "rd-page-new-bot",
        "Create a bot",
        "A separate assistant with its own personality, memory and model connections.",
        Scope::NewBot,
        vec![identity, personality, replies(s, t), note],
        look,
    )
}

/// The two cards every profile has: Identity and Personality. `id` is the
/// bot's id, or [`NEW_BOT`] for one being created; it picks the face and
/// the colour Raphie would choose.
fn fields(s: &Ui, id: &str, look: &Look) -> (El, El) {
    let t = &look.theme;
    let saving = s.model.saving_profile || s.model.creating_bot;
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
            .child(color_picker(s, id, look)),
    );
    let personality = section(
        t,
        "Personality",
        "Tone, values and working style, shared across this bot’s conversations.",
        col().w_full().gap(10.0).child(personality_editor(s, t)).child(
            text("Personality guides behavior. Models, connections and memory are configured separately.")
                .font(font(11.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        ),
    );
    (identity, personality)
}

/// One choice on a reply dial: its label, and the style it sets.
type Choice = (&'static str, fn(&mut ReplyStyle));

/// A dial: its key, its label, and its choices with whether each is chosen.
type Dial = (&'static str, &'static str, Vec<(Choice, bool)>);

/// The Replies card: length, warmth, formatting and emoji as small rows of
/// buttons, saved with the profile.
fn replies(s: &Ui, t: &Theme) -> El {
    let style = s.profile.reply_style;
    let saving = s.model.saving_profile || s.model.creating_bot;
    let dials: [Dial; 4] = [
        (
            "length",
            "Length",
            vec![
                (
                    ("Short", |r| r.length = ReplyLength::Short),
                    style.length == ReplyLength::Short,
                ),
                (
                    ("Balanced", |r| r.length = ReplyLength::Balanced),
                    style.length == ReplyLength::Balanced,
                ),
                (
                    ("Detailed", |r| r.length = ReplyLength::Detailed),
                    style.length == ReplyLength::Detailed,
                ),
            ],
        ),
        (
            "warmth",
            "Warmth",
            vec![
                (
                    ("Plain", |r| r.warmth = ReplyWarmth::Plain),
                    style.warmth == ReplyWarmth::Plain,
                ),
                (
                    ("Default", |r| r.warmth = ReplyWarmth::Default),
                    style.warmth == ReplyWarmth::Default,
                ),
                (
                    ("Warm", |r| r.warmth = ReplyWarmth::Warm),
                    style.warmth == ReplyWarmth::Warm,
                ),
            ],
        ),
        (
            "formatting",
            "Formatting",
            vec![
                (
                    ("Prose", |r| r.formatting = ReplyFormatting::Prose),
                    style.formatting == ReplyFormatting::Prose,
                ),
                (
                    ("Default", |r| r.formatting = ReplyFormatting::Default),
                    style.formatting == ReplyFormatting::Default,
                ),
                (
                    ("Lists & tables", |r| {
                        r.formatting = ReplyFormatting::Structured
                    }),
                    style.formatting == ReplyFormatting::Structured,
                ),
            ],
        ),
        (
            "emoji",
            "Emoji",
            vec![
                (("Off", |r| r.emoji = false), !style.emoji),
                (("On", |r| r.emoji = true), style.emoji),
            ],
        ),
    ];
    let mut body = col().w_full().gap(10.0);
    for (key, name, choices) in dials {
        let mut buttons = row()
            .role("group")
            .label(name)
            .gap(4.0)
            .center_y()
            .flex_wrap();
        for ((label, set), chosen) in choices {
            let mut choice = button(t, Kind::Ghost, Size::Small, None, label)
                .key(format!(
                    "rd-reply-{key}-{}",
                    label.to_lowercase().replace(' ', "-")
                ))
                .checked(chosen);
            if chosen {
                choice = choice.fill(t.muted);
            }
            buttons = buttons.child(pressable(choice, !saving, move |s: &mut Ui| {
                set(&mut s.profile.reply_style);
                s.profile.message = None;
            }));
        }
        body = body.child(
            row()
                .w_full()
                .gap(12.0)
                .center_y()
                .child(
                    text(name)
                        .font(font(13.0, 500.0))
                        .color(t.foreground)
                        .w(92.0),
                )
                .child(buttons),
        );
    }
    let note = match style.length {
        ReplyLength::Short => "The answer first; most replies under 80 words.",
        ReplyLength::Balanced => "The answer first, with a line of context; most under 150 words.",
        ReplyLength::Detailed => "The answer first, then the reasoning and caveats you'd want.",
    };
    section(
        t,
        "Replies",
        "How this bot writes back. Its personality can still ask for more.",
        body.child(
            text(note)
                .key("rd-reply-note")
                .font(font(11.0, 400.0))
                .color(t.muted_foreground)
                .mt(4.0)
                .wrap(),
        ),
    )
}

/// "Delete bot", under the form: what it removes, and the button that asks
/// for confirmation.
fn delete_section(s: &Ui, bot: &BotProfile, t: &Theme) -> El {
    let busy = s.model.saving_profile || s.model.deleting_bot;
    // Unsaved edits, or a newer revision elsewhere, would make the
    // confirmation name a bot that is not the one on the host.
    let stale = s.profile.is_dirty() || s.profile.changed_elsewhere(bot);
    col()
        .key("rd-delete-bot")
        .w_full()
        .pt(24.0)
        .gap(10.5)
        .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        .child(
            text("Delete bot")
                .role("heading")
                .font(font(14.0, 500.0))
                .color(t.foreground),
        )
        .child(
            text("Permanently remove this bot and all its local data. Save or discard profile changes first.")
                .font(font(12.25, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        )
        .child(
            pressable(
                button(t, Kind::Destructive, Size::Regular, None, "Delete bot…")
                    .key("rd-delete-bot-open"),
                !busy && !stale,
                |s: &mut Ui| s.ask_delete_bot(),
            )
            .self_start(),
        )
}

/// "Delete <name>?": says what is lost and takes the bot's name as
/// confirmation. A modal: Rune keeps focus inside it.
fn delete_dialog(s: &Ui, bot: &BotProfile, look: &Look, overlays: &mut Vec<El>) {
    let t = &look.theme;
    if !s.deleting_bot {
        return;
    }
    let busy = s.model.deleting_bot;
    let quiet = |content: &str| {
        text(content)
            .font(font(12.25, 400.0).lh(19.0))
            .color(t.muted_foreground)
            .wrap()
    };
    let mut body = col()
        .key("rd-delete-bot-form")
        .w_full()
        .px(16.0)
        .pb(16.0)
        .gap(14.0)
        // The kit's own description is one unwrapped line, so the long
        // warning sits here, where it wraps.
        .child(quiet(
            "This permanently removes its profile history, conversations, attachments, local memory, connections, scheduled jobs and workspace files. This cannot be undone.",
        ))
        .child(quiet(
            "External memory and messages stay in their services. Provider keys are not revoked. Backups are not erased.",
        ))
        .child(
            col()
                .w_full()
                .gap(7.0)
                .child(
                    text(format!("Type {} to confirm", bot.name))
                        .font(font(12.25, 400.0))
                        .color(t.foreground)
                        .wrap(),
                )
                .child(text_field(
                    t,
                    Field {
                        key: "rd-delete-bot-name",
                        label: "Bot name",
                        placeholder: "",
                        edit: &s.delete_confirmation,
                        disabled: busy,
                        compact: true,
                    },
                    |s: &mut Ui| &mut s.delete_confirmation,
                    |s: &mut Ui, _: &mut Tx| s.delete_bot(),
                )),
        );
    if let Some(error) = &s.model.delete_bot_error {
        body = body.child(
            text(error.clone())
                .key("rd-delete-bot-error")
                .role("alert")
                .font(font(12.25, 400.0))
                .color(t.error)
                .wrap(),
        );
    }
    body = body.child(
        row()
            .w_full()
            .gap(8.0)
            .justify_end()
            .center_y()
            .child(pressable(
                button(t, Kind::Outline, Size::Regular, None, "Cancel").key("rd-delete-bot-cancel"),
                !busy,
                |s: &mut Ui| s.close_delete_bot(),
            ))
            .child(pressable(
                button(
                    t,
                    Kind::Destructive,
                    Size::Regular,
                    None,
                    if busy {
                        "Deleting…"
                    } else {
                        "Permanently delete bot"
                    },
                )
                .key("rd-delete-bot-confirm"),
                // Only the bot's name, typed exactly, enables the button.
                !busy && s.delete_confirmed(),
                |s: &mut Ui| s.delete_bot(),
            )),
    );
    Dialog::new("rd-delete-bot-dialog", format!("Delete {}?", bot.name))
        .width(480.0)
        .fit()
        .open(true)
        .on_close(|s: &mut Ui| s.close_delete_bot())
        .child(body)
        .build(&look.kit, overlays);
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
fn color_picker(s: &Ui, id: &str, look: &Look) -> El {
    let t = &look.theme;
    let chosen = s.profile.color.as_deref();
    // What Raphie would pick if the owner chose nothing: the roster's
    // colours worked out as if this bot had no colour of its own.
    let automatic = {
        let mut others = s.model.bots.clone();
        match others.iter_mut().find(|other| other.id == id) {
            Some(this) => this.color = None,
            // A bot being created is not in the roster yet: stand in for it.
            None => others.push(BotProfile {
                id: id.to_owned(),
                name: String::new(),
                description: String::new(),
                color: None,
                personality: String::new(),
                reply_style: Default::default(),
                revision: 0,
            }),
        }
        Tones::assign(&others).of(id)
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
                .child(bot_avatar(id, tone, 32.0))
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

/// The personality as the owner writes it: a bar with its revision over the editor.
fn personality_editor(s: &Ui, t: &Theme) -> El {
    let revision = s.profile.saved.as_ref().map_or(String::new(), |saved| {
        format!("Revision {}", saved.revision)
    });
    let mut editor = text_input(&s.profile.personality, font(13.0, 400.0).lh(22.0))
        .key("rd-profile-personality")
        .label("Personality")
        .w_full()
        .color(t.foreground)
        .caret(t.foreground, t.selection())
        .disabled(s.model.saving_profile);
    if !s.model.saving_profile {
        editor = editor
            .on_edit(|s: &mut Ui| &mut s.profile.personality)
            // In a document, Return starts a new line instead of submitting.
            .on_submit(|s: &mut Ui, _: &mut Tx| s.profile.personality.insert("\n"));
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
                .child(
                    text("In your words")
                        .font(font(10.0, 500.0))
                        .color(t.foreground),
                )
                .child(
                    text(revision)
                        .key("rd-profile-revision")
                        .font(font(10.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(
            col()
                .key("rd-profile-personality-box")
                .w_full()
                .min_h(270.0)
                .padding(16.0)
                .fill(t.card)
                .child(editor)
                // A press on the empty part of the box puts the caret in.
                .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-profile-personality", false)),
        )
}

/// The bar docked under the page while there is something to save or to
/// say. `None` on a clean page, so it stays quiet.
pub fn save_bar(s: &Ui, look: &Look) -> Option<El> {
    let t = &look.theme;
    let draft = &s.profile;
    if draft.creating {
        return Some(create_bar(s, t));
    }
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
    let save_label = if saving { "Saving…" } else { "Save changes" };
    Some(save_bar_of(
        t,
        SaveBar {
            key: "rd-profile",
            error,
            status,
            save_label,
            can_save: s.can_save_profile(),
            can_discard: dirty && !saving,
            extra: None,
        },
        |s: &mut Ui| s.discard_profile(),
        |s: &mut Ui| s.save_profile(),
    ))
}

/// The bar under "Create a bot". It always shows: there is always a bot to
/// create or a way out.
fn create_bar(s: &Ui, t: &Theme) -> El {
    let draft = &s.profile;
    let dirty = draft.is_dirty();
    let creating = s.model.creating_bot;
    // What the host refused first, then what the form still needs. An
    // untouched form is not nagged about its empty name.
    let error = match &s.model.profile_error {
        Some(error) => Some(error.clone()),
        None if dirty => draft.problem().map(str::to_owned),
        None => None,
    };
    let cancel = pressable(
        button(t, Kind::Ghost, Size::Regular, None, "Cancel").key("rd-profile-cancel"),
        !creating,
        |s: &mut Ui| s.cancel_new_bot(),
    );
    save_bar_of(
        t,
        SaveBar {
            key: "rd-profile",
            error,
            status: if dirty {
                "Unsaved changes".to_owned()
            } else {
                "Independent configuration. No settings are copied.".to_owned()
            },
            save_label: if creating {
                "Creating…"
            } else {
                "Create bot"
            },
            can_save: s.can_save_profile(),
            can_discard: dirty && !creating,
            extra: Some(cancel),
        },
        |s: &mut Ui| s.discard_profile(),
        |s: &mut Ui| s.save_profile(),
    )
}
