//! Settings → Models: the default model for new sessions, and the catalogue
//! of models the bot's connections offer, to search, filter and pick from.
//!
//! Mirrors `model-settings.tsx`, `model-card.tsx` and `model-filters.tsx`,
//! and `shared/styles/settings/models.css`. Grouping, filtering and number
//! formats come from the core's `model_library`.

use raphie_core::contracts::{LibraryModel, Named, RuntimeSettings};
use raphie_core::model_library::{
    compact_tokens, filter_models, model_source, price, short_name, sources,
};
use rune::{El, Icon, Tx, col, el, icon, row, text, text_input};
use rune_kit::{Select, SelectAppearance};

use super::parts::{Scope, page, settings_loading, status};
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::{Dropdown, MODELS_PAGE, ModelsView, Ui};
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Kind, Size, button, one_line, pressable};

pub fn models(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.settings.get(bot_id) {
        Some(settings) if settings.connections.is_empty() => vec![no_connection(bot_id, t)],
        Some(settings) => catalogue(s, bot_id, settings, look, overlays),
        None => vec![settings_loading(s, bot_id, "Models", "models", t)],
    };
    page(
        "rd-page-models",
        "Models",
        &BotSection::Models.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

/// A bot with no provider connection has no models to show.
fn no_connection(bot_id: &str, t: &Theme) -> El {
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Connect a provider",
        "Add a provider connection for this bot to see available models.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Configure providers")
                .key("rd-models-providers"),
            true,
            move |s: &mut Ui| {
                s.open_settings(Some(Page::Bot {
                    bot_id: bot_id.clone(),
                    section: BotSection::Providers,
                }));
            },
        )),
    )
}

/// The page once the settings are here.
fn catalogue(
    s: &Ui,
    bot_id: &str,
    settings: &RuntimeSettings,
    look: &Look,
    overlays: &mut Vec<El>,
) -> Vec<El> {
    let t = &look.theme;
    let view = &s.models;
    let filter = view.filter();
    let matching = filter_models(&settings.models, &filter);
    let is_default = |model: &LibraryModel| {
        model.id == settings.model_id && model.connection_id == settings.provider
    };
    let default = settings.models.iter().find(|model| is_default(model));

    let mut parts = vec![
        default_summary(default, settings, t),
        filters(view, settings, look, overlays),
    ];

    // "2 models available" / "1 model match your filters", and Clear.
    let count = matching.len();
    let noun = if count == 1 { "model" } else { "models" };
    let tail = if filter.is_active() {
        "match your filters"
    } else {
        "available"
    };
    let mut summary = row()
        .w_full()
        .min_h(28.0)
        .mt(-8.0)
        .gap(8.0)
        .justify_between()
        .center_y()
        .child(
            text(format!("{count} {noun} {tail}"))
                .key("rd-models-count")
                .font(font(12.0, 400.0))
                .color(t.muted_foreground),
        );
    if filter.is_active() {
        summary = summary.child(pressable(
            button(
                t,
                Kind::Ghost,
                Size::Small,
                Some(&icons::X),
                "Clear filters",
            )
            .key("rd-models-clear"),
            true,
            |s: &mut Ui| s.models = ModelsView::new(),
        ));
    }
    parts.push(summary);

    if let Some(message) = &s.model.model_message {
        parts.push(
            text(message.clone())
                .key("rd-models-message")
                .font(font(12.5, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    }

    if matching.is_empty() {
        parts.push(
            status(
                t,
                "No models found",
                "Try a different name, provider, or model source.",
                Some(pressable(
                    button(t, Kind::Outline, Size::Regular, None, "Clear filters"),
                    true,
                    |s: &mut Ui| s.models = ModelsView::new(),
                )),
            )
            .key("rd-models-empty"),
        );
    } else {
        // Two cards to a row. `chunks(2)` hands out the shown models in
        // pairs; a last odd one gets an empty partner to keep its width.
        let shown: Vec<&LibraryModel> = matching.iter().copied().take(view.limit).collect();
        let mut grid = col().key("rd-models-grid").w_full().gap(16.0);
        for pair in shown.chunks(2) {
            let mut line = row().w_full().gap(16.0);
            for model in pair {
                line = line.child(card(
                    bot_id,
                    model,
                    is_default(model),
                    s.model.setting_model,
                    t,
                ));
            }
            if pair.len() == 1 {
                // An empty partner with the card's padding, so the lone card
                // is exactly as wide as the cards above it.
                line = line.child(el().grow(1.0).px(14.0));
            }
            grid = grid.child(line);
        }
        parts.push(grid);
        if count > view.limit {
            parts.push(
                row()
                    .w_full()
                    .gap(12.0)
                    .justify_between()
                    .center_y()
                    .child(
                        text(format!("Showing {} of {count} models", shown.len()))
                            .font(font(12.0, 400.0))
                            .color(t.muted_foreground),
                    )
                    .child(pressable(
                        button(t, Kind::Outline, Size::Regular, None, "Show more models")
                            .key("rd-models-more"),
                        true,
                        |s: &mut Ui| s.models.limit += MODELS_PAGE,
                    )),
            );
        }
    }
    parts.push(
        text("Model definitions and estimated prices come from Pi’s catalog. Prices are in USD per million tokens; your provider’s billing applies.")
            .font(font(12.0, 400.0).lh(19.0))
            .color(t.muted_foreground)
            .wrap(),
    );
    parts
}

/// "Default for new sessions": which model, through which connection.
fn default_summary(default: Option<&LibraryModel>, settings: &RuntimeSettings, t: &Theme) -> El {
    let name = match default {
        Some(model) => model.name.clone(),
        None => format!("{} · unavailable", settings.model_id),
    };
    let connection = default.map_or("No connection", |model| model.connection_name.as_str());
    row()
        .key("rd-models-default")
        .w_full()
        .px(20.0)
        .py(16.0)
        .gap(14.0)
        .center_y()
        .radius(12.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(
            row()
                .size(38.0, 38.0)
                .center()
                .radius(10.0)
                .fill(t.muted)
                .child(
                    icon(&icons::SLIDERS_HORIZONTAL, 18.0)
                        .color(t.muted_foreground)
                        .a11y_hidden(),
                ),
        )
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .child(
                    text("Default for new sessions")
                        .font(font(11.0, 400.0))
                        .color(t.muted_foreground),
                )
                .child(
                    text(name)
                        .font(font(14.0, 560.0))
                        .color(t.foreground)
                        .wrap(),
                )
                .child(
                    text(format!(
                        "{connection} · Existing sessions keep their model."
                    ))
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground)
                    .mt(3.0),
                ),
        )
}

/// The search box and the drop-downs that narrow the catalogue.
fn filters(
    view: &ModelsView,
    settings: &RuntimeSettings,
    look: &Look,
    overlays: &mut Vec<El>,
) -> El {
    let t = &look.theme;
    let caption = |content: &str| {
        text(content.to_owned())
            .font(font(12.0, 500.0))
            .color(t.foreground)
            .mb(8.0)
    };
    let focused = view.search.focused;
    let mut search_box = row()
        .key("rd-models-search")
        .w_full()
        // As tall as the kit's drop-downs beside it.
        .h(29.0)
        .px(10.5)
        .gap(8.0)
        .center_y()
        .radius(7.0)
        .border(1.0, if focused { t.accent } else { t.border })
        .child(
            icon(&icons::SEARCH, 14.0)
                .color(t.muted_foreground)
                .a11y_hidden(),
        )
        .child(
            text_input(&view.search, font(12.25, 400.0))
                .single_line()
                .key("rd-models-search-input")
                .label("Search models")
                .grow(1.0)
                .min_w(0.0)
                .color(t.foreground)
                .placeholder("Search by name or model ID…", t.muted_foreground)
                .caret(t.foreground, t.selection())
                .on_edit(|s: &mut Ui| &mut s.models.search)
                // Typing narrows the list, so start again from the first page.
                .on_input_change(|s: &mut Ui, _: &mut Tx| s.models.limit = MODELS_PAGE),
        )
        .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-models-search-input", false));
    if focused {
        search_box = search_box.outline(3.0, 0.0, t.accent.alpha(0.3));
    }

    let source_names: Vec<Named> = sources(&settings.models)
        .into_iter()
        .map(|source| Named {
            id: source.id,
            name: source.label,
        })
        .collect();
    let mut line = row()
        .w_full()
        .gap(12.0)
        .items_end()
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .child(caption("Search models"))
                .child(search_box),
        )
        .child(col().child(caption("Provider")).child(dropdown(
            Dropdown::Provider,
            "All providers",
            &settings.providers,
            view.provider.as_deref(),
            view.open,
            look,
            overlays,
        )))
        .child(col().child(caption("Model source")).child(dropdown(
            Dropdown::Source,
            "All sources",
            &source_names,
            view.source.as_deref(),
            view.open,
            look,
            overlays,
        )));
    // With one connection there is nothing to choose between.
    if settings.connections.len() > 1 {
        let connection_names: Vec<Named> = settings
            .connections
            .iter()
            .map(|connection| Named {
                id: connection.id.clone(),
                name: connection.name.clone(),
            })
            .collect();
        line = line.child(col().child(caption("Connection")).child(dropdown(
            Dropdown::Connection,
            "All connections",
            &connection_names,
            view.connection.as_deref(),
            view.open,
            look,
            overlays,
        )));
    }
    line
}

/// One drop-down: "All ..." first, then `choices` by name. The kit's
/// `Select` draws the button here and puts its floating list in `overlays`.
fn dropdown(
    which: Dropdown,
    all: &str,
    choices: &[Named],
    current: Option<&str>,
    open: Option<Dropdown>,
    look: &Look,
    overlays: &mut Vec<El>,
) -> El {
    let (key, label) = match which {
        Dropdown::Provider => ("rd-models-provider", "Provider"),
        Dropdown::Source => ("rd-models-source", "Model source"),
        Dropdown::Connection => ("rd-models-connection", "Connection"),
    };
    // The list shows names; a choice is turned back into an id below.
    let mut names = vec![all.to_owned()];
    names.extend(choices.iter().map(|choice| choice.name.clone()));
    let shown = current
        .and_then(|id| choices.iter().find(|choice| choice.id == id))
        .map_or(all, |choice| choice.name.as_str());
    // The closure below outlives this call, so it owns a copy of the pairs.
    let ids: Vec<(String, String)> = choices
        .iter()
        .map(|choice| (choice.name.clone(), choice.id.clone()))
        .collect();
    Select::new(key, &names)
        .label(label)
        .appearance(SelectAppearance::Field)
        .width(160.0)
        .current(Some(shown))
        .open(open == Some(which))
        .on_toggle(move |s: &mut Ui| {
            s.models.open = if s.models.open == Some(which) {
                None
            } else {
                Some(which)
            };
        })
        .on_close(|s: &mut Ui| s.models.open = None)
        .on_choose(move |s: &mut Ui, name: &str, _: &mut Tx| {
            let id = ids
                .iter()
                .find(|(shown, _)| shown == name)
                .map(|(_, id)| id.clone());
            match which {
                Dropdown::Provider => s.models.provider = id,
                Dropdown::Source => s.models.source = id,
                Dropdown::Connection => s.models.connection = id,
            }
            s.models.limit = MODELS_PAGE;
            s.models.open = None;
        })
        .build(&look.kit, overlays)
}

/// One model: who made it, what it can do, what it costs, and the button
/// that makes it the default.
fn card(bot_id: &str, model: &LibraryModel, is_default: bool, saving: bool, t: &Theme) -> El {
    let source = model_source(model);
    let small = |content: String| {
        text(content)
            .font(font(10.5, 400.0))
            .color(t.muted_foreground)
    };
    let tagged = |glyph: &'static Icon, label: &str| {
        row()
            .gap(4.0)
            .center_y()
            .child(icon(glyph, 12.0).color(t.muted_foreground).a11y_hidden())
            .child(small(label.to_owned()))
    };

    let mut top = row().w_full().min_h(28.0).gap(8.0).center_y().child(
        col()
            .grow(1.0)
            .min_w(0.0)
            .gap(2.0)
            .child(small(source.label.clone()))
            .child(
                text(short_name(model, &source).to_owned())
                    .font(font(14.0, 600.0).tracking(-0.25))
                    .color(t.foreground)
                    .wrap(),
            ),
    );
    if is_default {
        top = top.child(
            row()
                .px(8.0)
                .py(3.0)
                .gap(4.0)
                .center_y()
                .radius(6.0)
                .fill(t.accent_soft)
                .child(icon(&icons::CHECK, 12.0).color(t.accent).a11y_hidden())
                .child(text("Default").font(font(11.0, 500.0)).color(t.accent)),
        );
    }

    let mut meta = row()
        .w_full()
        .my(10.0)
        .gap(10.0)
        .flex_wrap()
        .center_y()
        .child(small(format!(
            "{} context",
            compact_tokens(model.context_window)
        )))
        .child(small(format!(
            "{} output",
            compact_tokens(model.max_output_tokens)
        )));
    if model.reasoning {
        meta = meta.child(tagged(&icons::BRAIN, "Reasoning"));
    }
    if model.input_modalities.iter().any(|kind| kind == "image") {
        meta = meta.child(tagged(&icons::IMAGE, "Vision"));
    }

    let cost = |label: &str, amount: Option<f64>| {
        row()
            .gap(6.0)
            .center_y()
            .child(small(label.to_owned()))
            .child(
                // A dash when the catalogue has no price.
                text(amount.map_or("—".to_owned(), price))
                    .font(font(12.0, 500.0))
                    .color(t.foreground),
            )
    };
    let pricing = row()
        .w_full()
        .mb(10.0)
        .gap(18.0)
        .flex_wrap()
        .child(cost("Input / 1M", model.pricing.map(|p| p.input)))
        .child(cost("Output / 1M", model.pricing.map(|p| p.output)));

    let (bot, id, connection) = (
        bot_id.to_owned(),
        model.id.clone(),
        model.connection_id.clone(),
    );
    let choose = if is_default {
        button(t, Kind::Outline, Size::Tiny, Some(&icons::CHECK), "Default")
    } else {
        button(t, Kind::Outline, Size::Tiny, None, "Set as default")
    }
    .key(format!(
        "rd-model-default-{}-{}",
        model.connection_id, model.id
    ));
    let footer = row()
        .w_full()
        .pt(10.0)
        .gap(10.0)
        .justify_between()
        .center_y()
        .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        .child(
            row()
                .gap(4.0)
                .center_y()
                .min_w(0.0)
                .shrink()
                .child(
                    icon(&icons::ARROW_UP_RIGHT, 12.0)
                        .color(t.muted_foreground)
                        .a11y_hidden(),
                )
                .child(one_line(
                    model.connection_name.clone(),
                    font(11.0, 400.0),
                    t.muted_foreground,
                )),
        )
        .child(pressable(
            choose,
            !is_default && !saving,
            move |s: &mut Ui| {
                s.set_default_model(&bot, &id, &connection);
            },
        ));

    col()
        .key(format!("rd-model-{}-{}", model.connection_id, model.id))
        .role("group")
        .label(format!("{} via {}", model.name, model.connection_name))
        // Two cards share a row equally.
        .grow(1.0)
        .min_w(0.0)
        .padding(14.0)
        .radius(12.0)
        .fill(t.card)
        .border(1.0, if is_default { t.accent } else { t.border })
        .child(top)
        .child(one_line(
            model.id.clone(),
            font(11.0, 400.0),
            t.muted_foreground,
        ))
        .child(meta)
        .child(pricing)
        .child(footer)
}
