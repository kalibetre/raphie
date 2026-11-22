//! A bot without a model introduces itself and asks for one, in place of
//! the empty conversation and its composer: it cannot reply until it has one.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/bot-setup.tsx` and the
//! `.bot-setup` rules in `bot-workspace.css`. The web opens the connection
//! form in place; here a choice opens the bot's Providers page with that
//! provider's form already open.

use raphie_core::contracts::{ConnectionAuth, ConnectionProvider};
use rune::{El, col, icon, row, text};

use super::Look;
use crate::avatar::bot_avatar;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, button, centered, one_line, pressable};

pub fn setup(s: &Ui, look: &Look) -> El {
    col()
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .padding(32.0)
        .center()
        .child(panel(s, look))
}

/// The bot's request for a model, without the space around it; onboarding
/// places it in its own pane.
pub fn panel(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let Some(bot) = s.model.selected_bot() else {
        return col();
    };
    let Some(settings) = s.model.settings.get(&bot.id) else {
        return col();
    };
    let name = bot.name.as_str();
    // A connection that gives no models, such as an expired sign-in, is
    // fixed where connections are managed.
    let broken = !settings.connections.is_empty();
    let (heading, lede) = if broken {
        (
            format!("{name}’s connection needs attention."),
            format!(
                "None of {name}’s connections offers a model right now. Check them in Settings."
            ),
        )
    } else {
        (
            "First, I need a way to think.".to_owned(),
            format!(
                "Connect one model service and {name} can start. It belongs to {name} only; you can add more later in Settings."
            ),
        )
    };
    let mut page = col()
        .key("rd-setup")
        .role("region")
        .label(heading.clone())
        .w_full()
        .max_w(520.0)
        .gap(10.0)
        .items_center()
        .child(bot_avatar(&bot.id, look.tones.of(&bot.id), 64.0))
        .child(
            text(heading)
                .role("heading")
                .font(font(24.0, 600.0).tracking(-0.4))
                .color(t.foreground)
                .mt(8.0),
        )
        .child(centered(&lede, font(14.0, 400.0).lh(22.4), t.muted_foreground).mb(10.0));
    let bot_id = bot.id.clone();
    if broken {
        page = page.child(pressable(
            button(
                t,
                Kind::Primary,
                Size::Regular,
                None,
                &format!("Open {name}’s providers"),
            )
            .key("rd-setup-providers"),
            true,
            move |s: &mut Ui| {
                s.open_settings(Some(Page::Bot {
                    bot_id: bot_id.clone(),
                    section: BotSection::Providers,
                }))
            },
        ));
    } else {
        let mut options = col()
            .w_full()
            .gap(8.0)
            .role("group")
            .label("Model services");
        for provider in &settings.providers {
            options = options.child(option(&bot.id, provider, t));
        }
        page = page.child(options);
    }
    page
}

fn option(bot_id: &str, provider: &ConnectionProvider, t: &Theme) -> El {
    let subscription = provider.auth.contains(&ConnectionAuth::Subscription);
    let how = if subscription {
        provider
            .sign_in_label
            .clone()
            .unwrap_or_else(|| "Sign in with your plan".into())
    } else {
        "Paste an API key".into()
    };
    let row = row()
        .key(format!("rd-setup-{}", provider.id))
        .role("button")
        .label(format!("{}: {how}", provider.name))
        .w_full()
        .px(14.0)
        .py(12.0)
        .gap(12.0)
        .center_y()
        .radius(11.0)
        .fill(t.card)
        .border(1.0, t.border)
        .hover(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        .child(
            icon(
                if subscription {
                    &icons::LOG_IN
                } else {
                    &icons::KEY_ROUND
                },
                16.0,
            )
            .color(t.muted_foreground)
            .a11y_hidden(),
        )
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .child(one_line(
                    provider.name.clone(),
                    font(13.5, 550.0),
                    t.foreground,
                ))
                .child(one_line(how, font(12.0, 400.0), t.muted_foreground)),
        );
    let (bot_id, provider_id) = (bot_id.to_owned(), provider.id.clone());
    pressable(row, true, move |s: &mut Ui| {
        s.set_up_provider(&bot_id, &provider_id)
    })
}
