//! The pages of Settings, as the web workspace names them.
//!
//! In sync with `apps/web/src/domains/settings/presentation/
//! settings-sections.ts` (labels, ledes, the `?section=` ids) and
//! `settings-nav.tsx` (which pages a bot has, and their order).

/// One page of Settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Page {
    /// A page of one bot's settings.
    Bot { bot_id: String, section: BotSection },
    /// Who is signed in, and signing out.
    Account,
    /// Light or dark.
    Appearance,
}

/// The pages every bot has, in the order the navigation lists them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BotSection {
    Profile,
    Providers,
    Models,
    Memory,
    Mcp,
    Channels,
    Sandbox,
    Workspace,
    Jobs,
    Diagnostics,
    Activity,
}

impl BotSection {
    pub const ALL: [BotSection; 11] = [
        BotSection::Profile,
        BotSection::Providers,
        BotSection::Models,
        BotSection::Memory,
        BotSection::Mcp,
        BotSection::Channels,
        BotSection::Sandbox,
        BotSection::Workspace,
        BotSection::Jobs,
        BotSection::Diagnostics,
        BotSection::Activity,
    ];

    pub fn label(self) -> &'static str {
        match self {
            BotSection::Profile => "Profile",
            BotSection::Providers => "Providers",
            BotSection::Models => "Models",
            BotSection::Memory => "Memory",
            BotSection::Mcp => "MCP tools",
            BotSection::Channels => "Channels",
            BotSection::Sandbox => "Sandbox",
            BotSection::Workspace => "Workspace",
            BotSection::Jobs => "Scheduled jobs",
            BotSection::Diagnostics => "Diagnostics",
            BotSection::Activity => "Activity",
        }
    }

    /// The page's id in the web workspace's address (`?section=`).
    pub fn web_id(self) -> &'static str {
        match self {
            BotSection::Profile => "bot",
            BotSection::Providers => "providers",
            BotSection::Models => "models",
            BotSection::Memory => "memory",
            BotSection::Mcp => "mcp",
            BotSection::Channels => "channels",
            BotSection::Sandbox => "sandbox",
            BotSection::Workspace => "workspace",
            BotSection::Jobs => "jobs",
            BotSection::Diagnostics => "telemetry",
            BotSection::Activity => "activity",
        }
    }

    /// The sentence under the page title, in the voice of the bot it
    /// configures.
    pub fn lede(self, bot: &str) -> String {
        match self {
            BotSection::Profile => {
                format!("The identity, color and personality {bot} brings to your conversations.")
            }
            BotSection::Providers => {
                format!(
                    "Model connections only {bot} can use. Keys stay encrypted on this machine."
                )
            }
            BotSection::Models => {
                format!("Compare what {bot} can run, and pick where new conversations start.")
            }
            BotSection::Memory => {
                format!("What {bot} keeps between conversations, and where it lives.")
            }
            BotSection::Mcp => {
                format!("Connect the tools {bot} can use. Every connection belongs to this bot.")
            }
            BotSection::Channels => format!("Connect {bot} to messaging channels."),
            BotSection::Sandbox => {
                format!(
                    "How {bot} runs commands, with the active execution provider and its limits."
                )
            }
            BotSection::Workspace => format!(
                "The files {bot} keeps between conversations. Browse folders and download saved work."
            ),
            BotSection::Jobs => format!(
                "Give {bot} reminders and recurring work, with results saved in a conversation."
            ),
            BotSection::Diagnostics => {
                format!("Timings and failures from {bot}’s runs. Nothing leaves this backend.")
            }
            BotSection::Activity => {
                format!("Recent activity from {bot}, across its conversations.")
            }
        }
    }
}

impl Page {
    pub fn label(&self) -> &'static str {
        match self {
            Page::Bot { section, .. } => section.label(),
            Page::Account => "Account",
            Page::Appearance => "Appearance",
        }
    }

    /// The query that opens this page in the web workspace.
    pub fn web_query(&self) -> String {
        match self {
            Page::Account => "view=settings&section=account".to_owned(),
            Page::Appearance => "view=settings&section=general".to_owned(),
            Page::Bot { bot_id, section } => {
                // Bot ids are letters, digits and dashes, so they need no
                // escaping; anything else is left out rather than guessed at.
                let safe = bot_id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-');
                if safe {
                    format!("view=settings&section={}&bot={bot_id}", section.web_id())
                } else {
                    format!("view=settings&section={}", section.web_id())
                }
            }
        }
    }
}
