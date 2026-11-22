//! The UI's state: the core [`Model`] plus what only the window needs (text
//! being typed, whether the sidebar is open), and the bridge to the engine.

use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use raphie_core::attachments::{Preview, Upload, is_image};
use raphie_core::auth::KeychainStore;
use raphie_core::auth::Secret;
use raphie_core::channels::{Channel, ChannelChange, ChannelOutcome, is_telegram_token};
use raphie_core::contracts::SessionSummary;
use raphie_core::contracts::{
    ApprovalMode, AskAnswer, ControlAction, Decision, MemoryProvider, MemoryStatus, ModelSelection,
    RuntimeSettings, Scope, TurnStatus, UpdateBotProfile,
};
use raphie_core::contracts::{BotRef, HandedOffBy, Handoff, HandoffStatus};
use raphie_core::contracts::{ProviderSignIn, SignInEvent, SignInStatus};
use raphie_core::engine::{Client, Command, ConnectionChange, EngineConfig};
use raphie_core::flavor::Flavor;
use raphie_core::inbox::{self, Announcement, Announcements, Item, Target};
use raphie_core::jobs::JobAction;
use raphie_core::last_sessions::LastSessions;
use raphie_core::local_install;
use raphie_core::mcp::McpAction;
use raphie_core::memory::{CONTENT_LIMIT, QUERY_LIMIT};
use raphie_core::mentions::{MentionQuery, insert_mention, mention_matches, mention_query};
use raphie_core::model::{AuthState, Effect, Event, Model, SkillOutcome};
use raphie_core::model_library::{self, ModelFilter, PickerFilter};
use raphie_core::origin::Origin;
use raphie_core::projections::tool_steps;
use raphie_core::replies::ReadReplies;
use raphie_core::self_updates::{SelfUpdateKind, SelfUpdateNote, self_update_notes};
use raphie_core::settings::{Settings, ThemeChoice};
use raphie_core::slash::{SlashItem, SlashKind, insert_skill, slash_matches, slash_query};
use raphie_core::updates::ReleaseChannel;
use raphie_core::updates::UpdateStatus;
use raphie_core::workspace::{self, ROOT};
use rune::{
    ClipboardContent, FileDialogOptions, Image, ImageCache, Key, KeyEvent, TextEdit, Tx, Waker,
};

use crate::channels::{DiscordForm, TelegramForm, UNSAVED};
use crate::format::now_ms;
use crate::jobs::JobForm;
use crate::mcp::McpForm;
use crate::memory::MemoryDraft;
use crate::notify;
use crate::owner::OwnerDraft;
use crate::profile::{NEW_BOT, ProfileDraft};
use crate::sandbox::SandboxDraft;
use crate::sections::{BotSection, Page};
use crate::skills::{SkillEditor, SkillsMode, SkillsView};

/// The fixture's web host: the default for a first launch from a checkout.
/// The test fixture's web host (`bun run dev:web:fixture`), which the dev
/// app offers until it has signed in somewhere.
pub const FIXTURE_ORIGIN: &str = "http://127.0.0.1:4321";

/// The address offered before this app has signed in anywhere: the dev app
/// offers the test fixture; the release app, Raphie installed on this Mac
/// (at the port its installer saved, or the default one).
fn first_origin(flavor: Flavor, ports_file: Option<&std::path::Path>) -> String {
    match flavor {
        Flavor::Dev => FIXTURE_ORIGIN.to_owned(),
        Flavor::Release => local_install::origin_at(ports_file).as_str().to_owned(),
    }
}

/// Which conversations the sidebar lists (the web's filter chips).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    All,
    /// Only conversations with replies not read yet on this computer.
    NewReplies,
    /// Only conversations with an action waiting for approval.
    Approvals,
    /// Only archived conversations, fetched when chosen.
    Archived,
}

/// Which notifications the inbox lists (the web's tabs).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InboxFilter {
    #[default]
    All,
    Replies,
    Approvals,
    Jobs,
}

/// How often the other bots' conversations and every bot's job updates
/// are asked for, in seconds. The web asks every 15.
const INBOX_REFRESH: f64 = 15.0;

/// Which connection the form on Settings → Providers is for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectionTarget {
    /// A connection that does not exist yet.
    New,
    /// The saved connection with this id.
    Edit(String),
}

/// Settings → Providers: the one form that can be open, and what is typed
/// in it. The key field is secure: it shows dots, and Rune wipes it from
/// memory when it is cleared or dropped.
pub struct ProvidersView {
    /// The form that is open, if any.
    pub open: Option<ConnectionTarget>,
    /// The provider chosen for a new connection.
    pub provider: String,
    /// Whether the provider list is open.
    pub choosing_provider: bool,
    pub name: TextEdit,
    pub key: TextEdit,
    /// The answer to a subscription sign-in's question: a pasted address
    /// or code, so a secure field.
    pub answer: TextEdit,
}

impl ProvidersView {
    pub fn new() -> ProvidersView {
        ProvidersView {
            open: None,
            provider: String::new(),
            choosing_provider: false,
            name: TextEdit::new(""),
            key: TextEdit::new("").secure(),
            answer: TextEdit::new("").secure(),
        }
    }
}

impl Default for ProvidersView {
    fn default() -> ProvidersView {
        ProvidersView::new()
    }
}

/// A drop-down list on Settings → Models.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dropdown {
    Provider,
    Source,
    Connection,
}

/// How many models the Models page shows before "Show more models".
pub const MODELS_PAGE: usize = 24;

/// What Settings → Models is showing: its filters and which list is open.
pub struct ModelsView {
    /// The search box.
    pub search: TextEdit,
    /// The chosen provider, model source and connection ids. `None` is "all".
    pub provider: Option<String>,
    pub source: Option<String>,
    pub connection: Option<String>,
    /// How many models to show.
    pub limit: usize,
    /// The drop-down that is open, if any.
    pub open: Option<Dropdown>,
}

impl ModelsView {
    pub fn new() -> ModelsView {
        ModelsView {
            search: TextEdit::new(""),
            provider: None,
            source: None,
            connection: None,
            limit: MODELS_PAGE,
            open: None,
        }
    }

    /// The filters as the core's model library takes them.
    pub fn filter(&self) -> ModelFilter {
        ModelFilter {
            search: self.search.text.clone(),
            provider: self.provider.clone(),
            source: self.source.clone(),
            connection: self.connection.clone(),
        }
    }
}

impl Default for ModelsView {
    fn default() -> ModelsView {
        ModelsView::new()
    }
}

/// How long typing must pause before a live search is sent, in seconds
/// (the web waits 300 ms too).
const SEARCH_PAUSE: f64 = 0.3;

/// How often the MCP tools page asks again how its connections are doing,
/// in seconds (the web's interval). A connection's state changes on its
/// own: an authorization finishes in the browser, a server drops.
const MCP_REFRESH: f64 = 5.0;

/// How often the Channels page asks again for the home channel, and, while
/// a Telegram pairing code is out, for the channels (the web's intervals).
const HOME_REFRESH: f64 = 5.0;

/// How often the Sandbox page asks again for its details (the web's
/// interval): usage and running operations change on their own.
const SANDBOX_REFRESH: f64 = 5.0;

/// How often the Scheduled jobs page asks again for its jobs and newest
/// runs (the web's interval): runs start and finish on their own.
const JOBS_REFRESH: f64 = 5.0;
/// How often the selected bot's handoffs are asked for: often while one is
/// open, as the web polls, and now and then otherwise.
const HANDOFFS_OPEN_REFRESH: f64 = 3.0;
const HANDOFFS_IDLE_REFRESH: f64 = 15.0;
/// How a message links a bot it names: `raphie-bot:<id>`.
pub const MENTION_SCHEME: &str = "raphie-bot:";

/// How often Diagnostics and Activity ask again for their lists (the web's
/// interval).
const INSPECT_REFRESH: f64 = 5.0;

/// The bot whose routes carry what belongs to the whole backend: the
/// runtime serves trace collection and traces on the default bot's routes.
pub const BACKEND: &str = "default";

/// The filter box and the unfolded rows of Diagnostics or Activity.
pub struct InspectView {
    pub filter: TextEdit,
    /// Rows whose details are unfolded, by id.
    pub open: HashSet<String>,
}

impl InspectView {
    pub fn new() -> InspectView {
        InspectView {
            filter: TextEdit::new(""),
            open: HashSet::new(),
        }
    }
}

impl Default for InspectView {
    fn default() -> InspectView {
        InspectView::new()
    }
}

/// How often the Workspace page asks again for the folder on screen (the
/// web's interval): the bot may be writing files while the owner looks.
const FILES_REFRESH: f64 = 5.0;
const PAIRING_REFRESH: f64 = 2.0;

/// "Browse memory": the search box, and the one memory being changed. The
/// list itself is in the core (`Model::memories`).
pub struct MemoriesView {
    pub query: TextEdit,
    /// The query the list on screen is for, so a change in the box shows.
    seen: String,
    /// The frame clock when the box last changed, while a live search waits
    /// for the typing to pause.
    typed_at: Option<f64>,
    /// The memory being corrected, and what it should say instead.
    pub editing: Option<String>,
    pub correction: TextEdit,
    /// The memory waiting on "Confirm forget".
    pub forgetting: Option<String>,
    /// Memories whose source and record id are unfolded.
    pub open_sources: HashSet<String>,
}

impl MemoriesView {
    pub fn new() -> MemoriesView {
        MemoriesView {
            query: TextEdit::new(""),
            seen: String::new(),
            typed_at: None,
            editing: None,
            correction: TextEdit::new(""),
            forgetting: None,
            open_sources: HashSet::new(),
        }
    }

    /// Whether a live search is waiting for the typing to pause.
    pub fn search_pending(&self) -> bool {
        self.typed_at.is_some()
    }
}

impl Default for MemoriesView {
    fn default() -> MemoriesView {
        MemoriesView::new()
    }
}

/// What fills the window once signed in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Screen {
    /// Bots and conversations.
    Workspace,
    /// Settings, on one of its pages.
    Settings(Page),
}

pub struct Ui {
    /// Everything the core knows. The view only reads it.
    pub model: Model,
    /// Which build this is. The dev build says so beside the brand.
    pub flavor: Flavor,
    /// Which releases this build follows. A nightly says so beside the brand.
    pub release_channel: ReleaseChannel,
    /// The running engine. `None` in headless runs and tests, where commands
    /// are recorded in `sent` instead of going to a network.
    client: Option<Client>,
    /// Commands sent while there was no engine (for tests).
    pub sent: Vec<Command>,
    /// Web pages opened while there was no engine (for tests).
    pub opened: Vec<String>,
    /// The sign-in screen's address field.
    pub origin_field: TextEdit,
    /// What the owner is typing to Raphie.
    pub composer: TextEdit,
    /// The list of bots working for this conversation, from the composer.
    pub delegates_open: bool,
    /// Result cards whose report is unfolded, by turn id.
    pub open_reports: HashSet<String>,
    /// Turns whose summary of earlier messages is shown.
    pub open_summaries: HashSet<String>,
    /// The question being answered in the owner's own words, and the words.
    pub own_answer: Option<(String, TextEdit)>,
    /// The highlighted bot in the composer's "@" menu.
    pub mention_active: usize,
    /// The "@" (its byte offset) Escape closed the menu for.
    pub mention_dismissed: Option<usize>,
    /// The highlighted entry of the composer's "/" menu.
    pub slash_active: usize,
    /// What was typed after "/" when Escape closed the menu; typing more
    /// opens it again.
    pub slash_dismissed: Option<String>,
    /// The bot whose skills were last asked for, for the "/" menu.
    skills_asked: Option<String>,
    /// Self-update steps (by tool step id) whose saves have been asked for:
    /// a new one asks for the bot's history and the owner's profile again.
    self_updates_asked: HashSet<String>,
    /// Skill notes (by note key) whose change has been asked for, with the
    /// bot's skills as they were then: when those change, a note may no
    /// longer be undoable, so it asks again.
    skill_changes_asked: HashMap<String, String>,
    /// Bot changes (by change id) the skills list did not show yet; the list
    /// was reloaded once for each, so earlier notes learn they are stale.
    skill_changes_seen: HashSet<String>,
    /// The save on its way restores a revision or undoes a bot's change,
    /// not the Profile form: unsaved edits in the form stay.
    restoring_profile: bool,
    /// When the selected bot's handoffs were last asked for, which bot that
    /// was, and what its conversation looked like then: a settled turn or a
    /// finished tool step asks again at once, so a new handoff's card comes
    /// with the reply that made it.
    handoffs_asked_at: f64,
    handoffs_bot: Option<String>,
    handoff_signal: String,
    /// Files are being dragged over the conversation.
    pub drop_hover: bool,
    /// Whether the bot roster on the left shows (⌘B).
    pub roster_open: bool,
    /// In a narrow window, where one column shows at a time: whether it is
    /// the roster (home) rather than the conversation.
    pub narrow_home: bool,
    /// In a narrow window, whether Settings shows its navigation rather
    /// than a page.
    pub settings_nav_home: bool,
    /// The workspace's size in points, as last laid out; 0 before the
    /// first layout. The width bounds the roster's, and the height the
    /// share the bots take of it.
    pub workspace_width: f32,
    pub workspace_height: f32,
    /// The roster's chosen width, dragged by its edge and kept in the
    /// settings.
    pub roster_width: f32,
    /// The search box over the selected bot's conversations.
    pub search: TextEdit,
    pub filter: Filter,
    pub screen: Screen,
    /// Bots whose pages are unfolded in the Settings navigation.
    pub expanded_bots: HashSet<String>,
    /// Light, dark or following the system (Settings → Appearance).
    pub theme: ThemeChoice,
    /// The composer's model picker.
    pub model_picker: ModelPicker,
    /// Models starred in the picker, kept on this computer.
    pub favorites: Vec<String>,
    /// The model chosen for a conversation that has not started yet. It
    /// goes with the first message.
    pub new_model: Option<ModelSelection>,
    /// The inbox (notifications across every bot) shows in place of the
    /// conversation.
    pub inbox_open: bool,
    pub inbox_filter: InboxFilter,
    /// When the inbox was last asked for, on `poll`'s clock; negative
    /// until the first time.
    inbox_asked_at: f64,
    /// Which updates the owner has been told about by the system.
    announced: Announcements,
    /// System notifications that would have been posted, kept while there
    /// is no engine (for tests).
    pub posted: Vec<Announcement>,
    /// How many of each conversation's replies were read on this computer.
    pub read_replies: ReadReplies,
    /// The conversation last open with each bot, reopened when the bot is
    /// chosen again.
    pub last_sessions: LastSessions,
    /// The conversation on screen is scrolled to its end.
    pub at_bottom: bool,
    /// This window is the one in front.
    pub window_focused: bool,
    /// Whether the composer's command permissions list shows.
    pub permissions_open: bool,
    /// The command mode chosen for a conversation that has not started
    /// yet. It goes with the first message.
    pub draft_mode: ApprovalMode,
    /// The bot whose models were last asked for, so they are asked for
    /// once and not on every event.
    models_asked: Option<String>,
    /// Settings → Models: its filters.
    pub models: ModelsView,
    /// Settings → Providers: its form.
    pub providers: ProvidersView,
    /// Settings → Memory: its form.
    pub memory: MemoryDraft,
    /// Settings → Memory → Browse memory.
    pub memories: MemoriesView,
    /// Settings → Revision history: the revisions that are unfolded.
    pub open_revisions: HashSet<u32>,
    /// Settings → Profile: whether "Delete bot" is asking to be confirmed,
    /// and what was typed to confirm it.
    pub deleting_bot: bool,
    pub delete_confirmation: TextEdit,
    /// Settings → Diagnostics: its filter, and the time window in hours.
    pub spans: InspectView,
    pub trace_hours: u8,
    /// Settings → Activity: its filter.
    pub events: InspectView,
    /// The frame clock when Diagnostics or Activity last asked for news.
    inspect_asked_at: f64,
    /// Settings → Scheduled jobs: the "Create a job" form.
    pub job: JobForm,
    /// The frame clock when the Scheduled jobs page last asked for news.
    jobs_asked_at: f64,
    /// The frame clock when the Workspace page last asked for its folder.
    files_asked_at: f64,
    /// Settings → You: its form.
    pub owner: OwnerDraft,
    /// Settings → Sandbox: its form.
    pub sandbox: SandboxDraft,
    /// The frame clock when the Sandbox page last asked for its details.
    sandbox_asked_at: f64,
    /// Settings → Channels: the Discord form and the Telegram panel.
    pub discord: DiscordForm,
    pub telegram: TelegramForm,
    /// The frame clock when the Channels page last asked for the home
    /// channel, and for the channels.
    channels_asked_at: (f64, f64),
    /// Settings → MCP tools: the "Add a connection" form.
    pub mcp: McpForm,
    /// Settings → Skills: the list, an open skill and the import dialog.
    pub skills: SkillsView,
    /// The frame clock when the MCP tools page last asked for its
    /// connections.
    mcp_asked_at: f64,
    /// The frame clock when a waiting sign-in was last asked about.
    sign_in_asked_at: f64,
    /// The sign-in whose page was opened by itself, so it opens once.
    sign_in_opened: Option<String>,
    /// The Profile form on screen.
    pub profile: ProfileDraft,
    /// Unsaved Profile edits for other bots, kept while the owner looks at
    /// another page, so moving around Settings never loses work.
    parked_profiles: HashMap<String, ProfileDraft>,
    /// Turns whose list of tool steps is unfolded.
    pub open_runs: HashSet<String>,
    /// Tool steps whose arguments and result are unfolded.
    pub open_steps: HashSet<String>,
    /// The frame clock (seconds) when the view last refreshed its "elapsed"
    /// labels.
    ticked_at: f64,
    /// Decodes pictures off the UI thread. Made in `setup`, which has the
    /// waker it needs; `None` in tests, where cards keep their icons.
    images: Option<ImageCache>,
    /// Image attachments' pictures, decoded or decoding, by bot and file id.
    pictures: HashMap<(String, String), Image>,
    /// The picture shown enlarged over the window, if one is.
    pub viewer: Option<Viewer>,
    /// The highest read count sent to the runtime per bot and session, so
    /// each is shared once.
    reported_reads: HashMap<(String, String), u32>,
}

/// An image attachment shown enlarged: whose file it is, and its name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Viewer {
    pub bot_id: String,
    pub id: String,
    pub name: String,
}

/// The bot roster's width on the left until dragged, the web's default,
/// and how narrow and wide a drag may make it (the web's limits).
pub const ROSTER_WIDTH: f32 = 264.0;
pub const ROSTER_MIN: f32 = 220.0;
pub const ROSTER_MAX: f32 = 480.0;

/// Below this width one column shows at a time, as on a phone: the roster
/// as home, or the conversation with a way back (the web's 768).
pub const NARROW: f32 = 768.0;

/// The narrowest the conversation is squeezed to when the window is too
/// small for the chosen widths: the columns give way first (the web's 320).
const CONVERSATION_FLOOR: f32 = 320.0;

/// The composer's model picker: whether it is open, and how its list is
/// narrowed.
#[derive(Default)]
pub struct ModelPicker {
    pub open: bool,
    pub search: TextEdit,
    pub filter: PickerFilter,
    /// Whether the "Model family" drop-down's list shows.
    pub family_open: bool,
}

impl Ui {
    /// A UI with no engine attached yet (`setup` attaches one in a window),
    /// offering the last origin this machine signed in to.
    pub fn new() -> Ui {
        // Snapshots (`--snap`) only run in debug builds, but they show the
        // app as people get it: the release look, with every setting at
        // its default, whatever this computer's owner has chosen. The
        // `dev-build` scene shows the dev look.
        if rune::tooling::headless_run().is_some() {
            let mut ui = Ui::with_origin(&first_origin(Flavor::Release, None));
            ui.flavor = Flavor::Release;
            ui.release_channel = ReleaseChannel::Stable;
            return ui;
        }
        let saved = Settings::default_path()
            .map(|path| Settings::load(&path))
            .unwrap_or_default();
        let first = || first_origin(Flavor::current(), local_install::ports_file().as_deref());
        let mut ui = Ui::with_origin(&saved.origin.unwrap_or_else(first));
        ui.theme = saved.theme;
        ui.favorites = saved.model_favorites;
        // `as f32` turns the saved whole points into points to draw with.
        if let Some(width) = saved.roster_width {
            ui.roster_width = (width as f32).clamp(ROSTER_MIN, ROSTER_MAX);
        }
        ui.read_replies = ReadReplies::default_path()
            .map(|path| ReadReplies::load(&path))
            .unwrap_or_default();
        ui.last_sessions = LastSessions::default_path()
            .map(|path| LastSessions::load(&path))
            .unwrap_or_default();
        ui
    }

    /// A UI offering `origin` on the sign-in screen.
    pub fn with_origin(origin: &str) -> Ui {
        Ui {
            model: Model::new(),
            flavor: Flavor::current(),
            release_channel: ReleaseChannel::current(),
            client: None,
            sent: Vec::new(),
            opened: Vec::new(),
            origin_field: TextEdit::new(origin),
            composer: TextEdit::new(""),
            drop_hover: false,
            roster_open: true,
            narrow_home: true,
            settings_nav_home: false,
            workspace_width: 0.0,
            workspace_height: 0.0,
            roster_width: ROSTER_WIDTH,
            search: TextEdit::new(""),
            filter: Filter::All,
            screen: Screen::Workspace,
            expanded_bots: HashSet::new(),
            theme: ThemeChoice::System,
            model_picker: ModelPicker::default(),
            favorites: Vec::new(),
            new_model: None,
            inbox_open: false,
            inbox_filter: InboxFilter::All,
            inbox_asked_at: -INBOX_REFRESH,
            announced: Announcements::default(),
            posted: Vec::new(),
            read_replies: ReadReplies::default(),
            last_sessions: LastSessions::default(),
            // A conversation opens at its end, in a window in front.
            at_bottom: true,
            window_focused: true,
            permissions_open: false,
            draft_mode: ApprovalMode::Ask,
            models_asked: None,
            models: ModelsView::new(),
            providers: ProvidersView::new(),
            memory: MemoryDraft::empty(),
            memories: MemoriesView::new(),
            open_revisions: HashSet::new(),
            deleting_bot: false,
            delete_confirmation: TextEdit::new(""),
            spans: InspectView::new(),
            trace_hours: 1,
            events: InspectView::new(),
            inspect_asked_at: 0.0,
            job: JobForm::new_at(0),
            jobs_asked_at: 0.0,
            delegates_open: false,
            open_reports: HashSet::new(),
            open_summaries: HashSet::new(),
            own_answer: None,
            mention_active: 0,
            mention_dismissed: None,
            slash_active: 0,
            slash_dismissed: None,
            skills_asked: None,
            self_updates_asked: HashSet::new(),
            skill_changes_asked: HashMap::new(),
            skill_changes_seen: HashSet::new(),
            restoring_profile: false,
            handoffs_asked_at: 0.0,
            handoffs_bot: None,
            handoff_signal: String::new(),
            files_asked_at: 0.0,
            owner: OwnerDraft::empty(),
            sandbox: SandboxDraft::empty(),
            sandbox_asked_at: 0.0,
            discord: DiscordForm::new(),
            telegram: TelegramForm::new(),
            channels_asked_at: (0.0, 0.0),
            mcp: McpForm::new(),
            skills: SkillsView::new(),
            mcp_asked_at: 0.0,
            sign_in_asked_at: 0.0,
            sign_in_opened: None,
            profile: ProfileDraft::empty(),
            parked_profiles: HashMap::new(),
            open_runs: HashSet::new(),
            open_steps: HashSet::new(),
            ticked_at: 0.0,
            images: None,
            pictures: HashMap::new(),
            viewer: None,
            reported_reads: HashMap::new(),
        }
    }

    /// Sends a command to the engine, or records it when there is none.
    pub fn command(&mut self, command: Command) {
        match &self.client {
            Some(client) => client.send(command),
            None => self.sent.push(command),
        }
    }

    // ----- What the owner does -----

    /// The address of a Raphie found on this Mac, when it is not the one
    /// already in the field.
    pub fn local_install_offer(&self) -> Option<&str> {
        let local = self.model.local_install.as_ref()?;
        let typed = Origin::parse(&self.origin_field.text).ok();
        (typed.as_ref() != Some(local)).then_some(local.as_str())
    }

    /// Connects to the Raphie found on this Mac.
    pub fn use_local_install(&mut self) {
        let Some(local) = self.model.local_install.clone() else {
            return;
        };
        self.origin_field = TextEdit::new(local.as_str());
        self.connect();
    }

    pub fn connect(&mut self) {
        match Origin::parse(&self.origin_field.text) {
            Ok(origin) => {
                self.model.notice = None;
                self.command(Command::Connect { origin });
            }
            Err(error) => {
                self.model.auth = AuthState::SignedOut {
                    notice: Some(error.to_string()),
                };
            }
        }
    }

    pub fn select_bot(&mut self, bot_id: &str) {
        // What was open with the bot being left, including a conversation
        // that started since it was chosen.
        self.remember_session();
        self.inbox_open = false;
        // A model chosen for one bot's new conversation is not another's.
        self.new_model = None;
        self.model_picker.open = false;
        self.draft_mode = ApprovalMode::Ask;
        self.permissions_open = false;
        self.model.select_bot(bot_id.to_owned());
        self.command(Command::SelectBot {
            bot_id: bot_id.to_owned(),
        });
        // The Archived filter shows this bot's archived ones now.
        if self.filter == Filter::Archived && self.model.archived.is_none() {
            self.command(Command::LoadArchived);
        }
    }

    /// Chooses which conversations the sidebar lists. The archived ones
    /// are fetched each time their filter is chosen, as on the web.
    pub fn choose_filter(&mut self, filter: Filter) {
        self.filter = filter;
        if filter == Filter::Archived {
            self.command(Command::LoadArchived);
        }
    }

    /// Archives one of the selected bot's conversations, or brings it
    /// back. It stays open if it is.
    pub fn archive(&mut self, session_id: &str, archived: bool) {
        self.command(Command::Archive {
            session_id: session_id.to_owned(),
            archived,
        });
    }

    /// The roster's drawn width: the chosen one, unless the window cannot
    /// fit it beside the conversation, as on the web.
    pub fn visible_roster_width(&self) -> f32 {
        if self.workspace_width <= 0.0 {
            return self.roster_width;
        }
        // In a narrow window the roster, when it shows, is the whole width.
        if self.narrow() {
            return self.workspace_width;
        }
        let room = self.workspace_width - CONVERSATION_FLOOR;
        self.roster_width.min(room.max(ROSTER_MIN))
    }

    /// True when the window is too narrow for two columns.
    pub fn narrow(&self) -> bool {
        self.workspace_width > 0.0 && self.workspace_width < NARROW
    }

    /// The width of the pane beside the roster: the window's in a narrow one.
    pub fn main_width(&self) -> f32 {
        if self.narrow() || !self.roster_open {
            self.workspace_width
        } else {
            self.workspace_width - self.visible_roster_width()
        }
    }

    /// In a narrow window, back from a conversation to the roster.
    pub fn go_home(&mut self) {
        self.narrow_home = true;
        self.inbox_open = false;
    }

    /// Sets the roster's width from a drag, within its limits.
    pub fn resize_roster(&mut self, width: f32) {
        self.roster_width = width.clamp(ROSTER_MIN, ROSTER_MAX);
    }

    /// Keeps the roster's width for the next launch, once a drag ends.
    pub fn save_layout(&self) {
        if self.client.is_none() {
            // Tests and headless runs leave the owner's settings alone.
            return;
        }
        if let Some(path) = Settings::default_path() {
            let mut saved = Settings::load(&path);
            // `round` then `as u32`: the nearest whole point.
            saved.roster_width = Some(self.roster_width.round() as u32);
            // Forgetting a width is harmless: the default comes back.
            let _ = saved.save(&path);
        }
    }

    pub fn select_session(&mut self, session_id: Option<&str>) {
        // In a narrow window the conversation takes the roster's place.
        self.narrow_home = false;
        self.inbox_open = false;
        self.new_model = None;
        self.model_picker.open = false;
        // A conversation opens at its end.
        self.at_bottom = true;
        // Each conversation starts by asking, as on the web.
        self.draft_mode = ApprovalMode::Ask;
        self.permissions_open = false;
        self.model.select_session(session_id.map(str::to_owned));
        self.command(Command::SelectSession {
            session_id: session_id.map(str::to_owned),
        });
    }

    /// Puts a suggested message in the composer for the owner to send or edit.
    pub fn suggest(&mut self, text: &str) {
        self.composer = TextEdit::new(text);
    }

    pub fn load_older(&mut self) {
        let Some(session_id) = self
            .model
            .conversation
            .as_ref()
            .map(|c| c.session_id.clone())
        else {
            return;
        };
        if let Some(before) = self.model.begin_load_older() {
            self.command(Command::LoadOlder { session_id, before });
        }
    }

    pub fn send(&mut self) {
        let text = self.composer.text.trim().to_owned();
        let bot_id = self.model.bot_id.clone();
        let draft = &self.model.attachments;
        // Files alone are a message; an upload still running is not ready.
        let nothing = text.is_empty() && draft.files_for(bot_id.as_deref()).is_empty();
        if nothing || draft.uploading || !self.model.begin_send() {
            return;
        }
        // The runtime accepts up to 4,000 characters per message.
        if text.chars().count() > 4000 {
            self.model.sending = false;
            self.model.notice = Some("Messages can be at most 4,000 characters.".into());
            return;
        }
        let attachments = match &bot_id {
            Some(bot_id) => self.model.attachments.take_for_send(bot_id),
            None => Vec::new(),
        };
        // Only a conversation that has not started takes a model and a
        // command mode from its first message.
        let (model, approval_mode) = match self.model.conversation {
            Some(_) => (None, None),
            None => (self.new_model.clone(), Some(self.draft_mode)),
        };
        self.command(Command::Send {
            text,
            attachments,
            model,
            approval_mode,
        });
    }

    /// The models the selected bot can run, once they have loaded.
    pub fn bot_models(&self) -> Option<&RuntimeSettings> {
        self.model.settings.get(self.model.bot_id.as_deref()?)
    }

    /// The model the next message will be answered with: the one chosen
    /// for this conversation, else the bot's default for new sessions.
    pub fn active_model(&self) -> Option<ModelSelection> {
        let chosen = match self.model.conversation {
            Some(_) => self.model.session_model().cloned(),
            None => self.new_model.clone(),
        };
        chosen.or_else(|| {
            let settings = self.bot_models()?;
            // A bot with no connection has no default: both are empty.
            (!settings.model_id.is_empty()).then(|| ModelSelection {
                provider: settings.provider.clone(),
                model_id: settings.model_id.clone(),
            })
        })
    }

    /// Asks for the selected bot's models, once per bot, so the picker's
    /// button can name the model before the picker is ever opened.
    fn ensure_models(&mut self) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            return;
        };
        // Only the conversation screen has the picker; Settings pages load
        // the models themselves when they need them.
        let wanted = matches!(self.model.auth, AuthState::SignedIn)
            && matches!(self.screen, Screen::Workspace);
        if wanted && self.models_asked.as_deref() != Some(bot_id.as_str()) {
            self.models_asked = Some(bot_id.clone());
            if !self.model.settings.contains_key(&bot_id) {
                self.command(Command::LoadSettings { bot_id });
            }
        }
    }

    /// How many of one of the selected bot's conversations' replies have
    /// not been read on this computer.
    pub fn unread(&self, session: &SessionSummary) -> u32 {
        match &self.model.bot_id {
            Some(bot_id) => self.unread_in(bot_id, session),
            None => 0,
        }
    }

    /// The same for any bot's conversation.
    pub fn unread_in(&self, bot_id: &str, session: &SessionSummary) -> u32 {
        match &self.model.origin {
            Some(origin) => self.read_replies.unread(origin.as_str(), bot_id, session),
            None => 0,
        }
    }

    /// A bot's conversations as last heard: the selected bot's from its
    /// live list, another's from the inbox's last round.
    pub fn sessions_of(&self, bot_id: &str) -> Vec<&SessionSummary> {
        if self.model.bot_id.as_deref() == Some(bot_id) {
            self.model.session_list().collect()
        } else {
            self.model
                .inbox
                .sessions
                .get(bot_id)
                .map(|sessions| sessions.iter().collect())
                .unwrap_or_default()
        }
    }

    /// How many of a bot's conversations have something for the owner.
    pub fn attention_in(&self, bot_id: &str) -> usize {
        self.sessions_of(bot_id)
            .into_iter()
            .filter(|session| session.waiting || self.unread_in(bot_id, session) > 0)
            .count()
    }

    /// The notifications across every bot, newest first, and how many the
    /// bell counts.
    pub fn notifications(&self) -> (Vec<Item>, usize) {
        let bots = &self.model.bots;
        let jobs = self.model.inbox.job_entries(bots);
        let (list, _) = inbox::items(
            bots,
            |bot_id| self.sessions_of(bot_id),
            |bot_id, session| self.unread_in(bot_id, session),
            &jobs,
        );
        let count = inbox::count(list.len(), self.model.inbox.job_total(), jobs.len());
        (list, count)
    }

    /// Tells the owner, through the system, about updates that are new
    /// since the last look. Only while this window is not in front: in
    /// front, the bell and its count already show them.
    pub fn announce(&mut self) {
        let (items, _) = self.notifications();
        // Always look, so what was seen in front is not announced later.
        let news = self.announced.news(&items);
        if self.window_focused {
            return;
        }
        for announcement in news {
            match &self.client {
                Some(_) => notify::post(announcement),
                // Tests and headless runs post nothing to the system.
                None => self.posted.push(announcement),
            }
        }
    }

    /// Asks for the other bots' conversations and every bot's job updates
    /// when they are due. Returns true while signed in, so `poll` keeps
    /// looking at the clock.
    pub fn refresh_inbox(&mut self, clock: f64) -> bool {
        if !matches!(self.model.auth, AuthState::SignedIn) || self.model.bots.is_empty() {
            return false;
        }
        if clock - self.inbox_asked_at >= INBOX_REFRESH {
            self.inbox_asked_at = clock;
            self.load_inbox();
        }
        true
    }

    /// Asks now, whatever the clock says.
    pub fn load_inbox(&mut self) {
        let selected = self.model.bot_id.clone();
        let all: Vec<String> = self.model.bots.iter().map(|bot| bot.id.clone()).collect();
        // The selected bot's conversations arrive on its own stream.
        let others = all
            .iter()
            .filter(|id| Some(*id) != selected.as_ref())
            .cloned()
            .collect();
        self.command(Command::LoadInbox {
            session_bots: others,
            job_bots: all,
        });
    }

    /// Opens a notification's conversation. A job update is dismissed on
    /// the way, as on the web.
    pub fn open_notification(&mut self, item: &Item) {
        // A row without a conversation has nothing to open from the inbox.
        if item.session_id().is_some() {
            self.open_target(&item.target());
        }
    }

    /// Opens what a notification leads to, from the inbox or from the
    /// system's banner: its conversation, dismissing a job run on the way
    /// as the inbox does. A job run with no conversation, or a bot that is
    /// gone, opens the inbox instead.
    pub fn open_target(&mut self, target: &Target) {
        if self.model.auth != AuthState::SignedIn {
            return;
        }
        let bot_exists = self.model.bots.iter().any(|bot| bot.id == target.bot_id);
        if let (true, Some(run_id)) = (bot_exists, &target.run_id) {
            self.dismiss_run(&target.bot_id, run_id);
        }
        match (bot_exists, &target.session_id) {
            (true, Some(session_id)) => self.open_conversation(&target.bot_id, session_id),
            _ => {
                self.close_settings();
                self.inbox_open = true;
            }
        }
    }

    /// Dismisses one job update from the inbox.
    pub fn dismiss_run(&mut self, bot_id: &str, run_id: &str) {
        if self.model.inbox.begin_acknowledge() {
            self.command(Command::AcknowledgeRun {
                bot_id: bot_id.to_owned(),
                run_id: run_id.to_owned(),
            });
        }
    }

    /// True for a conversation with something for the owner: a reply not
    /// read yet, or an action waiting for approval.
    pub fn needs_attention(&self, session: &SessionSummary) -> bool {
        session.waiting || self.unread(session) > 0
    }

    /// Records the open conversation's replies as read, when the owner can
    /// be taken to have seen them: it is on screen, scrolled to its end,
    /// in the window in front. The web's rule (`conversation.tsx`).
    pub fn mark_read(&mut self) {
        // The inbox and Settings cover the conversation.
        let on_screen = matches!(self.screen, Screen::Workspace) && !self.inbox_open;
        if !self.at_bottom || !self.window_focused || !on_screen {
            return;
        }
        let (Some(origin), Some(bot_id)) = (&self.model.origin, &self.model.bot_id) else {
            return;
        };
        let Some(open) = &self.model.conversation else {
            return;
        };
        // The stream's own summary is the freshest; the list covers the
        // moment before the stream's first event.
        let observed = open.observation.as_ref().map(|seen| &seen.session);
        let listed = self
            .model
            .session_list()
            .find(|session| session.id == open.session_id);
        let summary = observed.or(listed);
        let Some(count) = summary.and_then(|session| session.reply_count) else {
            return;
        };
        // What the runtime already knows, from this or another client.
        let shared = summary.and_then(|session| session.read_reply_count);
        let changed = self
            .read_replies
            .read(origin.as_str(), bot_id, &open.session_id, count);
        // Share it when the runtime knows less, once per count. A runtime
        // too old to keep read counts (`None`) is not asked.
        if let Some(shared) = shared {
            let key = (bot_id.clone(), open.session_id.clone());
            let sent = self.reported_reads.get(&key).copied().unwrap_or(0);
            if count > shared.max(sent) {
                self.reported_reads.insert(key, count);
                self.command(Command::MarkRead {
                    bot_id: bot_id.clone(),
                    session_id: open.session_id.clone(),
                    reply_count: count,
                });
            }
        }
        // Tests and headless runs have no engine and must not write files.
        if changed
            && self.client.is_some()
            && let Some(path) = ReadReplies::default_path()
        {
            // Forgetting is harmless: the replies show as new once more.
            let _ = self.read_replies.save(&path);
        }
    }

    /// The open conversation's session, if one is open.
    fn open_session(&self) -> Option<String> {
        let open = self.model.conversation.as_ref()?;
        Some(open.session_id.clone())
    }

    /// Asks how the open conversation treats commands, once each time a
    /// conversation is opened.
    fn ensure_command_mode(&mut self) {
        if !matches!(self.model.auth, AuthState::SignedIn)
            || !matches!(self.screen, Screen::Workspace)
        {
            return;
        }
        match self.open_session() {
            Some(session_id) => {
                if self.model.command_mode.session_id.as_deref() != Some(session_id.as_str()) {
                    self.load_command_mode(session_id);
                }
            }
            None => self.model.command_mode.close(),
        }
    }

    fn load_command_mode(&mut self, session_id: String) {
        self.model.command_mode.open(&session_id);
        self.command(Command::LoadApprovalMode { session_id });
    }

    /// Asks again after a failed load.
    pub fn retry_command_mode(&mut self) {
        if let Some(session_id) = self.open_session() {
            self.load_command_mode(session_id);
        }
    }

    /// How commands are treated in the conversation on screen: the
    /// session's mode once known, or the one chosen for a new conversation.
    pub fn shown_command_mode(&self) -> Option<ApprovalMode> {
        match self.model.conversation {
            Some(_) => self.model.command_mode.mode,
            None => Some(self.draft_mode),
        }
    }

    /// The owner chose a command mode. An open conversation is changed on
    /// the host; a new one remembers the choice for its first message.
    pub fn set_command_mode(&mut self, mode: ApprovalMode) {
        match self.open_session() {
            Some(session_id) => {
                if self.model.command_mode.begin_save() {
                    self.command(Command::SetApprovalMode { session_id, mode });
                }
            }
            None => self.draft_mode = mode,
        }
    }

    /// Opens the model picker with an empty search.
    pub fn open_model_picker(&mut self) {
        self.model_picker = ModelPicker {
            open: true,
            ..ModelPicker::default()
        };
        self.model.model_error = None;
    }

    /// The keys of the picker's model rows, top to bottom, as the view
    /// draws them: what Up and Down move between.
    pub fn picker_rows(&self) -> Vec<String> {
        let models = self
            .bot_models()
            .map_or(&[][..], |settings| &settings.models);
        model_library::pick_models(
            models,
            &self.model_picker.search.text,
            &self.model_picker.filter,
            &self.favorites,
        )
        .into_iter()
        .map(|model| format!("rd-model-choice-{}", model_library::favorite_key(model)))
        .collect()
    }

    /// Where Up (`step` -1) or Down (+1) moves from `focused` in the model
    /// list, as on the web: from the search box to the first row (Down) or
    /// the last (Up), and around at the ends. `None` when focus is
    /// elsewhere or there is nothing to move to.
    pub fn picker_step(&self, focused: Option<&str>, step: isize) -> Option<String> {
        let rows = self.picker_rows();
        if rows.is_empty() {
            return None;
        }
        let count = rows.len() as isize;
        let next = match rows.iter().position(|row| Some(row.as_str()) == focused) {
            // `rem_euclid` keeps the result in 0..count, so -1 becomes the last.
            Some(at) => (at as isize + step).rem_euclid(count),
            None if focused == Some("rd-model-search") => {
                if step > 0 {
                    0
                } else {
                    count - 1
                }
            }
            None => return None,
        };
        rows.into_iter().nth(next as usize)
    }

    /// Asks again for the selected bot's models after a failed load.
    pub fn reload_models(&mut self) {
        if let Some(bot_id) = self.model.bot_id.clone() {
            self.model.settings_error = None;
            self.command(Command::LoadSettings { bot_id });
        }
    }

    /// The owner picked a model. An open conversation is changed on the
    /// host and the picker closes when it agrees; a new conversation just
    /// remembers the choice for its first message.
    pub fn choose_model(&mut self, model: ModelSelection) {
        let open = self
            .model
            .conversation
            .as_ref()
            .map(|open| open.session_id.clone());
        match open {
            Some(session_id) => {
                if self.model.begin_choose_model() {
                    self.command(Command::ChooseModel { session_id, model });
                }
            }
            None => {
                self.new_model = Some(model);
                self.model_picker.open = false;
            }
        }
    }

    /// Stars or unstars a model, and remembers it between launches.
    pub fn toggle_favorite(&mut self, key: &str) {
        model_library::toggle_favorite(&mut self.favorites, key);
        // Tests and headless runs have no engine and must not write files.
        if self.client.is_none() {
            return;
        }
        if let Some(path) = Settings::default_path() {
            let mut saved = Settings::load(&path);
            saved.model_favorites.clone_from(&self.favorites);
            // Forgetting a star is harmless; it stays for this launch.
            let _ = saved.save(&path);
        }
    }

    /// Uploads what the owner chose to the selected bot, to go with the
    /// next message.
    pub fn attach(&mut self, uploads: Vec<Upload>) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            self.model.notice = Some("Choose a bot before attaching files.".into());
            return;
        };
        // `begin` refuses a fifth file and says so in the draft's error.
        if !self.model.sending && self.model.attachments.begin(&bot_id, uploads.len()) {
            self.command(Command::Attach { bot_id, uploads });
        }
    }

    /// Opens the system's file picker and attaches the file chosen. The
    /// answer arrives on a later frame, in the closure.
    pub fn choose_attachment(tx: &mut Tx) {
        let options = FileDialogOptions {
            title: "Attach a file".into(),
            ..FileDialogOptions::default()
        };
        tx.open_file(options, |s: &mut Ui, answer, _: &mut Tx| match answer {
            Ok(Some(path)) => s.attach(vec![Upload::File(path)]),
            // The owner closed the picker.
            Ok(None) => {}
            Err(error) => {
                s.model.attachments.error =
                    Some(format!("Could not open the file picker: {error}"));
            }
        });
    }

    /// Something was pasted into the composer. An image (a screenshot) or
    /// copied files are attached; returns false for anything else, so text
    /// is pasted as usual.
    pub fn paste_attachment(&mut self, content: &ClipboardContent) -> bool {
        if let Some(image) = content.image() {
            self.attach(vec![Upload::Bytes {
                name: "Pasted image.png".into(),
                bytes: image.png().to_vec().into(),
            }]);
            true
        } else if !content.files().is_empty() {
            self.attach(content.files().iter().cloned().map(Upload::File).collect());
            true
        } else {
            false
        }
    }

    /// Saves a message's file to this machine's Downloads folder.
    pub fn save_attachment(&mut self, id: &str, name: &str) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            return;
        };
        if self.model.begin_save_attachment(id) {
            self.command(Command::DownloadAttachment {
                bot_id,
                id: id.to_owned(),
                name: name.to_owned(),
            });
        }
    }

    pub fn decide(&mut self, approval_id: &str, decision: Decision, scope: Scope) {
        if self.model.begin_decide(approval_id) {
            self.command(Command::Decide {
                approval_id: approval_id.to_owned(),
                decision,
                scope,
            });
        }
    }

    /// Answers a bot's question: one of its options, or the owner's words.
    pub fn answer(&mut self, ask_id: &str, answer: AskAnswer) {
        if self.model.begin_answer(ask_id, answer.clone()) {
            if self.own_answer.as_ref().is_some_and(|(id, _)| id == ask_id) {
                self.own_answer = None;
            }
            self.command(Command::Answer {
                ask_id: ask_id.to_owned(),
                answer,
            });
        }
    }

    /// Sends the words typed for `ask_id`, if there are any.
    pub fn answer_in_own_words(&mut self, ask_id: &str) {
        let Some((id, edit)) = &self.own_answer else {
            return;
        };
        let text = edit.text.trim().to_owned();
        if id == ask_id && !text.is_empty() {
            self.answer(ask_id, AskAnswer::Text { text });
        }
    }

    /// Stops the open conversation's run.
    pub fn stop(&mut self) {
        self.control(ControlAction::Stop, None);
    }

    /// Stops the run, or steers or re-queues the queued message `turn_id`.
    pub fn control(&mut self, action: ControlAction, turn_id: Option<&str>) {
        // `let ... else` returns early when there is no open conversation.
        let Some(conversation) = &self.model.conversation else {
            return;
        };
        self.command(Command::Control {
            session_id: conversation.session_id.clone(),
            action,
            turn_id: turn_id.map(str::to_owned),
        });
    }

    /// Whether Raphie is working in the open conversation: its newest turn
    /// has no finished reply yet.
    pub fn busy(&self) -> bool {
        self.model.conversation.as_ref().is_some_and(|c| {
            c.turns()
                .last()
                .is_some_and(|turn| turn.status == TurnStatus::Pending)
        })
    }

    /// The selected bot's handoffs, newest first, once loaded.
    pub fn handoffs(&self) -> &[Handoff] {
        self.model
            .bot_id
            .as_ref()
            .and_then(|id| self.model.handoffs.get(id))
            .map_or(&[], |list| &list.items[..])
    }

    /// The bots the selected bot can hand tasks to: every other bot.
    pub fn handoff_targets(&self) -> &[BotRef] {
        self.model
            .bot_id
            .as_ref()
            .and_then(|id| self.model.handoffs.get(id))
            .map_or(&[], |list| &list.targets[..])
    }

    /// Every bot by id and name, so "@Name" in a message shows as the bot.
    pub fn bot_refs(&self) -> Vec<BotRef> {
        self.model
            .bots
            .iter()
            .map(|bot| BotRef {
                id: bot.id.clone(),
                name: bot.name.clone(),
            })
            .collect()
    }

    /// The bot that handed the open conversation's task off, if one did:
    /// only it sends messages there.
    pub fn handed_off_by(&self) -> Option<&HandedOffBy> {
        let conversation = self.model.conversation.as_ref()?;
        conversation
            .observation
            .as_ref()
            .and_then(|o| o.session.handed_off_by.as_ref())
            .or_else(|| {
                self.model
                    .sessions
                    .iter()
                    .find(|s| s.id == conversation.session_id)
                    .and_then(|s| s.handed_off_by.as_ref())
            })
    }

    /// Asks for the selected bot's handoffs when they are due: on a new
    /// bot, when its conversation settles a turn or finishes a tool step,
    /// and on a timer, faster while one is open. Returns whether one is
    /// open, so the clock keeps waking.
    pub fn refresh_handoffs(&mut self, clock: f64) -> bool {
        if self.model.auth != AuthState::SignedIn {
            return false;
        }
        let Some(bot_id) = self.model.bot_id.clone() else {
            return false;
        };
        let open = self
            .handoffs()
            .iter()
            .any(|handoff| handoff.status == HandoffStatus::Working);
        let signal = self
            .model
            .conversation
            .as_ref()
            .map_or_else(String::new, |c| {
                let mut signal: String = c
                    .turns()
                    .iter()
                    .map(|turn| format!("{}:{:?}|", turn.id, turn.status))
                    .collect();
                let done = c.observation.as_ref().map_or(0, |o| {
                    o.activity
                        .iter()
                        .filter(|event| event.kind == "tool.completed")
                        .count()
                });
                signal.push_str(&done.to_string());
                signal
            });
        let every = if open {
            HANDOFFS_OPEN_REFRESH
        } else {
            HANDOFFS_IDLE_REFRESH
        };
        let new_bot = self.handoffs_bot.as_deref() != Some(bot_id.as_str());
        if new_bot || signal != self.handoff_signal || clock - self.handoffs_asked_at >= every {
            self.handoffs_asked_at = clock;
            self.handoffs_bot = Some(bot_id.clone());
            self.handoff_signal = signal;
            self.command(Command::LoadHandoffs { bot_id });
        }
        open
    }

    /// Stops the other bot's work on one of the selected bot's handoffs.
    pub fn cancel_handoff(&mut self, id: &str) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            return;
        };
        if self.model.cancelling_handoff.is_some() {
            return;
        }
        self.model.cancelling_handoff = Some(id.to_owned());
        self.model.handoff_error = None;
        self.command(Command::CancelHandoff {
            bot_id,
            id: id.to_owned(),
        });
    }

    /// Opens another bot: one of its conversations, or the bot itself.
    pub fn open_bot(&mut self, bot_id: &str, session_id: Option<&str>) {
        self.delegates_open = false;
        match session_id {
            Some(session_id) => self.open_conversation(bot_id, session_id),
            None => self.choose_bot(bot_id),
        }
    }

    /// A bot chosen from the roster or a link: back to the conversation
    /// last open with it, or a new one if there was none, as on the web.
    pub fn choose_bot(&mut self, bot_id: &str) {
        self.remember_session();
        let last = self
            .model
            .origin
            .as_ref()
            .and_then(|origin| self.last_sessions.get(origin.as_str(), bot_id))
            .map(str::to_owned);
        match last {
            Some(session_id) => self.open_conversation(bot_id, &session_id),
            None => self.select_bot(bot_id),
        }
    }

    /// Notes the open conversation as the last one with its bot. A new
    /// conversation with no session yet leaves the last one as it was.
    fn remember_session(&mut self) {
        let (Some(origin), Some(bot_id), Some(open)) = (
            &self.model.origin,
            &self.model.bot_id,
            &self.model.conversation,
        ) else {
            return;
        };
        let changed = self
            .last_sessions
            .set(origin.as_str(), bot_id, &open.session_id);
        // Tests and headless runs have no engine and must not write files.
        if changed
            && self.client.is_some()
            && let Some(path) = LastSessions::default_path()
        {
            // Forgetting is harmless: the bot opens on a new conversation.
            let _ = self.last_sessions.save(&path);
        }
    }

    /// A link pressed in a message: a bot it names opens that bot, and a
    /// web address opens in the browser.
    pub fn press_link(&mut self, url: &str, tx: &mut Tx) {
        if let Some(bot_id) = url.strip_prefix(MENTION_SCHEME) {
            self.open_bot(bot_id, None);
        } else if url.starts_with("https://") || url.starts_with("http://") {
            self.open_url(url.to_owned(), tx);
        }
    }

    /// The "@name" typed before the composer's caret, unless Escape closed
    /// the menu for it.
    fn typed_mention(&self) -> Option<MentionQuery> {
        let query = mention_query(&self.composer.text, self.composer.focus)?;
        (self.mention_dismissed != Some(query.start)).then_some(query)
    }

    /// The bots the composer's "@" menu offers now; empty when it is shut.
    pub fn mention_options(&self) -> Vec<BotRef> {
        // A handed-off task is done here, never handed on.
        if self.handed_off_by().is_some() {
            return Vec::new();
        }
        let Some(query) = self.typed_mention() else {
            return Vec::new();
        };
        mention_matches(self.handoff_targets(), &query.query)
            .into_iter()
            .cloned()
            .collect()
    }

    /// The highlighted option, kept within the list as it narrows.
    pub fn mention_highlight(&self, count: usize) -> usize {
        self.mention_active.min(count.saturating_sub(1))
    }

    /// Writes "@Name" for the chosen bot in place of what was typed.
    pub fn choose_mention(&mut self, bot: &BotRef) {
        let Some(query) = self.typed_mention() else {
            return;
        };
        let (text, caret) =
            insert_mention(&self.composer.text, &query, self.composer.focus, &bot.name);
        self.composer.replace_text(text);
        self.composer.set_caret(caret);
        self.mention_active = 0;
    }

    /// The commands and skills the composer's "/" menu offers now; empty
    /// when it is shut.
    pub fn slash_options(&self) -> Vec<SlashItem> {
        let Some(query) = slash_query(&self.composer.text, self.composer.focus) else {
            return Vec::new();
        };
        if self.slash_dismissed.as_deref() == Some(query.as_str()) {
            return Vec::new();
        }
        let command = |kind, name: &str, description: &str| SlashItem {
            kind,
            name: name.to_owned(),
            description: description.to_owned(),
        };
        let mut items = vec![
            command(SlashKind::New, "new", "Start a new conversation"),
            command(
                SlashKind::Model,
                "model",
                "Choose the model for this conversation",
            ),
        ];
        if self.busy() {
            items.push(command(
                SlashKind::Stop,
                "stop",
                "Stop the reply in progress",
            ));
        }
        if self.handed_off_by().is_none() && !self.handoff_targets().is_empty() {
            items.push(command(
                SlashKind::Handoff,
                "handoff",
                "Give this task to another bot",
            ));
        }
        let skills = self
            .model
            .bot_id
            .as_ref()
            .and_then(|bot_id| self.model.skills.get(bot_id));
        // Only skills that are on: off means the bot never uses it.
        for skill in skills.into_iter().flatten() {
            if skill.enabled && skill.problem.is_none() {
                items.push(command(SlashKind::Skill, &skill.name, &skill.description));
            }
        }
        slash_matches(&items, &query)
    }

    /// The highlighted "/" entry, kept within the list as it narrows.
    pub fn slash_highlight(&self, count: usize) -> usize {
        self.slash_active.min(count.saturating_sub(1))
    }

    /// Runs a command, or writes "/name " for a skill.
    pub fn choose_slash(&mut self, item: &SlashItem) {
        self.slash_active = 0;
        if item.kind == SlashKind::Skill {
            let (text, caret) = insert_skill(&self.composer.text, &item.name);
            self.composer.replace_text(text);
            self.composer.set_caret(caret);
            return;
        }
        self.composer.replace_text("");
        self.composer.set_caret(0);
        match item.kind {
            // The same as the New conversation buttons.
            SlashKind::New => self.select_session(None),
            SlashKind::Model => self.model_picker.open = true,
            SlashKind::Stop => self.stop(),
            SlashKind::Handoff => {
                self.composer.replace_text("@");
                self.composer.set_caret(1);
                self.mention_dismissed = None;
            }
            SlashKind::Skill => {}
        }
    }

    /// The keys the open "/" menu takes before the composer, as the "@"
    /// menu does. Returns whether it took the key.
    pub fn slash_key(&mut self, key: &KeyEvent) -> bool {
        let options = self.slash_options();
        if options.is_empty() {
            return false;
        }
        let active = self.slash_highlight(options.len());
        match key.key {
            Key::Down => self.slash_active = (active + 1) % options.len(),
            Key::Up => self.slash_active = (active + options.len() - 1) % options.len(),
            Key::Enter | Key::Tab => self.choose_slash(&options[active]),
            Key::Escape => {
                self.slash_dismissed = slash_query(&self.composer.text, self.composer.focus);
            }
            _ => return false,
        }
        true
    }

    /// Opens the selected bot's Skills settings, from the "/" menu.
    pub fn manage_skills(&mut self) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            return;
        };
        self.composer.replace_text("");
        self.composer.set_caret(0);
        self.open_settings(Some(Page::Bot {
            bot_id,
            section: BotSection::Skills,
        }));
    }

    /// The selected bot's skills a message can invoke: on, and usable.
    pub fn invocable_skills(&self) -> Vec<&str> {
        self.model
            .bot_id
            .as_ref()
            .and_then(|bot_id| self.model.skills.get(bot_id))
            .into_iter()
            .flatten()
            .filter(|skill| skill.enabled && skill.problem.is_none())
            .map(|skill| skill.name.as_str())
            .collect()
    }

    /// Asks for the built-in personalities until they have arrived; they
    /// are the same for every bot.
    fn ensure_presets(&mut self) {
        if self.model.personality_presets.is_none() {
            self.command(Command::LoadPersonalityPresets);
        }
    }

    /// The conversation's finished self-updates: what its bot changed
    /// about itself or the owner, one per tool step.
    pub fn self_update_notes(&self) -> Vec<SelfUpdateNote> {
        let Some(conversation) = &self.model.conversation else {
            return Vec::new();
        };
        let Some(observation) = &conversation.observation else {
            return Vec::new();
        };
        conversation
            .turns()
            .into_iter()
            .flat_map(|turn| {
                self_update_notes(&tool_steps(
                    &turn.id,
                    &observation.activity,
                    &observation.tool_approvals,
                ))
            })
            .collect()
    }

    /// A self-update not seen before asks for what it saved: the bot's
    /// revisions and the owner's profile, which its note under the reply
    /// reads.
    fn ensure_self_update_sources(&mut self) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            return;
        };
        let wanted = matches!(self.model.auth, AuthState::SignedIn)
            && matches!(self.screen, Screen::Workspace);
        if !wanted {
            return;
        }
        let notes = self.self_update_notes();
        let mut new = false;
        for note in notes
            .iter()
            .filter(|note| note.kind != SelfUpdateKind::Skill)
        {
            new |= self.self_updates_asked.insert(note.id.clone());
        }
        if new {
            self.command(Command::LoadBotHistory {
                bot_id: bot_id.clone(),
            });
            self.command(Command::LoadOwner);
        }
        self.ensure_skill_changes(&bot_id, &notes);
    }

    /// Each `save_skill` note asks the runtime what its call changed, and
    /// asks again once the bot's skills change. A change the skills list
    /// has not caught up with reloads the list, so the skill's earlier
    /// notes stop offering an undo.
    fn ensure_skill_changes(&mut self, bot_id: &str, notes: &[SelfUpdateNote]) {
        let skills = self.model.skills.get(bot_id);
        let version = format!(
            "{:?}",
            skills.map(|items| {
                items
                    .iter()
                    .map(|item| (&item.name, item.bot_change))
                    .collect::<Vec<_>>()
            })
        );
        let mut reload = false;
        for note in notes
            .iter()
            .filter(|note| note.kind == SelfUpdateKind::Skill)
        {
            let key = note.key();
            if self.skill_changes_asked.get(&key) != Some(&version) {
                self.skill_changes_asked
                    .insert(key.clone(), version.clone());
                self.command(Command::LoadSkillChange {
                    bot_id: bot_id.to_owned(),
                    note: key.clone(),
                    call: note.id.clone(),
                    from: note.started_at,
                    to: note.done_at,
                });
            }
            let Some(Some(found)) = self.model.skill_changes.get(&key) else {
                continue;
            };
            let listed = self
                .model
                .skills
                .get(bot_id)
                .and_then(|items| items.iter().find(|item| item.name == found.name))
                .and_then(|item| item.bot_change);
            let unseen = found.undoable
                && listed.is_none_or(|change| change.at != found.at || change.kind != found.kind);
            if unseen && self.skill_changes_seen.insert(found.id.clone()) {
                reload = true;
            }
        }
        if reload {
            self.command(Command::LoadSkills {
                bot_id: bot_id.to_owned(),
            });
        }
    }

    /// "Open" under a reply: the skill in Settings → Skills.
    pub fn open_bot_skill(&mut self, bot_id: &str, name: &str) {
        self.open_settings(Some(Page::Bot {
            bot_id: bot_id.to_owned(),
            section: BotSection::Skills,
        }));
        self.open_skill(name);
    }

    /// "Undo" under a reply: puts the skill back as it was before the
    /// bot's change `id`.
    pub fn undo_skill_change(&mut self, bot_id: &str, id: &str) {
        if self.model.undoing_skill_change {
            return;
        }
        self.model.undoing_skill_change = true;
        self.model.skill_undo_error = None;
        self.command(Command::UndoSkillChange {
            bot_id: bot_id.to_owned(),
            id: id.to_owned(),
        });
    }

    /// Saves `bot_id`'s profile as the host has it, with `personality` in
    /// place of its own: "Restore this personality" in revision history,
    /// and Undo under a reply. The bot's other settings are kept.
    pub fn restore_personality(&mut self, bot_id: &str, personality: String) {
        let Some(bot) = self.model.bots.iter().find(|bot| bot.id == bot_id) else {
            return;
        };
        let update = UpdateBotProfile {
            name: bot.name.clone(),
            description: bot.description.clone(),
            personality,
            reply_style: bot.reply_style,
            color: bot.color.clone(),
            self_updates: None,
            revision: bot.revision,
        };
        if self.model.begin_save_profile() {
            self.restoring_profile = true;
            self.command(Command::SaveProfile {
                bot_id: bot_id.to_owned(),
                update,
            });
        }
    }

    /// Puts a built-in personality in the Profile form's editor, to save as
    /// it is or edit first.
    pub fn pick_preset(&mut self, personality: &str) {
        if self.profile.personality.text != personality {
            self.profile.personality = TextEdit::new(personality);
            self.profile.message = None;
        }
    }

    /// Asks once per bot for its skills, which the "/" menu offers.
    fn ensure_skills(&mut self) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            return;
        };
        let wanted = matches!(self.model.auth, AuthState::SignedIn)
            && matches!(self.screen, Screen::Workspace);
        if wanted && self.skills_asked.as_deref() != Some(bot_id.as_str()) {
            self.skills_asked = Some(bot_id.clone());
            self.command(Command::LoadSkills { bot_id });
        }
    }

    /// The keys the open "@" menu takes before the composer: arrows move,
    /// Return or Tab choose, Escape closes. Returns whether it took the key.
    pub fn mention_key(&mut self, key: &KeyEvent) -> bool {
        let options = self.mention_options();
        if options.is_empty() {
            return false;
        }
        let active = self.mention_highlight(options.len());
        match key.key {
            Key::Down => self.mention_active = (active + 1) % options.len(),
            Key::Up => self.mention_active = (active + options.len() - 1) % options.len(),
            Key::Enter | Key::Tab => self.choose_mention(&options[active]),
            Key::Escape => self.mention_dismissed = self.typed_mention().map(|q| q.start),
            _ => return false,
        }
        true
    }

    /// Unfolds or folds something by id: a run's steps, or one step's details.
    pub fn toggle(set: &mut HashSet<String>, id: &str) {
        // `remove` says whether the id was there; if not, add it.
        if !set.remove(id) {
            set.insert(id.to_owned());
        }
    }

    /// Opens Settings on `page`, or on the selected bot's Profile.
    pub fn open_settings(&mut self, page: Option<Page>) {
        // In a narrow window, the gear opens on the navigation; a link to
        // one page opens that page.
        self.settings_nav_home = page.is_none();
        let page = page.unwrap_or_else(|| Page::Bot {
            bot_id: self
                .model
                .bot_id
                .clone()
                .unwrap_or_else(|| "default".into()),
            section: BotSection::Profile,
        });
        // The bot whose page this is starts unfolded in the navigation.
        if let Page::Bot { bot_id, section } = &page {
            self.expanded_bots.insert(bot_id.clone());
            if matches!(section, BotSection::Profile | BotSection::History) {
                self.ensure_presets();
            }
            if *section == BotSection::Profile {
                self.show_profile(bot_id);
                self.deleting_bot = false;
                self.model.delete_bot_error = None;
                // Notice a save made in another client before editing.
                self.command(Command::RefreshBots);
            }
            if *section == BotSection::History {
                // A failed restore is told here; an old error is not.
                self.model.profile_error = None;
                // The current revision starts unfolded, as on the web.
                let current = self.model.bots.iter().find(|bot| &bot.id == bot_id);
                self.open_revisions = current.map(|bot| bot.revision).into_iter().collect();
                self.command(Command::LoadBotHistory {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Providers {
                // Any half-typed key is dropped when the page is reopened.
                self.providers = ProvidersView::new();
                self.model.connection_message = None;
                self.command(Command::LoadSettings {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Memory {
                self.show_memory(bot_id);
                self.model.memory_message = None;
                // Notice settings saved in another client.
                self.command(Command::LoadMemory {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Activity {
                self.events = InspectView::new();
                self.model.export_saved = None;
                self.model.export_error = None;
                self.command(Command::LoadBotActivity {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Jobs {
                self.job = JobForm::new_at(now_ms());
                self.model.job_message = None;
                self.model.job_error = None;
                self.command(Command::LoadJobs {
                    bot_id: bot_id.clone(),
                });
                // Every job's runs, from the newest.
                self.model.runs.show(None);
                let ticket = self.model.runs.begin_load(false);
                self.command(Command::LoadJobRuns {
                    bot_id: bot_id.clone(),
                    job_id: None,
                    before: None,
                    ticket,
                });
            }
            if *section == BotSection::Workspace {
                // Start at the top each time; the sandbox details say which
                // provider keeps the files and how full the workspace is.
                self.model.files = workspace::WorkspaceBrowser::default();
                self.model.files.open(bot_id, ROOT);
                self.command(Command::LoadWorkspaceFiles {
                    bot_id: bot_id.clone(),
                    path: ROOT.to_owned(),
                });
                self.command(Command::LoadSandbox {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Sandbox {
                self.show_sandbox(bot_id);
                self.model.sandbox_message = None;
                self.command(Command::LoadSandbox {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Channels {
                // Folded forms each time: a typed token is never kept for
                // a page that is not on screen.
                self.discord = DiscordForm::new();
                self.telegram = TelegramForm::new();
                self.model.channel_messages.clear();
                self.model.channel_errors.clear();
                self.command(Command::LoadChannels {
                    bot_id: bot_id.clone(),
                });
                self.command(Command::LoadChannelHome {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Skills {
                self.skills = SkillsView::new();
                self.model.skill = None;
                self.model.skill_message = None;
                self.model.skill_change_error = None;
                self.command(Command::LoadSkills {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Mcp {
                // A fresh form each time: a typed token is never kept for
                // a page that is not on screen.
                self.mcp = McpForm::new();
                self.model.mcp_message = None;
                self.model.mcp_change_error = None;
                self.command(Command::LoadMcp {
                    bot_id: bot_id.clone(),
                });
            }
            if *section == BotSection::Models {
                // A fresh look at the catalogue each time the page opens.
                self.models = ModelsView::new();
                self.model.model_message = None;
                self.command(Command::LoadSettings {
                    bot_id: bot_id.clone(),
                });
            }
        }
        if page == Page::NewBot {
            self.ensure_presets();
            self.show_new_bot();
        }
        if page == Page::Owner {
            // Unsaved edits stay; otherwise show what was last loaded
            // while asking for what the host has now.
            if !self.owner.is_dirty() {
                self.owner = match &self.model.owner {
                    Some(saved) => OwnerDraft::of(saved),
                    None => OwnerDraft::empty(),
                };
            }
            self.model.owner_message = None;
            self.model.owner_save_error = None;
            self.model.owner_error = None;
            self.command(Command::LoadOwner);
        }
        if page == Page::Diagnostics {
            self.spans = InspectView::new();
            self.model.export_saved = None;
            self.model.export_error = None;
            self.model.telemetry_error = None;
            // The runtime's settings hold the telemetry switch.
            self.command(Command::LoadSettings {
                bot_id: BACKEND.to_owned(),
            });
            self.model.traces.open(BACKEND, self.trace_hours);
            self.command(Command::LoadTraces {
                bot_id: BACKEND.to_owned(),
                hours: self.trace_hours,
            });
        }
        let browsing = matches!(
            &page,
            Page::Bot {
                section: BotSection::MemoryBrowse,
                ..
            }
        );
        if let (true, Page::Bot { bot_id, .. }) = (browsing, &page) {
            // A fresh list each time, and the settings that say what this
            // back end allows.
            self.memories = MemoriesView::new();
            self.model.memories.clear();
            self.command(Command::LoadMemory {
                bot_id: bot_id.clone(),
            });
        }
        self.screen = Screen::Settings(page);
        if browsing {
            self.follow_memories();
        }
    }

    /// Puts `bot_id`'s profile in the form: its unsaved edits if there are
    /// any, else the profile as the host has it.
    fn show_profile(&mut self, bot_id: &str) {
        if !self.profile.creating && self.profile.bot_id() == Some(bot_id) {
            return;
        }
        let next = match self.parked_profiles.remove(bot_id) {
            Some(parked) => parked,
            None => match self.model.bots.iter().find(|bot| bot.id == bot_id) {
                Some(bot) => ProfileDraft::of(bot),
                None => ProfileDraft::empty(),
            },
        };
        self.swap_profile(next);
    }

    /// Puts the "Create a bot" form on screen: the one left unfinished, if
    /// there is one, else a fresh one.
    fn show_new_bot(&mut self) {
        if self.profile.creating {
            return;
        }
        let next = self
            .parked_profiles
            .remove(NEW_BOT)
            .unwrap_or_else(ProfileDraft::new_bot);
        self.swap_profile(next);
        self.model.profile_error = None;
    }

    /// Shows `next` in the form, keeping the form it replaces if it has
    /// unsaved edits.
    fn swap_profile(&mut self, next: ProfileDraft) {
        // `mem::replace` swaps the new form in and hands back the old one.
        let previous = std::mem::replace(&mut self.profile, next);
        if previous.is_dirty()
            && let Some(key) = previous.park_key()
        {
            self.parked_profiles.insert(key.to_owned(), previous);
        }
    }

    /// The bot the Profile form edits, as the host has it now.
    pub fn profile_bot(&self) -> Option<&raphie_core::contracts::BotProfile> {
        let id = self.profile.bot_id()?;
        self.model.bots.iter().find(|bot| bot.id == id)
    }

    /// Whether the Profile form may be saved now.
    pub fn can_save_profile(&self) -> bool {
        if self.profile.creating {
            // A new bot needs only a valid form.
            return self.profile.problem().is_none() && !self.model.creating_bot;
        }
        let unchanged_elsewhere = self
            .profile_bot()
            .is_some_and(|latest| !self.profile.changed_elsewhere(latest));
        unchanged_elsewhere
            && self.profile.is_dirty()
            && self.profile.problem().is_none()
            && !self.model.saving_profile
    }

    pub fn save_profile(&mut self) {
        if !self.can_save_profile() {
            return;
        }
        if let Some(bot) = self.profile.new_bot_request() {
            if self.model.begin_create_bot() {
                self.command(Command::CreateBot { bot });
            }
            return;
        }
        let (Some(bot_id), Some(update)) = (
            self.profile.bot_id().map(str::to_owned),
            self.profile.update(),
        ) else {
            return;
        };
        if self.model.begin_save_profile() {
            self.profile.message = None;
            self.restoring_profile = false;
            self.command(Command::SaveProfile { bot_id, update });
        }
    }

    /// True once the selected bot's settings say it has no model it can
    /// reply with.
    pub fn needs_setup(&self) -> bool {
        self.model
            .bot_id
            .as_ref()
            .and_then(|bot_id| self.model.settings.get(bot_id))
            .is_some_and(|settings| settings.models.is_empty())
    }

    /// From a bot's setup: its Providers page, with the form for a new
    /// connection to `provider_id` open.
    pub fn set_up_provider(&mut self, bot_id: &str, provider_id: &str) {
        self.open_settings(Some(Page::Bot {
            bot_id: bot_id.to_owned(),
            section: BotSection::Providers,
        }));
        let Some(settings) = self.model.settings.get(bot_id) else {
            return;
        };
        let Some(provider) = settings.providers.iter().find(|p| p.id == provider_id) else {
            return;
        };
        let count = settings
            .connections
            .iter()
            .filter(|connection| connection.provider == provider.id)
            .count();
        self.providers = ProvidersView {
            open: Some(ConnectionTarget::New),
            provider: provider.id.clone(),
            name: TextEdit::new(format!("{} {}", provider.name, count + 1)),
            ..ProvidersView::new()
        };
    }

    /// Opens the form for a new connection to `bot_id`'s first provider,
    /// with a name suggested as the web suggests it ("OpenRouter 2").
    pub fn add_connection(&mut self, bot_id: &str) {
        let Some(settings) = self.model.settings.get(bot_id) else {
            return;
        };
        let Some(provider) = settings.providers.first() else {
            return;
        };
        let count = settings
            .connections
            .iter()
            .filter(|connection| connection.provider == provider.id)
            .count();
        self.providers = ProvidersView {
            open: Some(ConnectionTarget::New),
            provider: provider.id.clone(),
            name: TextEdit::new(format!("{} {}", provider.name, count + 1)),
            ..ProvidersView::new()
        };
        self.model.connection_message = None;
    }

    /// "OpenRouter 2", "OpenAI 1": a provider's name and the next number.
    fn suggested_connection_name(&self, provider_id: &str) -> Option<String> {
        let settings = self.settings_for_open_page()?;
        let provider = settings.providers.iter().find(|p| p.id == provider_id)?;
        let count = settings
            .connections
            .iter()
            .filter(|c| c.provider == provider_id)
            .count();
        Some(format!("{} {}", provider.name, count + 1))
    }

    /// The settings of the bot whose page is open, if one is.
    fn settings_for_open_page(&self) -> Option<&RuntimeSettings> {
        let Screen::Settings(Page::Bot { bot_id, .. }) = &self.screen else {
            return None;
        };
        self.model.settings.get(bot_id)
    }

    /// Chooses the provider of a new connection. A name still at its
    /// suggestion follows the provider, as on the web.
    pub fn choose_connection_provider(&mut self, provider_id: &str) {
        let suggested = self.suggested_connection_name(&self.providers.provider);
        if suggested.as_deref() == Some(self.providers.name.text.as_str())
            && let Some(next) = self.suggested_connection_name(provider_id)
        {
            self.providers.name = TextEdit::new(next);
        }
        self.providers.provider = provider_id.to_owned();
    }

    /// Opens the form for a saved connection, with no key typed.
    pub fn edit_connection(&mut self, connection_id: &str, name: &str) {
        self.providers = ProvidersView {
            open: Some(ConnectionTarget::Edit(connection_id.to_owned())),
            name: TextEdit::new(name),
            ..ProvidersView::new()
        };
        self.model.connection_message = None;
    }

    /// Whether the open connection form signs in to a subscription rather
    /// than taking a key: a new one to such a provider, or a saved one.
    pub fn form_signs_in(&self, bot_id: &str) -> bool {
        let Some(settings) = self.model.settings.get(bot_id) else {
            return false;
        };
        match &self.providers.open {
            Some(ConnectionTarget::New) => settings
                .providers
                .iter()
                .any(|p| p.id == self.providers.provider && p.signs_in()),
            Some(ConnectionTarget::Edit(id)) => settings
                .connections
                .iter()
                .any(|c| &c.id == id && c.is_subscription()),
            None => false,
        }
    }

    /// The sign-in on screen for `bot_id`, if any.
    pub fn sign_in_for(&self, bot_id: &str) -> Option<&ProviderSignIn> {
        match &self.model.sign_in {
            Some((owner, sign_in)) if owner == bot_id => Some(sign_in),
            _ => None,
        }
    }

    /// True while a sign-in for `bot_id` waits on the owner or the provider.
    pub fn signing_in(&self, bot_id: &str) -> bool {
        self.sign_in_for(bot_id)
            .is_some_and(|s| s.status == SignInStatus::Waiting)
    }

    /// Starts the form's sign-in: a new subscription connection, or the
    /// saved one renewed.
    pub fn start_sign_in(&mut self, bot_id: &str) {
        let name = self.providers.name.text.trim().to_owned();
        if name.is_empty() || self.model.sign_in_busy {
            return;
        }
        let (provider, connection_id) = match &self.providers.open {
            Some(ConnectionTarget::New) => (self.providers.provider.clone(), None),
            Some(ConnectionTarget::Edit(id)) => {
                let Some(saved) = self
                    .model
                    .settings
                    .get(bot_id)
                    .and_then(|s| s.connections.iter().find(|c| &c.id == id))
                else {
                    return;
                };
                (saved.provider.clone(), Some(id.clone()))
            }
            None => return,
        };
        self.model.sign_in = None;
        self.model.sign_in_error = None;
        self.model.sign_in_busy = true;
        self.command(Command::StartProviderSignIn {
            bot_id: bot_id.to_owned(),
            provider,
            name,
            connection_id,
        });
    }

    /// Answers the sign-in's question with `value`, or with what is typed
    /// in the answer field when `value` is `None`.
    pub fn answer_sign_in(&mut self, bot_id: &str, value: Option<String>) {
        let Some(sign_in) = self.sign_in_for(bot_id) else {
            return;
        };
        let Some(prompt) = &sign_in.prompt else {
            return;
        };
        let value = value.unwrap_or_else(|| self.providers.answer.text.trim().to_owned());
        if value.is_empty() || self.model.sign_in_busy {
            return;
        }
        let (id, prompt_id) = (sign_in.id.clone(), prompt.id.clone());
        // Replacing the field drops the pasted text from memory.
        self.providers.answer = TextEdit::new("").secure();
        self.model.sign_in_busy = true;
        self.command(Command::AnswerProviderSignIn {
            bot_id: bot_id.to_owned(),
            id,
            prompt_id,
            value: Secret::new(value),
        });
    }

    /// Stops a waiting sign-in, as closing its form does.
    pub fn cancel_sign_in(&mut self, bot_id: &str) {
        if let Some(sign_in) = self.sign_in_for(bot_id)
            && sign_in.status == SignInStatus::Waiting
        {
            let id = sign_in.id.clone();
            self.command(Command::CancelProviderSignIn {
                bot_id: bot_id.to_owned(),
                id,
            });
        }
        self.model.sign_in = None;
        self.model.sign_in_error = None;
    }

    /// Asks every second where a waiting sign-in has got to: the owner
    /// may be finishing it in a browser. True while one waits.
    pub fn follow_sign_in(&mut self, clock: f64) -> bool {
        let Some((bot_id, sign_in)) = &self.model.sign_in else {
            return false;
        };
        if sign_in.status != SignInStatus::Waiting {
            return false;
        }
        if clock - self.sign_in_asked_at >= 1.0 && !self.model.sign_in_busy {
            let (bot_id, id) = (bot_id.clone(), sign_in.id.clone());
            self.sign_in_asked_at = clock;
            self.command(Command::PollProviderSignIn { bot_id, id });
        }
        true
    }

    /// Opens a waiting sign-in's page as soon as the runtime reports it, so
    /// one press of "Sign in" is enough. Once per sign-in: the card keeps a
    /// button to open it again.
    fn open_announced_sign_in_page(&mut self, tx: &mut Tx) {
        let Some((_, sign_in)) = &self.model.sign_in else {
            return;
        };
        if sign_in.status != SignInStatus::Waiting
            || self.sign_in_opened.as_deref() == Some(sign_in.id.as_str())
        {
            return;
        }
        let Some(url) = sign_in.events.iter().find_map(|e| match e {
            SignInEvent::AuthUrl { url, .. } => Some(url.clone()),
            _ => None,
        }) else {
            return;
        };
        self.sign_in_opened = Some(sign_in.id.clone());
        self.open_sign_in_page(&url, tx);
    }

    /// Opens a sign-in page the runtime reported, when it is a web address.
    pub fn open_sign_in_page(&mut self, url: &str, tx: &mut Tx) {
        if url.starts_with("https://") {
            self.open_url(url.to_owned(), tx);
        }
    }

    /// Whether the open connection form can be submitted: a name, and for a
    /// new connection a key.
    pub fn can_save_connection(&self) -> bool {
        let named = !self.providers.name.text.trim().is_empty();
        let keyed = !self.providers.key.text.is_empty();
        match &self.providers.open {
            Some(ConnectionTarget::New) => named && keyed,
            Some(ConnectionTarget::Edit(_)) => named,
            None => false,
        }
    }

    /// The typed key as a secret, or `None` when the field is empty.
    fn typed_key(&self) -> Option<Secret> {
        let key = &self.providers.key.text;
        (!key.is_empty()).then(|| Secret::new(key.as_str()))
    }

    /// Adds the new connection, or saves the edited one.
    pub fn save_connection(&mut self, bot_id: &str) {
        if !self.can_save_connection() {
            return;
        }
        let name = self.providers.name.text.trim().to_owned();
        let change = match (&self.providers.open, self.typed_key()) {
            (Some(ConnectionTarget::New), Some(key)) => ConnectionChange::Add {
                provider: self.providers.provider.clone(),
                name,
                key,
            },
            (Some(ConnectionTarget::Edit(id)), key) => ConnectionChange::Edit {
                id: id.clone(),
                name,
                key,
            },
            _ => return,
        };
        self.change_connection(bot_id, change);
    }

    /// Asks the host to try the connection in the form.
    pub fn test_connection(&mut self, bot_id: &str) {
        let id = match &self.providers.open {
            Some(ConnectionTarget::Edit(id)) => Some(id.clone()),
            Some(ConnectionTarget::New) => None,
            None => return,
        };
        let key = self.typed_key();
        self.change_connection(bot_id, ConnectionChange::Test { id, key });
    }

    pub fn remove_connection(&mut self, bot_id: &str, connection_id: &str, name: &str) {
        self.change_connection(
            bot_id,
            ConnectionChange::Remove {
                id: connection_id.to_owned(),
                name: name.to_owned(),
            },
        );
    }

    fn change_connection(&mut self, bot_id: &str, change: ConnectionChange) {
        if self.model.begin_change_connection() {
            self.command(Command::ChangeConnection {
                bot_id: bot_id.to_owned(),
                change,
            });
        }
    }

    /// Puts `bot_id`'s memory settings in the form. Unsaved edits for the
    /// same bot stay; edits for another bot are dropped, typed key included,
    /// so a key is never held for a page that is not on screen.
    fn show_memory(&mut self, bot_id: &str) {
        if self.memory.bot_id() == Some(bot_id) && self.memory.is_dirty() {
            return;
        }
        self.model.memory_save_error = None;
        self.memory = match self.model.memory.get(bot_id) {
            Some(status) => MemoryDraft::of(bot_id, &status.configuration),
            None => MemoryDraft::empty(),
        };
    }

    /// After news from the host: a Memory form with no edits shows what the
    /// host has now; a form with edits keeps them.
    fn follow_memory(&mut self) {
        let Screen::Settings(Page::Bot {
            bot_id,
            section: BotSection::Memory,
        }) = &self.screen
        else {
            return;
        };
        let Some(status) = self.model.memory.get(bot_id) else {
            return;
        };
        let shown = self
            .memory
            .saved
            .as_ref()
            .is_some_and(|(id, saved)| id == bot_id && *saved == status.configuration);
        if !shown && !self.memory.is_dirty() && !self.model.saving_memory {
            self.memory = MemoryDraft::of(bot_id, &status.configuration);
        }
    }

    /// What stops the Memory form from being saved, in words for the owner.
    pub fn memory_problem(&self) -> Option<&'static str> {
        self.memory.update().problem()
    }

    pub fn can_save_memory(&self) -> bool {
        self.memory.is_dirty()
            && self.memory_problem().is_none()
            && !self.model.saving_memory
            && !self.model.testing_memory
    }

    pub fn save_memory(&mut self) {
        if !self.can_save_memory() {
            return;
        }
        let Some(bot_id) = self.memory.bot_id().map(str::to_owned) else {
            return;
        };
        if self.model.begin_save_memory() {
            let update = self.memory.update();
            self.command(Command::SaveMemory { bot_id, update });
        }
    }

    /// Throws the edits away, typed key included.
    pub fn discard_memory(&mut self) {
        if let Some((bot_id, saved)) = self.memory.saved.take() {
            self.memory = MemoryDraft::of(&bot_id, &saved);
        }
        self.model.memory_save_error = None;
    }

    /// Asks the runtime to reach the memory back end as it is saved.
    pub fn test_memory(&mut self) {
        let Some(bot_id) = self.memory.bot_id().map(str::to_owned) else {
            return;
        };
        if !self.memory.is_dirty() && self.model.begin_test_memory() {
            self.command(Command::TestMemory { bot_id });
        }
    }

    /// The bot whose saved memories are on screen, with its memory
    /// settings, while "Browse memory" shows and memory is switched on.
    fn browsed(&self) -> Option<(&str, &MemoryStatus)> {
        let Screen::Settings(Page::Bot {
            bot_id,
            section: BotSection::MemoryBrowse,
        }) = &self.screen
        else {
            return None;
        };
        let status = self.model.memory.get(bot_id)?;
        status
            .configuration
            .enabled
            .then_some((bot_id.as_str(), status))
    }

    /// Loads what the search box asks for: the matches of its query, or
    /// with the box empty every memory (the page after `after`, if given).
    pub fn load_memories(&mut self, after: Option<String>) {
        let Some((bot_id, status)) = self.browsed() else {
            return;
        };
        let bot_id = bot_id.to_owned();
        let can_browse = status.capabilities.browse;
        let query = self.memories.query.text.trim().to_owned();
        // This load answers the box as it is now.
        self.memories.seen = query.clone();
        self.memories.typed_at = None;
        if query.chars().count() > QUERY_LIMIT {
            self.model.memories.clear();
            self.model.memories.error = Some("A search can be at most 2,000 characters.".into());
        } else if !query.is_empty() {
            let ticket = self.model.memories.begin_load();
            self.command(Command::SearchMemory {
                bot_id,
                query,
                ticket,
            });
        } else if can_browse {
            let ticket = self.model.memories.begin_load();
            self.command(Command::BrowseMemory {
                bot_id,
                after,
                ticket,
            });
        }
    }

    /// After news from the host: with nothing asked for yet, list every
    /// memory once the settings say the back end can.
    fn follow_memories(&mut self) {
        let idle = self.model.memories.evidence.is_none()
            && !self.model.memories.busy()
            && self.model.memories.error.is_none()
            && self.memories.query.text.trim().is_empty();
        let can_browse = self
            .browsed()
            .is_some_and(|(_, status)| status.capabilities.browse);
        if idle && can_browse {
            self.load_memories(None);
        }
    }

    /// Notices typing in the search box; `clock` is the frame clock in
    /// seconds. A new query empties the list at once. The built-in back end
    /// then searches when the typing pauses; others wait for Search, since
    /// each of their searches is a request to a server. Returns true when
    /// the screen changed.
    pub fn watch_memory_query(&mut self, clock: f64) -> bool {
        let Some((_, status)) = self.browsed() else {
            return false;
        };
        let live = status.configuration.provider == MemoryProvider::Builtin;
        let query = self.memories.query.text.trim().to_owned();
        if query != self.memories.seen {
            self.memories.seen = query.clone();
            // Retires the answer to the previous query, if it is still on
            // its way.
            self.model.memories.clear();
            self.memories.typed_at = None;
            if query.is_empty() {
                self.load_memories(None);
            } else if live {
                self.memories.typed_at = Some(clock);
            }
            return true;
        }
        match self.memories.typed_at {
            Some(at) if clock - at >= SEARCH_PAUSE => {
                self.load_memories(None);
                true
            }
            _ => false,
        }
    }

    /// Empties the search box and goes back to every memory.
    pub fn clear_memory_search(&mut self) {
        self.memories.query.clear();
        self.memories.seen.clear();
        self.model.memories.clear();
        self.load_memories(None);
    }

    /// Opens the editor on one memory, holding what it says now.
    pub fn correct_memory(&mut self, id: &str) {
        let shown = self.model.memories.evidence.iter().flatten();
        let Some(item) = shown.into_iter().find(|item| item.id == id) else {
            return;
        };
        self.memories.correction = TextEdit::new(item.content.clone());
        self.memories.editing = Some(id.to_owned());
    }

    /// Whether the correction in the editor can be sent: some words, and no
    /// more than the runtime takes.
    pub fn can_save_correction(&self) -> bool {
        let text = self.memories.correction.text.trim();
        !text.is_empty() && text.chars().count() <= CONTENT_LIMIT && !self.model.memories.busy()
    }

    pub fn save_correction(&mut self) {
        let (Some(id), Some((bot_id, _))) = (self.memories.editing.clone(), self.browsed()) else {
            return;
        };
        let bot_id = bot_id.to_owned();
        if self.can_save_correction() && self.model.memories.begin_change() {
            let content = self.memories.correction.text.trim().to_owned();
            self.command(Command::ReviseMemory {
                bot_id,
                id,
                content,
            });
        }
    }

    /// Forgets the memory waiting on "Confirm forget".
    pub fn forget_memory(&mut self) {
        let (Some(id), Some((bot_id, _))) = (self.memories.forgetting.clone(), self.browsed())
        else {
            return;
        };
        let bot_id = bot_id.to_owned();
        if self.model.memories.begin_change() {
            self.command(Command::ForgetMemory { bot_id, id });
        }
    }

    /// Whose list is on screen: the backend's for Diagnostics (`traces`),
    /// or the bot whose Activity page shows.
    fn inspected_bot(&self, traces: bool) -> Option<String> {
        match &self.screen {
            Screen::Settings(Page::Diagnostics) if traces => Some(BACKEND.to_owned()),
            Screen::Settings(Page::Bot {
                bot_id,
                section: BotSection::Activity,
            }) if !traces => Some(bot_id.clone()),
            _ => None,
        }
    }

    /// Asks for the traces of the window on screen, again.
    pub fn load_traces(&mut self) {
        let Some(bot_id) = self.inspected_bot(true) else {
            return;
        };
        let hours = self.trace_hours;
        self.model.traces.open(&bot_id, hours);
        self.command(Command::LoadTraces { bot_id, hours });
    }

    /// Chooses the time window Diagnostics shows: the last 1, 6 or 24 hours.
    pub fn set_trace_window(&mut self, hours: u8) {
        if self.trace_hours != hours {
            self.trace_hours = hours;
            self.load_traces();
        }
    }

    /// Flips the runtime's trace collection.
    pub fn set_telemetry(&mut self, enabled: bool) {
        let Some(bot_id) = self.inspected_bot(true) else {
            return;
        };
        if self.model.begin_set_telemetry() {
            self.command(Command::SetTelemetry { bot_id, enabled });
        }
    }

    /// Saves the traces on screen to the Downloads folder as JSON, in the
    /// shape the runtime sent them.
    pub fn export_traces(&mut self) {
        let Some(data) = &self.model.traces.data else {
            return;
        };
        // Pretty JSON, as the web's export is.
        let Ok(contents) = serde_json::to_string_pretty(data) else {
            return;
        };
        self.save_export(format!("raphie-traces-{}.json", now_ms()), contents);
    }

    /// Saves the bot's events on screen to the Downloads folder as JSON.
    pub fn export_activity(&mut self) {
        let Some(bot_id) = self.inspected_bot(false) else {
            return;
        };
        let Some(events) = self.model.activity.get(&bot_id) else {
            return;
        };
        let now = now_ms();
        let export = serde_json::json!({
            "exportedAt": crate::format::iso_utc(now),
            "events": events,
        });
        let Ok(contents) = serde_json::to_string_pretty(&export) else {
            return;
        };
        self.save_export(format!("raphie-activity-{now}.json"), contents);
    }

    fn save_export(&mut self, name: String, contents: String) {
        if self.model.begin_export() {
            self.command(Command::SaveExport { name, contents });
        }
    }

    /// While Diagnostics or Activity shows, asks for its list again every
    /// few seconds; `clock` is the frame clock in seconds. Returns true
    /// while either page shows.
    pub fn refresh_inspection(&mut self, clock: f64) -> bool {
        let traces = self.inspected_bot(true);
        let activity = self.inspected_bot(false);
        if traces.is_none() && activity.is_none() {
            return false;
        }
        if clock - self.inspect_asked_at < INSPECT_REFRESH {
            return true;
        }
        self.inspect_asked_at = clock;
        // Not while a load is on its way.
        if traces.is_some() && !self.model.traces.loading {
            self.load_traces();
        }
        if let Some(bot_id) = activity {
            self.command(Command::LoadBotActivity { bot_id });
        }
        true
    }

    /// The bot whose Scheduled jobs page is on screen.
    fn jobs_bot(&self) -> Option<String> {
        match &self.screen {
            Screen::Settings(Page::Bot {
                bot_id,
                section: BotSection::Jobs,
            }) => Some(bot_id.clone()),
            _ => None,
        }
    }

    /// Opens an empty "Create a job" dialog.
    pub fn open_job_form(&mut self) {
        self.job = JobForm::new_at(now_ms());
        self.job.open = true;
        self.model.job_error = None;
    }

    /// The dialog's close button, Escape, or a press outside it. A draft
    /// keeps the dialog open and says how to leave it, as on the web.
    pub fn close_job_form(&mut self) {
        if self.model.changing_job {
            self.job.error = Some("Wait for the job to finish scheduling.");
        } else if self.job.is_dirty() {
            self.job.error = Some("Discard your draft before closing.");
        } else {
            self.job.open = false;
        }
    }

    /// Closes the dialog and drops what was typed.
    pub fn discard_job_form(&mut self) {
        self.job = JobForm::new_at(now_ms());
        self.model.job_error = None;
    }

    /// Schedules the job in the form, or says what is wrong with it.
    pub fn add_job(&mut self) {
        let Some(bot_id) = self.jobs_bot() else {
            return;
        };
        if !self.job.is_complete() {
            return;
        }
        match self.job.job() {
            Ok(job) => {
                self.job.error = None;
                if self.model.begin_change_job() {
                    self.command(Command::AddJob { bot_id, job });
                }
            }
            Err(problem) => self.job.error = Some(problem),
        }
    }

    /// Resumes, pauses, removes or runs one job.
    pub fn change_job(&mut self, id: &str, action: JobAction) {
        let Some(bot_id) = self.jobs_bot() else {
            return;
        };
        if self.model.begin_change_job() {
            self.command(Command::ChangeJob {
                bot_id,
                id: id.to_owned(),
                action,
            });
        }
    }

    /// Leaves Settings for the conversation a job's results are in.
    pub fn open_job_session(&mut self, session_id: &str) {
        if let Some(bot_id) = self.jobs_bot() {
            self.open_conversation(&bot_id, session_id);
        }
    }

    /// Shows one job's runs, or with `None` every job's, from the newest.
    pub fn show_runs(&mut self, job_id: Option<String>) {
        self.model.runs.show(job_id);
        self.load_runs(false);
    }

    /// Loads the newest runs again, or with `older` the page after the
    /// ones on screen.
    pub fn load_runs(&mut self, older: bool) {
        let Some(bot_id) = self.jobs_bot() else {
            return;
        };
        let before = if older {
            // Nothing older to ask for without a cursor.
            let Some(cursor) = self.model.runs.next.clone() else {
                return;
            };
            Some(cursor)
        } else {
            None
        };
        let job_id = self.model.runs.job_id.clone();
        let ticket = self.model.runs.begin_load(older);
        self.command(Command::LoadJobRuns {
            bot_id,
            job_id,
            before,
            ticket,
        });
    }

    /// While the Scheduled jobs page shows, asks for its jobs and newest
    /// runs again every few seconds; `clock` is the frame clock in seconds.
    /// Returns true while the page shows.
    pub fn refresh_jobs(&mut self, clock: f64) -> bool {
        let Some(bot_id) = self.jobs_bot() else {
            return false;
        };
        if clock - self.jobs_asked_at < JOBS_REFRESH {
            return true;
        }
        self.jobs_asked_at = clock;
        // Not while a change is on its way: its answer is the newer list.
        if !self.model.changing_job {
            self.command(Command::LoadJobs { bot_id });
        }
        // Not while runs are loading: a new load would retire that one.
        let runs = &self.model.runs;
        if !runs.loading && !runs.loading_older {
            self.load_runs(false);
        }
        true
    }

    /// The bot whose Workspace page is on screen.
    fn files_bot(&self) -> Option<String> {
        match &self.screen {
            Screen::Settings(Page::Bot {
                bot_id,
                section: BotSection::Workspace,
            }) => Some(bot_id.clone()),
            _ => None,
        }
    }

    /// Opens a workspace folder, or asks again for the one on screen.
    pub fn open_folder(&mut self, path: &str) {
        let Some(bot_id) = self.files_bot() else {
            return;
        };
        self.model.files.open(&bot_id, path);
        self.command(Command::LoadWorkspaceFiles {
            bot_id,
            path: path.to_owned(),
        });
    }

    /// The Refresh button: the folder on screen again, and the sandbox
    /// details that say how full the workspace is.
    pub fn refresh_files(&mut self) {
        let Some(bot_id) = self.files_bot() else {
            return;
        };
        self.model.files.download_error = None;
        let path = self.model.files.path.clone();
        self.open_folder(&path);
        self.command(Command::LoadSandbox { bot_id });
    }

    /// Saves the workspace file at `path` to this machine's Downloads
    /// folder, as the listing on screen has it.
    pub fn download_file(&mut self, path: &str, name: &str) {
        let (Some(bot_id), Some(listing)) = (self.files_bot(), &self.model.files.listing) else {
            return;
        };
        let revision = listing.revision;
        if self.model.files.begin_download(path) {
            self.command(Command::DownloadWorkspaceFile {
                bot_id,
                path: path.to_owned(),
                name: name.to_owned(),
                revision,
            });
        }
    }

    /// While the Workspace page shows, asks for the folder on screen again
    /// every few seconds; `clock` is the frame clock in seconds. Returns
    /// true while the page shows.
    pub fn watch_files(&mut self, clock: f64) -> bool {
        let Some(bot_id) = self.files_bot() else {
            return false;
        };
        // Not while one is already on its way.
        if clock - self.files_asked_at >= FILES_REFRESH && !self.model.files.loading {
            self.files_asked_at = clock;
            let path = self.model.files.path.clone();
            self.model.files.open(&bot_id, &path);
            self.command(Command::LoadWorkspaceFiles { bot_id, path });
        }
        true
    }

    /// The bot whose Skills page is on screen.
    fn skills_bot(&self) -> Option<String> {
        match &self.screen {
            Screen::Settings(Page::Bot {
                bot_id,
                section: BotSection::Skills,
            }) => Some(bot_id.clone()),
            _ => None,
        }
    }

    /// Opens a saved skill in the editor.
    pub fn open_skill(&mut self, name: &str) {
        let Some(bot_id) = self.skills_bot() else {
            return;
        };
        self.skills.mode = SkillsMode::Edit(name.to_owned());
        self.skills.editor = None;
        self.model.skill = None;
        self.model.skill_error = None;
        self.model.skill_message = None;
        self.model.skill_change_error = None;
        self.command(Command::LoadSkill {
            bot_id,
            name: name.to_owned(),
        });
    }

    /// Opens the editor on a new skill.
    pub fn new_skill(&mut self) {
        self.skills.mode = SkillsMode::New;
        self.skills.editor = Some(SkillEditor::new_skill());
        self.model.skill_message = None;
        self.model.skill_change_error = None;
    }

    /// Back to the list, unless the editor holds unsaved edits.
    pub fn back_to_skills(&mut self) {
        if let Some(editor) = &mut self.skills.editor
            && editor.is_dirty()
        {
            editor.note = Some("Save or discard your changes first.".into());
            return;
        }
        self.skills.mode = SkillsMode::List;
        self.skills.editor = None;
        self.model.skill_message = None;
        self.model.skill_change_error = None;
    }

    /// The editor, once its saved skill has arrived, shows it.
    fn follow_skill(&mut self) {
        let (Some(bot_id), SkillsMode::Edit(name)) = (self.skills_bot(), &self.skills.mode) else {
            return;
        };
        if self.skills.editor.is_none()
            && let Some((id, detail)) = &self.model.skill
            && *id == bot_id
            && detail.summary.name == *name
        {
            self.skills.editor = Some(SkillEditor::of(detail));
        }
    }

    pub fn can_save_skill(&self) -> bool {
        self.skills.editor.as_ref().is_some_and(|editor| {
            (editor.is_dirty() || self.skills.mode == SkillsMode::New) && !editor.name().is_empty()
        }) && !self.model.changing_skill
    }

    pub fn save_skill(&mut self) {
        if !self.can_save_skill() {
            return;
        }
        let (Some(bot_id), Some(editor)) = (self.skills_bot(), &self.skills.editor) else {
            return;
        };
        let create = self.skills.mode == SkillsMode::New;
        let name = match &self.skills.mode {
            SkillsMode::Edit(name) => name.clone(),
            _ => editor.name(),
        };
        let skill = editor.save();
        if self.model.begin_change_skill() {
            self.command(Command::SaveSkill {
                bot_id,
                name,
                skill,
                create,
            });
        }
    }

    pub fn discard_skill(&mut self) {
        self.skills.editor = match (&self.skills.mode, &self.model.skill) {
            (SkillsMode::New, _) => Some(SkillEditor::new_skill()),
            (SkillsMode::Edit(_), Some((_, detail))) => Some(SkillEditor::of(detail)),
            _ => None,
        };
        self.model.skill_change_error = None;
        self.model.skill_message = None;
    }

    pub fn enable_skill(&mut self, name: &str, enabled: bool) {
        let Some(bot_id) = self.skills_bot() else {
            return;
        };
        if self.model.begin_change_skill() {
            self.command(Command::EnableSkill {
                bot_id,
                name: name.to_owned(),
                enabled,
            });
        }
    }

    pub fn remove_skill(&mut self) {
        let (Some(bot_id), SkillsMode::Edit(name)) = (self.skills_bot(), &self.skills.mode) else {
            return;
        };
        let name = name.clone();
        if self.model.begin_change_skill() {
            self.command(Command::RemoveSkill { bot_id, name });
        }
    }

    /// Opens the system's file picker for a .zip of skills.
    pub fn choose_skill_zip(tx: &mut Tx) {
        let options = FileDialogOptions {
            title: "Import skills from a .zip".into(),
            ..FileDialogOptions::default()
        };
        tx.open_file(options, |s: &mut Ui, answer, _: &mut Tx| match answer {
            Ok(Some(path)) => s.skills.import.zip = Some(path),
            Ok(None) => {}
            Err(error) => {
                s.model.skill_change_error =
                    Some(format!("Could not open the file picker: {error}"));
            }
        });
    }

    pub fn import_skills(&mut self) {
        let Some(bot_id) = self.skills_bot() else {
            return;
        };
        let form = &self.skills.import;
        if !form.ready() {
            return;
        }
        let source = if form.github {
            raphie_core::engine::SkillSource::GitHub {
                url: form.url.text.trim().to_owned(),
            }
        } else {
            let Some(path) = form.zip.clone() else {
                return;
            };
            raphie_core::engine::SkillSource::Zip { path }
        };
        let replace = form.replace;
        if self.model.begin_change_skill() {
            self.command(Command::ImportSkills {
                bot_id,
                source,
                replace,
            });
        }
    }

    /// After news from the host: a You form with no edits shows what
    /// the host has now.
    fn follow_owner(&mut self) {
        let Some(saved) = &self.model.owner else {
            return;
        };
        let shown = self.owner.saved.as_ref() == Some(saved);
        if !shown && !self.owner.is_dirty() && !self.model.saving_owner {
            self.owner = OwnerDraft::of(saved);
        }
    }

    /// Whether You may be saved now: it has valid edits and no save
    /// is on its way.
    pub fn can_save_owner(&self) -> bool {
        self.owner.is_dirty() && self.owner.problem().is_none() && !self.model.saving_owner
    }

    pub fn save_owner(&mut self) {
        if !self.can_save_owner() {
            return;
        }
        let Some(owner) = self.owner.update() else {
            return;
        };
        if self.model.begin_save_owner() {
            self.command(Command::SaveOwner { owner });
        }
    }

    /// Throws the edits away and shows the profile the host has now.
    pub fn discard_owner(&mut self) {
        if let Some(saved) = &self.model.owner {
            self.owner = OwnerDraft::of(saved);
        }
        self.model.owner_save_error = None;
        self.model.owner_message = None;
    }

    /// Puts `bot_id`'s sandbox settings in the form. Unsaved edits for the
    /// same bot stay; edits for another bot are dropped.
    fn show_sandbox(&mut self, bot_id: &str) {
        if self.sandbox.bot_id() == Some(bot_id) && self.sandbox.is_dirty() {
            return;
        }
        self.model.sandbox_save_error = None;
        self.sandbox = match self.model.sandbox.get(bot_id) {
            Some(info) => SandboxDraft::of(bot_id, &info.settings),
            None => SandboxDraft::empty(),
        };
    }

    /// The sandbox settings of the form's bot, as the host has them now.
    pub fn sandbox_latest(&self) -> Option<&raphie_core::contracts::SandboxSettings> {
        let info = self.model.sandbox.get(self.sandbox.bot_id()?)?;
        Some(&info.settings)
    }

    /// After news from the host: a Sandbox form with no edits shows what
    /// the host has now; a form with edits keeps them, and the save bar
    /// says the settings changed elsewhere.
    fn follow_sandbox(&mut self) {
        let Screen::Settings(Page::Bot {
            bot_id,
            section: BotSection::Sandbox,
        }) = &self.screen
        else {
            return;
        };
        let Some(info) = self.model.sandbox.get(bot_id) else {
            return;
        };
        let shown = self
            .sandbox
            .saved
            .as_ref()
            .is_some_and(|(id, saved)| id == bot_id && *saved == info.settings);
        if !shown && !self.sandbox.is_dirty() && !self.model.saving_sandbox {
            self.sandbox = SandboxDraft::of(bot_id, &info.settings);
        }
    }

    /// Whether the Sandbox form may be saved now: it has edits, they are
    /// valid, and they started from the settings the host still has.
    pub fn can_save_sandbox(&self) -> bool {
        let current = self
            .sandbox_latest()
            .is_some_and(|latest| !self.sandbox.changed_elsewhere(latest));
        current
            && self.sandbox.is_dirty()
            && self.sandbox.problem().is_none()
            && !self.model.saving_sandbox
    }

    pub fn save_sandbox(&mut self) {
        if !self.can_save_sandbox() {
            return;
        }
        let (Some(bot_id), Some(update)) = (
            self.sandbox.bot_id().map(str::to_owned),
            self.sandbox.update(),
        ) else {
            return;
        };
        if self.model.begin_save_sandbox() {
            self.command(Command::SaveSandbox { bot_id, update });
        }
    }

    /// Throws the edits away and shows the settings the host has now.
    pub fn discard_sandbox(&mut self) {
        let latest = self
            .sandbox
            .bot_id()
            .and_then(|bot_id| Some((bot_id.to_owned(), self.sandbox_latest()?.clone())));
        if let Some((bot_id, settings)) = latest {
            self.sandbox = SandboxDraft::of(&bot_id, &settings);
        }
        self.model.sandbox_save_error = None;
        self.model.sandbox_message = None;
    }

    /// While the Sandbox page shows, asks for its details again every few
    /// seconds; `clock` is the frame clock in seconds. Returns true while
    /// the page shows.
    pub fn refresh_sandbox(&mut self, clock: f64) -> bool {
        let Screen::Settings(Page::Bot {
            bot_id,
            section: BotSection::Sandbox,
        }) = &self.screen
        else {
            return false;
        };
        // Not while a save is on its way: its answer is the newer state.
        if clock - self.sandbox_asked_at >= SANDBOX_REFRESH && !self.model.saving_sandbox {
            let bot_id = bot_id.clone();
            self.sandbox_asked_at = clock;
            self.command(Command::LoadSandbox { bot_id });
        }
        true
    }

    /// The bot whose Channels page is on screen.
    fn channels_bot(&self) -> Option<String> {
        match &self.screen {
            Screen::Settings(Page::Bot {
                bot_id,
                section: BotSection::Channels,
            }) => Some(bot_id.clone()),
            _ => None,
        }
    }

    /// Makes one change to the channels of the bot on screen.
    pub fn change_channel(&mut self, change: ChannelChange) {
        let Some(bot_id) = self.channels_bot() else {
            return;
        };
        if self.model.begin_change_channel(change.outcome().channel()) {
            self.command(Command::ChangeChannel { bot_id, change });
        }
    }

    /// The Discord row's button: unfolds the form on the saved settings, or
    /// folds it. A form with edits stays open and says how to leave it.
    pub fn toggle_discord(&mut self) {
        let Some(bot_id) = self.channels_bot() else {
            return;
        };
        if !self.discord.open {
            let saved = self.model.channels.get(&bot_id);
            self.discord = DiscordForm::of(saved.and_then(|c| c.discord.as_ref()));
            self.model.channel_messages.remove(&Channel::Discord);
        } else if self.discord.is_dirty() {
            self.discord.error = Some(UNSAVED);
        } else {
            self.discord = DiscordForm::new();
        }
    }

    /// Sends the Discord form, or says what is wrong with it.
    pub fn save_discord(&mut self) {
        let Some(bot_id) = self.channels_bot() else {
            return;
        };
        let saved = self
            .model
            .channels
            .get(&bot_id)
            .is_some_and(|c| c.discord.is_some());
        let update = self.discord.update();
        self.discord.error = update.problem(saved);
        if self.discord.error.is_none() {
            self.change_channel(ChannelChange::SaveDiscord(update));
        }
    }

    /// Folds the Discord form and drops its edits, typed token included.
    pub fn cancel_discord(&mut self) {
        self.discord = DiscordForm::new();
        self.model.channel_errors.remove(&Channel::Discord);
    }

    /// The Telegram row's button: unfolds or folds its panel. A typed
    /// token keeps it open.
    pub fn toggle_telegram(&mut self) {
        if self.telegram.open && !self.telegram.token.text.is_empty() {
            self.telegram.error = Some(UNSAVED);
            return;
        }
        self.telegram.error = None;
        self.telegram.open = !self.telegram.open;
        self.model.channel_messages.remove(&Channel::Telegram);
        self.model.channel_errors.remove(&Channel::Telegram);
    }

    /// Connects Telegram with the typed bot token, or says it is not one.
    pub fn save_telegram(&mut self) {
        let token = self.telegram.token.text.trim().to_owned();
        if token.is_empty() {
            return;
        }
        if is_telegram_token(&token) {
            self.telegram.error = None;
            self.change_channel(ChannelChange::SaveTelegram(Secret::new(token.as_str())));
        } else {
            self.telegram.error = Some("Enter a valid bot token.");
        }
    }

    /// Folds the Telegram panel and drops a typed token.
    pub fn cancel_telegram(&mut self) {
        self.telegram = TelegramForm::new();
        self.model.channel_errors.remove(&Channel::Telegram);
    }

    /// While the Channels page shows, asks again for the home channel every
    /// few seconds and, while a pairing code is out, for the channels, so
    /// the owner's account shows as verified by itself. `clock` is the
    /// frame clock in seconds. Returns true while the page shows.
    pub fn refresh_channels(&mut self, clock: f64) -> bool {
        let Some(bot_id) = self.channels_bot() else {
            return false;
        };
        let (home_at, channels_at) = self.channels_asked_at;
        if clock - home_at >= HOME_REFRESH {
            self.channels_asked_at.0 = clock;
            self.command(Command::LoadChannelHome {
                bot_id: bot_id.clone(),
            });
        }
        let pairing = self
            .model
            .channels
            .get(&bot_id)
            .and_then(|c| c.telegram.as_ref())
            .is_some_and(|t| t.pairing_expires_at.is_some());
        // Not while a change is on its way: its answer is the newer state.
        if pairing && !self.model.changing_channel && clock - channels_at >= PAIRING_REFRESH {
            self.channels_asked_at.1 = clock;
            self.command(Command::LoadChannels { bot_id });
        }
        true
    }

    /// Sends the "Add a connection" form, or says what is wrong with it.
    pub fn add_mcp(&mut self) {
        // The form belongs to the page on screen, so that names the bot.
        let Screen::Settings(Page::Bot {
            bot_id,
            section: BotSection::Mcp,
        }) = &self.screen
        else {
            return;
        };
        let bot_id = bot_id.clone();
        if !self.mcp.is_complete() {
            return;
        }
        match self.mcp.connection() {
            Ok(connection) => {
                self.mcp.error = None;
                if self.model.begin_change_mcp() {
                    self.command(Command::AddMcp { bot_id, connection });
                }
            }
            Err(problem) => {
                self.mcp.error = Some(problem);
                self.model.mcp_message = None;
            }
        }
    }

    /// Enables, pauses, removes or imports one MCP connection.
    pub fn change_mcp(&mut self, bot_id: &str, id: &str, action: McpAction) {
        self.mcp.error = None;
        if self.model.begin_change_mcp() {
            self.command(Command::ChangeMcp {
                bot_id: bot_id.to_owned(),
                id: id.to_owned(),
                action,
            });
        }
    }

    /// Empties the "Add a connection" form, typed token included.
    pub fn discard_mcp(&mut self) {
        self.mcp = McpForm::new();
        self.model.mcp_change_error = None;
    }

    /// Opens an MCP server's sign-in page in the owner's browser. The
    /// address comes from the server, so anything but a web page is refused.
    pub fn authorize_mcp(&mut self, url: &str, tx: &mut Tx) {
        if url.starts_with("https://") || url.starts_with("http://") {
            self.open_url(url.to_owned(), tx);
        } else {
            self.model.mcp_change_error = Some("The authorization link is not a web page.".into());
        }
    }

    /// While the MCP tools page shows, asks for its connections again every
    /// few seconds; `clock` is the frame clock in seconds. Returns true
    /// while the page shows, so the caller keeps the clock ticking.
    pub fn refresh_mcp(&mut self, clock: f64) -> bool {
        let Screen::Settings(Page::Bot {
            bot_id,
            section: BotSection::Mcp,
        }) = &self.screen
        else {
            return false;
        };
        let due = clock - self.mcp_asked_at >= MCP_REFRESH;
        // Not while a change is on its way: its answer is the newer list.
        if due && !self.model.changing_mcp {
            let bot_id = bot_id.clone();
            self.mcp_asked_at = clock;
            self.command(Command::LoadMcp { bot_id });
        }
        true
    }

    /// Leaves Settings for a conversation: the one a memory came from, or
    /// the one a job's result is in.
    pub fn open_conversation(&mut self, bot_id: &str, session_id: &str) {
        self.select_bot(bot_id);
        self.select_session(Some(session_id));
        self.close_settings();
    }

    /// Makes a model the default for `bot_id`'s new sessions.
    pub fn set_default_model(&mut self, bot_id: &str, model_id: &str, connection_id: &str) {
        if self.model.begin_set_model() {
            self.command(Command::SetDefaultModel {
                bot_id: bot_id.to_owned(),
                model_id: model_id.to_owned(),
                connection_id: connection_id.to_owned(),
            });
        }
    }

    /// Throws the edits away and shows the bot as the host has it now.
    pub fn discard_profile(&mut self) {
        if self.profile.creating {
            self.profile = ProfileDraft::new_bot();
        } else if let Some(latest) = self.profile_bot() {
            self.profile = ProfileDraft::of(latest);
        }
        self.model.profile_error = None;
    }

    /// After news from the host: a form with no edits follows the bot when
    /// it was saved elsewhere; a form with edits keeps them.
    fn follow_profile(&mut self) {
        // A Profile opened before its bot was known (as when the app opens
        // on it) fills in once the bot arrives.
        if !self.profile.creating
            && self.profile.saved.is_none()
            && let Screen::Settings(Page::Bot {
                bot_id,
                section: BotSection::Profile,
            }) = &self.screen
            && let Some(bot) = self.model.bots.iter().find(|bot| &bot.id == bot_id)
        {
            self.profile = ProfileDraft::of(bot);
        }
        let stale = self
            .profile_bot()
            .is_some_and(|latest| self.profile.changed_elsewhere(latest));
        if stale && !self.profile.is_dirty() && !self.model.saving_profile {
            let message = self.profile.message.take();
            self.discard_profile();
            self.profile.message = message;
        }
    }

    /// Leaves "Create a bot" without creating one, for the selected bot's
    /// Profile. The unfinished form is dropped: Cancel means discard.
    pub fn cancel_new_bot(&mut self) {
        self.profile = ProfileDraft::empty();
        self.model.profile_error = None;
        self.open_settings(None);
    }

    /// Opens "Delete bot" asking for the bot's name.
    pub fn ask_delete_bot(&mut self) {
        self.deleting_bot = true;
        self.delete_confirmation = TextEdit::new("");
        self.model.delete_bot_error = None;
    }

    /// Closes "Delete bot" without deleting. Not while the delete is on
    /// its way: its answer needs somewhere to show.
    pub fn close_delete_bot(&mut self) {
        if !self.model.deleting_bot {
            self.deleting_bot = false;
        }
    }

    /// Whether what was typed is the bot's name, exactly.
    pub fn delete_confirmed(&self) -> bool {
        self.profile
            .saved
            .as_ref()
            .is_some_and(|saved| self.delete_confirmation.text == saved.name)
    }

    /// Deletes the bot in the Profile form, once its name has been typed.
    /// The runtime is sent the name and revision that were confirmed, and
    /// refuses if the bot changed since.
    pub fn delete_bot(&mut self) {
        if !self.delete_confirmed() {
            return;
        }
        let Some(saved) = &self.profile.saved else {
            return;
        };
        let (bot_id, name, revision) = (saved.id.clone(), saved.name.clone(), saved.revision);
        if self.model.begin_delete_bot() {
            self.command(Command::DeleteBot {
                bot_id,
                name,
                revision,
            });
        }
    }

    pub fn close_settings(&mut self) {
        self.screen = Screen::Workspace;
        // Skills may have changed in Settings: the "/" menu asks again.
        self.skills_asked = None;
    }

    /// Chooses light, dark or the system's appearance, and remembers it.
    pub fn set_theme(&mut self, theme: ThemeChoice) {
        self.theme = theme;
        // Tests and headless runs have no engine and must not write files.
        if self.client.is_none() {
            return;
        }
        if let Some(path) = Settings::default_path() {
            let mut saved = Settings::load(&path);
            saved.theme = theme;
            // Forgetting the choice is harmless; it stays for this launch.
            let _ = saved.save(&path);
        }
    }

    /// The address of a Settings page in the web workspace on this host.
    pub fn web_url(&self, page: &Page) -> Option<String> {
        let origin = self.model.origin.as_ref()?;
        Some(origin.url(&format!("/?{}", page.web_query())))
    }

    /// Opens a Settings page of the web workspace in the owner's browser,
    /// for what this app cannot do itself.
    pub fn open_web(&mut self, page: &Page, tx: &mut Tx) {
        let Some(url) = self.web_url(page) else {
            return;
        };
        self.open_url(url, tx);
    }

    /// Opens a fixed, known web page (a provider's console, say) in the
    /// owner's browser.
    pub fn open_page(&mut self, url: &'static str, tx: &mut Tx) {
        self.open_url(url.to_owned(), tx);
    }

    /// Asks for the picture of every image attachment on screen, once each:
    /// those waiting in the composer and those on the open conversation's
    /// messages.
    pub fn ask_previews(&mut self) {
        let Some(bot_id) = self.model.bot_id.clone() else {
            return;
        };
        // Collected first: asking needs `&mut self`, which cannot happen
        // while the model's lists are borrowed.
        let mut wanted: Vec<String> = self
            .model
            .attachments
            .files_for(Some(&bot_id))
            .iter()
            .filter(|file| is_image(file))
            .map(|file| file.id.clone())
            .collect();
        if let Some(conversation) = &self.model.conversation {
            for turn in conversation.turns() {
                let images = turn.attachments.iter().filter(|file| is_image(file));
                wanted.extend(images.map(|file| file.id.clone()));
            }
        }
        for id in wanted {
            if self.model.previews.begin(&bot_id, &id) {
                self.command(Command::LoadPreview {
                    bot_id: bot_id.clone(),
                    id,
                });
            }
        }
    }

    /// Hands newly arrived picture bytes to the decoder, and lets go of
    /// pictures whose bytes are gone. True when something changed.
    pub fn decode_previews(&mut self) -> bool {
        let Some(images) = &self.images else {
            return false;
        };
        let previews = &self.model.previews;
        let before = self.pictures.len();
        self.pictures
            .retain(|(bot_id, id), _| matches!(previews.get(bot_id, id), Some(Preview::Ready(_))));
        let mut changed = self.pictures.len() != before;
        for (key, bytes) in previews.ready() {
            // `entry` looks the key up once: `Vacant` when it is not there.
            if let Entry::Vacant(slot) = self.pictures.entry(key) {
                // Cloning `Arc<[u8]>` shares the bytes; nothing is copied.
                slot.insert(images.load(bytes.0.clone()));
                changed = true;
            }
        }
        changed
    }

    /// Gives this UI a decoder for pictures: `setup` does in a window; a
    /// test passes its own.
    pub fn use_images(&mut self, images: ImageCache) {
        self.images = Some(images);
    }

    /// Waits until every picture handed to the decoder is decoded. For
    /// tests, which need a picture on screen before they can press it.
    pub fn wait_for_pictures(&self) {
        for picture in self.pictures.values() {
            // A picture that fails to decode is done too.
            let _ = picture.wait();
        }
    }

    /// Shows a picture enlarged over the window.
    pub fn open_viewer(&mut self, bot_id: &str, id: &str, name: &str) {
        self.viewer = Some(Viewer {
            bot_id: bot_id.to_owned(),
            id: id.to_owned(),
            name: name.to_owned(),
        });
    }

    /// The decoded picture of `bot_id`'s file `id`, once it can be drawn.
    pub fn picture(&self, bot_id: &str, id: &str) -> Option<&Image> {
        let picture = self.pictures.get(&(bot_id.to_owned(), id.to_owned()))?;
        (picture.is_ready() && picture.error().is_none()).then_some(picture)
    }

    /// Asks now whether the signed-in Raphie answers, unless a check is
    /// already on its way.
    pub fn check_reach(&mut self) {
        if !self.model.checking_reach {
            self.model.checking_reach = true;
            self.command(Command::CheckReach);
        }
    }

    /// Back to the sign-in screen with this address in the field, to
    /// connect to another. This address's sign-in is kept.
    pub fn change_address(&mut self) {
        self.close_settings();
        self.command(Command::ChangeAddress);
    }

    /// Asks whether a newer Raphie has been released, unless a check is
    /// already on its way.
    pub fn check_for_updates(&mut self) {
        if self.model.update.begin() {
            self.command(Command::CheckForUpdates);
        }
    }

    /// Opens the newer release's page on GitHub. The core only keeps
    /// pages under Raphie's releases, so this cannot open anything else.
    pub fn open_release(&mut self, tx: &mut Tx) {
        if let UpdateStatus::Available(update) = &self.model.update {
            let url = update.url.clone();
            self.open_url(url, tx);
        }
    }

    fn open_url(&mut self, url: String, tx: &mut Tx) {
        if self.client.is_none() {
            // Tests and headless runs: note it instead of opening a browser.
            self.opened.push(url);
        } else if tx.open_url(&url).is_err() {
            self.model.notice = Some("Could not open a browser.".into());
        }
    }
}

impl Default for Ui {
    fn default() -> Ui {
        Ui::new()
    }
}

/// `AppSpec::setup`: runs once with Rune's waker. Starts the engine and, if
/// this machine signed in before, quietly restores that sign-in.
pub fn setup(ui: &mut Ui, waker: Waker) {
    // Headless snapshots draw pictures too, so this comes first. A decode
    // finishing wakes the app with `waker`.
    ui.use_images(ImageCache::new(waker.clone()));
    // Headless runs (`--snap`, `--tree`, `--script`) render scenes; they must
    // never touch the network or the Keychain.
    if rune::tooling::headless_run().is_some() {
        return;
    }
    // `Waker` is `Arc<dyn Fn() + Send + Sync>`, the same type the core calls
    // `Notify`, so it passes straight through.
    let client = Client::start(
        Arc::new(KeychainStore::new()),
        EngineConfig::default(),
        waker,
    );
    ui.client = Some(client);
    // Ask, the first time, whether updates may be shown as notifications.
    notify::prepare();
    // Once per launch; Settings → Appearance can ask again.
    ui.check_for_updates();
    // Whether Raphie runs on this Mac, to offer it on the sign-in screen.
    ui.command(Command::FindLocalInstall);
    // `raphie-desktop --origin https://…` signs in to that origin at once;
    // otherwise reuse the last origin's stored token, if there is one.
    if let Some(origin) = origin_argument(rune::extra_args()) {
        ui.origin_field = TextEdit::new(origin);
        ui.connect();
    } else if let Ok(origin) = Origin::parse(&ui.origin_field.text) {
        ui.command(Command::Restore { origin });
    }
}

/// The value after `--origin` among the arguments Rune did not recognise.
fn origin_argument(args: &[String]) -> Option<&str> {
    let flag = args.iter().position(|a| a == "--origin")?;
    args.get(flag + 1).map(String::as_str)
}

/// `AppSpec::poll`: runs before each frame. Applies whatever the engine
/// reported; returns true when the view should be rebuilt.
pub fn poll(ui: &mut Ui, clock: f64, tx: &mut Tx) -> bool {
    // Before the engine check, so headless snapshots decode their pictures.
    let decoded = ui.decode_previews();
    let Some(client) = &ui.client else {
        return decoded;
    };
    let events = client.drain();
    // A search box has no "changed" handler, so each frame looks at it.
    let searched = ui.watch_memory_query(clock);
    if ui.memories.search_pending() {
        tx.wake_after(Duration::from_millis(300));
    }
    // `|` rather than `||`: both pages get their look at the clock.
    let watching = ui.refresh_inbox(clock)
        | ui.follow_sign_in(clock)
        | ui.refresh_mcp(clock)
        | ui.refresh_channels(clock)
        | ui.refresh_sandbox(clock)
        | ui.watch_files(clock)
        | ui.refresh_jobs(clock)
        | ui.refresh_handoffs(clock)
        | ui.refresh_inspection(clock);
    if watching {
        tx.wake_after(Duration::from_secs(1));
    }
    // While Raphie works, wake up every second so "12s elapsed" keeps
    // counting and an approval's deadline is noticed. Asking again on every
    // poll adds no extra polls.
    let busy = ui.busy();
    if busy {
        tx.wake_after(Duration::from_secs(1));
    }
    let ticked = busy && clock - ui.ticked_at >= 1.0;
    if ticked {
        ui.ticked_at = clock;
    }
    // `|` rather than `||`: the events are applied even after a tick.
    receive(ui, events, tx) | ticked | searched | decoded
}

/// Applies what the engine reported; returns true when anything arrived.
/// Separate from `poll` so tests can deliver events without an engine.
pub fn receive(ui: &mut Ui, events: Vec<Event>, tx: &mut Tx) -> bool {
    if events.is_empty() {
        return false;
    }
    for event in events {
        // Back on the sign-in screen (a failed connect, a sign-out): look
        // for Raphie on this Mac again, in case it started since.
        if matches!(event, Event::SignedOut { .. }) {
            ui.command(Command::FindLocalInstall);
        }
        for effect in ui.model.apply(event) {
            match effect {
                Effect::ModelChosen => ui.model_picker.open = false,
                Effect::ClearComposer => {
                    ui.composer.clear();
                    tx.scroll_to_bottom("rd-transcript");
                }
                Effect::CloseConnectionForm => {
                    // Replacing the form drops the typed key, which wipes it.
                    ui.providers = ProvidersView::new();
                }
                Effect::MemorySaved(bot_id) => {
                    // Show what was saved. Replacing the form drops the
                    // typed key, which wipes it.
                    if ui.memory.bot_id() == Some(bot_id.as_str())
                        && let Some(status) = ui.model.memory.get(&bot_id)
                    {
                        ui.memory = MemoryDraft::of(&bot_id, &status.configuration);
                    }
                }
                Effect::BotCreated(bot_id) => {
                    // The form did its job. Next the new bot needs a model
                    // connection, so open its Providers page, as the web does.
                    ui.profile = ProfileDraft::empty();
                    ui.open_settings(Some(Page::Bot {
                        bot_id,
                        section: BotSection::Providers,
                    }));
                }
                Effect::BotDeleted(bot_id) => {
                    ui.deleting_bot = false;
                    ui.delete_confirmation.clear();
                    ui.parked_profiles.remove(&bot_id);
                    ui.expanded_bots.remove(&bot_id);
                    if ui.profile.bot_id() == Some(bot_id.as_str()) {
                        ui.profile = ProfileDraft::empty();
                    }
                    // Its pages and conversations are gone: go back to the
                    // default bot's conversations, as the web does.
                    let on_its_page = matches!(
                        &ui.screen,
                        Screen::Settings(Page::Bot { bot_id: shown, .. }) if *shown == bot_id
                    );
                    if on_its_page {
                        ui.close_settings();
                    }
                    if ui.model.bot_id.as_deref() == Some(bot_id.as_str()) {
                        ui.select_bot("default");
                    }
                }
                Effect::JobAdded => {
                    // The job is scheduled: close its dialog and empty it.
                    ui.job = JobForm::new_at(now_ms());
                }
                Effect::SkillChanged(outcome) => match outcome {
                    SkillOutcome::Saved(detail) => {
                        if ui.skills.mode == SkillsMode::New {
                            ui.skills.mode = SkillsMode::List;
                            ui.skills.editor = None;
                        } else {
                            ui.skills.editor = Some(SkillEditor::of(&detail));
                        }
                    }
                    SkillOutcome::Removed => {
                        ui.skills.mode = SkillsMode::List;
                        ui.skills.editor = None;
                    }
                    SkillOutcome::Imported(_) => {
                        ui.skills.import = crate::skills::SkillImportForm::new();
                    }
                    SkillOutcome::Changed => {}
                },
                Effect::OwnerSaved => {
                    // Show what was saved.
                    if let Some(saved) = &ui.model.owner {
                        ui.owner = OwnerDraft::of(saved);
                    }
                }
                Effect::SandboxSaved(bot_id) => {
                    // Show what was saved, at its new revision.
                    if ui.sandbox.bot_id() == Some(bot_id.as_str())
                        && let Some(info) = ui.model.sandbox.get(&bot_id)
                    {
                        ui.sandbox = SandboxDraft::of(&bot_id, &info.settings);
                    }
                }
                Effect::ChannelChanged(outcome) => match outcome {
                    // Replacing a form drops its typed token, which wipes it.
                    ChannelOutcome::DiscordSaved | ChannelOutcome::DiscordRemoved => {
                        ui.discord = DiscordForm::new();
                    }
                    ChannelOutcome::TelegramSaved => ui.telegram.token.clear(),
                    ChannelOutcome::TelegramRemoved => ui.telegram = TelegramForm::new(),
                    _ => {}
                },
                Effect::SignedIn(bot_id) => {
                    // The connection is made: show it, with its models.
                    ui.providers = ProvidersView::new();
                    ui.model.sign_in = None;
                    ui.model.connection_message = Some("Signed in.".into());
                    ui.command(Command::LoadSettings { bot_id });
                }
                Effect::McpAdded => {
                    // Replacing the form drops what was typed, which wipes
                    // the token and the environment.
                    ui.mcp = McpForm::new();
                }
                Effect::MemoryChanged(id) => {
                    // The correction was saved or the memory is gone: close
                    // what was open on it.
                    if ui.memories.editing.as_deref() == Some(id.as_str()) {
                        ui.memories.editing = None;
                        ui.memories.correction.clear();
                    }
                    if ui.memories.forgetting.as_deref() == Some(id.as_str()) {
                        ui.memories.forgetting = None;
                    }
                }
                Effect::ProfileSaved(profile) => {
                    // Show what was saved, at its new revision. A restore
                    // leaves unsaved edits in the form, which then say the
                    // bot changed elsewhere.
                    let restored = std::mem::take(&mut ui.restoring_profile);
                    if ui.profile.bot_id() == Some(profile.id.as_str())
                        && !(restored && ui.profile.is_dirty())
                    {
                        ui.profile = ProfileDraft::of(&profile);
                        ui.profile.message = Some(format!("Saved revision {}.", profile.revision));
                    }
                }
            }
        }
    }
    ui.follow_profile();
    ui.follow_memory();
    ui.follow_memories();
    ui.follow_sandbox();
    ui.follow_owner();
    ui.follow_skill();
    ui.ensure_models();
    ui.ensure_skills();
    ui.ensure_self_update_sources();
    ui.ensure_command_mode();
    ui.ask_previews();
    ui.open_announced_sign_in_page(tx);
    // A reply that arrived while its conversation is on screen is read.
    ui.mark_read();
    // Whatever is still new after that is worth a system notification.
    ui.announce();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dev_app_first_offers_the_fixture_and_the_release_app_this_mac() {
        assert_eq!(first_origin(Flavor::Dev, None), FIXTURE_ORIGIN);
        assert_eq!(
            first_origin(Flavor::Release, None),
            "http://127.0.0.1:24320"
        );
        let file = std::env::temp_dir().join(format!("raphie-first-{}", std::process::id()));
        std::fs::write(&file, "runtime=25016\nweb=25020\n").unwrap();
        assert_eq!(
            first_origin(Flavor::Release, Some(&file)),
            "http://127.0.0.1:25020"
        );
        std::fs::remove_file(file).unwrap();
    }
}
