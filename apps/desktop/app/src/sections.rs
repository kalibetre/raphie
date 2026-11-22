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
    /// Who every bot is talking to: the owner's name, time zone and a few
    /// lines about them. Shared by every bot.
    Owner,
    /// Who is signed in, and signing out.
    Account,
    /// A new bot, before it exists.
    NewBot,
    /// Light or dark.
    Appearance,
    /// This app's version and updates. Desktop only: the web shows its
    /// version under Appearance.
    About,
    /// The switch that collects diagnostic traces, and recent traces. They
    /// belong to the whole Raphie backend, not to one bot.
    Diagnostics,
}

/// A bot's pages. The navigation lists those in [`BotSection::ALL`]; the
/// rest are reached from inside another page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BotSection {
    Profile,
    /// Every saved version of the profile, reached from Profile.
    History,
    Providers,
    Models,
    Memory,
    /// The saved memories, reached from Memory.
    MemoryBrowse,
    Mcp,
    /// The bot's skills, kept in its workspace.
    Skills,
    Channels,
    Sandbox,
    Workspace,
    Jobs,
    Activity,
}

impl BotSection {
    /// The pages the navigation lists, in its order.
    pub const ALL: [BotSection; 11] = [
        BotSection::Profile,
        BotSection::Providers,
        BotSection::Models,
        BotSection::Memory,
        BotSection::Mcp,
        BotSection::Skills,
        BotSection::Channels,
        BotSection::Sandbox,
        BotSection::Workspace,
        BotSection::Jobs,
        BotSection::Activity,
    ];

    pub fn label(self) -> &'static str {
        match self {
            BotSection::Profile => "Profile",
            BotSection::History => "Revision history",
            BotSection::Providers => "Providers",
            BotSection::Models => "Models",
            BotSection::Memory => "Memory",
            BotSection::MemoryBrowse => "Browse memory",
            BotSection::Mcp => "MCP tools",
            BotSection::Skills => "Skills",
            BotSection::Channels => "Channels",
            BotSection::Sandbox => "Sandbox",
            BotSection::Workspace => "Workspace",
            BotSection::Jobs => "Scheduled jobs",
            BotSection::Activity => "Activity",
        }
    }

    /// The page's id in the web workspace's address (`?section=`).
    pub fn web_id(self) -> &'static str {
        match self {
            BotSection::Profile => "bot",
            BotSection::History => "bot-history",
            BotSection::Providers => "providers",
            BotSection::Models => "models",
            BotSection::Memory => "memory",
            BotSection::MemoryBrowse => "memory-browse",
            BotSection::Mcp => "mcp",
            BotSection::Skills => "skills",
            BotSection::Channels => "channels",
            BotSection::Sandbox => "sandbox",
            BotSection::Workspace => "workspace",
            BotSection::Jobs => "jobs",
            BotSection::Activity => "activity",
        }
    }

    /// The page this one was reached from, for pages the navigation does
    /// not list (the web's `parentSection`).
    pub fn parent(self) -> Option<BotSection> {
        match self {
            BotSection::MemoryBrowse => Some(BotSection::Memory),
            BotSection::History => Some(BotSection::Profile),
            _ => None,
        }
    }

    /// The sentence under the page title, in the voice of the bot it
    /// configures.
    pub fn lede(self, bot: &str) -> String {
        match self {
            BotSection::Profile => {
                format!("The identity, color and personality {bot} brings to your conversations.")
            }
            BotSection::History => {
                format!("Every saved version of {bot}’s personality, newest first.")
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
            BotSection::MemoryBrowse => {
                format!("What {bot} remembers, with sources. Correct or forget anything.")
            }
            BotSection::Skills => {
                format!("Instructions {bot} reads when a task needs them, kept in its workspace.")
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
            Page::Owner => "You",
            Page::Account => "Account",
            Page::NewBot => "Create a bot",
            Page::Appearance => "Appearance",
            Page::About => "About",
            Page::Diagnostics => "Diagnostics",
        }
    }

    /// The query that opens this page in the web workspace.
    pub fn web_query(&self) -> String {
        match self {
            Page::Owner => "view=settings&section=owner".to_owned(),
            Page::Account => "view=settings&section=account".to_owned(),
            Page::NewBot => "view=settings&section=new-bot".to_owned(),
            // The web's version sits under Appearance (`general`).
            Page::Appearance | Page::About => "view=settings&section=general".to_owned(),
            Page::Diagnostics => "view=settings&section=telemetry".to_owned(),
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
