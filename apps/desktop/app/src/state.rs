//! The UI's state: the core [`Model`] plus what only the window needs (text
//! being typed, which side panels are open), and the bridge to the engine.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use raphie_core::auth::KeychainStore;
use raphie_core::auth::Secret;
use raphie_core::contracts::{
    ControlAction, Decision, MemoryProvider, MemoryStatus, Scope, TurnStatus,
};
use raphie_core::engine::{Client, Command, ConnectionChange, EngineConfig};
use raphie_core::memory::{CONTENT_LIMIT, QUERY_LIMIT};
use raphie_core::model::{AuthState, Effect, Event, Model};
use raphie_core::model_library::ModelFilter;
use raphie_core::origin::Origin;
use raphie_core::settings::{Settings, ThemeChoice};
use rune::{TextEdit, Tx, Waker};

use crate::memory::MemoryDraft;
use crate::profile::ProfileDraft;
use crate::sections::{BotSection, Page};

/// The fixture's web host: the default for a first launch from a checkout.
pub const DEFAULT_ORIGIN: &str = "http://127.0.0.1:4321";

/// Which conversations the panel lists (the web's filter chips).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    All,
    /// Only conversations with an action waiting for approval.
    Approvals,
}

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
}

impl ProvidersView {
    pub fn new() -> ProvidersView {
        ProvidersView {
            open: None,
            provider: String::new(),
            choosing_provider: false,
            name: TextEdit::new(""),
            key: TextEdit::new("").secure(),
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
    /// Whether the bot roster on the left shows (⌘B).
    pub roster_open: bool,
    /// Whether the conversations panel on the right shows.
    pub panel_open: bool,
    /// The conversations panel's search box.
    pub search: TextEdit,
    pub filter: Filter,
    pub screen: Screen,
    /// Bots whose pages are unfolded in the Settings navigation.
    pub expanded_bots: HashSet<String>,
    /// Light, dark or following the system (Settings → Appearance).
    pub theme: ThemeChoice,
    /// Settings → Models: its filters.
    pub models: ModelsView,
    /// Settings → Providers: its form.
    pub providers: ProvidersView,
    /// Settings → Memory: its form.
    pub memory: MemoryDraft,
    /// Settings → Memory → Browse memory.
    pub memories: MemoriesView,
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
}

impl Ui {
    /// A UI with no engine attached yet (`setup` attaches one in a window),
    /// offering the last origin this machine signed in to.
    pub fn new() -> Ui {
        let saved = Settings::default_path()
            .map(|path| Settings::load(&path))
            .unwrap_or_default();
        let mut ui = Ui::with_origin(saved.origin.as_deref().unwrap_or(DEFAULT_ORIGIN));
        ui.theme = saved.theme;
        ui
    }

    /// A UI offering `origin` on the sign-in screen.
    pub fn with_origin(origin: &str) -> Ui {
        Ui {
            model: Model::new(),
            client: None,
            sent: Vec::new(),
            opened: Vec::new(),
            origin_field: TextEdit::new(origin),
            composer: TextEdit::new(""),
            roster_open: true,
            // Closed until asked for, like the web workspace's panel.
            panel_open: false,
            search: TextEdit::new(""),
            filter: Filter::All,
            screen: Screen::Workspace,
            expanded_bots: HashSet::new(),
            theme: ThemeChoice::System,
            models: ModelsView::new(),
            providers: ProvidersView::new(),
            memory: MemoryDraft::empty(),
            memories: MemoriesView::new(),
            profile: ProfileDraft::empty(),
            parked_profiles: HashMap::new(),
            open_runs: HashSet::new(),
            open_steps: HashSet::new(),
            ticked_at: 0.0,
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
        self.model.select_bot(bot_id.to_owned());
        self.command(Command::SelectBot {
            bot_id: bot_id.to_owned(),
        });
    }

    pub fn select_session(&mut self, session_id: Option<&str>) {
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
        if text.is_empty() || !self.model.begin_send() {
            return;
        }
        // The runtime accepts up to 4,000 characters per message.
        if text.chars().count() > 4000 {
            self.model.sending = false;
            self.model.notice = Some("Messages can be at most 4,000 characters.".into());
            return;
        }
        self.command(Command::Send { text });
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

    /// Unfolds or folds something by id: a run's steps, or one step's details.
    pub fn toggle(set: &mut HashSet<String>, id: &str) {
        // `remove` says whether the id was there; if not, add it.
        if !set.remove(id) {
            set.insert(id.to_owned());
        }
    }

    /// Opens Settings on `page`, or on the selected bot's Profile.
    pub fn open_settings(&mut self, page: Option<Page>) {
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
            if *section == BotSection::Profile {
                self.show_profile(bot_id);
                // Notice a save made in another client before editing.
                self.command(Command::RefreshBots);
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
            if *section == BotSection::Models {
                // A fresh look at the catalogue each time the page opens.
                self.models = ModelsView::new();
                self.model.model_message = None;
                self.command(Command::LoadSettings {
                    bot_id: bot_id.clone(),
                });
            }
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
        if self.profile.bot_id() == Some(bot_id) {
            return;
        }
        let next = match self.parked_profiles.remove(bot_id) {
            Some(parked) => parked,
            None => match self.model.bots.iter().find(|bot| bot.id == bot_id) {
                Some(bot) => ProfileDraft::of(bot),
                None => ProfileDraft::empty(),
            },
        };
        // `mem::replace` swaps the new form in and hands back the old one.
        let previous = std::mem::replace(&mut self.profile, next);
        if previous.is_dirty()
            && let Some(id) = previous.bot_id()
        {
            self.parked_profiles.insert(id.to_owned(), previous);
        }
    }

    /// The bot the Profile form edits, as the host has it now.
    pub fn profile_bot(&self) -> Option<&raphie_core::contracts::BotProfile> {
        let id = self.profile.bot_id()?;
        self.model.bots.iter().find(|bot| bot.id == id)
    }

    /// Whether the Profile form may be saved now.
    pub fn can_save_profile(&self) -> bool {
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
        let (Some(bot_id), Some(update)) = (
            self.profile.bot_id().map(str::to_owned),
            self.profile.update(),
        ) else {
            return;
        };
        if self.model.begin_save_profile() {
            self.profile.message = None;
            self.command(Command::SaveProfile { bot_id, update });
        }
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

    /// Opens the form for a saved connection, with no key typed.
    pub fn edit_connection(&mut self, connection_id: &str, name: &str) {
        self.providers = ProvidersView {
            open: Some(ConnectionTarget::Edit(connection_id.to_owned())),
            name: TextEdit::new(name),
            ..ProvidersView::new()
        };
        self.model.connection_message = None;
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

    /// Leaves Settings for the conversation a memory came from.
    pub fn open_memory_source(&mut self, bot_id: &str, session_id: &str) {
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
        if let Some(latest) = self.profile_bot() {
            self.profile = ProfileDraft::of(latest);
        }
        self.model.profile_error = None;
    }

    /// After news from the host: a form with no edits follows the bot when
    /// it was saved elsewhere; a form with edits keeps them.
    fn follow_profile(&mut self) {
        let stale = self
            .profile_bot()
            .is_some_and(|latest| self.profile.changed_elsewhere(latest));
        if stale && !self.profile.is_dirty() && !self.model.saving_profile {
            let message = self.profile.message.take();
            self.discard_profile();
            self.profile.message = message;
        }
    }

    pub fn close_settings(&mut self) {
        self.screen = Screen::Workspace;
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
    let Some(client) = &ui.client else {
        return false;
    };
    let events = client.drain();
    // A search box has no "changed" handler, so each frame looks at it.
    let searched = ui.watch_memory_query(clock);
    if ui.memories.search_pending() {
        tx.wake_after(Duration::from_millis(300));
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
    receive(ui, events, tx) | ticked | searched
}

/// Applies what the engine reported; returns true when anything arrived.
/// Separate from `poll` so tests can deliver events without an engine.
pub fn receive(ui: &mut Ui, events: Vec<Event>, tx: &mut Tx) -> bool {
    if events.is_empty() {
        return false;
    }
    for event in events {
        for effect in ui.model.apply(event) {
            match effect {
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
                    // Show what was saved, at its new revision.
                    if ui.profile.bot_id() == Some(profile.id.as_str()) {
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
    true
}
