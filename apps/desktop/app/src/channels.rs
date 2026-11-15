//! What is typed on Settings → Channels: the Discord form and the Telegram
//! token.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! channel-settings.tsx` and `telegram-settings.tsx`. The checks on what
//! was typed live in the core (`raphie_core::channels`).

use raphie_core::auth::Secret;
use raphie_core::channels::DiscordUpdate;
use raphie_core::contracts::DiscordChannel;
use rune::TextEdit;

/// What the web says when a form with edits is closed by its button.
pub const UNSAVED: &str = "Save your changes or choose Cancel to discard them.";

/// The Discord form. The token is a secure field: it draws dots, and Rune
/// wipes it from memory when it is cleared or dropped.
pub struct DiscordForm {
    /// Whether the form is unfolded under the Discord row.
    pub open: bool,
    pub token: TextEdit,
    /// One field per allowed Discord user.
    pub user_ids: Vec<TextEdit>,
    pub channel_id: TextEdit,
    /// The ids and channel the form started from, to tell edits from them.
    started: (Vec<String>, String),
    /// What is wrong with the form, found before anything was sent.
    pub error: Option<&'static str>,
}

impl DiscordForm {
    /// A folded, empty form.
    pub fn new() -> DiscordForm {
        DiscordForm {
            open: false,
            token: TextEdit::new("").secure(),
            user_ids: Vec::new(),
            channel_id: TextEdit::new(""),
            started: (Vec::new(), String::new()),
            error: None,
        }
    }

    /// An unfolded form showing the saved settings, if there are any.
    pub fn of(saved: Option<&DiscordChannel>) -> DiscordForm {
        let (ids, channel) = match saved {
            Some(discord) => (discord.allowed_user_ids.clone(), discord.channel_id.clone()),
            None => (Vec::new(), String::new()),
        };
        DiscordForm {
            open: true,
            user_ids: ids.iter().map(|id| TextEdit::new(id.clone())).collect(),
            channel_id: TextEdit::new(channel.clone()),
            started: (ids, channel),
            ..DiscordForm::new()
        }
    }

    /// The ids as typed, one per field, blanks included.
    fn typed_ids(&self) -> Vec<String> {
        self.user_ids
            .iter()
            .map(|field| field.text.clone())
            .collect()
    }

    /// Whether anything differs from what the form started with.
    pub fn is_dirty(&self) -> bool {
        !self.token.text.is_empty()
            || self.typed_ids() != self.started.0
            || self.channel_id.text != self.started.1
    }

    /// What a save would send: ids trimmed and blank rows left out.
    pub fn update(&self) -> DiscordUpdate {
        DiscordUpdate {
            token: (!self.token.text.trim().is_empty())
                .then(|| Secret::new(self.token.text.trim())),
            allowed_user_ids: self
                .user_ids
                .iter()
                .map(|field| field.text.trim().to_owned())
                .filter(|id| !id.is_empty())
                .collect(),
            channel_id: self.channel_id.text.trim().to_owned(),
        }
    }
}

impl Default for DiscordForm {
    fn default() -> DiscordForm {
        DiscordForm::new()
    }
}

/// The Telegram panel: whether it is unfolded, and a typed bot token.
pub struct TelegramForm {
    pub open: bool,
    /// A secure field, like Discord's.
    pub token: TextEdit,
    pub error: Option<&'static str>,
}

impl TelegramForm {
    pub fn new() -> TelegramForm {
        TelegramForm {
            open: false,
            token: TextEdit::new("").secure(),
            error: None,
        }
    }
}

impl Default for TelegramForm {
    fn default() -> TelegramForm {
        TelegramForm::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved() -> DiscordChannel {
        DiscordChannel {
            allowed_user_ids: vec!["1001".into()],
            channel_id: String::new(),
            connected: true,
            conflict: false,
        }
    }

    #[test]
    fn a_form_opened_on_saved_settings_has_nothing_to_save() {
        let form = DiscordForm::of(Some(&saved()));
        assert!(form.open && !form.is_dirty());
        assert_eq!(form.update().token, None);
        assert_eq!(form.update().allowed_user_ids, ["1001"]);
    }

    #[test]
    fn blank_rows_count_as_edits_but_are_not_sent() {
        let mut form = DiscordForm::of(Some(&saved()));
        form.user_ids.push(TextEdit::new(""));
        assert!(form.is_dirty());
        assert_eq!(form.update().allowed_user_ids, ["1001"]);
        form.user_ids[1] = TextEdit::new(" 1002 ");
        assert_eq!(form.update().allowed_user_ids, ["1001", "1002"]);
    }

    #[test]
    fn a_typed_token_is_an_edit_and_is_sent_trimmed() {
        let mut form = DiscordForm::of(None);
        form.token = TextEdit::new(" not-a-real-token ").secure();
        assert!(form.is_dirty());
        let token = form.update().token.expect("a token was typed");
        assert_eq!(token.expose(), "not-a-real-token");
    }
}
