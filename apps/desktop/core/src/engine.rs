//! The engine: everything that waits on the network, off the UI thread.
//!
//! # Threads and ownership
//!
//! ```text
//!   UI thread                         engine (Tokio runtime, worker threads)
//!   ─────────                         ──────────────────────────────────────
//!   Client::send(Command) ──mpsc──▶   Engine::run loop ──spawns──▶ tasks
//!   Client::drain() ◀──────mpsc───   Emitter::emit(Event)  ◀──────┘
//!        ▲                                   │
//!        └──────── notify() (Rune's Waker) ──┘   "new events, run poll"
//! ```
//!
//! The UI never touches engine state and the engine never touches UI state;
//! they only exchange messages. That is why no `Mutex` is needed: the
//! [`Engine`] struct is owned by one async task, and tasks it spawns report
//! back through channels instead of sharing it. Rust's ownership rules turn
//! this into a compile-time guarantee: a task cannot hold `&mut Engine`,
//! because the run loop already owns it.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::de::DeserializeOwned;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Instant, sleep};

use crate::api::{ApiClient, ApiError, ChannelAnswer, bot_path};
use crate::attachments::{FileBytes, MAX_BYTES, TOO_LARGE, Upload, upload_name};
use crate::auth::{AccessToken, DevicePolicy, DevicePoll, Secret, TokenStore};
use crate::channels::{Channel, ChannelChange};
use crate::contracts::ApprovalMode;
use crate::contracts::ModelSelection;
use crate::contracts::NewBot;
use crate::contracts::SaveOwnerProfile;
use crate::contracts::{
    ApprovalStatus, BotProfile, ControlAction, Decision, Page, Scope, SessionObservation,
    SessionSummary, SubmitMessage, UpdateBotProfile,
};
use crate::contracts::{AskAnswer, AskStatus};
use crate::inbox::JobUpdates;
use crate::jobs::{JobAction, NewJob};
use crate::local_install;
use crate::mcp::{McpAction, NewMcpConnection};
use crate::memory::MemoryUpdate;
use crate::model::{AnswerOutcome, DecisionOutcome, Event, Reach, StreamStatus};
use crate::origin::Origin;
use crate::sandbox::SandboxUpdate;
use crate::settings::Settings;
use crate::sse::SseParser;
use crate::updates;
use crate::workspace::save_download;

/// Called after events are queued, from an engine thread. In the app this is
/// Rune's `Waker`, which schedules the UI's `poll`. Same shape as
/// `rune::Waker`, so the core does not need to depend on Rune.
pub type Notify = Arc<dyn Fn() + Send + Sync>;

/// What the owner asked for.
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    /// Sign in to `origin`: reuse a stored token, or start device sign-in.
    Connect {
        origin: Origin,
    },
    /// At launch: sign in with a stored token only. Without one, show the
    /// sign-in screen rather than starting a device code unprompted.
    Restore {
        origin: Origin,
    },
    CancelSignIn,
    /// Forget this device's token. The device stays listed in Settings →
    /// Account on the host until disconnected there.
    SignOut,
    /// Back to the sign-in screen to connect to another address, keeping
    /// this one's token so connecting to it again needs no new approval.
    ChangeAddress,
    /// Ask now whether the signed-in Raphie answers.
    CheckReach,
    SelectBot {
        bot_id: String,
    },
    /// Open a session, or `None` for a new conversation.
    SelectSession {
        session_id: Option<String>,
    },
    LoadMoreSessions {
        after: String,
    },
    /// Fetch the selected bot's archived sessions.
    LoadArchived,
    /// Archive one of the selected bot's sessions (`archived: true`), or
    /// bring it back.
    Archive {
        session_id: String,
        archived: bool,
    },
    LoadOlder {
        session_id: String,
        before: String,
    },
    /// Send a message. `attachments` are ids of files already uploaded
    /// with [`Command::Attach`].
    Send {
        text: String,
        attachments: Vec<String>,
        /// The model to start a new session with; `None` for the bot's
        /// default, and for a session that exists.
        model: Option<ModelSelection>,
        /// The command mode to start a new session with.
        approval_mode: Option<ApprovalMode>,
    },
    /// Ask what needs the owner beyond the conversation on screen: the
    /// first page of each of `session_bots`' conversations, and each of
    /// `job_bots`' undismissed job runs.
    LoadInbox {
        session_bots: Vec<String>,
        job_bots: Vec<String>,
    },
    /// Dismiss one job run from the notifications.
    AcknowledgeRun {
        bot_id: String,
        run_id: String,
    },
    /// Start signing a bot in to a subscription: a new connection, or
    /// `connection_id` renewed.
    StartProviderSignIn {
        bot_id: String,
        provider: String,
        name: String,
        connection_id: Option<String>,
    },
    /// Ask where a sign-in has got to.
    PollProviderSignIn {
        bot_id: String,
        id: String,
    },
    /// Answer a sign-in's question; the answer is secret.
    AnswerProviderSignIn {
        bot_id: String,
        id: String,
        prompt_id: String,
        value: Secret,
    },
    CancelProviderSignIn {
        bot_id: String,
        id: String,
    },
    /// Share that the owner has read `reply_count` of a session's replies.
    MarkRead {
        bot_id: String,
        session_id: String,
        reply_count: u32,
    },
    /// Fetch the picture of an image attachment, to preview it.
    LoadPreview {
        bot_id: String,
        id: String,
    },
    /// Ask GitHub whether a newer Raphie has been released. Works signed
    /// in or not: it does not involve the host.
    CheckForUpdates,
    /// Look for a Raphie installed for this user on this computer, at the
    /// port its installer saved. Works signed in or not.
    FindLocalInstall,
    /// Ask how a session treats commands.
    LoadApprovalMode {
        session_id: String,
    },
    /// Change how a session treats commands.
    SetApprovalMode {
        session_id: String,
        mode: ApprovalMode,
    },
    /// Change the model an existing session answers with.
    ChooseModel {
        session_id: String,
        model: ModelSelection,
    },
    /// Upload files to a bot, one after another, so they can go with the
    /// next message.
    Attach {
        bot_id: String,
        uploads: Vec<Upload>,
    },
    /// Save one uploaded file to this machine's Downloads folder.
    DownloadAttachment {
        bot_id: String,
        id: String,
        name: String,
    },
    Decide {
        approval_id: String,
        decision: Decision,
        scope: Scope,
    },
    /// Answer a bot's question.
    Answer {
        ask_id: String,
        answer: AskAnswer,
    },
    /// Fetch the bot list again, to notice changes made in another client.
    RefreshBots,
    /// Save a bot's name, description, colour and personality.
    SaveProfile {
        bot_id: String,
        update: UpdateBotProfile,
    },
    /// Load a bot's model connections and models.
    LoadSettings {
        bot_id: String,
    },
    /// Make a model the default for a bot's new sessions.
    SetDefaultModel {
        bot_id: String,
        model_id: String,
        connection_id: String,
    },
    /// Add, rename, re-key, remove or try a provider connection.
    ChangeConnection {
        bot_id: String,
        change: ConnectionChange,
    },
    /// Load a bot's memory settings.
    LoadMemory {
        bot_id: String,
    },
    /// Save a bot's memory settings.
    SaveMemory {
        bot_id: String,
        update: MemoryUpdate,
    },
    /// Ask the runtime to reach the bot's saved memory back end.
    TestMemory {
        bot_id: String,
    },
    /// Load the saved versions of a bot's profile.
    LoadBotHistory {
        bot_id: String,
    },
    /// Create a bot.
    CreateBot {
        bot: NewBot,
    },
    /// Delete a bot and everything the runtime keeps for it. `name` and
    /// `revision` are the bot as the owner confirmed it.
    DeleteBot {
        bot_id: String,
        name: String,
        revision: u32,
    },
    /// Load who every bot is talking to.
    LoadOwner,
    /// Save who every bot is talking to.
    SaveOwner {
        owner: SaveOwnerProfile,
    },
    /// Load a bot's sandbox settings, provider, limits and usage.
    LoadSandbox {
        bot_id: String,
    },
    /// Save a bot's sandbox settings.
    SaveSandbox {
        bot_id: String,
        update: SandboxUpdate,
    },
    /// Load exported traces from a bot's last `hours` hours (1, 6 or 24).
    LoadTraces {
        bot_id: String,
        hours: u8,
    },
    /// Load a bot's most recent durable events.
    LoadBotActivity {
        bot_id: String,
    },
    /// Switch the runtime's trace collection on or off.
    SetTelemetry {
        bot_id: String,
        enabled: bool,
    },
    /// Write an export to this machine's Downloads folder. `name` is what
    /// to call the file; `contents` is its text.
    SaveExport {
        name: String,
        contents: String,
    },
    /// Load a bot's handoffs and the bots it can hand tasks to.
    LoadHandoffs {
        bot_id: String,
    },
    /// Stop the other bot's work on one of a bot's handoffs.
    CancelHandoff {
        bot_id: String,
        id: String,
    },
    /// Load a bot's scheduled jobs.
    LoadJobs {
        bot_id: String,
    },
    /// Schedule a job.
    AddJob {
        bot_id: String,
        job: NewJob,
    },
    /// Resume, pause, remove or run one job.
    ChangeJob {
        bot_id: String,
        id: String,
        action: JobAction,
    },
    /// Load a page of job runs: every job's, or only `job_id`'s; the
    /// newest, or the page after the cursor `before`. `ticket` comes from
    /// `RunHistory::begin_load` and returns with the answer.
    LoadJobRuns {
        bot_id: String,
        job_id: Option<String>,
        before: Option<String>,
        ticket: u64,
    },
    /// Load what one folder of a bot's workspace holds.
    LoadWorkspaceFiles {
        bot_id: String,
        path: String,
    },
    /// Save one workspace file to this machine's Downloads folder. `name`
    /// is what to call it; `revision` is the listing it was chosen from.
    DownloadWorkspaceFile {
        bot_id: String,
        path: String,
        name: String,
        revision: u64,
    },
    /// Load a bot's Discord and Telegram connections.
    LoadChannels {
        bot_id: String,
    },
    /// Load where a bot's scheduled results go.
    LoadChannelHome {
        bot_id: String,
    },
    /// Make one change to a bot's channels.
    ChangeChannel {
        bot_id: String,
        change: ChannelChange,
    },
    /// Load a bot's connections to MCP servers.
    LoadMcp {
        bot_id: String,
    },
    /// Add a connection to an MCP server.
    AddMcp {
        bot_id: String,
        connection: NewMcpConnection,
    },
    /// Enable, pause, remove or import one MCP connection.
    ChangeMcp {
        bot_id: String,
        id: String,
        action: McpAction,
    },
    /// Load a page of a bot's saved memories: the first, or the one after
    /// the cursor `after`. `ticket` comes from `MemoryBrowser::begin_load`
    /// and returns with the answer.
    BrowseMemory {
        bot_id: String,
        after: Option<String>,
        ticket: u64,
    },
    /// Search a bot's saved memories.
    SearchMemory {
        bot_id: String,
        query: String,
        ticket: u64,
    },
    /// Replace what one memory says.
    ReviseMemory {
        bot_id: String,
        id: String,
        content: String,
    },
    /// Remove one memory from what the bot remembers.
    ForgetMemory {
        bot_id: String,
        id: String,
    },
    /// Stop a session's run, or steer or re-queue one of its queued messages.
    Control {
        session_id: String,
        action: ControlAction,
        turn_id: Option<String>,
    },
}

/// What to do to a bot's provider connections.
#[derive(Clone, Debug, PartialEq)]
pub enum ConnectionChange {
    Add {
        provider: String,
        name: String,
        key: Secret,
    },
    Edit {
        id: String,
        name: String,
        /// `None` keeps the saved key.
        key: Option<Secret>,
    },
    Remove {
        id: String,
        name: String,
    },
    /// Try a saved connection (`id`), or a key not saved yet.
    Test {
        id: Option<String>,
        key: Option<Secret>,
    },
}

/// Timings, adjustable so tests run in milliseconds.
#[derive(Clone, Debug)]
pub struct EngineConfig {
    pub device: DevicePolicy,
    /// First and largest wait before reconnecting a dropped event stream.
    pub reconnect_min: Duration,
    pub reconnect_max: Duration,
    /// Waits between attempts to send a message that met a network error.
    pub send_retries: Vec<Duration>,
    /// Where to remember the last origin; `None` remembers nothing.
    pub settings_path: Option<PathBuf>,
    /// Where downloaded workspace files are saved; `None` saves nothing.
    pub downloads: Option<PathBuf>,
    /// The list of releases to check for updates; `None` checks nothing.
    pub releases_url: Option<String>,
    /// Where a local installation saved its ports
    /// ([`local_install::ports_file`]); `None` looks at the default port.
    pub local_ports_file: Option<PathBuf>,
    /// How often a signed-in app checks that Raphie still answers.
    pub reach_every: Duration,
}

impl Default for EngineConfig {
    fn default() -> EngineConfig {
        EngineConfig {
            device: DevicePolicy::default(),
            reconnect_min: Duration::from_secs(1),
            reconnect_max: Duration::from_secs(15),
            send_retries: vec![Duration::from_secs(1), Duration::from_secs(3)],
            settings_path: Settings::default_path(),
            downloads: dirs::download_dir(),
            releases_url: Some(updates::RELEASES_URL.to_owned()),
            local_ports_file: local_install::ports_file(),
            reach_every: Duration::from_secs(10),
        }
    }
}

/// The UI's handle on a running engine.
pub struct Client {
    inbox: mpsc::UnboundedSender<Input>,
    events: std_mpsc::Receiver<Event>,
    // `Option` so `Drop` can take the runtime out and shut it down.
    runtime: Option<tokio::runtime::Runtime>,
}

impl Client {
    /// Starts the engine on its own Tokio runtime. `notify` runs (on an engine
    /// thread) whenever new events are ready for [`Client::drain`].
    pub fn start(store: Arc<dyn TokenStore>, config: EngineConfig, notify: Notify) -> Client {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("raphie-engine")
            .enable_all()
            .build()
            .expect("the engine's runtime starts");
        let (inbox, commands) = mpsc::unbounded_channel();
        let (events_tx, events) = std_mpsc::channel();
        let engine = Engine {
            store,
            config,
            emit: Emitter {
                events: events_tx,
                notify,
            },
            inbox: inbox.clone(),
            api: None,
            bot_id: None,
            session_id: None,
            sign_in: None,
            sessions_stream: None,
            session_stream: None,
            reach: None,
        };
        runtime.spawn(engine.run(commands));
        Client {
            inbox,
            events,
            runtime: Some(runtime),
        }
    }

    /// Queues a command. Never blocks.
    pub fn send(&self, command: Command) {
        // Fails only after the engine stopped, when there is no one to tell.
        let _ = self.inbox.send(Input::Command(command));
    }

    /// Takes every event that arrived since the last call. Never blocks.
    pub fn drain(&self) -> Vec<Event> {
        self.events.try_iter().collect()
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // Stop the engine's tasks without waiting for open streams to end.
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

/// The engine's inbox: the owner's commands plus results from its own tasks.
enum Input {
    Command(Command),
    Authorized {
        api: ApiClient,
    },
    SessionCreated {
        bot_id: String,
        session_id: String,
    },
    /// A request came back 401: the token is no longer valid.
    Expired,
}

/// Sends events to the UI and wakes it. Cloned into every task.
#[derive(Clone)]
struct Emitter {
    events: std_mpsc::Sender<Event>,
    notify: Notify,
}

impl Emitter {
    fn emit(&self, event: Event) {
        if self.events.send(event).is_ok() {
            (self.notify)();
        }
    }
}

/// A spawned task that is cancelled when this value is dropped or replaced.
///
/// Tokio does not cancel a task when its `JoinHandle` is dropped, so this
/// wrapper does (RAII: cleanup tied to a value's lifetime). Assigning a new
/// What a sign-in command asks of the runtime.
enum SignInStep {
    Start {
        provider: String,
        name: String,
        connection_id: Option<String>,
    },
    Poll {
        id: String,
    },
    Answer {
        id: String,
        prompt_id: String,
        value: Secret,
    },
    Cancel {
        id: String,
    },
}

/// `Task` to a field drops the old one, which aborts the old stream.
struct Task(JoinHandle<()>);

impl Task {
    fn spawn(future: impl Future<Output = ()> + Send + 'static) -> Task {
        Task(tokio::spawn(future))
    }
}

impl Drop for Task {
    fn drop(&mut self) {
        self.0.abort();
    }
}

struct Engine {
    store: Arc<dyn TokenStore>,
    config: EngineConfig,
    emit: Emitter,
    inbox: mpsc::UnboundedSender<Input>,
    /// Present while signed in.
    api: Option<ApiClient>,
    bot_id: Option<String>,
    session_id: Option<String>,
    sign_in: Option<Task>,
    sessions_stream: Option<Task>,
    session_stream: Option<Task>,
    /// Checks, while signed in, that Raphie still answers.
    reach: Option<Task>,
}

impl Engine {
    async fn run(mut self, mut inbox: mpsc::UnboundedReceiver<Input>) {
        // Each input is handled quickly; anything slow is spawned as a task,
        // so the loop is always ready for the next command.
        while let Some(input) = inbox.recv().await {
            match input {
                Input::Command(command) => self.command(command),
                Input::Authorized { api } => self.authorized(api),
                Input::SessionCreated { bot_id, session_id } => {
                    if self.bot_id.as_deref() == Some(bot_id.as_str()) && self.session_id.is_none()
                    {
                        self.open_session(Some(session_id.clone()));
                        self.emit.emit(Event::SessionCreated { bot_id, session_id });
                    }
                }
                Input::Expired => {
                    if let Some(api) = self.api.take() {
                        self.sign_out(api.origin().clone(), Some(signed_out_notice()));
                    }
                }
            }
        }
    }

    fn command(&mut self, command: Command) {
        match command {
            Command::Connect { origin } => self.connect(origin, false),
            Command::Restore { origin } => self.connect(origin, true),
            Command::CancelSignIn => {
                self.sign_in = None;
                self.emit.emit(Event::SignedOut { notice: None });
            }
            Command::SignOut => {
                if let Some(api) = self.api.take() {
                    self.sign_out(api.origin().clone(), None);
                }
            }
            Command::ChangeAddress => {
                if self.api.take().is_some() {
                    self.leave_host();
                    self.emit.emit(Event::SignedOut { notice: None });
                }
            }
            Command::CheckReach => self.check_reach(),
            Command::SelectBot { bot_id } => self.select_bot(bot_id),
            Command::SelectSession { session_id } => self.open_session(session_id),
            Command::LoadMoreSessions { after } => self.load_more_sessions(after),
            Command::LoadArchived => self.load_archived(),
            Command::Archive {
                session_id,
                archived,
            } => self.archive(session_id, archived),
            Command::LoadOlder { session_id, before } => self.load_older(session_id, before),
            Command::Send {
                text,
                attachments,
                model,
                approval_mode,
            } => self.send(text, attachments, model, approval_mode),
            Command::LoadInbox {
                session_bots,
                job_bots,
            } => self.load_inbox(session_bots, job_bots),
            Command::AcknowledgeRun { bot_id, run_id } => self.acknowledge_run(bot_id, run_id),
            Command::CheckForUpdates => self.check_for_updates(),
            Command::FindLocalInstall => self.find_local_install(),
            Command::LoadPreview { bot_id, id } => self.load_preview(bot_id, id),
            Command::StartProviderSignIn {
                bot_id,
                provider,
                name,
                connection_id,
            } => self.provider_sign_in(
                bot_id,
                SignInStep::Start {
                    provider,
                    name,
                    connection_id,
                },
            ),
            Command::PollProviderSignIn { bot_id, id } => {
                self.provider_sign_in(bot_id, SignInStep::Poll { id })
            }
            Command::AnswerProviderSignIn {
                bot_id,
                id,
                prompt_id,
                value,
            } => self.provider_sign_in(
                bot_id,
                SignInStep::Answer {
                    id,
                    prompt_id,
                    value,
                },
            ),
            Command::CancelProviderSignIn { bot_id, id } => {
                self.provider_sign_in(bot_id, SignInStep::Cancel { id });
            }
            Command::MarkRead {
                bot_id,
                session_id,
                reply_count,
            } => self.mark_read(bot_id, session_id, reply_count),
            Command::LoadApprovalMode { session_id } => self.load_approval_mode(session_id),
            Command::SetApprovalMode { session_id, mode } => {
                self.set_approval_mode(session_id, mode);
            }
            Command::ChooseModel { session_id, model } => self.choose_model(session_id, model),
            Command::Attach { bot_id, uploads } => self.attach(bot_id, uploads),
            Command::DownloadAttachment { bot_id, id, name } => {
                self.download_attachment(bot_id, id, name);
            }
            Command::Decide {
                approval_id,
                decision,
                scope,
            } => self.decide(approval_id, decision, scope),
            Command::Answer { ask_id, answer } => self.answer(ask_id, answer),
            Command::Control {
                session_id,
                action,
                turn_id,
            } => self.control(session_id, action, turn_id),
            Command::RefreshBots => self.refresh_bots(),
            Command::ChangeConnection { bot_id, change } => self.change_connection(bot_id, change),
            Command::LoadSettings { bot_id } => self.load_settings(bot_id),
            Command::LoadMemory { bot_id } => self.load_memory(bot_id),
            Command::SaveMemory { bot_id, update } => self.save_memory(bot_id, update),
            Command::TestMemory { bot_id } => self.test_memory(bot_id),
            Command::LoadBotHistory { bot_id } => self.load_bot_history(bot_id),
            Command::CreateBot { bot } => self.create_bot(bot),
            Command::DeleteBot {
                bot_id,
                name,
                revision,
            } => self.delete_bot(bot_id, name, revision),
            Command::LoadOwner => self.load_owner(),
            Command::SaveOwner { owner } => self.save_owner(owner),
            Command::LoadSandbox { bot_id } => self.load_sandbox(bot_id),
            Command::SaveSandbox { bot_id, update } => self.save_sandbox(bot_id, update),
            Command::LoadTraces { bot_id, hours } => self.load_traces(bot_id, hours),
            Command::LoadBotActivity { bot_id } => self.load_bot_activity(bot_id),
            Command::SetTelemetry { bot_id, enabled } => self.set_telemetry(bot_id, enabled),
            Command::SaveExport { name, contents } => self.save_export(name, contents),
            Command::LoadHandoffs { bot_id } => self.load_handoffs(bot_id),
            Command::CancelHandoff { bot_id, id } => self.cancel_handoff(bot_id, id),
            Command::LoadJobs { bot_id } => self.load_jobs(bot_id),
            Command::AddJob { bot_id, job } => self.add_job(bot_id, job),
            Command::ChangeJob { bot_id, id, action } => self.change_job(bot_id, id, action),
            Command::LoadJobRuns {
                bot_id,
                job_id,
                before,
                ticket,
            } => self.load_job_runs(bot_id, job_id, before, ticket),
            Command::LoadWorkspaceFiles { bot_id, path } => self.load_workspace_files(bot_id, path),
            Command::DownloadWorkspaceFile {
                bot_id,
                path,
                name,
                revision,
            } => self.download_workspace_file(bot_id, path, name, revision),
            Command::LoadChannels { bot_id } => self.load_channels(bot_id),
            Command::LoadChannelHome { bot_id } => self.load_channel_home(bot_id),
            Command::ChangeChannel { bot_id, change } => self.change_channel(bot_id, change),
            Command::LoadMcp { bot_id } => self.load_mcp(bot_id),
            Command::AddMcp { bot_id, connection } => self.add_mcp(bot_id, connection),
            Command::ChangeMcp { bot_id, id, action } => self.change_mcp(bot_id, id, action),
            Command::BrowseMemory {
                bot_id,
                after,
                ticket,
            } => self.browse_memory(bot_id, after, ticket),
            Command::SearchMemory {
                bot_id,
                query,
                ticket,
            } => self.search_memory(bot_id, query, ticket),
            Command::ReviseMemory {
                bot_id,
                id,
                content,
            } => self.change_memory(bot_id, id, Some(content)),
            Command::ForgetMemory { bot_id, id } => self.change_memory(bot_id, id, None),
            Command::SetDefaultModel {
                bot_id,
                model_id,
                connection_id,
            } => self.set_default_model(bot_id, model_id, connection_id),
            Command::SaveProfile { bot_id, update } => self.save_profile(bot_id, update),
        }
    }

    // ----- Signing in and out -----

    fn connect(&mut self, origin: Origin, restore_only: bool) {
        // Starting over: drop the old session's streams and any sign-in.
        self.api = None;
        self.sessions_stream = None;
        self.session_stream = None;
        self.emit.emit(Event::Connecting {
            origin: origin.clone(),
        });
        let api = match ApiClient::new(origin) {
            Ok(api) => api,
            Err(error) => {
                self.emit.emit(Event::SignedOut {
                    notice: Some(error.to_string()),
                });
                return;
            }
        };
        let store = self.store.clone();
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        let policy = self.config.device;
        self.sign_in = Some(Task::spawn(async move {
            match sign_in(api, store, policy, restore_only, &emit).await {
                Ok(Some(api)) => {
                    let _ = inbox.send(Input::Authorized { api });
                }
                Ok(None) => emit.emit(Event::SignedOut { notice: None }),
                Err(message) => emit.emit(Event::SignedOut {
                    notice: Some(message),
                }),
            }
        }));
    }

    fn authorized(&mut self, api: ApiClient) {
        self.sign_in = None;
        if let Some(path) = &self.config.settings_path {
            // Change only the origin: the file also holds the appearance.
            let mut settings = Settings::load(path);
            settings.origin = Some(api.origin().as_str().to_owned());
            // Remembering the origin is a convenience; failing to is harmless.
            let _ = settings.save(path);
        }
        self.emit.emit(Event::SignedIn {
            origin: api.origin().clone(),
        });
        self.api = Some(api.clone());
        self.bot_id = None;
        self.session_id = None;
        self.watch_reach(api.clone());
        tell_host_version(&self.emit, &api);
        // Who is signed in, for Settings → Account. Nothing depends on it, so
        // a failure only leaves the name out.
        let emit = self.emit.clone();
        let account_api = api.clone();
        tokio::spawn(async move {
            if let Ok(account) = account_api.account().await {
                emit.emit(Event::Account(account));
            }
        });
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        // Load the bots, then select the default one through the inbox so the
        // selection happens on the engine loop like any other.
        tokio::spawn(async move {
            match api.bots().await {
                Ok(bots) => {
                    let first = default_bot(&bots);
                    emit.emit(Event::Bots(bots));
                    if let Some(bot_id) = first {
                        let _ = inbox.send(Input::Command(Command::SelectBot { bot_id }));
                    }
                }
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::Problem(error.to_string())),
            }
        });
    }

    /// Stops everything that talks to the signed-in host.
    fn leave_host(&mut self) {
        self.sign_in = None;
        self.sessions_stream = None;
        self.session_stream = None;
        self.reach = None;
        self.bot_id = None;
        self.session_id = None;
    }

    fn sign_out(&mut self, origin: Origin, notice: Option<String>) {
        self.leave_host();
        let store = self.store.clone();
        let emit = self.emit.clone();
        tokio::spawn(async move {
            // The credential store is a blocking OS call: run it on Tokio's
            // blocking pool so it cannot stall the async worker threads.
            let deleted = tokio::task::spawn_blocking(move || store.delete(&origin)).await;
            let notice = match deleted {
                Ok(Err(error)) => Some(error.to_string()),
                _ => notice,
            };
            emit.emit(Event::SignedOut { notice });
        });
    }

    // ----- Whether Raphie answers -----

    /// Checks every `reach_every` that Raphie still answers, and reports
    /// when that changes.
    fn watch_reach(&mut self, api: ApiClient) {
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        let every = self.config.reach_every;
        self.reach = Some(Task::spawn(async move {
            let mut last = Reach::Up;
            loop {
                sleep(every).await;
                let Some(reach) = reach_of(api.reach().await) else {
                    let _ = inbox.send(Input::Expired);
                    return;
                };
                if reach != last {
                    // Back after a stop: perhaps updated meanwhile.
                    if reach == Reach::Up {
                        tell_host_version(&emit, &api);
                    }
                    last = reach.clone();
                    emit.emit(Event::Reach(reach));
                }
            }
        }));
    }

    fn check_reach(&mut self) {
        let Some(api) = self.api.clone() else { return };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match reach_of(api.reach().await) {
                Some(reach) => {
                    if reach == Reach::Up {
                        tell_host_version(&emit, &api);
                    }
                    emit.emit(Event::Reach(reach));
                }
                None => {
                    let _ = inbox.send(Input::Expired);
                }
            }
        });
    }

    // ----- Bots and sessions -----

    fn select_bot(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else { return };
        self.bot_id = Some(bot_id.clone());
        self.session_id = None;
        self.session_stream = None;
        self.emit.emit(Event::BotSelected {
            bot_id: bot_id.clone(),
        });
        let path = bot_path(&bot_id, "/api/sessions/events");
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        let config = self.config.clone();
        self.sessions_stream = Some(Task::spawn(async move {
            follow::<Page<SessionSummary>>(&api, &path, &config, &inbox, &emit, |page| {
                Event::Sessions {
                    bot_id: bot_id.clone(),
                    page,
                    more: false,
                }
            })
            .await;
        }));
    }

    fn load_more_sessions(&mut self, after: String) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.sessions(&bot_id, Some(&after)).await {
                Ok(page) => emit.emit(Event::Sessions {
                    bot_id,
                    page,
                    more: true,
                }),
                Err(error) => report(error, &inbox, &emit),
            }
        });
    }

    fn load_archived(&mut self) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            fetch_archived(&api, bot_id, &inbox, &emit).await;
        });
    }

    /// Archives a session or brings it back. The live list follows on its
    /// own stream; the archived list is fetched again.
    fn archive(&mut self, session_id: String, archived: bool) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.archive(&bot_id, &session_id, archived).await {
                Ok(archived) => {
                    emit.emit(Event::Archived {
                        bot_id: bot_id.clone(),
                        session_id,
                        archived_at: archived.then(now_ms),
                    });
                    fetch_archived(&api, bot_id, &inbox, &emit).await;
                }
                Err(error) => report(error, &inbox, &emit),
            }
        });
    }

    fn open_session(&mut self, session_id: Option<String>) {
        self.session_id = session_id.clone();
        self.session_stream = None;
        let (Some(api), Some(bot_id), Some(session_id)) =
            (self.api.clone(), self.bot_id.clone(), session_id)
        else {
            return;
        };
        let path = bot_path(&bot_id, &format!("/api/sessions/{session_id}/events"));
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        let config = self.config.clone();
        self.session_stream = Some(Task::spawn(async move {
            follow::<SessionObservation>(&api, &path, &config, &inbox, &emit, |observation| {
                Event::Observation {
                    session_id: session_id.clone(),
                    observation: Box::new(observation),
                }
            })
            .await;
        }));
    }

    fn load_older(&mut self, session_id: String, before: String) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.history(&bot_id, &session_id, &before).await {
                Ok(page) => emit.emit(Event::OlderTurns { session_id, page }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::OlderFailed {
                    session_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    // ----- Messages and approvals -----

    fn send(
        &mut self,
        text: String,
        attachments: Vec<String>,
        model: Option<ModelSelection>,
        approval_mode: Option<ApprovalMode>,
    ) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            self.emit.emit(Event::MessageFailed {
                message: "Choose a bot before sending.".into(),
            });
            return;
        };
        let message = SubmitMessage {
            text,
            // One id per message, reused on retry: the runtime admits it once.
            event_id: uuid::Uuid::new_v4().to_string(),
            session_id: self.session_id.clone(),
            attachments,
            // Only a new session takes its model and command mode from
            // the message. `filter` keeps a value only when the test holds.
            model: model.filter(|_| self.session_id.is_none()),
            approval_mode: approval_mode.filter(|_| self.session_id.is_none()),
        };
        let new_session = message.session_id.is_none();
        let retries = self.config.send_retries.clone();
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let mut waits = retries.into_iter();
            let result = loop {
                match api.submit(&bot_id, &message).await {
                    Err(error) if error.is_transient() => match waits.next() {
                        Some(wait) => sleep(wait).await,
                        None => break Err(error),
                    },
                    other => break other,
                }
            };
            match result {
                Ok(receipt) => {
                    if new_session {
                        let _ = inbox.send(Input::SessionCreated {
                            bot_id,
                            session_id: receipt.session_id.clone(),
                        });
                    }
                    emit.emit(Event::MessageAccepted { receipt });
                }
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::MessageFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn load_inbox(&mut self, session_bots: Vec<String>, job_bots: Vec<String>) {
        let Some(api) = self.api.clone() else {
            return;
        };
        // One task per request, so a slow bot does not hold up the rest.
        for bot_id in session_bots {
            let (api, emit, inbox) = (api.clone(), self.emit.clone(), self.inbox.clone());
            tokio::spawn(async move {
                match api.sessions(&bot_id, None).await {
                    Ok(page) => emit.emit(Event::InboxSessions {
                        bot_id,
                        sessions: page.items,
                    }),
                    Err(ApiError::Unauthenticated) => {
                        let _ = inbox.send(Input::Expired);
                    }
                    // A missed round keeps what was known; the next one
                    // asks again.
                    Err(_) => {}
                }
            });
        }
        for bot_id in job_bots {
            let (api, emit, inbox) = (api.clone(), self.emit.clone(), self.inbox.clone());
            tokio::spawn(async move {
                match api.job_notifications(&bot_id).await {
                    Ok(page) => emit.emit(Event::JobUpdates {
                        bot_id,
                        updates: JobUpdates {
                            // An older runtime sends no total: count what came.
                            total: page.total.unwrap_or(page.items.len()),
                            more: page.next.is_some(),
                            runs: page.items,
                        },
                    }),
                    Err(ApiError::Unauthenticated) => {
                        let _ = inbox.send(Input::Expired);
                    }
                    Err(_) => emit.emit(Event::JobUpdatesFailed { bot_id }),
                }
            });
        }
    }

    fn acknowledge_run(&mut self, bot_id: String, run_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.acknowledge_run(&bot_id, &run_id).await {
                Ok(()) => emit.emit(Event::RunAcknowledged { bot_id, run_id }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(_) => emit.emit(Event::RunAcknowledgeFailed),
            }
        });
    }

    /// One step of a subscription sign-in; the answer reports where it is.
    fn provider_sign_in(&mut self, bot_id: String, step: SignInStep) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let answer = match &step {
                SignInStep::Start {
                    provider,
                    name,
                    connection_id,
                } => {
                    api.start_sign_in(&bot_id, provider, name, connection_id.as_deref())
                        .await
                }
                SignInStep::Poll { id } => api.sign_in(&bot_id, id).await,
                SignInStep::Answer {
                    id,
                    prompt_id,
                    value,
                } => api.answer_sign_in(&bot_id, id, prompt_id, value).await,
                SignInStep::Cancel { id } => api.cancel_sign_in(&bot_id, id).await,
            };
            match answer {
                Ok(sign_in) => emit.emit(Event::ProviderSignIn { bot_id, sign_in }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                // A poll that fails is tried again on the next tick.
                Err(_) if matches!(step, SignInStep::Poll { .. }) => {}
                Err(error) => emit.emit(Event::ProviderSignInFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn mark_read(&mut self, bot_id: String, session_id: String, reply_count: u32) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            // A failure is harmless: this computer's own record still has
            // it, and the next read sends again.
            if let Err(ApiError::Unauthenticated) =
                api.mark_read(&bot_id, &session_id, reply_count).await
            {
                let _ = inbox.send(Input::Expired);
            }
        });
    }

    fn load_preview(&mut self, bot_id: String, id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.download_attachment(&bot_id, &id).await {
                Ok(bytes) => emit.emit(Event::PreviewLoaded {
                    bot_id,
                    id,
                    bytes: bytes.into(),
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(_) => emit.emit(Event::PreviewFailed { bot_id, id }),
            }
        });
    }

    fn check_for_updates(&mut self) {
        // About shows the signed-in Raphie's version beside this app's,
        // so look at both again.
        if let Some(api) = &self.api {
            tell_host_version(&self.emit, api);
        }
        let emit = self.emit.clone();
        let Some(url) = self.config.releases_url.clone() else {
            emit.emit(Event::UpdateChecked(Err(
                "Update checks are off in this build.".into(),
            )));
            return;
        };
        tokio::spawn(async move {
            emit.emit(Event::UpdateChecked(updates::check(&url).await));
        });
    }

    fn find_local_install(&mut self) {
        let emit = self.emit.clone();
        let origin = local_install::origin_at(self.config.local_ports_file.as_deref());
        tokio::spawn(async move {
            let found = local_install::answers(&origin).await;
            emit.emit(Event::LocalInstall(found.then_some(origin)));
        });
    }

    fn load_approval_mode(&mut self, session_id: String) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.approval_mode(&bot_id, &session_id).await {
                Ok(mode) => emit.emit(Event::ApprovalMode { session_id, mode }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(_) => emit.emit(Event::ApprovalModeFailed { session_id }),
            }
        });
    }

    fn set_approval_mode(&mut self, session_id: String, mode: ApprovalMode) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.set_approval_mode(&bot_id, &session_id, mode).await {
                // The runtime's answer is the mode now in force.
                Ok(mode) => emit.emit(Event::ApprovalModeSaved { session_id, mode }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(_) => emit.emit(Event::ApprovalModeSaveFailed { session_id }),
            }
        });
    }

    fn choose_model(&mut self, session_id: String, model: ModelSelection) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.choose_model(&bot_id, &session_id, &model).await {
                Ok(()) => emit.emit(Event::ModelChosen { session_id, model }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::ModelChoiceFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn attach(&mut self, bot_id: String, uploads: Vec<Upload>) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            // Whatever happens, the last event says the uploads are over,
            // so the composer never waits forever.
            let outcome = upload_all(&api, &bot_id, uploads, &emit).await;
            let failed = |message: String| {
                emit.emit(Event::AttachFailed {
                    bot_id: bot_id.clone(),
                    message,
                });
            };
            match outcome {
                Ok(()) => {}
                Err(AttachStop::Api(ApiError::Unauthenticated)) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(AttachStop::Api(error)) => failed(error.to_string()),
                Err(AttachStop::Refused(message)) => failed(message),
            }
            emit.emit(Event::AttachFinished { bot_id });
        });
    }

    fn download_attachment(&mut self, bot_id: String, id: String, name: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        let folder = self.config.downloads.clone();
        tokio::spawn(async move {
            let failed = |message: String| emit.emit(Event::AttachmentSaveFailed { message });
            let Some(folder) = folder else {
                failed("This machine has no Downloads folder to save to.".into());
                return;
            };
            let bytes = match api.download_attachment(&bot_id, &id).await {
                Ok(bytes) => bytes,
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                    return;
                }
                Err(error) => {
                    failed(error.to_string());
                    return;
                }
            };
            let written =
                tokio::task::spawn_blocking(move || save_download(&folder, &name, &bytes)).await;
            match written {
                Ok(Ok(saved)) => {
                    let saved_as = saved
                        .file_name()
                        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
                    emit.emit(Event::AttachmentSaved { saved_as });
                }
                Ok(Err(error)) => failed(format!("Could not save the file: {error}.")),
                Err(_) => failed("Could not save the file.".into()),
            }
        });
    }

    fn decide(&mut self, approval_id: String, decision: Decision, scope: Scope) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let outcome = match api.decide(&bot_id, &approval_id, decision, scope).await {
                Ok(status) => decision_outcome(decision, status),
                Err(ApiError::NotFound(_)) => DecisionOutcome::Gone,
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                    return;
                }
                Err(error) => DecisionOutcome::Failed(error.to_string()),
            };
            emit.emit(Event::Decided {
                approval_id,
                outcome,
            });
        });
    }

    fn answer(&mut self, ask_id: String, answer: AskAnswer) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let outcome = match api.answer(&bot_id, &ask_id, &answer).await {
                Ok(AskStatus::Answered) => AnswerOutcome::Applied,
                Ok(_) => AnswerOutcome::Late,
                Err(ApiError::NotFound(_)) => AnswerOutcome::Gone,
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                    return;
                }
                Err(error) => AnswerOutcome::Failed(error.to_string()),
            };
            emit.emit(Event::Answered { ask_id, outcome });
        });
    }

    fn load_settings(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.settings(&bot_id).await {
                Ok(settings) => emit.emit(Event::BotSettings {
                    bot_id,
                    settings: Box::new(settings),
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::BotSettingsFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn set_default_model(&mut self, bot_id: String, model_id: String, connection_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api
                .set_default_model(&bot_id, &model_id, &connection_id)
                .await
            {
                Ok(settings) => emit.emit(Event::DefaultModelSet {
                    bot_id,
                    settings: Box::new(settings),
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::DefaultModelFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn change_connection(&mut self, bot_id: String, change: ConnectionChange) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            // Every change but a test answers with the settings afterwards.
            let outcome = match &change {
                ConnectionChange::Add {
                    provider,
                    name,
                    key,
                } => api
                    .add_connection(&bot_id, provider, name, key)
                    .await
                    .map(|settings| (Some(settings), "Connection added.".to_owned())),
                ConnectionChange::Edit { id, name, key } => api
                    .edit_connection(&bot_id, id, name, key.as_ref())
                    .await
                    .map(|settings| (Some(settings), "Connection saved.".to_owned())),
                ConnectionChange::Remove { id, name } => {
                    api.remove_connection(&bot_id, id).await.map(|settings| {
                        (
                            Some(settings),
                            format!("{name} removed. Other connections are unchanged."),
                        )
                    })
                }
                ConnectionChange::Test { id, key } => api
                    .test_connection(&bot_id, id.as_deref(), key.as_ref())
                    .await
                    .map(|()| (None, "Connection successful.".to_owned())),
            };
            match outcome {
                Ok((settings, message)) => emit.emit(Event::ConnectionChanged {
                    bot_id,
                    settings: settings.map(Box::new),
                    message,
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::ConnectionFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn load_memory(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.memory(&bot_id).await {
                Ok(status) => emit.emit(Event::Memory { bot_id, status }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::MemoryFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn save_memory(&mut self, bot_id: String, update: MemoryUpdate) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.save_memory(&bot_id, &update).await {
                Ok(status) => emit.emit(Event::MemorySaved { bot_id, status }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::MemorySaveFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn test_memory(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            // Either way the owner gets one line saying how it went.
            let message = match api.test_memory(&bot_id).await {
                Ok(()) => "Connection successful.".to_owned(),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                    return;
                }
                Err(error) => error.to_string(),
            };
            emit.emit(Event::MemoryTested { message });
        });
    }

    fn load_bot_history(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.bot_history(&bot_id).await {
                Ok(items) => emit.emit(Event::BotHistory { bot_id, items }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::BotHistoryFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn create_bot(&mut self, bot: NewBot) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.create_bot(&bot).await {
                Ok(profile) => {
                    emit.emit(Event::BotCreated(profile));
                    // The list as the host has it now, in its order.
                    if let Ok(bots) = api.bots().await {
                        emit.emit(Event::Bots(bots));
                    }
                }
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::BotCreateFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn delete_bot(&mut self, bot_id: String, name: String, revision: u32) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.delete_bot(&bot_id, &name, revision).await {
                Ok(()) => emit.emit(Event::BotDeleted { bot_id }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => {
                    // The bot may have changed elsewhere: read the list so
                    // the page shows it as it is now.
                    if let Ok(bots) = api.bots().await {
                        emit.emit(Event::Bots(bots));
                    }
                    emit.emit(Event::BotDeleteFailed {
                        message: error.to_string(),
                    });
                }
            }
        });
    }

    fn load_owner(&mut self) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.owner().await {
                Ok(owner) => emit.emit(Event::Owner(owner)),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::OwnerFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn save_owner(&mut self, owner: SaveOwnerProfile) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.save_owner(&owner).await {
                Ok(owner) => emit.emit(Event::OwnerSaved(owner)),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::OwnerSaveFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn load_sandbox(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.sandbox(&bot_id).await {
                Ok(info) => emit.emit(Event::Sandbox {
                    bot_id,
                    info: Box::new(info),
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::SandboxFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn save_sandbox(&mut self, bot_id: String, update: SandboxUpdate) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.save_sandbox(&bot_id, &update).await {
                Ok(settings) => emit.emit(Event::SandboxSaved { bot_id, settings }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => {
                    emit.emit(Event::SandboxSaveFailed {
                        message: error.to_string(),
                    });
                    // A refusal often means the settings changed elsewhere:
                    // read them again so the form can say so.
                    if let Ok(info) = api.sandbox(&bot_id).await {
                        emit.emit(Event::Sandbox {
                            bot_id,
                            info: Box::new(info),
                        });
                    }
                }
            }
        });
    }

    fn load_traces(&mut self, bot_id: String, hours: u8) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.traces(&bot_id, hours).await {
                Ok(data) => emit.emit(Event::Traces {
                    bot_id,
                    hours,
                    data: Box::new(data),
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                // The page says the trace backend is unavailable; the
                // reason is not shown, so it is not carried.
                Err(_) => emit.emit(Event::TracesFailed { bot_id, hours }),
            }
        });
    }

    fn load_bot_activity(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.bot_activity(&bot_id).await {
                Ok(items) => emit.emit(Event::BotActivity { bot_id, items }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(_) => emit.emit(Event::BotActivityFailed { bot_id }),
            }
        });
    }

    fn set_telemetry(&mut self, bot_id: String, enabled: bool) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.set_telemetry(&bot_id, enabled).await {
                Ok(settings) => emit.emit(Event::TelemetrySet {
                    bot_id,
                    settings: Box::new(settings),
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::TelemetryFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    /// Writes text the UI prepared into the Downloads folder. Nothing goes
    /// over the network: the text is already on this machine.
    fn save_export(&mut self, name: String, contents: String) {
        let emit = self.emit.clone();
        let folder = self.config.downloads.clone();
        tokio::spawn(async move {
            let failed = |message: String| emit.emit(Event::ExportFailed { message });
            let Some(folder) = folder else {
                failed("This machine has no Downloads folder to save to.".into());
                return;
            };
            // Writing a file blocks, so it runs on Tokio's thread pool for
            // blocking work.
            let written = tokio::task::spawn_blocking(move || {
                save_download(&folder, &name, contents.as_bytes())
            })
            .await;
            match written {
                Ok(Ok(saved)) => {
                    let saved_as = saved
                        .file_name()
                        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
                    emit.emit(Event::ExportSaved { saved_as });
                }
                Ok(Err(error)) => failed(format!("Could not save the file: {error}.")),
                Err(_) => failed("Could not save the file.".into()),
            }
        });
    }

    fn load_handoffs(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.handoffs(&bot_id).await {
                Ok(list) => emit.emit(Event::Handoffs { bot_id, list }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                // A failed refresh keeps the list shown; the next one retries.
                Err(_) => {}
            }
        });
    }

    fn cancel_handoff(&mut self, bot_id: String, id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.cancel_handoff(&bot_id, &id).await {
                Ok(()) => match api.handoffs(&bot_id).await {
                    Ok(list) => emit.emit(Event::Handoffs { bot_id, list }),
                    Err(_) => emit.emit(Event::HandoffCancelled { id }),
                },
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::HandoffCancelFailed {
                    id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn load_jobs(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.jobs(&bot_id).await {
                Ok(items) => emit.emit(Event::Jobs { bot_id, items }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::JobsFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn add_job(&mut self, bot_id: String, job: NewJob) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.add_job(&bot_id, &job).await {
                Ok(items) => emit.emit(Event::JobAdded { bot_id, items }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::JobChangeFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn change_job(&mut self, bot_id: String, id: String, action: JobAction) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.change_job(&bot_id, &id, action).await {
                Ok(items) => emit.emit(Event::JobChanged {
                    bot_id,
                    items,
                    ran: action == JobAction::Run,
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::JobChangeFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn load_job_runs(
        &mut self,
        bot_id: String,
        job_id: Option<String>,
        before: Option<String>,
        ticket: u64,
    ) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let older = before.is_some();
            let page = api
                .job_runs(&bot_id, job_id.as_deref(), before.as_deref())
                .await;
            match page {
                Ok(page) => emit.emit(Event::JobRuns {
                    ticket,
                    older,
                    page,
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::JobRunsFailed {
                    ticket,
                    older,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn load_workspace_files(&mut self, bot_id: String, path: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.workspace_files(&bot_id, &path).await {
                Ok(listing) => emit.emit(Event::WorkspaceFiles { bot_id, listing }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::WorkspaceFilesFailed {
                    bot_id,
                    path,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn download_workspace_file(
        &mut self,
        bot_id: String,
        path: String,
        name: String,
        revision: u64,
    ) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        let folder = self.config.downloads.clone();
        tokio::spawn(async move {
            let failed = |message: String| emit.emit(Event::FileDownloadFailed { message });
            let Some(folder) = folder else {
                failed("This machine has no Downloads folder to save to.".into());
                return;
            };
            let bytes = match api.download_workspace_file(&bot_id, &path, revision).await {
                Ok(bytes) => bytes,
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                    return;
                }
                Err(error) => {
                    failed(error.to_string());
                    return;
                }
            };
            // Writing a file blocks, so it runs on Tokio's thread pool for
            // blocking work instead of holding up the engine.
            let written =
                tokio::task::spawn_blocking(move || save_download(&folder, &name, &bytes)).await;
            match written {
                Ok(Ok(saved)) => {
                    let saved_as = saved
                        .file_name()
                        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
                    emit.emit(Event::FileDownloaded { saved_as });
                }
                Ok(Err(error)) => failed(format!("Could not save the file: {error}.")),
                Err(_) => failed("Could not save the file.".into()),
            }
        });
    }

    fn load_channels(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.channels(&bot_id).await {
                Ok(settings) => emit.emit(Event::Channels { bot_id, settings }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::ChannelsFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn load_channel_home(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.channel_home(&bot_id).await {
                Ok(home) => emit.emit(Event::ChannelHome { bot_id, home }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::ChannelHomeFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn change_channel(&mut self, bot_id: String, change: ChannelChange) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let outcome = change.outcome();
            let answer = match api.change_channel(&bot_id, &change).await {
                Ok(answer) => answer,
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                    return;
                }
                Err(error) => {
                    emit.emit(Event::ChannelChangeFailed {
                        channel: outcome.channel(),
                        message: error.to_string(),
                    });
                    return;
                }
            };
            let pairing = match answer {
                ChannelAnswer::Home(home) => {
                    emit.emit(Event::ChannelHome {
                        bot_id: bot_id.clone(),
                        home,
                    });
                    None
                }
                ChannelAnswer::Pairing(code) => Some(code),
                ChannelAnswer::Done => None,
            };
            // Read the settings again rather than piece them together from
            // each route's answer. If that fails the change still happened;
            // the page's next load catches up.
            let settings = match outcome.channel() {
                Channel::Home => None,
                _ => api.channels(&bot_id).await.ok(),
            };
            emit.emit(Event::ChannelChanged {
                bot_id,
                outcome,
                settings,
                pairing,
            });
        });
    }

    fn load_mcp(&mut self, bot_id: String) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.mcp(&bot_id).await {
                Ok(items) => emit.emit(Event::Mcp { bot_id, items }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::McpFailed {
                    bot_id,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn add_mcp(&mut self, bot_id: String, connection: NewMcpConnection) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.add_mcp(&bot_id, &connection).await {
                Ok(items) => emit.emit(Event::McpAdded { bot_id, items }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::McpChangeFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn change_mcp(&mut self, bot_id: String, id: String, action: McpAction) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.change_mcp(&bot_id, &id, action).await {
                Ok(items) => emit.emit(Event::McpChanged { bot_id, items }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::McpChangeFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn browse_memory(&mut self, bot_id: String, after: Option<String>, ticket: u64) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let more = after.is_some();
            match api.memory_evidence(&bot_id, after.as_deref()).await {
                Ok(page) => emit.emit(Event::MemoryListed { ticket, more, page }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::MemoryLoadFailed {
                    ticket,
                    more,
                    message: error.to_string(),
                }),
            }
        });
    }

    fn search_memory(&mut self, bot_id: String, query: String, ticket: u64) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.recall_memory(&bot_id, &query).await {
                Ok(recall) => emit.emit(Event::MemoryRecalled {
                    ticket,
                    evidence: recall.evidence,
                }),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => emit.emit(Event::MemoryLoadFailed {
                    ticket,
                    more: false,
                    message: error.to_string(),
                }),
            }
        });
    }

    /// Corrects a memory (`content` is what it should say) or forgets it
    /// (`None`).
    fn change_memory(&mut self, bot_id: String, id: String, content: Option<String>) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            let result = match &content {
                Some(content) => api.revise_memory(&bot_id, &id, content).await,
                None => api.forget_memory(&bot_id, &id).await,
            };
            match (result, content) {
                (Ok(()), Some(content)) => emit.emit(Event::MemoryRevised { id, content }),
                (Ok(()), None) => emit.emit(Event::MemoryForgotten { id }),
                (Err(ApiError::Unauthenticated), _) => {
                    let _ = inbox.send(Input::Expired);
                }
                (Err(error), _) => emit.emit(Event::MemoryChangeFailed {
                    message: error.to_string(),
                }),
            }
        });
    }

    fn refresh_bots(&mut self) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.bots().await {
                Ok(bots) => emit.emit(Event::Bots(bots)),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                // A refresh is a convenience; the list on screen stays.
                Err(_) => {}
            }
        });
    }

    fn save_profile(&mut self, bot_id: String, update: UpdateBotProfile) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            match api.save_profile(&bot_id, &update).await {
                Ok(profile) => emit.emit(Event::ProfileSaved(profile)),
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(error) => {
                    // The save may have lost to another client's: fetch the
                    // list so the page can say the bot changed elsewhere.
                    if let Ok(bots) = api.bots().await {
                        emit.emit(Event::Bots(bots));
                    }
                    emit.emit(Event::ProfileFailed {
                        bot_id,
                        message: error.to_string(),
                    });
                }
            }
        });
    }

    fn control(&mut self, session_id: String, action: ControlAction, turn_id: Option<String>) {
        let (Some(api), Some(bot_id)) = (self.api.clone(), self.bot_id.clone()) else {
            return;
        };
        let emit = self.emit.clone();
        let inbox = self.inbox.clone();
        tokio::spawn(async move {
            // Success needs no event: the session stream shows the run
            // stopping or the message changing queue.
            match api
                .control(&bot_id, &session_id, action, turn_id.as_deref())
                .await
            {
                Ok(()) => {}
                Err(ApiError::Unauthenticated) => {
                    let _ = inbox.send(Input::Expired);
                }
                Err(_) if action == ControlAction::Stop => emit.emit(Event::Problem(
                    "Could not stop this task. It may already have finished.".into(),
                )),
                Err(_) => emit.emit(Event::Problem(
                    "This message could not be changed. It may already have been picked up.".into(),
                )),
            }
        });
    }
}

/// The device sign-in, start to finish. `Ok(None)` means "no stored token"
/// in restore mode; `Err` carries a message for the sign-in screen.
async fn sign_in(
    api: ApiClient,
    store: Arc<dyn TokenStore>,
    policy: DevicePolicy,
    restore_only: bool,
    emit: &Emitter,
) -> Result<Option<ApiClient>, String> {
    let origin = api.origin().clone();
    // 1. A token saved earlier for this origin, if it still works.
    let lookup = origin.clone();
    let reader = store.clone();
    let saved = tokio::task::spawn_blocking(move || reader.load(&lookup))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if let Some(token) = saved {
        let candidate = api.with_token(token);
        match candidate.bots().await {
            Ok(_) => return Ok(Some(candidate)),
            Err(ApiError::Unauthenticated) => {
                let remover = store.clone();
                let forget = origin.clone();
                let _ = tokio::task::spawn_blocking(move || remover.delete(&forget)).await;
                if restore_only {
                    return Err(signed_out_notice());
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    } else if restore_only {
        return Ok(None);
    }

    // 2. A new device code, approved by the owner in a browser.
    let (code, device_code, interval) =
        api.request_device_code().await.map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(code.expires_in);
    emit.emit(Event::DeviceCode(code));
    let mut wait = policy.initial_interval(interval);
    loop {
        sleep(wait).await;
        if Instant::now() >= deadline {
            return Err("The sign-in code expired. Start again.".into());
        }
        let answer = api
            .poll_device_token(&device_code)
            .await
            .map_err(|e| e.to_string())?;
        wait = policy.next_interval(wait, &answer);
        match answer {
            DevicePoll::Pending | DevicePoll::SlowDown => continue,
            DevicePoll::Granted(token) => {
                save_token(&store, &origin, token.clone()).await?;
                return Ok(Some(api.with_token(token)));
            }
            DevicePoll::Denied => return Err("Sign-in was denied in the browser.".into()),
            DevicePoll::Expired => return Err("The sign-in code expired. Start again.".into()),
        }
    }
}

async fn save_token(
    store: &Arc<dyn TokenStore>,
    origin: &Origin,
    token: AccessToken,
) -> Result<(), String> {
    let store = store.clone();
    let origin = origin.clone();
    tokio::task::spawn_blocking(move || store.save(&origin, &token))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Follows an event stream until cancelled, turning each JSON event into an
/// [`Event`] with `wrap`, and reconnecting with a growing wait when it drops.
///
/// `T: DeserializeOwned` lets one function serve both streams: the compiler
/// makes a copy of it for each `T` it is called with (monomorphisation).
async fn follow<T: DeserializeOwned>(
    api: &ApiClient,
    path: &str,
    config: &EngineConfig,
    inbox: &mpsc::UnboundedSender<Input>,
    emit: &Emitter,
    wrap: impl Fn(T) -> Event,
) {
    let session_id = stream_session_id(path);
    let mut wait = config.reconnect_min;
    loop {
        match api.open_stream(path).await {
            Ok(response) => {
                let mut parser = SseParser::new();
                let mut body = response.bytes_stream();
                // `next().await` yields each network chunk as it arrives and
                // `None` when the server ends the stream.
                while let Some(chunk) = body.next().await {
                    let Ok(chunk) = chunk else { break };
                    for data in parser.push(&chunk) {
                        match serde_json::from_str::<T>(&data) {
                            Ok(value) => {
                                wait = config.reconnect_min;
                                emit.emit(wrap(value));
                            }
                            Err(error) => emit.emit(Event::Problem(format!(
                                "Unexpected update from Raphie: {error}"
                            ))),
                        }
                    }
                }
            }
            Err(ApiError::Unauthenticated) => {
                let _ = inbox.send(Input::Expired);
                return;
            }
            Err(ApiError::NotFound(_)) => {
                emit.emit(Event::Problem("This conversation no longer exists.".into()));
                return;
            }
            Err(ApiError::Locked) => {
                emit.emit(Event::Problem(ApiError::Locked.to_string()));
            }
            Err(_) => {}
        }
        // The stream ended or failed: say so, wait, and try again.
        if let Some(session_id) = &session_id {
            emit.emit(Event::Stream {
                session_id: session_id.clone(),
                status: StreamStatus::Reconnecting,
            });
        }
        sleep(wait).await;
        wait = (wait * 2).min(config.reconnect_max);
    }
}

/// The session id in a `/sessions/<id>/events` path, for stream status events.
fn stream_session_id(path: &str) -> Option<String> {
    let rest = path.split("/sessions/").nth(1)?;
    let id = rest.strip_suffix("/events")?;
    (!id.is_empty()).then(|| id.to_owned())
}

fn report(error: ApiError, inbox: &mpsc::UnboundedSender<Input>, emit: &Emitter) {
    if error == ApiError::Unauthenticated {
        let _ = inbox.send(Input::Expired);
    } else {
        emit.emit(Event::Problem(error.to_string()));
    }
}

/// Fetches a bot's archived sessions and reports them, or why not.
async fn fetch_archived(
    api: &ApiClient,
    bot_id: String,
    inbox: &mpsc::UnboundedSender<Input>,
    emit: &Emitter,
) {
    match api.archived_sessions(&bot_id).await {
        Ok(page) => emit.emit(Event::ArchivedSessions {
            bot_id,
            sessions: page.items,
        }),
        Err(ApiError::Unauthenticated) => {
            let _ = inbox.send(Input::Expired);
        }
        Err(error) => emit.emit(Event::ArchivedFailed {
            bot_id,
            message: error.to_string(),
        }),
    }
}

/// Milliseconds since the Unix epoch, as the runtime counts time.
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as i64)
}

fn default_bot(bots: &[BotProfile]) -> Option<String> {
    bots.iter()
        .find(|b| b.id == "default")
        .or(bots.first())
        .map(|b| b.id.clone())
}

fn decision_outcome(asked: Decision, status: ApprovalStatus) -> DecisionOutcome {
    match (asked, status) {
        (Decision::Approved, ApprovalStatus::Approved)
        | (Decision::Rejected, ApprovalStatus::Rejected) => DecisionOutcome::Applied,
        (_, ApprovalStatus::Approved | ApprovalStatus::Rejected | ApprovalStatus::Expired) => {
            DecisionOutcome::AlreadySettled(status)
        }
        (_, ApprovalStatus::Pending | ApprovalStatus::Unknown) => {
            DecisionOutcome::Failed("The runtime did not record the decision. Try again.".into())
        }
    }
}

fn signed_out_notice() -> String {
    "This device was signed out (it may have been disconnected in Settings → Account). Sign in again."
        .into()
}

/// Why attaching stopped: a file this client refused or could not read
/// (with the sentence to show), or a failed upload.
enum AttachStop {
    Refused(String),
    Api(ApiError),
}

/// Reads and uploads each chosen file in turn, reporting each one as it is
/// filed. Stops at the first that fails; the ones before it stay attached.
async fn upload_all(
    api: &ApiClient,
    bot_id: &str,
    uploads: Vec<Upload>,
    emit: &Emitter,
) -> Result<(), AttachStop> {
    // Read everything first: one file that is too large refuses the whole
    // choice before anything is sent, as on the web.
    let mut files = Vec::with_capacity(uploads.len());
    for upload in uploads {
        files.push(read_upload(upload).await.map_err(AttachStop::Refused)?);
    }
    for (name, bytes) in files {
        let file = api
            .upload_attachment(bot_id, &name, &bytes.0)
            .await
            .map_err(AttachStop::Api)?;
        emit.emit(Event::Attached {
            bot_id: bot_id.to_owned(),
            file,
        });
    }
    Ok(())
}

/// The name and bytes of one chosen file, or the sentence that says why
/// it cannot be attached. A file on disk is read on Tokio's thread pool
/// for blocking work.
async fn read_upload(upload: Upload) -> Result<(String, FileBytes), String> {
    match upload {
        Upload::Bytes { name, bytes } => {
            if bytes.0.len() as u64 > MAX_BYTES {
                return Err(TOO_LARGE.to_owned());
            }
            Ok((upload_name(&name), bytes))
        }
        Upload::File(path) => {
            let read = tokio::task::spawn_blocking(move || {
                let name = upload_name(&path.to_string_lossy());
                let unreadable = |error: std::io::Error| format!("Could not read {name}: {error}.");
                // Ask the size before reading, so a huge file is refused
                // without being loaded.
                let details = std::fs::metadata(&path).map_err(unreadable)?;
                if !details.is_file() {
                    return Err("Only files can be attached, not folders.".to_owned());
                }
                if details.len() > MAX_BYTES {
                    return Err(TOO_LARGE.to_owned());
                }
                let bytes = std::fs::read(&path).map_err(unreadable)?;
                Ok((name, FileBytes::from(bytes)))
            })
            .await;
            // The outer error is the blocking task itself failing.
            read.unwrap_or_else(|_| Err("Could not read the file.".to_owned()))
        }
    }
}

/// What a connection check means, or `None` when the token was refused.
/// Any answer from the runtime counts as up, even a refusal: only no
/// answer, or the web host saying the runtime is unavailable, is down.
/// Asks the signed-in Raphie which release it runs, for Settings → About.
/// Nothing depends on it, so a failure leaves the last answer shown.
fn tell_host_version(emit: &Emitter, api: &ApiClient) {
    let emit = emit.clone();
    let api = api.clone();
    tokio::spawn(async move {
        if let Ok(version) = api.host_version().await {
            emit.emit(Event::HostVersion(version));
        }
    });
}

fn reach_of(result: Result<(), ApiError>) -> Option<Reach> {
    match result {
        Err(ApiError::Unauthenticated) => None,
        Err(ApiError::Network(error)) => Some(Reach::Unreachable(error)),
        Err(ApiError::Rejected { status, message }) if status >= 500 => {
            Some(Reach::RuntimeDown(message))
        }
        Err(ApiError::Locked) => Some(Reach::RuntimeDown(ApiError::Locked.to_string())),
        _ => Some(Reach::Up),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_is_down_only_when_nothing_or_no_runtime_answers() {
        let network = ApiError::Network("connection refused".into());
        assert_eq!(
            reach_of(Err(network)),
            Some(Reach::Unreachable("connection refused".into()))
        );
        let unavailable = ApiError::Rejected {
            status: 503,
            message: "The runtime is unavailable. Please retry.".into(),
        };
        assert!(matches!(
            reach_of(Err(unavailable)),
            Some(Reach::RuntimeDown(_))
        ));
        // An older host without the route still answered.
        assert_eq!(
            reach_of(Err(ApiError::NotFound("no".into()))),
            Some(Reach::Up)
        );
        assert_eq!(reach_of(Ok(())), Some(Reach::Up));
        assert_eq!(reach_of(Err(ApiError::Unauthenticated)), None);
    }

    #[test]
    fn a_stale_decision_reports_the_earlier_outcome() {
        assert_eq!(
            decision_outcome(Decision::Approved, ApprovalStatus::Approved),
            DecisionOutcome::Applied
        );
        assert_eq!(
            decision_outcome(Decision::Approved, ApprovalStatus::Rejected),
            DecisionOutcome::AlreadySettled(ApprovalStatus::Rejected)
        );
        assert_eq!(
            decision_outcome(Decision::Rejected, ApprovalStatus::Expired),
            DecisionOutcome::AlreadySettled(ApprovalStatus::Expired)
        );
    }

    #[test]
    fn stream_status_names_the_session() {
        assert_eq!(
            stream_session_id("/api/bots/b/sessions/abc/events").as_deref(),
            Some("abc")
        );
        assert_eq!(stream_session_id("/api/sessions/events"), None);
    }

    #[test]
    fn the_default_bot_wins_else_the_first() {
        let bot = |id: &str| BotProfile {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            color: None,
            personality: String::new(),
            reply_style: Default::default(),
            revision: 1,
        };
        assert_eq!(
            default_bot(&[bot("a"), bot("default")]).as_deref(),
            Some("default")
        );
        assert_eq!(default_bot(&[bot("a"), bot("b")]).as_deref(), Some("a"));
        assert_eq!(default_bot(&[]), None);
    }
}
