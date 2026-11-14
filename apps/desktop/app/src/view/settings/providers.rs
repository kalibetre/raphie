//! Settings → Providers: a bot's model connections. Each is a named API key
//! for one provider; a bot can connect the same provider more than once.
//!
//! Mirrors `provider-settings.tsx`, `provider-card.tsx` and
//! `provider-connection.tsx`, and `shared/styles/settings/providers.css`.
//! The web can edit several connections at once; here one form is open at a
//! time, so only one key is ever typed and held.

use raphie_core::contracts::{ProviderConnection, RuntimeSettings};
use rune::{El, Tx, col, icon, row, text};
use rune_kit::{Select, SelectAppearance};

use super::parts::{Scope, page, settings_loading};
use crate::icons;
use crate::sections::BotSection;
use crate::state::{ConnectionTarget, ProvidersView, Ui};
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, centered, icon_button, pressable, text_field};

pub fn providers(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.settings.get(bot_id) {
        Some(settings) => connections(s, bot_id, settings, look, overlays),
        None => vec![settings_loading(s, bot_id, "Connections", "providers", t)],
    };
    page(
        "rd-page-providers",
        "Providers",
        &BotSection::Providers.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

/// The page once the settings are here: a toolbar, the open form if any,
/// one card per connection, and what the last change said.
fn connections(
    s: &Ui,
    bot_id: &str,
    settings: &RuntimeSettings,
    look: &Look,
    overlays: &mut Vec<El>,
) -> Vec<El> {
    let t = &look.theme;
    let busy = s.model.changing_connection;
    let adding = s.providers.open == Some(ConnectionTarget::New);
    let count = settings.connections.len();
    let summary = match count {
        0 => "Name each connection. You can connect the same provider more than once.".to_owned(),
        1 => "1 connection · name each one, and connect a provider more than once if you need to."
            .to_owned(),
        _ => format!(
            "{count} connections · name each one, and connect a provider more than once if you need to."
        ),
    };
    // Each closure that outlives this call owns a copy of the bot id.
    let add_bot = bot_id.to_owned();
    let mut parts = vec![
        row()
            .w_full()
            .gap(16.0)
            .justify_between()
            .center_y()
            .child(
                text(summary)
                    .font(font(12.5, 400.0))
                    .color(t.muted_foreground)
                    .wrap()
                    .shrink(),
            )
            .child(pressable(
                button(
                    t,
                    Kind::Primary,
                    Size::Regular,
                    Some(&icons::PLUS),
                    "Add connection",
                )
                .key("rd-providers-add"),
                !adding && !busy && !settings.providers.is_empty(),
                move |s: &mut Ui| s.add_connection(&add_bot),
            )),
    ];
    if adding {
        parts.push(form(s, bot_id, None, settings, look, overlays));
    }
    for connection in &settings.connections {
        let editing = s.providers.open == Some(ConnectionTarget::Edit(connection.id.clone()));
        parts.push(if editing {
            form(s, bot_id, Some(connection), settings, look, overlays)
        } else {
            card(bot_id, connection, settings, busy, t)
        });
    }
    if count == 0 && !adding {
        let first_bot = bot_id.to_owned();
        parts.push(
            col()
                .key("rd-providers-empty")
                .w_full()
                .px(24.0)
                .py(40.0)
                .gap(12.0)
                .items_center()
                .radius(14.0)
                .border(1.0, t.border)
                .border_dash(4.0, 3.0)
                .child(icon(&icons::KEY_ROUND, 24.0).color(t.muted_foreground).a11y_hidden())
                .child(
                    text("No providers connected")
                        .font(font(15.0, 560.0))
                        .color(t.foreground),
                )
                .child(
                    centered(
                        "Add a connection to start using models. Your conversations stay here when a connection is removed.",
                        font(13.0, 400.0),
                        t.muted_foreground,
                    )
                    .max_w(360.0),
                )
                .child(pressable(
                    button(
                        t,
                        Kind::Outline,
                        Size::Regular,
                        Some(&icons::PLUS),
                        "Add your first connection",
                    )
                    .key("rd-providers-add-first"),
                    !busy && !settings.providers.is_empty(),
                    move |s: &mut Ui| s.add_connection(&first_bot),
                )),
        );
    }
    // With a form open its own message line shows what happened instead.
    if let (Some(message), None) = (&s.model.connection_message, &s.providers.open) {
        parts.push(
            text(message.clone())
                .key("rd-providers-message")
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    }
    parts
}

/// One saved connection: its name and provider, what it holds, and the
/// buttons to edit or remove it.
fn card(
    bot_id: &str,
    connection: &ProviderConnection,
    settings: &RuntimeSettings,
    busy: bool,
    t: &Theme,
) -> El {
    let provider = provider_name(settings, &connection.provider);
    let models = settings
        .models
        .iter()
        .filter(|model| model.connection_id == connection.id)
        .count();
    let (edit_id, edit_name) = (connection.id.clone(), connection.name.clone());
    let (remove_bot, remove_id, remove_name) = (
        bot_id.to_owned(),
        connection.id.clone(),
        connection.name.clone(),
    );
    col()
        .key(format!("rd-connection-{}", connection.id))
        .role("group")
        .label(format!("{} connection", connection.name))
        .w_full()
        .padding(22.0)
        .radius(14.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(
            row()
                .w_full()
                .gap(14.0)
                .center_y()
                .child(
                    row()
                        .size(44.0, 44.0)
                        .center()
                        .radius(12.0)
                        .fill(t.muted)
                        .border(1.0, t.border)
                        .child(
                            icon(&icons::ARROW_UP_RIGHT, 22.0)
                                .color(t.foreground)
                                .a11y_hidden(),
                        ),
                )
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
                        .gap(4.0)
                        .child(
                            text(connection.name.clone())
                                .font(font(16.0, 600.0))
                                .color(t.foreground)
                                .wrap(),
                        )
                        .child(
                            text(provider.to_owned())
                                .font(font(12.5, 400.0))
                                .color(t.muted_foreground),
                        ),
                )
                .child(
                    row()
                        .px(8.0)
                        .py(4.0)
                        .gap(5.0)
                        .center_y()
                        .radius(6.0)
                        .fill(t.accent_soft)
                        .child(icon(&icons::CHECK, 12.0).color(t.accent).a11y_hidden())
                        .child(text("Connected").font(font(11.0, 500.0)).color(t.accent)),
                ),
        )
        .child(
            row()
                .w_full()
                .mt(24.0)
                .mb(20.0)
                .gap(20.0)
                .center_y()
                .child(
                    row()
                        .gap(7.0)
                        .center_y()
                        .child(
                            icon(&icons::KEY_ROUND, 14.0)
                                .color(t.muted_foreground)
                                .a11y_hidden(),
                        )
                        .child(
                            text("Saved API key")
                                .font(font(12.0, 400.0))
                                .color(t.muted_foreground),
                        ),
                )
                .child(
                    // The web writes "1 models" too.
                    text(format!("{models} models"))
                        .font(font(12.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(
            row()
                .w_full()
                .pt(16.0)
                .gap(8.0)
                .justify_between()
                .center_y()
                .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
                .child(pressable(
                    button(
                        t,
                        Kind::Outline,
                        Size::Small,
                        Some(&icons::PENCIL),
                        "Edit connection",
                    )
                    .key(format!("rd-connection-edit-{}", connection.id)),
                    !busy,
                    move |s: &mut Ui| s.edit_connection(&edit_id, &edit_name),
                ))
                .child(pressable(
                    button(
                        t,
                        Kind::Ghost,
                        Size::Small,
                        Some(&icons::TRASH),
                        "Remove connection",
                    )
                    .key(format!("rd-connection-remove-{}", connection.id)),
                    !busy,
                    move |s: &mut Ui| s.remove_connection(&remove_bot, &remove_id, &remove_name),
                )),
        )
}

fn provider_name<'a>(settings: &'a RuntimeSettings, provider_id: &'a str) -> &'a str {
    settings
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .map_or(provider_id, |provider| provider.name.as_str())
}

/// The form for a new connection (`connection` is `None`) or a saved one.
fn form(
    s: &Ui,
    bot_id: &str,
    connection: Option<&ProviderConnection>,
    settings: &RuntimeSettings,
    look: &Look,
    overlays: &mut Vec<El>,
) -> El {
    let t = &look.theme;
    let view: &ProvidersView = &s.providers;
    let busy = s.model.changing_connection;
    let provider_id = connection.map_or(view.provider.as_str(), |c| c.provider.as_str());
    let provider = provider_name(settings, provider_id);
    let (title, detail) = match connection {
        Some(connection) => (
            format!("Edit {}", connection.name),
            format!("{provider} · API key connection"),
        ),
        None => (
            format!("Connect {provider}"),
            "Add an independent connection with its own name and API key.".to_owned(),
        ),
    };
    let caption = |content: String| text(content).font(font(13.0, 560.0)).color(t.foreground);

    let mut fields = col().w_full().mt(22.0).gap(12.0);
    // The provider is chosen once, when a connection is added.
    if connection.is_none() {
        let names: Vec<String> = settings.providers.iter().map(|p| p.name.clone()).collect();
        let ids: Vec<(String, String)> = settings
            .providers
            .iter()
            .map(|p| (p.name.clone(), p.id.clone()))
            .collect();
        fields = fields.child(caption("Provider".to_owned())).child(
            Select::new("rd-connection-provider", &names)
                .label("Provider")
                .appearance(SelectAppearance::Field)
                .width(240.0)
                .current(Some(provider))
                .open(view.choosing_provider)
                .disabled(busy)
                .on_toggle(|s: &mut Ui| {
                    s.providers.choosing_provider = !s.providers.choosing_provider
                })
                .on_close(|s: &mut Ui| s.providers.choosing_provider = false)
                .on_choose(move |s: &mut Ui, name: &str, _: &mut Tx| {
                    if let Some((_, id)) = ids.iter().find(|(shown, _)| shown == name) {
                        s.providers.provider = id.clone();
                    }
                    s.providers.choosing_provider = false;
                })
                .build(&look.kit, overlays),
        );
    }
    let key_caption = match connection {
        Some(_) => "Replace API key".to_owned(),
        None => format!("{provider} API key"),
    };
    let key_placeholder = if connection.is_some() {
        "Leave blank to keep the current key"
    } else {
        "Enter an API key"
    };
    fields = fields
        .child(caption("Connection name".to_owned()))
        .child(text_field(
            t,
            Field {
                key: "rd-connection-name",
                label: "Connection name",
                placeholder: "e.g. Personal or Work",
                edit: &view.name,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.providers.name,
            |_: &mut Ui, _: &mut Tx| {},
        ))
        .child(caption(key_caption))
        .child(text_field(
            t,
            Field {
                key: "rd-connection-key",
                label: "API key",
                placeholder: key_placeholder,
                // A secure field: it draws dots, never the key.
                edit: &view.key,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.providers.key,
            |_: &mut Ui, _: &mut Tx| {},
        ))
        .child(
            row()
                .w_full()
                .gap(6.0)
                .center_y()
                .child(icon(&icons::KEY_ROUND, 12.0).color(t.muted_foreground).a11y_hidden())
                .child(
                    text(if connection.is_some() {
                        "Only this connection is updated. Its provider and identity stay the same."
                    } else {
                        "Keys stay on the backend. Adding a connection does not replace existing ones."
                    })
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground)
                    .wrap()
                    .shrink(),
                ),
        );

    let keyed = !view.key.text.is_empty();
    let (save_bot, test_bot) = (bot_id.to_owned(), bot_id.to_owned());
    let save_label = match (busy, connection) {
        (true, _) => "Saving…",
        (false, Some(_)) => "Save changes",
        (false, None) => "Add connection",
    };
    fields = fields.child(
        row()
            .w_full()
            .gap(8.0)
            .flex_wrap()
            .center_y()
            .child(pressable(
                button(t, Kind::Primary, Size::Regular, None, save_label).key("rd-connection-save"),
                !busy && s.can_save_connection(),
                move |s: &mut Ui| s.save_connection(&save_bot),
            ))
            .child(pressable(
                button(t, Kind::Outline, Size::Regular, None, "Test connection")
                    .key("rd-connection-test"),
                // A new connection needs a key to try; a saved one has its own.
                !busy && (connection.is_some() || keyed),
                move |s: &mut Ui| s.test_connection(&test_bot),
            ))
            .child(pressable(
                button(t, Kind::Ghost, Size::Regular, None, "Cancel").key("rd-connection-cancel"),
                !busy,
                |s: &mut Ui| s.providers = ProvidersView::new(),
            )),
    );
    if let Some(message) = &s.model.connection_message {
        fields = fields.child(
            text(message.clone())
                .key("rd-connection-message")
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    }

    col()
        .key("rd-connection-form")
        .w_full()
        .padding(22.0)
        .radius(14.0)
        .fill(t.card)
        .border(1.0, t.border)
        .child(
            row()
                .w_full()
                .gap(12.0)
                .justify_between()
                .center_y()
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
                        .gap(4.0)
                        .child(
                            text(title)
                                .font(font(16.0, 600.0))
                                .color(t.foreground)
                                .wrap(),
                        )
                        .child(
                            text(detail)
                                .font(font(12.0, 400.0))
                                .color(t.muted_foreground)
                                .wrap(),
                        ),
                )
                .child(pressable(
                    icon_button(t, &icons::X, 16.0, "Close").key("rd-connection-close"),
                    !busy,
                    |s: &mut Ui| s.providers = ProvidersView::new(),
                )),
        )
        .child(fields)
}
