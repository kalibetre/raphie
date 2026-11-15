//! Settings → Providers: a bot's model connections. Each is a named API key
//! for one provider, or a subscription signed in to; a bot can connect the
//! same provider more than once.
//!
//! A subscription's sign-in runs on the runtime; this page shows whatever
//! it reports and asks (a page to open, a code, a question), the same way
//! for every provider, as `provider-sign-in.tsx` does.
//!
//! Mirrors `provider-settings.tsx`, `provider-card.tsx` and
//! `provider-connection.tsx`, and `shared/styles/settings/providers.css`.
//! The web can edit several connections at once; here one form is open at a
//! time, so only one key is ever typed and held.

use raphie_core::contracts::{
    ProviderConnection, ProviderSignIn, RuntimeSettings, SignInEvent, SignInPromptKind,
    SignInStatus,
};
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
            card(
                bot_id,
                connection,
                settings,
                busy || s.signing_in(bot_id),
                t,
            )
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
    let subscription = connection.is_subscription();
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
                .child(if connection.needs_sign_in {
                    row()
                        .key(format!("rd-connection-sign-in-badge-{}", connection.id))
                        .px(8.0)
                        .py(4.0)
                        .gap(5.0)
                        .center_y()
                        .radius(6.0)
                        .fill(t.attention_soft)
                        .child(
                            icon(&icons::TRIANGLE_ALERT, 12.0)
                                .color(t.attention)
                                .a11y_hidden(),
                        )
                        .child(
                            text("Sign in again")
                                .font(font(11.0, 500.0))
                                .color(t.attention),
                        )
                } else {
                    row()
                        .px(8.0)
                        .py(4.0)
                        .gap(5.0)
                        .center_y()
                        .radius(6.0)
                        .fill(t.accent_soft)
                        .child(icon(&icons::CHECK, 12.0).color(t.accent).a11y_hidden())
                        .child(text("Connected").font(font(11.0, 500.0)).color(t.accent))
                }),
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
                            icon(
                                if subscription {
                                    &icons::LOG_IN
                                } else {
                                    &icons::KEY_ROUND
                                },
                                14.0,
                            )
                            .color(t.muted_foreground)
                            .a11y_hidden(),
                        )
                        .child(
                            text(if subscription {
                                "Subscription sign-in"
                            } else {
                                "Saved API key"
                            })
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
                        Some(if connection.needs_sign_in {
                            &icons::LOG_IN
                        } else {
                            &icons::PENCIL
                        }),
                        if connection.needs_sign_in {
                            "Sign in again"
                        } else {
                            "Edit connection"
                        },
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
    let signs_in = s.form_signs_in(bot_id);
    let signing = s.signing_in(bot_id);
    let (title, detail) = match connection {
        Some(connection) => (
            format!("Edit {}", connection.name),
            format!(
                "{provider} · {}",
                if signs_in {
                    "Subscription"
                } else {
                    "API key connection"
                }
            ),
        ),
        None if signs_in => (
            format!("Connect {provider}"),
            "Sign in with your subscription account. Raphie keeps the sign-in on the backend and renews it as needed."
                .to_owned(),
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
                        s.choose_connection_provider(id);
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
                disabled: busy || signing,
                compact: true,
            },
            |s: &mut Ui| &mut s.providers.name,
            |_: &mut Ui, _: &mut Tx| {},
        ));
    if signs_in {
        fields = fields.child(sign_in_section(s, bot_id, connection, settings, t));
    } else {
        fields = fields
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
    }

    let keyed = !view.key.text.is_empty();
    let (save_bot, test_bot) = (bot_id.to_owned(), bot_id.to_owned());
    let save_label = match (busy, connection) {
        (true, _) => "Saving…",
        (false, Some(_)) => "Save changes",
        (false, None) => "Add connection",
    };
    // A new subscription has nothing to save or test until it signs in.
    let keyed_form = !signs_in || connection.is_some();
    let (cancel_bot, close_bot) = (bot_id.to_owned(), bot_id.to_owned());
    let mut actions = row().w_full().gap(8.0).flex_wrap().center_y();
    if keyed_form {
        actions = actions
            .child(pressable(
                button(t, Kind::Primary, Size::Regular, None, save_label).key("rd-connection-save"),
                !busy && !signing && s.can_save_connection(),
                move |s: &mut Ui| s.save_connection(&save_bot),
            ))
            .child(pressable(
                button(t, Kind::Outline, Size::Regular, None, "Test connection")
                    .key("rd-connection-test"),
                // A new connection needs a key to try; a saved one has its own.
                !busy && !signing && (connection.is_some() || keyed),
                move |s: &mut Ui| s.test_connection(&test_bot),
            ));
    }
    fields = fields.child(actions.child(pressable(
        button(t, Kind::Ghost, Size::Regular, None, "Cancel").key("rd-connection-cancel"),
        !busy,
        move |s: &mut Ui| {
            // Closing the form stops a sign-in still waiting.
            s.cancel_sign_in(&cancel_bot);
            s.providers = ProvidersView::new();
        },
    )));
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
                    move |s: &mut Ui| {
                        s.cancel_sign_in(&close_bot);
                        s.providers = ProvidersView::new();
                    },
                )),
        )
        .child(fields)
}

/// The sign-in part of a subscription connection's form: the button that
/// starts it, then whatever the provider reports and asks.
fn sign_in_section(
    s: &Ui,
    bot_id: &str,
    connection: Option<&ProviderConnection>,
    settings: &RuntimeSettings,
    t: &Theme,
) -> El {
    let note = |content: &str| {
        text(content.to_owned())
            .font(font(12.0, 400.0))
            .color(t.muted_foreground)
            .wrap()
    };
    let mut section = col().w_full().gap(12.0);
    let sign_in = s.sign_in_for(bot_id);
    let waiting = sign_in.is_some_and(|i| i.status == SignInStatus::Waiting);
    if connection.is_some_and(|c| c.needs_sign_in) && sign_in.is_none() {
        section = section.child(
            text("This subscription’s sign-in expired and could not be renewed. Sign in again to keep using it.")
                .key("rd-sign-in-expired")
                .font(font(12.0, 400.0))
                .color(t.attention)
                .wrap(),
        );
    }
    if !waiting {
        let provider_id = connection.map_or(s.providers.provider.as_str(), |c| c.provider.as_str());
        let label = match connection {
            Some(_) => "Sign in again".to_owned(),
            None => settings
                .providers
                .iter()
                .find(|p| p.id == provider_id)
                .and_then(|p| p.sign_in_label.clone())
                .unwrap_or_else(|| format!("Sign in to {}", provider_name(settings, provider_id))),
        };
        let starting = s.model.sign_in_busy;
        let start_bot = bot_id.to_owned();
        section = section.child(
            row().child(pressable(
                button(
                    t,
                    Kind::Primary,
                    Size::Regular,
                    Some(&icons::LOG_IN),
                    if starting { "Starting…" } else { &label },
                )
                .key("rd-sign-in-start"),
                !starting && !s.providers.name.text.trim().is_empty(),
                move |s: &mut Ui| s.start_sign_in(&start_bot),
            )),
        );
    }
    if let Some(sign_in) = sign_in.filter(|_| waiting) {
        section = section.child(sign_in_steps(s, bot_id, sign_in, t));
    }
    match sign_in.map(|i| i.status) {
        Some(SignInStatus::Failed) => {
            let why = sign_in
                .and_then(|i| i.error.clone())
                .unwrap_or_else(|| "Sign-in did not finish. Try again.".to_owned());
            section = section.child(
                text(why)
                    .key("rd-sign-in-error")
                    .font(font(12.0, 400.0))
                    .color(t.error)
                    .wrap(),
            );
        }
        Some(SignInStatus::Cancelled) => section = section.child(note("Sign-in cancelled.")),
        _ => {}
    }
    if let Some(error) = &s.model.sign_in_error {
        section = section.child(
            text(error.clone())
                .key("rd-sign-in-error")
                .font(font(12.0, 400.0))
                .color(t.error)
                .wrap(),
        );
    }
    section.child(
        row()
            .w_full()
            .gap(6.0)
            .center_y()
            .child(
                icon(&icons::KEY_ROUND, 12.0)
                    .color(t.muted_foreground)
                    .a11y_hidden(),
            )
            .child(
                note(if connection.is_some() {
                    "Signing in again renews this connection. Its name and identity stay the same."
                } else {
                    "Only one sign-in can run on a backend at a time."
                })
                .shrink(),
            ),
    )
}

/// What a waiting sign-in reports and asks, in a panel like the web's
/// `.sign-in-steps`.
fn sign_in_steps(s: &Ui, bot_id: &str, sign_in: &ProviderSignIn, t: &Theme) -> El {
    let note = |content: String| {
        text(content)
            .font(font(12.5, 400.0))
            .color(t.muted_foreground)
            .wrap()
    };
    let mut steps = col()
        .key("rd-sign-in-steps")
        .w_full()
        .padding(14.0)
        .gap(14.0)
        .radius(10.0)
        .fill(t.background)
        .border(1.0, t.border);
    let link = sign_in.events.iter().rev().find_map(|e| match e {
        SignInEvent::AuthUrl { url, .. } => Some(url.clone()),
        _ => None,
    });
    let code = sign_in.events.iter().rev().find_map(|e| match e {
        SignInEvent::DeviceCode {
            user_code,
            verification_uri,
            ..
        } => Some((user_code.clone(), verification_uri.clone())),
        _ => None,
    });
    let latest_note = sign_in.events.iter().rev().find_map(|e| match e {
        SignInEvent::Progress { message } | SignInEvent::Info { message } => Some(message.clone()),
        _ => None,
    });
    if let Some(url) = &link {
        let open = url.clone();
        steps = steps.child(
            col()
                .w_full()
                .gap(8.0)
                .child(note(
                    "Open the sign-in page and sign in. When it sends you back and the page doesn’t load, which happens when Raphie runs on another computer, copy that page’s address and paste it below."
                        .to_owned(),
                ))
                .child(
                    row().child(
                        button(
                            t,
                            Kind::Outline,
                            Size::Regular,
                            Some(&icons::EXTERNAL_LINK),
                            "Open the sign-in page",
                        )
                        .key("rd-sign-in-open")
                        .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.open_sign_in_page(&open, tx)),
                    ),
                ),
        );
    }
    if let Some((user_code, verification)) = &code {
        let open = verification.clone();
        steps = steps.child(
            col()
                .w_full()
                .gap(8.0)
                .child(note("Enter this code on the page that opens:".to_owned()))
                .child(
                    row().px(12.0).py(6.0).radius(8.0).fill(t.muted).child(
                        text(user_code.clone())
                            .key("rd-sign-in-code")
                            .font(font(20.0, 600.0).tracking(2.4))
                            .color(t.foreground)
                            .selectable(true),
                    ),
                )
                .child(
                    row().child(
                        button(
                            t,
                            Kind::Outline,
                            Size::Regular,
                            Some(&icons::EXTERNAL_LINK),
                            "Open the page",
                        )
                        .key("rd-sign-in-open-code")
                        .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.open_sign_in_page(&open, tx)),
                    ),
                ),
        );
    }
    if let Some(message) = latest_note {
        steps = steps.child(note(message));
    }
    let busy = s.model.sign_in_busy;
    if let Some(prompt) = &sign_in.prompt {
        if prompt.kind == SignInPromptKind::Select {
            let mut options = row().w_full().gap(8.0).flex_wrap();
            for option in &prompt.options {
                let (answer_bot, choice) = (bot_id.to_owned(), option.id.clone());
                options = options.child(pressable(
                    button(t, Kind::Outline, Size::Regular, None, &option.label)
                        .key(format!("rd-sign-in-option-{}", option.id)),
                    !busy,
                    move |s: &mut Ui| s.answer_sign_in(&answer_bot, Some(choice.clone())),
                ));
            }
            steps = steps.child(
                col()
                    .w_full()
                    .gap(8.0)
                    .child(note(prompt.message.clone()))
                    .child(options),
            );
        } else {
            let (answer_bot, submit_bot) = (bot_id.to_owned(), bot_id.to_owned());
            let placeholder = prompt.placeholder.as_deref().unwrap_or("");
            steps = steps.child(
                col()
                    .w_full()
                    .gap(8.0)
                    .child(
                        text(prompt.message.clone())
                            .font(font(13.0, 560.0))
                            .color(t.foreground)
                            .wrap(),
                    )
                    .child(
                        row()
                            .w_full()
                            .gap(8.0)
                            .center_y()
                            .child(
                                text_field(
                                    t,
                                    Field {
                                        key: "rd-sign-in-answer",
                                        label: "Sign-in answer",
                                        placeholder,
                                        // Secure: a pasted address carries a code.
                                        edit: &s.providers.answer,
                                        disabled: busy,
                                        compact: true,
                                    },
                                    |s: &mut Ui| &mut s.providers.answer,
                                    move |s: &mut Ui, _: &mut Tx| {
                                        s.answer_sign_in(&submit_bot, None)
                                    },
                                )
                                .grow(1.0)
                                .min_w(0.0),
                            )
                            .child(pressable(
                                button(
                                    t,
                                    Kind::Primary,
                                    Size::Regular,
                                    None,
                                    if busy { "Sending…" } else { "Continue" },
                                )
                                .key("rd-sign-in-continue"),
                                !busy && !s.providers.answer.text.trim().is_empty(),
                                move |s: &mut Ui| s.answer_sign_in(&answer_bot, None),
                            )),
                    ),
            );
        }
    }
    steps
}
