//! The "Add a connection" form on Settings → MCP tools, and what each
//! saved connection is for, as it is being edited.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! mcp-settings.tsx`. The checks on what was typed live in the core
//! (`raphie_core::mcp`).

use raphie_core::auth::Secret;
use raphie_core::mcp::{McpTransport, NewMcpConnection, parse_args, parse_env};
use std::collections::HashMap;

use raphie_core::contracts::McpConnection;
use rune::TextEdit;

/// What is typed into the form. The token and the environment are secure
/// fields: they draw dots, and Rune wipes them from memory when they are
/// cleared or dropped.
pub struct McpForm {
    pub name: TextEdit,
    /// What the bot should use the connection for; may be left blank.
    pub purpose: TextEdit,
    pub transport: McpTransport,
    /// Whether the list of transports is open.
    pub choosing_transport: bool,
    /// The server's URL, or the command to start.
    pub address: TextEdit,
    /// A bearer token for a URL server.
    pub token: TextEdit,
    /// The command's arguments, as a JSON array.
    pub args: TextEdit,
    /// The command's environment, as a JSON object.
    pub env: TextEdit,
    /// What is wrong with what was typed, found when "Connect server" was
    /// pressed.
    pub error: Option<&'static str>,
    /// What each saved connection is for, as it is being edited, by the
    /// connection's id.
    pub purposes: HashMap<String, PurposeDraft>,
}

/// The runtime's limit on a purpose (`mcp-routes.ts`).
pub const PURPOSE_LIMIT: usize = 300;

/// What one saved connection is for: the text in its field, and the saved
/// text it started from.
pub struct PurposeDraft {
    pub saved: String,
    pub edit: TextEdit,
}

impl PurposeDraft {
    pub fn of(saved: &str) -> PurposeDraft {
        PurposeDraft {
            saved: saved.to_owned(),
            edit: TextEdit::new(saved),
        }
    }

    /// Whether the text differs from what is saved; Save and Discard show
    /// only then.
    pub fn is_changed(&self) -> bool {
        self.edit.text.trim() != self.saved
    }

    /// Puts the saved text back.
    pub fn discard(&mut self) {
        self.edit = TextEdit::new(self.saved.clone());
    }
}

impl McpForm {
    pub fn new() -> McpForm {
        McpForm {
            name: TextEdit::new(""),
            purpose: TextEdit::new(""),
            transport: McpTransport::Http,
            choosing_transport: false,
            address: TextEdit::new(""),
            token: TextEdit::new("").secure(),
            args: TextEdit::new(""),
            env: TextEdit::new("").secure(),
            error: None,
            purposes: HashMap::new(),
        }
    }

    /// Empties the "Add a connection" form, typed token included. What is
    /// being typed for saved connections stays.
    pub fn clear(&mut self) {
        let purposes = std::mem::take(&mut self.purposes);
        *self = McpForm {
            purposes,
            ..McpForm::new()
        };
    }

    /// Follows the connections the host has now: each gets a field, and a
    /// field starts again from the saved text whenever that changes, as
    /// the web's does. Fields of connections that are gone are dropped.
    pub fn follow(&mut self, connections: &[McpConnection]) {
        self.purposes
            .retain(|id, _| connections.iter().any(|connection| &connection.id == id));
        for connection in connections {
            let saved = connection.purpose.as_deref().unwrap_or("");
            let current = self.purposes.get(&connection.id);
            if current.is_none_or(|draft| draft.saved != saved) {
                self.purposes
                    .insert(connection.id.clone(), PurposeDraft::of(saved));
            }
        }
    }

    /// The purpose to save for connection `id`: the trimmed text, when it
    /// differs from the saved one and fits.
    pub fn purpose_to_save(&self, id: &str) -> Result<Option<String>, &'static str> {
        let Some(draft) = self.purposes.get(id).filter(|draft| draft.is_changed()) else {
            return Ok(None);
        };
        let text = draft.edit.text.trim();
        if text.chars().count() > PURPOSE_LIMIT {
            return Err(PURPOSE_TOO_LONG);
        }
        Ok(Some(text.to_owned()))
    }

    /// Switches the transport. What was typed for the other one is dropped,
    /// so a token is never sent with a command or the other way round.
    pub fn choose(&mut self, transport: McpTransport) {
        if transport != self.transport {
            self.transport = transport;
            self.address.clear();
            self.token.clear();
            self.args.clear();
            self.env.clear();
        }
        self.choosing_transport = false;
    }

    /// Whether anything was typed or chosen.
    pub fn is_dirty(&self) -> bool {
        let typed = [
            &self.name,
            &self.purpose,
            &self.address,
            &self.token,
            &self.args,
            &self.env,
        ];
        typed.iter().any(|field| !field.text.is_empty()) || self.transport != McpTransport::Http
    }

    /// Whether there is enough to send: a name and an address.
    pub fn is_complete(&self) -> bool {
        !self.name.text.trim().is_empty() && !self.address.text.trim().is_empty()
    }

    /// The connection the form describes, or what is wrong with it.
    pub fn connection(&self) -> Result<NewMcpConnection, &'static str> {
        let name = self.name.text.trim().to_owned();
        if name.chars().count() > 80 {
            return Err("A connection name can be at most 80 characters.");
        }
        let purpose = self.purpose.text.trim();
        if purpose.chars().count() > PURPOSE_LIMIT {
            return Err(PURPOSE_TOO_LONG);
        }
        // `then` builds it only when something was typed.
        let purpose = (!purpose.is_empty()).then(|| purpose.to_owned());
        let address = self.address.text.trim().to_owned();
        match self.transport {
            McpTransport::Http => Ok(NewMcpConnection::Http {
                purpose,
                name,
                url: address,
                // `then` builds the secret only when a token was typed.
                token: (!self.token.text.is_empty()).then(|| Secret::new(self.token.text.as_str())),
            }),
            McpTransport::Stdio => Ok(NewMcpConnection::Stdio {
                purpose,
                name,
                command: address,
                // `?` returns the error to the caller if parsing failed.
                args: parse_args(&self.args.text)?,
                env: parse_env(&self.env.text)?,
            }),
        }
    }
}

const PURPOSE_TOO_LONG: &str = "What a connection is for can be at most 300 characters.";

impl Default for McpForm {
    fn default() -> McpForm {
        McpForm::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_form_is_clean_and_incomplete() {
        let form = McpForm::new();
        assert!(!form.is_dirty());
        assert!(!form.is_complete());
    }

    #[test]
    fn a_url_server_sends_its_token_only_when_typed() {
        let mut form = McpForm::new();
        form.name = TextEdit::new(" Project tools ");
        form.address = TextEdit::new("https://tools.example.com/mcp");
        assert!(form.is_complete());
        let Ok(NewMcpConnection::Http { name, token, .. }) = form.connection() else {
            panic!("a URL server");
        };
        assert_eq!(name, "Project tools");
        assert_eq!(token, None);
        form.token = TextEdit::new("not-a-real-token").secure();
        assert!(matches!(
            form.connection(),
            Ok(NewMcpConnection::Http { token: Some(_), .. })
        ));
    }

    fn connection(id: &str, purpose: Option<&str>) -> McpConnection {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "name": "Executor",
            "purpose": purpose,
            "transport": "http",
            "address": "https://executor.example.com",
            "enabled": true,
            "connected": true,
            "toolCount": 6,
        }))
        .expect("a connection")
    }

    #[test]
    fn a_purpose_is_sent_with_a_new_connection_only_when_typed() {
        let mut form = McpForm::new();
        form.name = TextEdit::new("Executor");
        form.address = TextEdit::new("https://executor.example.com/mcp");
        assert!(matches!(
            form.connection(),
            Ok(NewMcpConnection::Http { purpose: None, .. })
        ));
        form.purpose = TextEdit::new("  calendar and mail ");
        assert!(form.is_dirty());
        let Ok(NewMcpConnection::Http { purpose, .. }) = form.connection() else {
            panic!("a URL server");
        };
        assert_eq!(purpose.as_deref(), Some("calendar and mail"));
        form.purpose = TextEdit::new("x".repeat(PURPOSE_LIMIT + 1));
        assert!(form.connection().unwrap_err().contains("300 characters"));
    }

    #[test]
    fn each_saved_connection_has_a_purpose_field_that_follows_the_host() {
        let mut form = McpForm::new();
        form.follow(&[connection("a", Some("calendar")), connection("b", None)]);
        assert_eq!(form.purposes["a"].edit.text, "calendar");
        assert!(!form.purposes["a"].is_changed());
        assert_eq!(form.purpose_to_save("a"), Ok(None));
        form.purposes.get_mut("b").unwrap().edit = TextEdit::new(" tickets ");
        assert_eq!(form.purpose_to_save("b"), Ok(Some("tickets".into())));
        // The same list again keeps what is being typed.
        form.follow(&[connection("a", Some("calendar")), connection("b", None)]);
        assert_eq!(form.purposes["b"].edit.text, " tickets ");
        // Emptying the add form keeps it too.
        form.clear();
        assert!(form.purposes["b"].is_changed());
        form.purposes.get_mut("b").unwrap().discard();
        assert!(!form.purposes["b"].is_changed());
        // A purpose saved elsewhere starts the field again; a connection
        // that is gone loses its field.
        form.purposes.get_mut("a").unwrap().edit = TextEdit::new("mail");
        form.follow(&[connection("a", Some("calendar and mail"))]);
        assert_eq!(form.purposes["a"].edit.text, "calendar and mail");
        assert!(!form.purposes.contains_key("b"));
        // Clearing a saved purpose is a change that saves "".
        form.purposes.get_mut("a").unwrap().edit = TextEdit::new("  ");
        assert_eq!(form.purpose_to_save("a"), Ok(Some(String::new())));
    }

    #[test]
    fn switching_transport_drops_what_was_typed_for_the_other() {
        let mut form = McpForm::new();
        form.address = TextEdit::new("https://tools.example.com/mcp");
        form.token = TextEdit::new("not-a-real-token").secure();
        form.choose(McpTransport::Stdio);
        assert!(form.address.text.is_empty() && form.token.text.is_empty());
        assert!(form.is_dirty(), "the transport itself is a choice");
        form.name = TextEdit::new("Local");
        form.address = TextEdit::new("npx");
        form.args = TextEdit::new(r#"["-y", 7]"#);
        assert!(form.connection().unwrap_err().contains("array of strings"));
        form.args = TextEdit::new(r#"["-y", "a-server"]"#);
        assert!(matches!(
            form.connection(),
            Ok(NewMcpConnection::Stdio { args, .. }) if args.len() == 2
        ));
    }
}
