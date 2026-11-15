//! Settings → Channels: what can be done to a bot's Discord and Telegram
//! connections and its home channel, the checks made before a change is
//! sent, and how each connection is described.
//!
//! The limits are the runtime's (`routes.ts` in
//! `packages/runtime/src/domains/channels/presentation/http`). The runtime
//! still checks everything itself, and its word is final.

use crate::auth::Secret;
use crate::contracts::{DiscordChannel, TelegramChannel, TelegramProblem};

/// The three parts of the Channels page. Messages and errors are kept per
/// part, so a Telegram failure does not show under Discord.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Channel {
    Discord,
    Telegram,
    Home,
}

/// One save of a bot's Discord settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscordUpdate {
    /// A new bot token; `None` keeps the saved one.
    pub token: Option<Secret>,
    /// The Discord users who may message the bot.
    pub allowed_user_ids: Vec<String>,
    /// The one channel the bot answers in, or empty for anywhere.
    pub channel_id: String,
}

impl DiscordUpdate {
    /// What is wrong with these settings, if anything, in words for the
    /// owner. `saved` says whether the runtime already holds a token.
    pub fn problem(&self, saved: bool) -> Option<&'static str> {
        if !saved && self.token.is_none() {
            return Some("Enter a Discord bot token.");
        }
        if self.allowed_user_ids.len() > 100 {
            return Some("A bot can have at most 100 allowed Discord users.");
        }
        if !self.allowed_user_ids.iter().all(|id| is_discord_id(id)) {
            return Some("A Discord user ID is a number of up to 32 digits.");
        }
        // Each id must appear once: compare every id with the ones after it.
        let ids = &self.allowed_user_ids;
        if (0..ids.len()).any(|i| ids[i + 1..].contains(&ids[i])) {
            return Some("User IDs must be unique.");
        }
        if !self.channel_id.is_empty() && !is_discord_id(&self.channel_id) {
            return Some("A Discord channel ID is a number of up to 32 digits.");
        }
        None
    }
}

/// The runtime's rule for Discord ids: `^\d{1,32}$`.
fn is_discord_id(text: &str) -> bool {
    (1..=32).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit())
}

/// The runtime's rule for a Telegram bot token:
/// `^\d{1,20}:[A-Za-z0-9_-]{20,100}$`.
pub fn is_telegram_token(text: &str) -> bool {
    let Some((id, key)) = text.split_once(':') else {
        return false;
    };
    (1..=20).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_digit())
        && (20..=100).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// One change to a bot's channels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChannelChange {
    SaveDiscord(DiscordUpdate),
    RemoveDiscord,
    /// Connect Telegram with this bot token, or replace the saved one.
    SaveTelegram(Secret),
    /// Start or stop receiving Telegram messages, keeping the token.
    EnableTelegram(bool),
    RemoveTelegram,
    /// Revoke one verified Telegram account, by its numeric id.
    UnpairTelegram(String),
    /// Ask for a one-time code that verifies the owner's Telegram account.
    PairTelegram,
    /// Send scheduled results to this destination, or `None` for web only.
    SelectHome(Option<String>),
}

impl ChannelChange {
    /// What this change will have done once the runtime accepts it.
    pub fn outcome(&self) -> ChannelOutcome {
        match self {
            ChannelChange::SaveDiscord(_) => ChannelOutcome::DiscordSaved,
            ChannelChange::RemoveDiscord => ChannelOutcome::DiscordRemoved,
            ChannelChange::SaveTelegram(_) => ChannelOutcome::TelegramSaved,
            ChannelChange::EnableTelegram(true) => ChannelOutcome::TelegramEnabled,
            ChannelChange::EnableTelegram(false) => ChannelOutcome::TelegramDisabled,
            ChannelChange::RemoveTelegram => ChannelOutcome::TelegramRemoved,
            ChannelChange::UnpairTelegram(_) => ChannelOutcome::TelegramUnpaired,
            ChannelChange::PairTelegram => ChannelOutcome::TelegramPairing,
            ChannelChange::SelectHome(_) => ChannelOutcome::HomeSelected,
        }
    }
}

/// A change the runtime accepted. Unlike [`ChannelChange`] it carries no
/// token, so it can travel in events and be copied freely.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChannelOutcome {
    DiscordSaved,
    DiscordRemoved,
    TelegramSaved,
    TelegramEnabled,
    TelegramDisabled,
    TelegramRemoved,
    TelegramUnpaired,
    TelegramPairing,
    HomeSelected,
}

impl ChannelOutcome {
    /// The part of the page this belongs to.
    pub fn channel(self) -> Channel {
        match self {
            ChannelOutcome::DiscordSaved | ChannelOutcome::DiscordRemoved => Channel::Discord,
            ChannelOutcome::HomeSelected => Channel::Home,
            _ => Channel::Telegram,
        }
    }

    /// What to tell the owner, as the web words it. A pairing code and a
    /// new home channel show themselves instead.
    pub fn message(self) -> Option<&'static str> {
        match self {
            ChannelOutcome::DiscordSaved => Some("Discord settings saved."),
            ChannelOutcome::DiscordRemoved => Some("Discord removed from this bot."),
            ChannelOutcome::TelegramSaved => Some("Telegram connected."),
            ChannelOutcome::TelegramEnabled => Some("Telegram enabled."),
            ChannelOutcome::TelegramDisabled => Some("Telegram disabled."),
            ChannelOutcome::TelegramRemoved => Some("Telegram removed from this bot."),
            ChannelOutcome::TelegramUnpaired => Some("Telegram account revoked."),
            ChannelOutcome::TelegramPairing | ChannelOutcome::HomeSelected => None,
        }
    }
}

/// What the Discord row says under its name.
pub fn discord_summary(saved: Option<&DiscordChannel>) -> &'static str {
    match saved {
        None => "Not configured",
        Some(discord) if discord.conflict => "Disconnected · application used by another bot",
        Some(discord) if discord.connected => "Connected",
        Some(_) => "Disconnected · save settings to reconnect",
    }
}

/// What the Telegram row says under its name.
pub fn telegram_summary(saved: Option<&TelegramChannel>) -> String {
    let Some(telegram) = saved else {
        return "Not configured".to_owned();
    };
    if !telegram.enabled {
        return "Disabled · token saved".to_owned();
    }
    if let Some(problem) = telegram.problem {
        return format!("Disconnected · {}", telegram_problem(problem));
    }
    let accounts = match telegram.verified_user_ids.len() {
        0 => "no verified account yet".to_owned(),
        1 => "1 verified account".to_owned(),
        many => format!("{many} verified accounts"),
    };
    format!("Connected as @{} · {accounts}", telegram.bot_username)
}

fn telegram_problem(problem: TelegramProblem) -> &'static str {
    match problem {
        TelegramProblem::Conflict => {
            "Telegram reports another poller or webhook for this bot. Remove the webhook or stop the other poller."
        }
        TelegramProblem::Token => "Telegram rejected the saved token. Enter a new token and save.",
        TelegramProblem::Network => "Cannot reach Telegram right now. Raphie keeps retrying.",
        TelegramProblem::Duplicate => {
            "This Telegram bot is connected to another Raphie bot. Remove it there first."
        }
        TelegramProblem::Unknown => "Telegram is not receiving messages.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(ids: &[&str], channel: &str) -> DiscordUpdate {
        DiscordUpdate {
            token: None,
            allowed_user_ids: ids.iter().map(|id| (*id).to_owned()).collect(),
            channel_id: channel.to_owned(),
        }
    }

    #[test]
    fn discord_needs_a_token_once_and_numeric_unique_ids() {
        assert!(update(&[], "").problem(false).unwrap().contains("token"));
        assert_eq!(update(&[], "").problem(true), None);
        assert_eq!(update(&["123", "456"], "789").problem(true), None);
        assert!(
            update(&["12a"], "")
                .problem(true)
                .unwrap()
                .contains("user ID")
        );
        assert!(
            update(&["1", "2", "1"], "")
                .problem(true)
                .unwrap()
                .contains("unique")
        );
        assert!(
            update(&[], "general")
                .problem(true)
                .unwrap()
                .contains("channel ID")
        );
        let with_token = DiscordUpdate {
            token: Some(Secret::new("not-a-real-token")),
            ..update(&[], "")
        };
        assert_eq!(with_token.problem(false), None);
    }

    #[test]
    fn a_telegram_token_is_digits_a_colon_and_a_key() {
        assert!(is_telegram_token("123456:ABCDEFGHIJKLMNOPQRSTUVWX_-"));
        assert!(!is_telegram_token("123456:short"));
        assert!(!is_telegram_token("bot:ABCDEFGHIJKLMNOPQRSTUVWX"));
        assert!(!is_telegram_token("no colon here"));
    }

    #[test]
    fn a_change_never_prints_its_token() {
        let change = ChannelChange::SaveTelegram(Secret::new("123456:not-a-real-token-at-all"));
        let printed = format!("{change:?} {:?}", change.outcome());
        assert!(!printed.contains("not-a-real-token"), "{printed}");
        assert_eq!(change.outcome().channel(), Channel::Telegram);
        assert_eq!(change.outcome().message(), Some("Telegram connected."));
    }

    #[test]
    fn telegram_is_described_by_its_state() {
        let mut telegram = TelegramChannel {
            enabled: true,
            connected: true,
            bot_username: "raphie_bot".into(),
            verified_user_ids: vec!["42".into()],
            pairing_expires_at: None,
            problem: None,
        };
        assert_eq!(telegram_summary(None), "Not configured");
        assert_eq!(
            telegram_summary(Some(&telegram)),
            "Connected as @raphie_bot · 1 verified account"
        );
        telegram.verified_user_ids.clear();
        assert!(telegram_summary(Some(&telegram)).ends_with("no verified account yet"));
        telegram.problem = Some(TelegramProblem::Token);
        assert!(telegram_summary(Some(&telegram)).starts_with("Disconnected · Telegram rejected"));
        telegram.enabled = false;
        assert_eq!(telegram_summary(Some(&telegram)), "Disabled · token saved");
    }
}
