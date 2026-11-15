//! The composer's model picker: a button naming the model the next message
//! will be answered with, and the list it opens to choose another.
//!
//! Mirrors `model-picker.tsx`, `model-results.tsx`, `model-choices.tsx`
//! and `model-picker.css`. What the list shows for a search, and how a
//! model is named, are in the core (`raphie_core::model_library`).
//!
//! One part of the web's picker is not here: the "model family" drop-down.
//! Typing the family ("anthropic") in the search finds the same models.

use raphie_core::contracts::{LibraryModel, ModelSelection, RuntimeSettings};
use raphie_core::model_library::{
    PickerFilter, favorite_key, pick_models, selected, selection_name, short_price,
};
use rune::{El, Icon, Tx, col, icon, row, text, text_input};
use rune_kit::{Placement, popover, scrim};

use super::Look;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{one_line, pressable, toolbar_chip};

/// The element the list hangs from.
const TRIGGER: &str = "rd-model";

/// The button in the composer's toolbar. When the picker is open, its list
/// is added to `overlays`, which draw above the page.
pub fn model_picker(s: &Ui, enabled: bool, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let settings = s.bot_models();
    let models: &[LibraryModel] = settings.map_or(&[], |settings| &settings.models);
    let active = s.active_model();
    let name = selection_name(models, active.as_ref());
    // `enabled` is the composer's say (not while Raphie works); the button
    // also waits while a choice is being saved, but the list stays open
    // then, to say so.
    let can_open = enabled && !s.model.choosing_model;
    let trigger = toolbar_chip(
        t,
        TRIGGER,
        &icons::SPARKLES,
        format!("Choose model: {name}"),
        name,
        s.model_picker.open,
    );
    let trigger = if can_open {
        // Opening also puts the caret in the search, so typing narrows
        // the list at once.
        trigger.on_press_tx(|s: &mut Ui, tx: &mut Tx| {
            s.open_model_picker();
            tx.focus("rd-model-search", false);
        })
    } else {
        // The web's `disabled:opacity-60`.
        trigger.disabled(true).layer_opacity(0.6)
    };
    if s.model_picker.open && enabled {
        // A press anywhere outside closes the list.
        overlays.push(scrim("rd-model-scrim", |s: &mut Ui| {
            s.model_picker.open = false;
        }));
        // The 1-point padding keeps the rail's own background off the
        // surface's border, which it would otherwise paint over.
        let inside = col()
            .padding(1.0)
            .child(panel(s, settings, active.as_ref(), t));
        let surface = popover::raised(&look.kit, inside, 14.0)
            .fill(t.card)
            .border(1.0, t.border);
        overlays.push(popover::anchored(
            &look.kit,
            surface,
            TRIGGER,
            Placement::TopStart,
            10.0,
        ));
    }
    trigger
}

/// The list: a rail of two filters, then the search, the models and a
/// footer.
fn panel(
    s: &Ui,
    settings: Option<&RuntimeSettings>,
    active: Option<&ModelSelection>,
    t: &Theme,
) -> El {
    let picker = &s.model_picker;
    let models: &[LibraryModel] = settings.map_or(&[], |settings| &settings.models);
    let matching = pick_models(models, &picker.search.text, picker.filter, &s.favorites);
    let current = active.and_then(|active| selected(models, active));

    let rail = col()
        .role("navigation")
        .label("Model filters")
        .h_full()
        .px(5.0)
        .py(10.0)
        .gap(6.0)
        .fill(t.background)
        .border_sides([0.0, 1.0, 0.0, 0.0], t.border)
        .child(rail_button(
            t,
            "rd-model-favorites",
            &icons::STAR,
            "Favorite models",
            PickerFilter::Favorites,
            picker.filter,
        ))
        .child(rail_button(
            t,
            "rd-model-all",
            &icons::LAYERS,
            "All models",
            PickerFilter::All,
            picker.filter,
        ));

    let search = row()
        .w_full()
        .px(4.0)
        .pb(10.0)
        .gap(8.0)
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        .child(
            icon(&icons::SEARCH, 15.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(
            text_input(&picker.search, font(13.0, 400.0))
                .single_line()
                .key("rd-model-search")
                .label("Find a model")
                .grow(1.0)
                .min_w(0.0)
                .color(t.foreground)
                .placeholder("Find a model…", t.muted_foreground)
                .caret(t.foreground, t.selection())
                .on_edit(|s: &mut Ui| &mut s.model_picker.search),
        );
    let heading = row()
        .w_full()
        .px(5.0)
        .pt(10.0)
        .pb(6.0)
        .gap(8.0)
        .justify_between()
        .child(
            text(if picker.filter == PickerFilter::Favorites {
                "Favorites"
            } else {
                "Your models"
            })
            .font(font(11.0, 400.0))
            .color(t.muted_foreground),
        )
        .child(
            text(matching.len().to_string())
                .key("rd-model-count")
                .font(font(11.0, 400.0))
                .color(t.muted_foreground),
        );

    let via = current.map_or("your connections", |model| model.connection_name.as_str());
    let footer = row()
        .w_full()
        .mt(8.0)
        .px(4.0)
        .pt(10.0)
        .gap(8.0)
        .center_y()
        .justify_between()
        .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        .child(
            one_line(
                if s.model.choosing_model {
                    "Saving…".to_owned()
                } else {
                    format!("Via {via}")
                },
                font(11.0, 400.0),
                t.muted_foreground,
            )
            .shrink(),
        )
        .child(
            text("Manage connection ↗")
                .key("rd-model-manage")
                .role("button")
                .font(font(11.0, 400.0))
                .color(t.accent)
                .focus_ring(1.0, 1.0, t.accent)
                .on_press(|s: &mut Ui| {
                    s.model_picker.open = false;
                    let page = s.model.bot_id.clone().map(|bot_id| Page::Bot {
                        bot_id,
                        section: BotSection::Providers,
                    });
                    s.open_settings(page);
                }),
        );

    let mut main = col()
        .grow(1.0)
        .min_w(0.0)
        .min_h(0.0)
        .padding(10.0)
        .child(search)
        .child(heading)
        // The models scroll when they are taller than the list has room
        // for; `fit_scroll` shrinks with the surface.
        .child(
            col()
                .w_full()
                .min_h(60.0)
                .shrink()
                .child(popover::fit_scroll(results(
                    s, settings, active, &matching, t,
                ))),
        );
    if let Some(error) = &s.model.model_error {
        main = main.child(
            message(t, error)
                .key("rd-model-error")
                .role("alert")
                .color(t.error),
        );
    }
    row()
        .key("rd-model-picker")
        .role("dialog")
        .label("Model for this session")
        .w(408.0)
        .max_h(438.0)
        // One less than the surface's 14, to sit inside its border.
        .clip_rounded(13.0)
        .child(rail)
        .child(main.child(footer))
}

/// One of the rail's two filters; the chosen one is tinted.
fn rail_button(
    t: &Theme,
    key: &str,
    glyph: &'static Icon,
    label: &str,
    filter: PickerFilter,
    chosen: PickerFilter,
) -> El {
    let on = filter == chosen;
    let button = row()
        .key(key.to_owned())
        .role("button")
        .label(label)
        .help(label)
        .checked(on)
        .size(32.0, 34.0)
        .center()
        .radius(8.0)
        .hover(t.hover)
        .press(t.hover)
        .focus_ring(1.0, 1.0, t.accent)
        .child(
            icon(glyph, 16.0)
                .color(if on { t.accent } else { t.muted_foreground })
                .a11y_hidden(),
        )
        .on_press(move |s: &mut Ui| s.model_picker.filter = filter);
    if on {
        button.fill(t.accent_soft)
    } else {
        button
    }
}

/// A line of explanation in the list (loading, nothing found, an error).
fn message(t: &Theme, content: &str) -> El {
    text(content.to_owned())
        .font(font(12.0, 400.0))
        .color(t.muted_foreground)
        .wrap()
        .px(6.0)
        .py(12.0)
}

/// What the list holds: why there are no models, or one row per model.
fn results(
    s: &Ui,
    settings: Option<&RuntimeSettings>,
    active: Option<&ModelSelection>,
    matching: &[&LibraryModel],
    t: &Theme,
) -> El {
    let failed = s
        .model
        .settings_error
        .as_ref()
        .is_some_and(|(bot, _)| Some(bot.as_str()) == s.model.bot_id.as_deref());
    let Some(settings) = settings else {
        if failed {
            return row()
                .w_full()
                .center_y()
                .child(message(t, "Could not load models.").role("alert"))
                .child(
                    text("Retry")
                        .key("rd-model-retry")
                        .role("button")
                        .font(font(12.0, 400.0))
                        .color(t.accent)
                        .focus_ring(1.0, 1.0, t.accent)
                        .on_press(|s: &mut Ui| s.reload_models()),
                );
        }
        return message(t, "Loading models…").role("status");
    };
    if settings.connections.is_empty() {
        return message(t, "Connect a provider in Settings to choose a model.");
    }
    let mut list = col().w_full().role("list").label("Available models");
    // The conversation's model is no longer offered (its connection was
    // removed, say): say so above the ones that are.
    if let Some(active) = active
        && selected(&settings.models, active).is_none()
    {
        list = list.child(
            message(
                t,
                &format!(
                    "Current model is unavailable: {}. Choose another model to continue.",
                    active.model_id
                ),
            )
            .role("status"),
        );
    }
    for model in matching {
        list = list.child(choice(s, settings, model, active, t));
    }
    if matching.is_empty() {
        let nothing = s.model_picker.filter == PickerFilter::Favorites
            && s.model_picker.search.text.trim().is_empty();
        list = list.child(
            message(
                t,
                if nothing {
                    "Star a model to keep it here."
                } else {
                    "No matching models."
                },
            )
            .key("rd-model-empty")
            .role("status"),
        );
    }
    list
}

/// One model: a tick if it is the one in use, its name, where it comes
/// from and what it costs, and a star to keep it among the favourites.
fn choice(
    s: &Ui,
    settings: &RuntimeSettings,
    model: &LibraryModel,
    active: Option<&ModelSelection>,
    t: &Theme,
) -> El {
    let key = favorite_key(model);
    let current = active.is_some_and(|active| {
        active.provider == model.connection_id && active.model_id == model.id
    });
    let favorite = s.favorites.contains(&key);
    // "Main · openai/gpt-x · $3 / $15 per M · New-session default"
    let mut details = format!("{} · {}", model.connection_name, model.id);
    if let Some(pricing) = &model.pricing {
        details.push_str(&format!(
            " · {} / {} per M",
            short_price(pricing.input),
            short_price(pricing.output)
        ));
    }
    if model.id == settings.model_id && model.connection_id == settings.provider {
        details.push_str(" · New-session default");
    }
    let selection = ModelSelection {
        provider: model.connection_id.clone(),
        model_id: model.id.clone(),
    };
    let pick = row()
        .key(format!("rd-model-choice-{key}"))
        .role("button")
        .label(model.name.clone())
        .checked(current)
        .grow(1.0)
        .min_w(0.0)
        .pl(6.0)
        .pr(3.0)
        .py(9.0)
        .gap(7.0)
        .center_y()
        .radius(8.0)
        .focus_ring(1.0, 1.0, t.accent)
        // The tick's place is kept empty, so every name starts level.
        .child(
            row()
                .size(14.0, 14.0)
                .center()
                .children(current.then(|| icon(&icons::CHECK, 13.0).color(t.accent).a11y_hidden())),
        )
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .child(
                    text(model.name.clone())
                        .font(font(12.5, 400.0))
                        .color(t.foreground)
                        .wrap(),
                )
                .child(
                    text(details)
                        .font(font(11.0, 400.0))
                        .color(t.muted_foreground)
                        .wrap(),
                ),
        );
    let pick = pressable(pick, !s.model.choosing_model, move |s: &mut Ui| {
        s.choose_model(selection.clone());
    });
    let star_label = format!(
        "{} {}",
        if favorite { "Unfavorite" } else { "Favorite" },
        model.name
    );
    let star = row()
        .key(format!("rd-model-star-{key}"))
        .role("button")
        .label(star_label.clone())
        .help(star_label)
        .checked(favorite)
        .size(28.0, 32.0)
        .center()
        .radius(6.0)
        .focus_ring(1.0, 1.0, t.accent)
        .child(
            icon(
                if favorite {
                    &icons::STAR_FILLED
                } else {
                    &icons::STAR
                },
                14.0,
            )
            .color(if favorite {
                t.accent
            } else {
                t.muted_foreground
            })
            .a11y_hidden(),
        )
        .on_press(move |s: &mut Ui| s.toggle_favorite(&key));
    let line = row()
        .w_full()
        .gap(2.0)
        .center_y()
        .radius(8.0)
        .hover(t.hover)
        .child(pick)
        .child(star);
    if current {
        line.fill(t.accent_soft)
    } else {
        line
    }
}
