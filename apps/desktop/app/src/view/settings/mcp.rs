//! Settings → MCP tools: the servers a bot can reach for tools, and the
//! form that adds one.
//!
//! Mirrors `mcp-settings.tsx` and the `.automation-*` rules in
//! `shared/styles/settings/automation.css`. The form's state is in
//! `crate::mcp`; its checks in `raphie_core::mcp`.
//!
//! "Authorize" opens the server's sign-in page in the browser, as the web's
//! link does: an MCP server's OAuth happens there, not in this app.

use raphie_core::contracts::McpConnection;
use raphie_core::engine::Command;
use raphie_core::mcp::{McpAction, McpTransport, summary};
use rune::{El, Span, Tx, col, row, text};
use rune_kit::{Select, SelectAppearance};

use super::parts::{Scope, group, page, setting, status};
use crate::sections::BotSection;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, text_field};

const HTTP: &str = "Streamable HTTP";
const STDIO: &str = "Local command (stdio)";

pub fn mcp(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.mcp.get(bot_id) {
        Some(connections) => vec![
            servers(s, bot_id, connections, t),
            add_form(s, look, overlays),
        ],
        None => vec![loading(s, bot_id, t)],
    };
    page(
        "rd-page-mcp",
        "MCP tools",
        &BotSection::Mcp.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

/// The connections are on their way, or could not be fetched.
fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let failed = s
        .model
        .mcp_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "MCP tools", "Loading connections…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "MCP tools",
        "Could not load MCP connections.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-mcp-retry"),
            true,
            move |s: &mut Ui| {
                s.model.mcp_error = None;
                s.command(Command::LoadMcp {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// Quiet wrapped text, the web's `.automation-note`.
fn note(t: &Theme, content: &str) -> El {
    text(content)
        .font(font(12.0, 400.0).lh(19.2))
        .color(t.muted_foreground)
        .wrap()
}

/// "Connected servers": one row per connection.
fn servers(s: &Ui, bot_id: &str, connections: &[McpConnection], t: &Theme) -> El {
    let busy = s.model.changing_mcp;
    let mut rows = Vec::new();
    if connections.iter().any(|c| c.from_environment) {
        rows.push(
            // In a column the text gets the card's width to wrap in.
            col().w_full().px(18.0).py(14.0).child(note(
                t,
                "Import saves an encrypted copy for this bot. After import, host environment edits are ignored, even if you remove the saved connection. Your environment files stay unchanged.",
            )),
        );
    }
    for connection in connections {
        rows.push(server(bot_id, connection, busy, t));
    }
    if connections.is_empty() {
        rows.push(setting(
            t,
            None,
            "No MCP servers yet",
            "Connect a server below to give this bot access to its tools.",
            None,
        ));
    }
    group(
        t,
        "Connected servers",
        "Tools are discovered as needed. Tool actions require your approval; connections are not shared with other bots.",
        rows,
    )
}

/// One connection: its name and state, then what can be done to it.
fn server(bot_id: &str, connection: &McpConnection, busy: bool, t: &Theme) -> El {
    let key = |part: &str| format!("rd-mcp-{}-{part}", connection.id);
    // A closure that makes the handler for one action on this connection.
    // Each handler owns its own copies of the ids, because Rune keeps it
    // until the next frame.
    let act = |action: McpAction| {
        let (bot_id, id) = (bot_id.to_owned(), connection.id.clone());
        move |s: &mut Ui| s.change_mcp(&bot_id, &id, action)
    };
    let mut actions = row().gap(8.0).flex_wrap().center_y();
    if let Some(url) = &connection.authorization_url {
        let (label, url) = ("Authorize", url.clone());
        actions = actions.child(
            text(label)
                .key(key("authorize"))
                .role("link")
                .label(format!(
                    "Authorize {} (opens your browser)",
                    connection.name
                ))
                .font(font(12.25, 500.0))
                .color(t.foreground)
                // One span over the whole label draws the underline.
                .spans(vec![Span::new(0, label.len()).underline(t.foreground)])
                .focusable(true)
                .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.authorize_mcp(&url, tx)),
        );
    }
    if connection.from_environment {
        actions = actions
            .child(
                text("Environment configuration · default bot only")
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground),
            )
            .child(pressable(
                button(
                    t,
                    Kind::Primary,
                    Size::Regular,
                    None,
                    "Import encrypted copy",
                )
                .key(key("import")),
                !busy,
                act(McpAction::Import),
            ));
    } else {
        // What the first button does depends on how the connection is doing.
        let waiting = connection.authorization_url.is_some();
        let (label, action) = if connection.connected {
            ("Pause", McpAction::Disable)
        } else if waiting {
            ("Cancel authorization", McpAction::Disable)
        } else if connection.enabled {
            ("Reconnect", McpAction::Enable)
        } else {
            ("Enable", McpAction::Enable)
        };
        actions = actions
            .child(pressable(
                button(t, Kind::Outline, Size::Small, None, label).key(key("toggle")),
                !busy,
                act(action),
            ))
            .child(pressable(
                button(t, Kind::Ghost, Size::Small, None, "Remove").key(key("remove")),
                !busy,
                act(McpAction::Remove),
            ));
    }
    let copy = col()
        .grow(1.0)
        .min_w(0.0)
        .gap(2.0)
        .child(
            text(connection.name.clone())
                .font(font(13.5, 560.0))
                .color(t.foreground),
        )
        .child(
            text(summary(connection))
                .key(key("summary"))
                .font(font(12.5, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    let line = row()
        .key(format!("rd-mcp-{}", connection.id))
        .w_full()
        .px(18.0)
        .py(14.0)
        .gap(16.0);
    if connection.from_environment {
        // Its note and button are too wide to sit beside the name.
        line.child(copy.gap(10.0).child(actions))
    } else {
        line.center_y().child(copy).child(actions)
    }
}

/// "Add a connection": a name, how to reach the server, and its secrets.
fn add_form(s: &Ui, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let form = &s.mcp;
    let busy = s.model.changing_mcp;
    let http = form.transport == McpTransport::Http;
    let caption = |content: &str| text(content).font(font(12.0, 550.0)).color(t.foreground);
    // Return in any field sends the form, as in the web's.
    let submit = |s: &mut Ui, _: &mut Tx| s.add_mcp();

    let options = [HTTP, STDIO];
    let mut fields = col()
        .key("rd-mcp-form")
        .w_full()
        .padding(18.0)
        .gap(10.0)
        .child(caption("Connection name"))
        .child(text_field(
            t,
            Field {
                key: "rd-mcp-name",
                label: "Connection name",
                placeholder: "My project tools",
                edit: &form.name,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.mcp.name,
            submit,
        ))
        .child(caption("Transport"))
        .child(
            Select::new("rd-mcp-transport", &options)
                .label("Transport")
                .appearance(SelectAppearance::Field)
                .width(280.0)
                .current(Some(if http { HTTP } else { STDIO }))
                .open(form.choosing_transport)
                .disabled(busy)
                .on_toggle(|s: &mut Ui| s.mcp.choosing_transport = !s.mcp.choosing_transport)
                .on_close(|s: &mut Ui| s.mcp.choosing_transport = false)
                .on_choose(|s: &mut Ui, chosen: &str, _: &mut Tx| {
                    s.mcp.choose(if chosen == STDIO {
                        McpTransport::Stdio
                    } else {
                        McpTransport::Http
                    });
                })
                .build(&look.kit, overlays),
        )
        .child(caption(if http { "Server URL" } else { "Command" }))
        .child(text_field(
            t,
            Field {
                key: "rd-mcp-address",
                label: if http { "Server URL" } else { "Command" },
                placeholder: if http {
                    "https://tools.example.com/mcp"
                } else {
                    "npx"
                },
                edit: &form.address,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.mcp.address,
            submit,
        ));
    if http {
        fields = fields
            .child(note(
                t,
                "Leave the token empty for automatic browser authorization when the server supports OAuth. After connecting, choose Authorize above to sign in.",
            ))
            .child(caption("Bearer token (optional)"))
            .child(text_field(
                t,
                Field {
                    key: "rd-mcp-token",
                    label: "Bearer token (optional)",
                    placeholder: "",
                    // A secure field: it draws dots, never the token.
                    edit: &form.token,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.mcp.token,
                submit,
            ));
    } else {
        fields = fields
            .child(note(
                t,
                "Local commands run on the runtime host with its permissions.",
            ))
            .child(caption("Arguments (JSON array)"))
            .child(text_field(
                t,
                Field {
                    key: "rd-mcp-args",
                    label: "Arguments (JSON array)",
                    placeholder: r#"["-y", "your-mcp-server"]"#,
                    edit: &form.args,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.mcp.args,
                submit,
            ))
            .child(caption("Environment (JSON object, optional)"))
            .child(text_field(
                t,
                Field {
                    key: "rd-mcp-env",
                    label: "Environment (JSON object, optional)",
                    placeholder: r#"{"API_TOKEN":"…"}"#,
                    // Secure too: the values are usually credentials.
                    edit: &form.env,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.mcp.env,
                submit,
            ));
    }
    // What is wrong with the form first, then what the runtime refused.
    let error = form
        .error
        .map(str::to_owned)
        .or_else(|| s.model.mcp_change_error.clone());
    if let Some(error) = error {
        fields = fields.child(
            text(error)
                .key("rd-mcp-error")
                .font(font(12.5, 500.0))
                .color(t.error)
                .wrap(),
        );
    }
    if let Some(message) = &s.model.mcp_message {
        fields = fields.child(note(t, message).key("rd-mcp-message"));
    }
    fields = fields.child(
        row()
            .w_full()
            .gap(8.0)
            .flex_wrap()
            .center_y()
            .child(pressable(
                button(
                    t,
                    Kind::Primary,
                    Size::Regular,
                    None,
                    if busy {
                        "Connecting…"
                    } else {
                        "Connect server"
                    },
                )
                .key("rd-mcp-connect"),
                !busy && form.is_complete(),
                |s: &mut Ui| s.add_mcp(),
            ))
            .child(pressable(
                button(t, Kind::Ghost, Size::Regular, None, "Discard").key("rd-mcp-discard"),
                !busy && form.is_dirty(),
                |s: &mut Ui| s.discard_mcp(),
            )),
    );
    group(
        t,
        "Add a connection",
        "Credentials are encrypted on the runtime. To change a server's configuration, remove it and add its replacement.",
        vec![fields],
    )
}
