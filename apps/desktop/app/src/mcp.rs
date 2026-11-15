//! The "Add a connection" form on Settings → MCP tools.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! mcp-settings.tsx`. The checks on what was typed live in the core
//! (`raphie_core::mcp`).

use raphie_core::auth::Secret;
use raphie_core::mcp::{McpTransport, NewMcpConnection, parse_args, parse_env};
use rune::TextEdit;

/// What is typed into the form. The token and the environment are secure
/// fields: they draw dots, and Rune wipes them from memory when they are
/// cleared or dropped.
pub struct McpForm {
    pub name: TextEdit,
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
}

impl McpForm {
    pub fn new() -> McpForm {
        McpForm {
            name: TextEdit::new(""),
            transport: McpTransport::Http,
            choosing_transport: false,
            address: TextEdit::new(""),
            token: TextEdit::new("").secure(),
            args: TextEdit::new(""),
            env: TextEdit::new("").secure(),
            error: None,
        }
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
        let address = self.address.text.trim().to_owned();
        match self.transport {
            McpTransport::Http => Ok(NewMcpConnection::Http {
                name,
                url: address,
                // `then` builds the secret only when a token was typed.
                token: (!self.token.text.is_empty()).then(|| Secret::new(self.token.text.as_str())),
            }),
            McpTransport::Stdio => Ok(NewMcpConnection::Stdio {
                name,
                command: address,
                // `?` returns the error to the caller if parsing failed.
                args: parse_args(&self.args.text)?,
                env: parse_env(&self.env.text)?,
            }),
        }
    }
}

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
