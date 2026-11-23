//! Settings → MCP tools: what a new connection carries, the checks made
//! before one is sent, and what can be done to a saved one.
//!
//! The limits are the runtime's (`mcp-routes.ts` in
//! `packages/runtime/src/domains/settings/presentation/http`). The runtime
//! still checks everything itself, and its word is final.

use serde::Serialize;

use crate::auth::Secret;

/// How the runtime reaches an MCP server.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    /// A server at a URL ("Streamable HTTP").
    Http,
    /// A command the runtime starts on its own machine.
    Stdio,
}

/// A connection to add. Tokens and environment values are [`Secret`]s, so
/// printing one with `{:?}` shows `<redacted>` in their place.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NewMcpConnection {
    Http {
        name: String,
        /// What the bot should use it for; `None` when left blank.
        purpose: Option<String>,
        url: String,
        /// `None` lets the server ask for browser authorization instead.
        token: Option<Secret>,
    },
    Stdio {
        name: String,
        purpose: Option<String>,
        command: String,
        args: Vec<String>,
        /// Environment variables for the command: name, then value.
        env: Vec<(String, Secret)>,
    },
}

/// What can be done to a saved connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpAction {
    /// Connect again, or switch a paused connection back on.
    Enable,
    /// Pause, or give up on an authorization that is waiting.
    Disable,
    Remove,
    /// Save an encrypted copy of a connection the host's environment set.
    Import,
}

/// The command's arguments from what was typed: a JSON array of strings,
/// or nothing at all. The error is in words for the owner.
pub fn parse_args(text: &str) -> Result<Vec<String>, &'static str> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| BAD_JSON)?;
    // `Vec<String>` only parses from an array whose items are all strings.
    serde_json::from_value(value).map_err(|_| "Arguments must be a JSON array of strings.")
}

/// The command's environment from what was typed: a JSON object of string
/// values, or nothing at all.
pub fn parse_env(text: &str) -> Result<Vec<(String, Secret)>, &'static str> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| BAD_JSON)?;
    let serde_json::Value::Object(entries) = value else {
        return Err("Environment must be a JSON object of string values.");
    };
    let mut env = Vec::with_capacity(entries.len());
    for (name, value) in entries {
        let serde_json::Value::String(value) = value else {
            return Err("Environment values must be strings.");
        };
        env.push((name, Secret::new(value.as_str())));
    }
    Ok(env)
}

const BAD_JSON: &str = "Check the arguments and environment JSON.";

/// What a connection's row says under its name, as the web words it.
pub fn summary(connection: &crate::contracts::McpConnection) -> String {
    let state = if connection.authorization_url.is_some() {
        "Authorization required".to_owned()
    } else if connection.authorization_failed {
        "Authorization did not complete · reconnect to retry".to_owned()
    } else if connection.connected {
        format!("{} tools", connection.tool_count)
    } else if connection.enabled {
        "Disconnected · reconnect to retry".to_owned()
    } else {
        "Paused".to_owned()
    };
    let transport = match connection.transport {
        McpTransport::Http => "Streamable HTTP",
        McpTransport::Stdio => "Local command",
    };
    format!("{state} · {transport} · {}", connection.address)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_are_a_json_array_of_strings() {
        assert_eq!(parse_args("  "), Ok(Vec::new()));
        assert_eq!(
            parse_args(r#"["-y", "a-server"]"#),
            Ok(vec!["-y".to_owned(), "a-server".to_owned()])
        );
        assert!(
            parse_args(r#"["-y", 3]"#)
                .unwrap_err()
                .contains("array of strings")
        );
        assert!(
            parse_args(r#"{"a":"b"}"#)
                .unwrap_err()
                .contains("array of strings")
        );
        assert!(
            parse_args("[-y")
                .unwrap_err()
                .contains("Check the arguments")
        );
    }

    #[test]
    fn the_environment_is_a_json_object_of_strings() {
        assert_eq!(parse_env(""), Ok(Vec::new()));
        let env = parse_env(r#"{"API_TOKEN":"not-a-real-token"}"#).unwrap();
        assert_eq!(env[0].0, "API_TOKEN");
        assert_eq!(env[0].1.expose(), "not-a-real-token");
        assert!(parse_env(r#"["a"]"#).unwrap_err().contains("JSON object"));
        assert!(
            parse_env(r#"{"A":1}"#)
                .unwrap_err()
                .contains("must be strings")
        );
    }

    #[test]
    fn a_new_connection_prints_without_its_secrets() {
        let http = NewMcpConnection::Http {
            purpose: None,
            name: "Tools".into(),
            url: "https://tools.example.com/mcp".into(),
            token: Some(Secret::new("not-a-real-token")),
        };
        let stdio = NewMcpConnection::Stdio {
            purpose: None,
            name: "Local".into(),
            command: "npx".into(),
            args: vec!["-y".into()],
            env: parse_env(r#"{"API_TOKEN":"not-a-real-token"}"#).unwrap(),
        };
        let printed = format!("{http:?} {stdio:?}");
        assert!(!printed.contains("not-a-real-token"), "{printed}");
        assert!(printed.contains("API_TOKEN"));
    }
}
