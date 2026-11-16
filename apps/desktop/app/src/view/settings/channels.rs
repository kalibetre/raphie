//! Settings → Channels: a bot's Discord and Telegram connections, and the
//! home channel its scheduled results go to.
//!
//! Mirrors `channel-settings.tsx`, `telegram-settings.tsx` and
//! `home-channel-settings.tsx`, and the `.channel-*` and `.telegram-*`
//! rules in `shared/styles/settings/automation.css`. What is typed lives in
//! `crate::channels`; the checks in `raphie_core::channels`.
//!
//! One difference from the web: its sentence about the Discord Developer
//! Portal has the link inside it; here the link is on a line of its own.

use raphie_core::channels::{Channel, ChannelChange, discord_summary, telegram_summary};
use raphie_core::contracts::{
    ChannelHomeSettings, ChannelPlatform, ChannelSettings, DiscordChannel, TelegramChannel,
};
use raphie_core::engine::Command;
use rune::{El, Icon, Span, Tx, col, row, text};

use super::parts::{Scope, alert, group, page, setting, status};
use crate::format::clock;
use crate::icons;
use crate::sections::BotSection;
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, switch, text_field};

const DISCORD_PORTAL: &str = "https://discord.com/developers/applications";

pub fn channels(s: &Ui, bot_id: &str, look: &Look) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.channels.get(bot_id) {
        Some(settings) => loaded(s, bot_id, settings, t),
        None => loading(s, bot_id, t),
    };
    page(
        "rd-page-channels",
        "Channels",
        &BotSection::Channels.lede(name),
        Scope::Bot { id: bot_id, name },
        vec![body],
        look,
    )
}

/// The channels are on their way, or could not be fetched.
fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let failed = s
        .model
        .channels_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "Channels", "Loading channels…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Channels",
        "Could not load channels.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-channels-retry"),
            true,
            move |s: &mut Ui| {
                s.model.channels_error = None;
                s.command(Command::LoadChannels {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// One card: Discord, Telegram, then the home channel.
fn loaded(s: &Ui, bot_id: &str, settings: &ChannelSettings, t: &Theme) -> El {
    group(
        t,
        "Channels",
        "Channels connect this bot to messaging services. Each bot has its own settings and conversations.",
        vec![
            discord(s, settings.discord.as_ref(), t),
            telegram(s, bot_id, settings.telegram.as_ref(), t),
            home(s, bot_id, t),
        ],
    )
}

// ----- Pieces the three parts share -----

/// Quiet wrapped text, the web's `.automation-note`.
fn note(t: &Theme, content: impl Into<String>) -> El {
    text(content)
        .font(font(12.0, 400.0).lh(19.2))
        .color(t.muted_foreground)
        .wrap()
}

/// A field's caption (`.automation-form label`).
fn caption(t: &Theme, content: &str) -> El {
    text(content).font(font(12.0, 550.0)).color(t.foreground)
}

/// A caption over its notes and controls (`.channel-field`).
fn field(children: Vec<El>) -> El {
    col().w_full().gap(6.0).children(children)
}

/// A row of buttons that wraps (`.automation-actions`).
fn actions() -> El {
    row().w_full().gap(8.0).flex_wrap().center_y()
}

/// A channel's row, the line its last change left under it, and its panel
/// when unfolded. They share one cell of the card, so no hairline falls
/// between them.
fn block(
    t: &Theme,
    glyph: &'static Icon,
    title: &str,
    summary: &str,
    control: El,
    message: Option<(&str, &str)>,
    panel: Option<El>,
) -> El {
    let mut block = col()
        .w_full()
        .child(setting(t, Some(glyph), title, summary, Some(control)));
    if let Some((key, message)) = message {
        block = block.child(
            row().w_full().px(18.0).pb(14.0).child(
                text(message)
                    .key(key)
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground)
                    .wrap()
                    .shrink(),
            ),
        );
    }
    block.children(panel)
}

/// The tinted area a channel's settings unfold into (`.channel-settings`).
fn panel(t: &Theme, key: &str) -> El {
    col()
        .key(key)
        .w_full()
        .padding(18.0)
        .fill(t.muted)
        .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
}

/// "Close", "Manage" or "Connect", by whether the panel is open and
/// whether anything is saved.
fn toggle_label(open: bool, saved: bool) -> &'static str {
    match (open, saved) {
        (true, _) => "Close",
        (false, true) => "Manage",
        (false, false) => "Connect",
    }
}

// ----- Discord -----

fn discord(s: &Ui, saved: Option<&DiscordChannel>, t: &Theme) -> El {
    let form = &s.discord;
    let busy = s.model.changing_channel;
    let toggle = pressable(
        button(
            t,
            Kind::Outline,
            Size::Small,
            None,
            toggle_label(form.open, saved.is_some()),
        )
        .key("rd-discord-toggle"),
        !busy,
        |s: &mut Ui| s.toggle_discord(),
    );
    let message = s.model.channel_messages.get(&Channel::Discord);
    block(
        t,
        &icons::DISCORD,
        "Discord",
        discord_summary(saved),
        toggle,
        message.map(|message| ("rd-discord-message", message.as_str())),
        form.open.then(|| discord_panel(s, saved, t)),
    )
}

fn discord_panel(s: &Ui, saved: Option<&DiscordChannel>, t: &Theme) -> El {
    let form = &s.discord;
    let busy = s.model.changing_channel;
    // What is wrong with the form first, then what the runtime refused.
    let error = form
        .error
        .map(str::to_owned)
        .or_else(|| s.model.channel_errors.get(&Channel::Discord).cloned());
    let submit = |s: &mut Ui, _: &mut Tx| s.save_discord();

    let mut body = panel(t, "rd-discord-settings").child(note(
        t,
        "The bot token is encrypted on the runtime host and is never shown again. Leave it blank to keep the saved token.",
    ));
    if saved.is_some_and(|discord| discord.conflict) && error.is_none() {
        body = body.child(
            alert(
                t,
                "rd-discord-conflict",
                "Discord application already in use",
                "This Discord application is configured for another bot. Remove it from that bot first, then save here to connect, or remove it from this bot.",
            )
            .mt(14.0),
        );
    }

    let portal = "Discord Developer Portal";
    let token = field(vec![
        caption(
            t,
            if saved.is_some() {
                "Bot token (leave blank to keep)"
            } else {
                "Bot token"
            },
        ),
        note(
            t,
            "Create an application and bot in the Discord Developer Portal, then copy its bot token here.",
        ),
        text(portal)
            .key("rd-discord-portal")
            .role("link")
            .label("Discord Developer Portal (opens your browser)")
            .font(font(12.0, 400.0))
            .color(t.foreground)
            // One span over the whole label draws the underline.
            .spans(vec![Span::new(0, portal.len()).underline(t.foreground)])
            .focusable(true)
            .self_start()
            .on_press_tx(|s: &mut Ui, tx: &mut Tx| s.open_page(DISCORD_PORTAL, tx)),
        text_field(
            t,
            Field {
                key: "rd-discord-token",
                label: "Bot token",
                placeholder: "",
                // A secure field: it draws dots, never the token.
                edit: &form.token,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.discord.token,
            submit,
        ),
    ]);

    let mut users = vec![
        caption(t, "Allowed Discord user IDs"),
        note(
            t,
            "Only these users can message this bot. Discord approvals are limited to the user who initiated the action. If the list is empty, nobody can use it.",
        ),
    ];
    for (index, edit) in form.user_ids.iter().enumerate() {
        let label = format!("Allowed Discord user ID {}", index + 1);
        users.push(
            row()
                .w_full()
                .gap(8.0)
                .center_y()
                .child(
                    text_field(
                        t,
                        Field {
                            key: &format!("rd-discord-user-{index}"),
                            label: &label,
                            placeholder: "",
                            edit,
                            disabled: busy,
                            compact: true,
                        },
                        // `move` copies `index` into the closure, so each
                        // row's field edits its own entry.
                        move |s: &mut Ui| &mut s.discord.user_ids[index],
                        submit,
                    )
                    .grow(1.0)
                    .min_w(0.0),
                )
                .child(pressable(
                    button(t, Kind::Ghost, Size::Small, None, "Remove")
                        .key(format!("rd-discord-user-{index}-remove"))
                        .label(format!("Remove user ID {}", index + 1)),
                    !busy,
                    move |s: &mut Ui| {
                        // The row may be gone if two presses raced.
                        if index < s.discord.user_ids.len() {
                            s.discord.user_ids.remove(index);
                        }
                    },
                )),
        );
    }
    users.push(
        pressable(
            button(t, Kind::Outline, Size::Small, None, "Add user ID").key("rd-discord-add-user"),
            !busy && form.user_ids.len() < 100,
            |s: &mut Ui| s.discord.user_ids.push(rune::TextEdit::new("")),
        )
        .self_start(),
    );

    let channel = field(vec![
        caption(t, "Channel ID (optional)"),
        text_field(
            t,
            Field {
                key: "rd-discord-channel",
                label: "Channel ID (optional)",
                placeholder: "",
                edit: &form.channel_id,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.discord.channel_id,
            submit,
        ),
        note(
            t,
            "Leave blank to allow direct messages and mentions in servers where the bot is present. Set a channel ID to restrict access to that channel and its threads.",
        ),
    ]);

    let mut fields = col()
        .w_full()
        .mt(16.0)
        .gap(14.0)
        .child(token)
        .child(field(users))
        .child(channel);
    if let Some(error) = &error {
        fields = fields.child(alert(
            t,
            "rd-discord-alert",
            "Discord settings need attention",
            error,
        ));
    }
    let mut buttons = actions().child(pressable(
        button(
            t,
            Kind::Primary,
            Size::Regular,
            None,
            if busy {
                "Saving…"
            } else {
                "Save and connect"
            },
        )
        .key("rd-discord-save"),
        !busy,
        |s: &mut Ui| s.save_discord(),
    ));
    if saved.is_some() {
        buttons = buttons.child(pressable(
            button(t, Kind::Ghost, Size::Regular, None, "Remove Discord").key("rd-discord-remove"),
            !busy,
            |s: &mut Ui| s.change_channel(ChannelChange::RemoveDiscord),
        ));
    }
    buttons = buttons.child(pressable(
        button(t, Kind::Ghost, Size::Regular, None, "Cancel").key("rd-discord-cancel"),
        !busy,
        |s: &mut Ui| s.cancel_discord(),
    ));
    body.child(fields.child(buttons))
}

// ----- Telegram -----

fn telegram(s: &Ui, bot_id: &str, saved: Option<&TelegramChannel>, t: &Theme) -> El {
    let form = &s.telegram;
    let busy = s.model.changing_channel;
    let toggle = pressable(
        button(
            t,
            Kind::Outline,
            Size::Small,
            None,
            toggle_label(form.open, saved.is_some()),
        )
        .key("rd-telegram-toggle"),
        !busy,
        |s: &mut Ui| s.toggle_telegram(),
    );
    let message = s.model.channel_messages.get(&Channel::Telegram);
    block(
        t,
        &icons::SEND,
        "Telegram",
        &telegram_summary(saved),
        toggle,
        message.map(|message| ("rd-telegram-message", message.as_str())),
        form.open.then(|| telegram_panel(s, bot_id, saved, t)),
    )
}

fn telegram_panel(s: &Ui, bot_id: &str, saved: Option<&TelegramChannel>, t: &Theme) -> El {
    let form = &s.telegram;
    let busy = s.model.changing_channel;
    let typed = !form.token.text.is_empty();
    let error = form
        .error
        .map(str::to_owned)
        .or_else(|| s.model.channel_errors.get(&Channel::Telegram).cloned());

    let token = field(vec![
        caption(
            t,
            if saved.is_some() {
                "Bot token (leave blank to keep)"
            } else {
                "Bot token"
            },
        ),
        text_field(
            t,
            Field {
                key: "rd-telegram-token",
                label: "Bot token",
                placeholder: "",
                // A secure field: it draws dots, never the token.
                edit: &form.token,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.telegram.token,
            |s: &mut Ui, _: &mut Tx| s.save_telegram(),
        ),
    ]);
    let mut buttons = actions().child(pressable(
        button(
            t,
            Kind::Primary,
            Size::Regular,
            None,
            if busy {
                "Saving…"
            } else {
                "Save and connect"
            },
        )
        .key("rd-telegram-save"),
        // With a token saved, there is nothing to save until one is typed.
        !busy && (typed || saved.is_none()),
        |s: &mut Ui| s.save_telegram(),
    ));
    if saved.is_some() {
        buttons = buttons.child(pressable(
            button(t, Kind::Ghost, Size::Regular, None, "Remove Telegram")
                .key("rd-telegram-remove"),
            !busy,
            |s: &mut Ui| s.change_channel(ChannelChange::RemoveTelegram),
        ));
    }
    buttons = buttons.child(pressable(
        button(t, Kind::Ghost, Size::Regular, None, "Cancel").key("rd-telegram-cancel"),
        !busy,
        |s: &mut Ui| s.cancel_telegram(),
    ));

    let mut body = panel(t, "rd-telegram-settings")
        .child(note(
            t,
            "Create a bot with @BotFather in Telegram and paste its token here. The token is encrypted on the runtime host and is never shown again. Raphie uses long polling, so nothing is exposed to the internet.",
        ))
        .child(col().w_full().mt(16.0).gap(14.0).child(token).child(buttons));
    if let Some(saved) = saved {
        body = body.child(telegram_accounts(s, bot_id, saved, t));
    }
    if let Some(error) = &error {
        body = body.child(
            alert(
                t,
                "rd-telegram-alert",
                "Telegram settings need attention",
                error,
            )
            .mt(14.0),
        );
    }
    body
}

/// Under a saved Telegram connection: the switch that pauses it, the
/// accounts that may use it, and pairing a new one.
fn telegram_accounts(s: &Ui, bot_id: &str, saved: &TelegramChannel, t: &Theme) -> El {
    let busy = s.model.changing_channel;
    let heading = |content: &str| text(content).font(font(13.0, 560.0)).color(t.foreground);
    let enabled = saved.enabled;
    let mut section = col()
        .w_full()
        .mt(18.0)
        .pt(16.0)
        .gap(10.0)
        .border_sides([1.0, 0.0, 0.0, 0.0], t.border)
        .child(
            row()
                .w_full()
                .gap(16.0)
                .justify_between()
                .center_y()
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
                        .gap(2.0)
                        .child(heading("Receive messages"))
                        .child(note(
                            t,
                            "Turn off to stop polling without losing the token or verified accounts.",
                        )),
                )
                .child(pressable(
                    switch(t, enabled, "Receive Telegram messages").key("rd-telegram-enabled"),
                    !busy,
                    move |s: &mut Ui| s.change_channel(ChannelChange::EnableTelegram(!enabled)),
                )),
        )
        .child(heading("Verified accounts"))
        .child(note(
            t,
            "Only these Telegram accounts can message this bot or decide tool approvals. Identity is the account's numeric ID, not its username. In groups, only verified owners can trigger replies by mentioning this bot or using /ask@BotName. Pair privately; group tool approvals are decided in the web workspace.",
        ));
    if saved.verified_user_ids.is_empty() {
        section = section.child(note(
            t,
            "No verified account yet. Nobody can use this bot until you pair your account below.",
        ));
    }
    for id in &saved.verified_user_ids {
        let user = id.clone();
        section = section.child(
            row()
                .w_full()
                .gap(8.0)
                .center_y()
                .child(
                    text(id.clone())
                        .font(mono(12.5))
                        .color(t.foreground)
                        .grow(1.0)
                        .min_w(0.0),
                )
                .child(pressable(
                    button(t, Kind::Ghost, Size::Small, None, "Revoke")
                        .key(format!("rd-telegram-revoke-{id}"))
                        .label(format!("Revoke Telegram account {id}")),
                    !busy,
                    move |s: &mut Ui| s.change_channel(ChannelChange::UnpairTelegram(user.clone())),
                )),
        );
    }
    section = section.child(
        pressable(
            button(t, Kind::Outline, Size::Small, None, "Create pairing code")
                .key("rd-telegram-pair"),
            // A code only works while the bot is receiving messages.
            !busy && saved.enabled && saved.connected,
            |s: &mut Ui| s.change_channel(ChannelChange::PairTelegram),
        )
        .self_start(),
    );
    if let Some(code) = s.model.live_pairing(bot_id) {
        // The mono face, bold and spaced out so the code is easy to copy.
        // `..` fills the rest of the style from `mono(22.0)`.
        let code_style = rune::TextStyle {
            weight: 600.0,
            ..mono(22.0).tracking(1.76)
        };
        section = section.child(
            col()
                .key("rd-telegram-pairing")
                .w_full()
                .px(14.0)
                .py(12.0)
                .gap(6.0)
                .radius(10.0)
                .fill(t.background)
                .border(1.0, t.border)
                .child(
                    text(code.code.clone())
                        .key("rd-telegram-code")
                        .font(code_style)
                        .color(t.foreground),
                )
                .child(note(
                    t,
                    format!(
                        "Open a private chat with @{} and send /pair {}. The code works once and expires at {}. Raphie does not show it again.",
                        saved.bot_username,
                        code.code,
                        clock(code.expires_at),
                    ),
                )),
        );
    }
    section
}

// ----- Home channel -----

fn home(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let mut body = panel(t, "rd-home-settings").gap(14.0).child(line(
        t,
        "Home channel",
        "Scheduled updates go here, wherever the job was created. Use /home in a verified Discord or Telegram conversation to select it. Web chat has no /home command.",
        None,
    ));
    match s.model.channel_home.get(bot_id) {
        Some(settings) => body = home_choices(s, body, settings, t),
        None => {
            let failed = s
                .model
                .channel_home_error
                .as_ref()
                .is_some_and(|(bot, _)| bot == bot_id);
            body = body.child(note(
                t,
                if failed {
                    "Could not load the home channel."
                } else {
                    "Loading home channel…"
                },
            ));
        }
    }
    if let Some(error) = s.model.channel_errors.get(&Channel::Home) {
        body = body.child(
            text(error.clone())
                .key("rd-home-error")
                .role("alert")
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    }
    body
}

/// "Web only", then each conversation scheduled results could go to.
fn home_choices(s: &Ui, body: El, settings: &ChannelHomeSettings, t: &Theme) -> El {
    let busy = s.model.changing_channel;
    let web_only = settings.selected.is_none();
    let mut body = body.child(line(
        t,
        "Web only",
        "Keep scheduled results in the web workspace.",
        Some(pressable(
            button(
                t,
                Kind::Outline,
                Size::Small,
                None,
                if web_only { "Selected" } else { "Use web only" },
            )
            .key("rd-home-web"),
            !busy && !web_only,
            |s: &mut Ui| s.change_channel(ChannelChange::SelectHome(None)),
        )),
    ));
    for destination in &settings.destinations {
        let chosen = settings.selected.as_deref() == Some(destination.id.as_str());
        let id = destination.id.clone();
        body = body.child(line(
            t,
            match destination.platform {
                ChannelPlatform::Telegram => "Telegram",
                ChannelPlatform::Discord => "Discord",
            },
            &format!(
                "{} · owner {}",
                destination.conversation_id, destination.user_id
            ),
            Some(pressable(
                button(
                    t,
                    Kind::Outline,
                    Size::Small,
                    None,
                    if chosen { "Home" } else { "Set as home" },
                )
                .key(format!("rd-home-{}", destination.id)),
                !busy && !chosen,
                move |s: &mut Ui| s.change_channel(ChannelChange::SelectHome(Some(id.clone()))),
            )),
        ));
    }
    body.child(note(
        t,
        "Only known conversations can be selected. A disabled, revoked or disconnected destination keeps new scheduled results web-only. Changes apply to future scheduled turns.",
    ))
}

/// A title over a description with an optional control on the right: the
/// web's `Row`, without the card's own padding.
fn line(t: &Theme, title: &str, description: &str, control: Option<El>) -> El {
    let copy = col()
        .grow(1.0)
        .min_w(0.0)
        .gap(2.0)
        .child(text(title).font(font(13.5, 560.0)).color(t.foreground))
        .child(
            text(description)
                .font(font(12.5, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    row()
        .w_full()
        .gap(16.0)
        .center_y()
        .child(copy)
        .children(control)
}
