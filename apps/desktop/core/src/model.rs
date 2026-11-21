//! What the app knows, and how each piece of news changes it.
//!
//! The engine reports news as [`Event`]s; [`Model::apply`] folds each one into
//! the model. `apply` does no I/O and never blocks, so it can run on the UI
//! thread every frame and is tested without a network or a window. A UI only
//! reads the model and calls the small `select_*`/`begin_*` methods when the
//! owner acts, then sends the matching [`Command`](crate::engine::Command).

use std::collections::{HashMap, HashSet};

use crate::attachments::{AttachmentDraft, FileBytes, Previews};
use crate::auth::DeviceCode;
use crate::channels::{Channel, ChannelOutcome};
use crate::contracts::ApprovalMode;
use crate::contracts::AskAnswer;
use crate::contracts::Attachment;
use crate::contracts::ModelSelection;
use crate::contracts::OwnerProfile;
use crate::contracts::WorkspaceListing;
use crate::contracts::{
    Account, ApprovalStatus, BotProfile, ChannelHomeSettings, ChannelSettings, HandoffList,
    McpConnection, MemoryEvidence, MemoryPage, MemoryStatus, Page, Receipt, RuntimeSettings,
    SandboxInfo, SandboxSettings, SessionApproval, SessionObservation, SessionSummary, SessionTurn,
    TelegramPairingCode,
};
use crate::contracts::{ActivityEvent, BotRevision, TraceDiagnostics};
use crate::contracts::{JobRun, ScheduledJob};
use crate::contracts::{ProviderSignIn, SignInStatus};
use crate::contracts::{SkillDetail, SkillSummary};
use crate::inbox::{Inbox, JobUpdates};
use crate::inspection::TraceView;
use crate::jobs::RunHistory;
use crate::memory::MemoryBrowser;
use crate::origin::Origin;
use crate::permissions::CommandMode;
use crate::updates::{Update, UpdateStatus};
use crate::workspace::WorkspaceBrowser;

/// News from the engine. Events about a bot or session carry its id, so news
/// that arrives after the owner moved on is recognised and dropped.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// Checking a saved token or asking the host for a sign-in code.
    Connecting {
        origin: Origin,
    },
    /// Show this code and link until the owner approves or denies it.
    DeviceCode(DeviceCode),
    SignedIn {
        origin: Origin,
    },
    /// Back to the sign-in screen, with the reason when there is one.
    SignedOut {
        notice: Option<String>,
    },
    /// A bot's model connections and models.
    BotSettings {
        bot_id: String,
        /// Boxed for the same reason as an observation: it is large.
        settings: Box<RuntimeSettings>,
    },
    BotSettingsFailed {
        bot_id: String,
        message: String,
    },
    /// The default model was changed; these are the settings afterwards.
    DefaultModelSet {
        bot_id: String,
        settings: Box<RuntimeSettings>,
    },
    DefaultModelFailed {
        message: String,
    },
    /// A provider connection was added, saved, removed or tested. `settings`
    /// is the bot's settings afterwards (a test changes none).
    ConnectionChanged {
        bot_id: String,
        settings: Option<Box<RuntimeSettings>>,
        message: String,
    },
    ConnectionFailed {
        message: String,
    },
    /// A bot's memory settings.
    Memory {
        bot_id: String,
        status: MemoryStatus,
    },
    MemoryFailed {
        bot_id: String,
        message: String,
    },
    /// Memory settings were saved; this is what the runtime now has.
    MemorySaved {
        bot_id: String,
        status: MemoryStatus,
    },
    MemorySaveFailed {
        message: String,
    },
    /// A test of the saved memory back end ended; `message` says how.
    MemoryTested {
        message: String,
    },
    /// The saved versions of a bot's profile, newest first.
    BotHistory {
        bot_id: String,
        items: Vec<BotRevision>,
    },
    BotHistoryFailed {
        bot_id: String,
        message: String,
    },
    /// A bot was created; this is it.
    BotCreated(BotProfile),
    BotCreateFailed {
        message: String,
    },
    /// A bot and everything the runtime kept for it were deleted.
    BotDeleted {
        bot_id: String,
    },
    BotDeleteFailed {
        message: String,
    },
    /// A bot's skills.
    Skills {
        bot_id: String,
        items: Vec<SkillSummary>,
    },
    SkillsFailed {
        bot_id: String,
        message: String,
    },
    /// One skill with its files, for the editor.
    Skill {
        bot_id: String,
        detail: Box<SkillDetail>,
    },
    SkillFailed {
        message: String,
    },
    /// A change to a bot's skills went through.
    SkillChanged {
        bot_id: String,
        outcome: SkillOutcome,
    },
    SkillChangeFailed {
        message: String,
    },
    /// Who every bot is talking to.
    Owner(OwnerProfile),
    OwnerFailed {
        message: String,
    },
    /// The owner profile was saved; this is it as saved.
    OwnerSaved(OwnerProfile),
    OwnerSaveFailed {
        message: String,
    },
    /// A bot's sandbox settings, provider, limits and usage.
    Sandbox {
        bot_id: String,
        info: Box<SandboxInfo>,
    },
    SandboxFailed {
        bot_id: String,
        message: String,
    },
    /// Sandbox settings were saved; these are they at their new revision.
    SandboxSaved {
        bot_id: String,
        settings: SandboxSettings,
    },
    SandboxSaveFailed {
        message: String,
    },
    /// Exported traces for a bot and a time window (in hours).
    Traces {
        bot_id: String,
        hours: u8,
        data: Box<TraceDiagnostics>,
    },
    TracesFailed {
        bot_id: String,
        hours: u8,
    },
    /// A bot's most recent durable events.
    BotActivity {
        bot_id: String,
        items: Vec<ActivityEvent>,
    },
    BotActivityFailed {
        bot_id: String,
    },
    /// Trace collection was switched; these are the settings afterwards.
    TelemetrySet {
        bot_id: String,
        settings: Box<RuntimeSettings>,
    },
    TelemetryFailed {
        message: String,
    },
    /// An export was written to this machine; `saved_as` is its file name.
    ExportSaved {
        saved_as: String,
    },
    ExportFailed {
        message: String,
    },
    /// A bot's handoffs and the bots it can hand tasks to.
    Handoffs {
        bot_id: String,
        list: HandoffList,
    },
    /// A cancel went through, though the list could not be reloaded.
    HandoffCancelled {
        id: String,
    },
    HandoffCancelFailed {
        id: String,
        message: String,
    },
    /// A bot's scheduled jobs.
    Jobs {
        bot_id: String,
        items: Vec<ScheduledJob>,
    },
    JobsFailed {
        bot_id: String,
        message: String,
    },
    /// A job was scheduled; these are the bot's jobs with it.
    JobAdded {
        bot_id: String,
        items: Vec<ScheduledJob>,
    },
    /// A job was resumed, paused, removed or run. `ran` says it was a
    /// "Run now", which has something to tell the owner.
    JobChanged {
        bot_id: String,
        items: Vec<ScheduledJob>,
        ran: bool,
    },
    JobChangeFailed {
        message: String,
    },
    /// One page of job runs. `ticket` is the load's, from
    /// [`RunHistory::begin_load`]; `older` says it follows the runs shown.
    JobRuns {
        ticket: u64,
        older: bool,
        page: Page<JobRun>,
    },
    JobRunsFailed {
        ticket: u64,
        older: bool,
        message: String,
    },
    /// What one folder of a bot's workspace holds.
    WorkspaceFiles {
        bot_id: String,
        listing: WorkspaceListing,
    },
    WorkspaceFilesFailed {
        bot_id: String,
        path: String,
        message: String,
    },
    /// A workspace file was saved to this machine; `saved_as` is the name
    /// it was given there.
    FileDownloaded {
        saved_as: String,
    },
    FileDownloadFailed {
        message: String,
    },
    /// A bot's Discord and Telegram connections.
    Channels {
        bot_id: String,
        settings: ChannelSettings,
    },
    ChannelsFailed {
        bot_id: String,
        message: String,
    },
    /// Where a bot's scheduled results go, and where they could.
    ChannelHome {
        bot_id: String,
        home: ChannelHomeSettings,
    },
    ChannelHomeFailed {
        bot_id: String,
        message: String,
    },
    /// A change to a bot's channels was made. `settings` is what the
    /// runtime has now, when it could be read again; `pairing` is the code
    /// a pairing request was answered with.
    ChannelChanged {
        bot_id: String,
        outcome: ChannelOutcome,
        settings: Option<ChannelSettings>,
        pairing: Option<TelegramPairingCode>,
    },
    ChannelChangeFailed {
        channel: Channel,
        message: String,
    },
    /// A bot's connections to MCP servers.
    Mcp {
        bot_id: String,
        items: Vec<McpConnection>,
    },
    McpFailed {
        bot_id: String,
        message: String,
    },
    /// A connection was added; these are the bot's connections with it.
    McpAdded {
        bot_id: String,
        items: Vec<McpConnection>,
    },
    /// A connection was enabled, paused, removed or imported.
    McpChanged {
        bot_id: String,
        items: Vec<McpConnection>,
    },
    McpChangeFailed {
        message: String,
    },
    /// One page of a bot's saved memories. `ticket` is the load's, from
    /// [`MemoryBrowser::begin_load`]; `more` says it follows earlier pages.
    MemoryListed {
        ticket: u64,
        more: bool,
        page: MemoryPage,
    },
    /// The saved memories that match a search.
    MemoryRecalled {
        ticket: u64,
        evidence: Vec<MemoryEvidence>,
    },
    MemoryLoadFailed {
        ticket: u64,
        more: bool,
        message: String,
    },
    /// A correction was saved: the memory `id` says `content` now.
    MemoryRevised {
        id: String,
        content: String,
    },
    /// The memory `id` was forgotten.
    MemoryForgotten {
        id: String,
    },
    /// A correction or a forget failed.
    MemoryChangeFailed {
        message: String,
    },
    /// A bot's profile was saved; this is it at its new revision.
    ProfileSaved(BotProfile),
    ProfileFailed {
        bot_id: String,
        message: String,
    },
    /// Who is signed in, when the host says.
    Account(Option<Account>),
    /// The release the signed-in Raphie runs.
    HostVersion(String),
    Bots(Vec<BotProfile>),
    BotSelected {
        bot_id: String,
    },
    /// The live first page of a bot's sessions (`more: false`), or a further
    /// page the owner asked for (`more: true`).
    Sessions {
        bot_id: String,
        page: Page<SessionSummary>,
        more: bool,
    },
    /// A bot's archived sessions, most recent first.
    ArchivedSessions {
        bot_id: String,
        sessions: Vec<SessionSummary>,
    },
    ArchivedFailed {
        bot_id: String,
        message: String,
    },
    /// A session was archived (`archived_at` is when) or brought back
    /// (`None`).
    Archived {
        bot_id: String,
        session_id: String,
        archived_at: Option<i64>,
    },
    /// A first message created this session; the engine now follows it.
    SessionCreated {
        bot_id: String,
        session_id: String,
    },
    /// The whole current state of the open session. Boxed because it is much
    /// larger than every other variant (see clippy's `large_enum_variant`).
    Observation {
        session_id: String,
        observation: Box<SessionObservation>,
    },
    Stream {
        session_id: String,
        status: StreamStatus,
    },
    OlderTurns {
        session_id: String,
        page: Page<SessionTurn>,
    },
    OlderFailed {
        session_id: String,
        message: String,
    },
    MessageAccepted {
        receipt: Receipt,
    },
    MessageFailed {
        message: String,
    },
    /// Another bot's conversations (its first page).
    InboxSessions {
        bot_id: String,
        sessions: Vec<SessionSummary>,
    },
    /// A bot's undismissed job runs.
    JobUpdates {
        bot_id: String,
        updates: JobUpdates,
    },
    JobUpdatesFailed {
        bot_id: String,
    },
    /// A job run was dismissed from the notifications.
    RunAcknowledged {
        bot_id: String,
        run_id: String,
    },
    RunAcknowledgeFailed,
    /// An image attachment's bytes, for its preview.
    PreviewLoaded {
        bot_id: String,
        id: String,
        bytes: FileBytes,
    },
    PreviewFailed {
        bot_id: String,
        id: String,
    },
    /// Where a subscription sign-in has got to.
    ProviderSignIn {
        bot_id: String,
        sign_in: ProviderSignIn,
    },
    /// A sign-in step was refused (another sign-in running, say).
    ProviderSignInFailed {
        bot_id: String,
        message: String,
    },
    /// What a check for a newer release found: the newer release, none,
    /// or why the check failed.
    UpdateChecked(Result<Option<Update>, String>),
    /// The address of a Raphie installed on this computer that answered,
    /// or `None` when none did.
    LocalInstall(Option<Origin>),
    /// Whether the signed-in Raphie answered its last check.
    Reach(Reach),
    /// How a session treats commands.
    ApprovalMode {
        session_id: String,
        mode: ApprovalMode,
    },
    ApprovalModeFailed {
        session_id: String,
    },
    /// A change of command mode was saved; `mode` is the one in force.
    ApprovalModeSaved {
        session_id: String,
        mode: ApprovalMode,
    },
    ApprovalModeSaveFailed {
        session_id: String,
    },
    /// The session answers with `model` from now on.
    ModelChosen {
        session_id: String,
        model: ModelSelection,
    },
    ModelChoiceFailed {
        message: String,
    },
    /// One chosen file was uploaded to `bot_id`.
    Attached {
        bot_id: String,
        file: Attachment,
    },
    /// An upload was refused or failed; the files before it stay.
    AttachFailed {
        bot_id: String,
        message: String,
    },
    /// The uploads asked for are over, whether or not all of them worked.
    AttachFinished {
        bot_id: String,
    },
    /// A message's file was saved to this machine as `saved_as`.
    AttachmentSaved {
        saved_as: String,
    },
    AttachmentSaveFailed {
        message: String,
    },
    Decided {
        approval_id: String,
        outcome: DecisionOutcome,
    },
    /// The answer to a bot's question was sent, or could not be.
    Answered {
        ask_id: String,
        outcome: AnswerOutcome,
    },
    /// Something went wrong that the owner should know about.
    Problem(String),
}

/// How sending an answer ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnswerOutcome {
    Applied,
    /// The question stopped waiting before the answer arrived.
    Late,
    Gone,
    Failed(String),
}

/// How an approval decision ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecisionOutcome {
    /// Recorded as asked.
    Applied,
    /// Already decided elsewhere (another client, Discord, Telegram) or
    /// expired before this decision reached the runtime.
    AlreadySettled(ApprovalStatus),
    /// The runtime no longer knows this approval.
    Gone,
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamStatus {
    Connecting,
    Live,
    /// The stream dropped; the engine is reconnecting.
    Reconnecting,
}

/// Whether the signed-in Raphie answers: the web host at its address, and
/// the runtime behind it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Reach {
    /// It answered the last check, or none has failed since signing in.
    #[default]
    Up,
    /// The web host answered, but the runtime behind it did not.
    RuntimeDown(String),
    /// Nothing answered at the address (stopped, offline, wrong address).
    Unreachable(String),
}

impl Reach {
    pub fn is_up(&self) -> bool {
        *self == Reach::Up
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum AuthState {
    SignedOut { notice: Option<String> },
    Connecting,
    AwaitingApproval(DeviceCode),
    SignedIn,
}

/// What a change to a bot's skills did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SkillOutcome {
    /// Created or saved; this is the skill as saved.
    Saved(Box<SkillDetail>),
    /// Turned on or off.
    Changed,
    Removed,
    /// Imported; these are the skills installed.
    Imported(Vec<String>),
}

/// Something the UI should do once, beyond redrawing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    /// The message was admitted: empty the composer.
    ClearComposer,
    /// The session's model was changed: close the picker.
    ModelChosen,
    /// A connection was added or saved: close its form and forget the key.
    CloseConnectionForm,
    /// A profile was saved: the form should show the saved values.
    ProfileSaved(BotProfile),
    /// This bot's memory settings were saved: its form should show them and
    /// forget any typed key.
    MemorySaved(String),
    /// A bot was created: open its settings so it can be given a model.
    BotCreated(String),
    /// A bot was deleted: leave its pages.
    BotDeleted(String),
    /// A job was scheduled: close its form and empty it.
    JobAdded,
    /// A change to a bot's skills went through: the editor follows it.
    SkillChanged(SkillOutcome),
    /// The owner profile was saved: its form should show it.
    OwnerSaved,
    /// This bot's sandbox settings were saved: its form should show them.
    SandboxSaved(String),
    /// A change to a bot's channels was made: forget what was typed for
    /// it, and close its form where the web does.
    ChannelChanged(ChannelOutcome),
    /// An MCP connection was added: empty its form and forget what was
    /// typed.
    McpAdded,
    /// The memory with this id was corrected or forgotten: close its editor
    /// or its "Confirm forget".
    MemoryChanged(String),
    /// A subscription sign-in connected for this bot: reload its settings
    /// and close the form.
    SignedIn(String),
}

/// The open conversation.
#[derive(Clone, Debug, PartialEq)]
pub struct Conversation {
    pub session_id: String,
    /// The latest observation, `None` until the stream's first event.
    pub observation: Option<SessionObservation>,
    /// Turns older than the observation's window, oldest first: pages loaded
    /// with "Show earlier messages", plus turns that scrolled out of the
    /// window while the session was open.
    pub older: Vec<SessionTurn>,
    /// A history page came back with no further cursor.
    pub reached_start: bool,
    pub loading_older: bool,
    pub stream: StreamStatus,
}

impl Conversation {
    fn new(session_id: String) -> Conversation {
        Conversation {
            session_id,
            observation: None,
            older: Vec::new(),
            reached_start: false,
            loading_older: false,
            stream: StreamStatus::Connecting,
        }
    }

    /// Every turn on screen, oldest first, each once.
    pub fn turns(&self) -> Vec<&SessionTurn> {
        let recent: &[SessionTurn] = match &self.observation {
            Some(observation) => &observation.turns,
            None => &[],
        };
        let recent_ids: HashSet<&str> = recent.iter().map(|t| t.id.as_str()).collect();
        let mut turns: Vec<&SessionTurn> = self
            .older
            .iter()
            .filter(|t| !recent_ids.contains(t.id.as_str()))
            .collect();
        turns.extend(recent.iter());
        // The runtime puts a pending turn first even when it is older than the
        // window, so order by time (a stable sort keeps equal times in place).
        turns.sort_by_key(|t| t.created_at);
        turns
    }

    /// The `before` cursor for the next history page, or `None` when there is
    /// nothing earlier. The runtime's cursor is the oldest held turn's id.
    pub fn older_cursor(&self) -> Option<String> {
        if self.reached_start {
            return None;
        }
        match self.older.first() {
            Some(oldest) => Some(oldest.id.clone()),
            None => self.observation.as_ref()?.next_before.clone(),
        }
    }

    /// Approvals still waiting for a decision.
    pub fn pending_approvals(&self) -> Vec<&SessionApproval> {
        self.observation
            .iter()
            .flat_map(|o| o.tool_approvals.iter())
            .filter(|a| a.status == ApprovalStatus::Pending)
            .collect()
    }

    /// The reply text streamed so far for the turn being answered.
    pub fn live_text(&self) -> Option<&str> {
        let live = self.observation.as_ref()?.live.as_ref()?;
        (live.generating || !live.text.is_empty()).then_some(live.text.as_str())
    }

    fn observe(&mut self, next: SessionObservation) {
        // Turns that fell out of the observation window while we watched stay
        // on screen: move them into `older` instead of losing them.
        if let Some(previous) = self.observation.take() {
            let kept: HashSet<&str> = next.turns.iter().map(|t| t.id.as_str()).collect();
            for turn in previous.turns {
                let known = self.older.iter().any(|t| t.id == turn.id);
                if !kept.contains(turn.id.as_str()) && !known {
                    self.older.push(turn);
                }
            }
            self.older.sort_by_key(|t| t.created_at);
        }
        self.observation = Some(next);
        self.stream = StreamStatus::Live;
    }

    fn prepend(&mut self, page: Page<SessionTurn>) {
        self.loading_older = false;
        self.reached_start = page.next.is_none();
        let known: HashSet<String> = self.older.iter().map(|t| t.id.clone()).collect();
        let mut merged: Vec<SessionTurn> = page
            .items
            .into_iter()
            .filter(|t| !known.contains(&t.id))
            .collect();
        merged.append(&mut self.older);
        self.older = merged;
    }
}

/// Everything the app shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Model {
    pub origin: Option<Origin>,
    pub auth: AuthState,
    /// The signed-in administrator, once the host has said who it is.
    pub account: Option<Account>,
    /// The release the signed-in Raphie runs, once it has said.
    pub host_version: Option<String>,
    /// Each bot's model connections and models, once loaded.
    pub settings: HashMap<String, RuntimeSettings>,
    /// The bot whose settings could not be loaded, and why.
    pub settings_error: Option<(String, String)>,
    /// A change of default model is on its way.
    pub setting_model: bool,
    /// What the last change of default model said.
    pub model_message: Option<String>,
    /// A provider connection change or test is on its way.
    pub changing_connection: bool,
    /// What the last connection change or test said.
    pub connection_message: Option<String>,
    /// Each bot's memory settings, once loaded.
    pub memory: HashMap<String, MemoryStatus>,
    /// The bot whose memory settings could not be loaded, and why.
    pub memory_error: Option<(String, String)>,
    /// A save of memory settings is on its way.
    pub saving_memory: bool,
    /// Why the last save of memory settings failed, until the next attempt.
    pub memory_save_error: Option<String>,
    /// A test of the memory back end is on its way.
    pub testing_memory: bool,
    /// What the last memory test or save said.
    pub memory_message: Option<String>,
    /// The saved memories on "Browse memory".
    pub memories: MemoryBrowser,
    /// Each bot's skills, once loaded.
    pub skills: HashMap<String, Vec<SkillSummary>>,
    /// The bot whose skills could not be loaded, and why.
    pub skills_error: Option<(String, String)>,
    /// The skill open in the editor, with the bot it belongs to.
    pub skill: Option<(String, SkillDetail)>,
    /// Why the skill for the editor could not be loaded.
    pub skill_error: Option<String>,
    /// A change to a skill is on its way.
    pub changing_skill: bool,
    /// Why the last change to a skill failed, until the next attempt.
    pub skill_change_error: Option<String>,
    /// What the last change to a skill said.
    pub skill_message: Option<String>,
    /// Who every bot is talking to, once loaded.
    pub owner: Option<OwnerProfile>,
    /// Why the owner profile could not be loaded.
    pub owner_error: Option<String>,
    /// A save of the owner profile is on its way.
    pub saving_owner: bool,
    /// Why the last save of the owner profile failed, until the next attempt.
    pub owner_save_error: Option<String>,
    /// What the last save of the owner profile said.
    pub owner_message: Option<String>,
    /// Each bot's sandbox details, once loaded.
    pub sandbox: HashMap<String, SandboxInfo>,
    /// The bot whose sandbox details could not be loaded, and why. Details
    /// loaded before stay on screen, marked as not refreshed.
    pub sandbox_error: Option<(String, String)>,
    /// A save of sandbox settings is on its way.
    pub saving_sandbox: bool,
    /// Why the last save of sandbox settings failed, until the next attempt.
    pub sandbox_save_error: Option<String>,
    /// What the last save of sandbox settings said.
    pub sandbox_message: Option<String>,
    /// Each bot's saved profile versions, once loaded.
    pub bot_history: HashMap<String, Vec<BotRevision>>,
    /// The bot whose history could not be loaded, and why.
    pub bot_history_error: Option<(String, String)>,
    /// A bot is being created.
    pub creating_bot: bool,
    /// A bot is being deleted.
    pub deleting_bot: bool,
    /// Why the last delete failed, until the next attempt.
    pub delete_bot_error: Option<String>,
    /// The traces on Diagnostics.
    pub traces: TraceView,
    /// Each bot's most recent events, once loaded.
    pub activity: HashMap<String, Vec<ActivityEvent>>,
    /// The bot whose events could not be loaded. Events loaded before stay.
    pub activity_failed: Option<String>,
    /// The telemetry switch is being changed.
    pub setting_telemetry: bool,
    /// Why the last change of the telemetry switch failed.
    pub telemetry_error: Option<String>,
    /// An export is being written.
    pub exporting: bool,
    /// What the last export said: the file's name, or why it failed.
    pub export_saved: Option<String>,
    pub export_error: Option<String>,
    /// Each bot's handoffs and the bots it can hand tasks to, once loaded.
    pub handoffs: HashMap<String, HandoffList>,
    /// The handoff being cancelled.
    pub cancelling_handoff: Option<String>,
    /// Why a cancel failed: the handoff, and the reason.
    pub handoff_error: Option<(String, String)>,
    /// Each bot's scheduled jobs, once loaded.
    pub jobs: HashMap<String, Vec<ScheduledJob>>,
    /// The bot whose jobs could not be loaded, and why.
    pub jobs_error: Option<(String, String)>,
    /// A job is being scheduled or changed.
    pub changing_job: bool,
    /// Why the last add or change failed, until the next attempt.
    pub job_error: Option<String>,
    /// What the last add or "Run now" said.
    pub job_message: Option<String>,
    /// The run history on screen.
    pub runs: RunHistory,
    /// The workspace folder on screen and what it holds.
    pub files: WorkspaceBrowser,
    /// Each bot's Discord and Telegram connections, once loaded.
    pub channels: HashMap<String, ChannelSettings>,
    /// The bot whose channels could not be loaded, and why.
    pub channels_error: Option<(String, String)>,
    /// Each bot's home channel settings, once loaded.
    pub channel_home: HashMap<String, ChannelHomeSettings>,
    /// The bot whose home channel could not be loaded, and why.
    pub channel_home_error: Option<(String, String)>,
    /// A change to a bot's channels is on its way.
    pub changing_channel: bool,
    /// What the last change to each part of the page said.
    pub channel_messages: HashMap<Channel, String>,
    /// Why the last change to each part of the page failed.
    pub channel_errors: HashMap<Channel, String>,
    /// The Telegram pairing code that is out, and the bot it is for. Shown
    /// while the runtime says that same code is still live.
    pub telegram_pairing: Option<(String, TelegramPairingCode)>,
    /// Each bot's MCP connections, once loaded.
    pub mcp: HashMap<String, Vec<McpConnection>>,
    /// The bot whose MCP connections could not be loaded, and why.
    pub mcp_error: Option<(String, String)>,
    /// A connection is being added or changed.
    pub changing_mcp: bool,
    /// Why the last add or change failed, until the next attempt.
    pub mcp_change_error: Option<String>,
    /// What the last add said.
    pub mcp_message: Option<String>,
    /// A profile save is on its way.
    pub saving_profile: bool,
    /// Why the last profile save failed, until the next attempt.
    pub profile_error: Option<String>,
    pub bots: Vec<BotProfile>,
    pub bot_id: Option<String>,
    /// The live first page of sessions, newest first.
    pub sessions: Vec<SessionSummary>,
    /// Later pages the owner asked for.
    pub more_sessions: Vec<SessionSummary>,
    pub sessions_next: Option<String>,
    /// The selected bot's archived sessions, newest first; `None` until
    /// they are fetched (when the Archived filter is chosen).
    pub archived: Option<Vec<SessionSummary>>,
    /// The open conversation; `None` means a new, unsent conversation.
    pub conversation: Option<Conversation>,
    pub sending: bool,
    /// What was last heard from the bots that are not on screen, and
    /// every bot's job updates.
    pub inbox: Inbox,
    /// Whether a newer Raphie has been released.
    pub update: UpdateStatus,
    /// A Raphie installed on this computer that answered when last looked
    /// for, offered on the sign-in screen.
    pub local_install: Option<Origin>,
    /// Whether the signed-in Raphie answered its last check.
    pub reach: Reach,
    /// A check asked for from Settings → Account is on its way.
    pub checking_reach: bool,
    /// The subscription sign-in on screen, and whose bot it is for.
    pub sign_in: Option<(String, ProviderSignIn)>,
    /// A sign-in step waiting for the runtime's answer.
    pub sign_in_busy: bool,
    /// The last subscription sign-in that connected, failed or was
    /// cancelled, so a late "waiting" answer for it is ignored.
    pub finished_sign_in: Option<String>,
    /// Why the last sign-in step was refused.
    pub sign_in_error: Option<String>,
    /// The pictures of image attachments.
    pub previews: Previews,
    /// How the open session treats commands.
    pub command_mode: CommandMode,
    /// A change of the open session's model is on its way.
    pub choosing_model: bool,
    /// Why the last change of model failed, until the next attempt.
    pub model_error: Option<String>,
    /// The files waiting in the composer to go with the next message.
    pub attachments: AttachmentDraft,
    /// The id of the message file being saved to this machine, if one is.
    pub saving_attachment: Option<String>,
    /// Approvals with a decision on its way.
    pub deciding: HashSet<String>,
    /// Answers sent to a bot's questions and not yet confirmed, by question.
    pub answering: HashMap<String, AskAnswer>,
    /// A message for the owner, shown until dismissed or replaced.
    pub notice: Option<String>,
}

impl Default for Model {
    fn default() -> Model {
        Model {
            origin: None,
            auth: AuthState::SignedOut { notice: None },
            account: None,
            host_version: None,
            settings: HashMap::new(),
            settings_error: None,
            setting_model: false,
            model_message: None,
            changing_connection: false,
            connection_message: None,
            memory: HashMap::new(),
            memory_error: None,
            saving_memory: false,
            memory_save_error: None,
            testing_memory: false,
            memory_message: None,
            memories: MemoryBrowser::default(),
            skills: HashMap::new(),
            skills_error: None,
            skill: None,
            skill_error: None,
            changing_skill: false,
            skill_change_error: None,
            skill_message: None,
            owner: None,
            owner_error: None,
            saving_owner: false,
            owner_save_error: None,
            owner_message: None,
            sandbox: HashMap::new(),
            sandbox_error: None,
            saving_sandbox: false,
            sandbox_save_error: None,
            sandbox_message: None,
            bot_history: HashMap::new(),
            bot_history_error: None,
            creating_bot: false,
            deleting_bot: false,
            delete_bot_error: None,
            traces: TraceView::default(),
            activity: HashMap::new(),
            activity_failed: None,
            setting_telemetry: false,
            telemetry_error: None,
            exporting: false,
            export_saved: None,
            export_error: None,
            handoffs: HashMap::new(),
            cancelling_handoff: None,
            handoff_error: None,
            jobs: HashMap::new(),
            jobs_error: None,
            changing_job: false,
            job_error: None,
            job_message: None,
            runs: RunHistory::default(),
            files: WorkspaceBrowser::default(),
            channels: HashMap::new(),
            channels_error: None,
            channel_home: HashMap::new(),
            channel_home_error: None,
            changing_channel: false,
            channel_messages: HashMap::new(),
            channel_errors: HashMap::new(),
            telegram_pairing: None,
            mcp: HashMap::new(),
            mcp_error: None,
            changing_mcp: false,
            mcp_change_error: None,
            mcp_message: None,
            saving_profile: false,
            profile_error: None,
            bots: Vec::new(),
            bot_id: None,
            sessions: Vec::new(),
            more_sessions: Vec::new(),
            sessions_next: None,
            archived: None,
            conversation: None,
            sending: false,
            inbox: Inbox::default(),
            update: UpdateStatus::default(),
            finished_sign_in: None,
            local_install: None,
            reach: Reach::Up,
            checking_reach: false,
            sign_in: None,
            sign_in_busy: false,
            sign_in_error: None,
            previews: Previews::default(),
            command_mode: CommandMode::default(),
            choosing_model: false,
            model_error: None,
            attachments: AttachmentDraft::default(),
            saving_attachment: None,
            deciding: HashSet::new(),
            answering: HashMap::new(),
            notice: None,
        }
    }
}

impl Model {
    pub fn new() -> Model {
        Model::default()
    }

    /// Folds one event into the model, returning anything the UI must do once.
    pub fn apply(&mut self, event: Event) -> Vec<Effect> {
        match event {
            Event::Connecting { origin } => {
                self.origin = Some(origin);
                self.auth = AuthState::Connecting;
            }
            Event::DeviceCode(code) => self.auth = AuthState::AwaitingApproval(code),
            Event::SignedIn { origin } => {
                self.origin = Some(origin);
                self.auth = AuthState::SignedIn;
                self.reach = Reach::Up;
                self.host_version = None;
                self.notice = None;
            }
            Event::SignedOut { notice } => {
                // Keep the origin so the sign-in screen offers it again, and
                // what belongs to this app rather than the host: whether a
                // newer release is out, and a Raphie found on this computer.
                // Drop everything that belonged to the signed-in host.
                let origin = self.origin.take();
                let update = std::mem::take(&mut self.update);
                let local_install = self.local_install.take();
                *self = Model {
                    origin,
                    update,
                    local_install,
                    auth: AuthState::SignedOut { notice },
                    ..Model::default()
                };
            }
            Event::Account(account) => self.account = account,
            Event::HostVersion(version) => self.host_version = Some(version),
            Event::ConnectionChanged {
                bot_id,
                settings,
                message,
            } => {
                self.changing_connection = false;
                self.connection_message = Some(message);
                // A change (not a test) closes the form it came from.
                if let Some(settings) = settings {
                    self.settings.insert(bot_id, *settings);
                    return vec![Effect::CloseConnectionForm];
                }
            }
            Event::ConnectionFailed { message } => {
                self.changing_connection = false;
                self.connection_message = Some(message);
            }
            Event::BotSettings { bot_id, settings } => {
                self.settings_error = None;
                self.settings.insert(bot_id, *settings);
            }
            Event::BotSettingsFailed { bot_id, message } => {
                self.settings_error = Some((bot_id, message));
            }
            Event::DefaultModelSet { bot_id, settings } => {
                self.setting_model = false;
                // Say which model it is now, by its name in the new settings.
                let name = settings
                    .models
                    .iter()
                    .find(|model| {
                        model.id == settings.model_id && model.connection_id == settings.provider
                    })
                    .map_or(settings.model_id.clone(), |model| model.name.clone());
                self.model_message = Some(format!("{name} is now the default for new sessions."));
                self.settings.insert(bot_id, *settings);
            }
            Event::DefaultModelFailed { message } => {
                self.setting_model = false;
                self.model_message = Some(message);
            }
            Event::Memory { bot_id, status } => {
                self.memory_error = None;
                self.memory.insert(bot_id, status);
            }
            Event::MemoryFailed { bot_id, message } => {
                self.memory_error = Some((bot_id, message));
            }
            Event::MemorySaved { bot_id, status } => {
                self.saving_memory = false;
                self.memory_save_error = None;
                self.memory_message = Some("Memory settings saved.".to_owned());
                self.memory.insert(bot_id.clone(), status);
                return vec![Effect::MemorySaved(bot_id)];
            }
            Event::MemorySaveFailed { message } => {
                self.saving_memory = false;
                self.memory_save_error = Some(message);
            }
            Event::MemoryTested { message } => {
                self.testing_memory = false;
                self.memory_message = Some(message);
            }
            Event::BotHistory { bot_id, items } => {
                self.bot_history_error = None;
                self.bot_history.insert(bot_id, items);
            }
            Event::BotHistoryFailed { bot_id, message } => {
                self.bot_history_error = Some((bot_id, message));
            }
            Event::BotCreated(profile) => {
                self.creating_bot = false;
                self.profile_error = None;
                let id = profile.id.clone();
                // The list is read again too; until then show the new bot.
                if !self.bots.iter().any(|bot| bot.id == id) {
                    self.bots.push(profile);
                }
                return vec![Effect::BotCreated(id)];
            }
            Event::BotCreateFailed { message } => {
                self.creating_bot = false;
                // Shown where a failed profile save is: the form's save bar.
                self.profile_error = Some(message);
            }
            Event::BotDeleted { bot_id } => {
                self.deleting_bot = false;
                self.delete_bot_error = None;
                self.bots.retain(|bot| bot.id != bot_id);
                // Nothing of the bot's is kept here either.
                self.bot_history.remove(&bot_id);
                self.settings.remove(&bot_id);
                self.memory.remove(&bot_id);
                return vec![Effect::BotDeleted(bot_id)];
            }
            Event::BotDeleteFailed { message } => {
                self.deleting_bot = false;
                self.delete_bot_error = Some(message);
            }
            Event::Skills { bot_id, items } => {
                if self
                    .skills_error
                    .as_ref()
                    .is_some_and(|(id, _)| *id == bot_id)
                {
                    self.skills_error = None;
                }
                self.skills.insert(bot_id, items);
            }
            Event::SkillsFailed { bot_id, message } => {
                self.skills_error = Some((bot_id, message));
            }
            Event::Skill { bot_id, detail } => {
                self.skill_error = None;
                self.skill = Some((bot_id, *detail));
            }
            Event::SkillFailed { message } => self.skill_error = Some(message),
            Event::SkillChanged { bot_id, outcome } => {
                self.changing_skill = false;
                self.skill_change_error = None;
                self.skill_message = match &outcome {
                    SkillOutcome::Saved(_) => {
                        Some("Saved. The bot uses it from its next message.".into())
                    }
                    SkillOutcome::Imported(names) => {
                        Some(format!("Imported {}.", names.join(", ")))
                    }
                    SkillOutcome::Removed | SkillOutcome::Changed => None,
                };
                if let SkillOutcome::Saved(detail) = &outcome {
                    self.skill = Some((bot_id, (**detail).clone()));
                }
                return vec![Effect::SkillChanged(outcome)];
            }
            Event::SkillChangeFailed { message } => {
                self.changing_skill = false;
                self.skill_change_error = Some(message);
            }
            Event::Owner(owner) => {
                self.owner_error = None;
                self.owner = Some(owner);
            }
            Event::OwnerFailed { message } => self.owner_error = Some(message),
            Event::OwnerSaved(owner) => {
                self.saving_owner = false;
                self.owner_save_error = None;
                self.owner_message = Some("Saved. Every bot uses it from its next reply.".into());
                self.owner = Some(owner);
                return vec![Effect::OwnerSaved];
            }
            Event::OwnerSaveFailed { message } => {
                self.saving_owner = false;
                self.owner_save_error = Some(message);
            }
            Event::Sandbox { bot_id, info } => {
                self.sandbox_error = None;
                // `*info` moves the details out of their `Box`.
                self.sandbox.insert(bot_id, *info);
            }
            Event::SandboxFailed { bot_id, message } => {
                self.sandbox_error = Some((bot_id, message));
            }
            Event::SandboxSaved { bot_id, settings } => {
                self.saving_sandbox = false;
                self.sandbox_save_error = None;
                self.sandbox_message = Some(format!("Saved revision {}.", settings.revision));
                if let Some(info) = self.sandbox.get_mut(&bot_id) {
                    info.settings = settings;
                }
                return vec![Effect::SandboxSaved(bot_id)];
            }
            Event::SandboxSaveFailed { message } => {
                self.saving_sandbox = false;
                self.sandbox_save_error = Some(message);
            }
            Event::Traces {
                bot_id,
                hours,
                data,
            } => self.traces.loaded(&bot_id, hours, *data),
            Event::TracesFailed { bot_id, hours } => self.traces.load_failed(&bot_id, hours),
            Event::BotActivity { bot_id, items } => {
                if self.activity_failed.as_deref() == Some(bot_id.as_str()) {
                    self.activity_failed = None;
                }
                self.activity.insert(bot_id, items);
            }
            Event::BotActivityFailed { bot_id } => self.activity_failed = Some(bot_id),
            Event::TelemetrySet { bot_id, settings } => {
                self.setting_telemetry = false;
                self.telemetry_error = None;
                self.settings.insert(bot_id, *settings);
            }
            Event::TelemetryFailed { message } => {
                self.setting_telemetry = false;
                self.telemetry_error = Some(message);
            }
            Event::ExportSaved { saved_as } => {
                self.exporting = false;
                self.export_saved = Some(saved_as);
            }
            Event::ExportFailed { message } => {
                self.exporting = false;
                self.export_error = Some(message);
            }
            Event::Handoffs { bot_id, list } => {
                // A finished cancel shows in the list it brings.
                if self
                    .cancelling_handoff
                    .as_ref()
                    .is_some_and(|id| list.items.iter().any(|h| &h.id == id))
                {
                    self.cancelling_handoff = None;
                }
                self.handoffs.insert(bot_id, list);
            }
            Event::HandoffCancelled { id } => {
                if self.cancelling_handoff.as_deref() == Some(id.as_str()) {
                    self.cancelling_handoff = None;
                }
            }
            Event::HandoffCancelFailed { id, message } => {
                self.cancelling_handoff = None;
                self.handoff_error = Some((id, message));
            }
            Event::Jobs { bot_id, items } => {
                self.jobs_error = None;
                self.jobs.insert(bot_id, items);
            }
            Event::JobsFailed { bot_id, message } => {
                self.jobs_error = Some((bot_id, message));
            }
            Event::JobAdded { bot_id, items } => {
                self.changing_job = false;
                self.job_message =
                    Some("Job scheduled. The runtime must be running when it is due.".to_owned());
                self.jobs.insert(bot_id, items);
                return vec![Effect::JobAdded];
            }
            Event::JobChanged { bot_id, items, ran } => {
                self.changing_job = false;
                if ran {
                    self.job_message = Some(
                        "Run queued. Its result will appear in the job's conversation.".to_owned(),
                    );
                }
                self.jobs.insert(bot_id, items);
            }
            Event::JobChangeFailed { message } => {
                self.changing_job = false;
                self.job_error = Some(message);
            }
            Event::JobRuns {
                ticket,
                older,
                page,
            } => self.runs.loaded(ticket, older, page),
            Event::JobRunsFailed {
                ticket,
                older,
                message,
            } => self.runs.failed(ticket, older, message),
            Event::WorkspaceFiles { bot_id, listing } => self.files.listed(&bot_id, listing),
            Event::WorkspaceFilesFailed {
                bot_id,
                path,
                message,
            } => self.files.failed(&bot_id, &path, message),
            Event::FileDownloaded { saved_as } => self.files.downloaded(saved_as),
            Event::FileDownloadFailed { message } => self.files.download_failed(message),
            Event::Channels { bot_id, settings } => {
                self.channels_error = None;
                self.channels.insert(bot_id, settings);
            }
            Event::ChannelsFailed { bot_id, message } => {
                self.channels_error = Some((bot_id, message));
            }
            Event::ChannelHome { bot_id, home } => {
                // Also the answer to choosing a home channel.
                if self
                    .channel_home_error
                    .as_ref()
                    .is_some_and(|(bot, _)| *bot == bot_id)
                {
                    self.channel_home_error = None;
                }
                self.channel_home.insert(bot_id, home);
            }
            Event::ChannelHomeFailed { bot_id, message } => {
                self.channel_home_error = Some((bot_id, message));
            }
            Event::ChannelChanged {
                bot_id,
                outcome,
                settings,
                pairing,
            } => {
                self.changing_channel = false;
                if let Some(message) = outcome.message() {
                    self.channel_messages
                        .insert(outcome.channel(), message.to_owned());
                }
                if let Some(settings) = settings {
                    self.channels.insert(bot_id.clone(), settings);
                }
                match (outcome, pairing) {
                    (_, Some(code)) => self.telegram_pairing = Some((bot_id, code)),
                    // A removed connection's code is of no use to anyone.
                    (ChannelOutcome::TelegramRemoved, None) => self.telegram_pairing = None,
                    _ => {}
                }
                return vec![Effect::ChannelChanged(outcome)];
            }
            Event::ChannelChangeFailed { channel, message } => {
                self.changing_channel = false;
                self.channel_errors.insert(channel, message);
            }
            Event::Mcp { bot_id, items } => {
                self.mcp_error = None;
                self.mcp.insert(bot_id, items);
            }
            Event::McpFailed { bot_id, message } => {
                self.mcp_error = Some((bot_id, message));
            }
            Event::McpAdded { bot_id, items } => {
                self.changing_mcp = false;
                // A server that needs a sign-in comes back with a link.
                let waiting = items.iter().any(|item| item.authorization_url.is_some());
                self.mcp_message = Some(
                    if waiting {
                        "Server added. Choose Authorize to sign in and grant access."
                    } else {
                        "Connected. These tools are available only to this bot."
                    }
                    .to_owned(),
                );
                self.mcp.insert(bot_id, items);
                return vec![Effect::McpAdded];
            }
            Event::McpChanged { bot_id, items } => {
                self.changing_mcp = false;
                self.mcp.insert(bot_id, items);
            }
            Event::McpChangeFailed { message } => {
                self.changing_mcp = false;
                self.mcp_change_error = Some(message);
            }
            Event::MemoryListed { ticket, more, page } => self.memories.listed(ticket, more, page),
            Event::MemoryRecalled { ticket, evidence } => self.memories.recalled(ticket, evidence),
            Event::MemoryLoadFailed {
                ticket,
                more,
                message,
            } => self.memories.load_failed(ticket, more, message),
            Event::MemoryRevised { id, content } => {
                self.memories.revised(&id, content);
                return vec![Effect::MemoryChanged(id)];
            }
            Event::MemoryForgotten { id } => {
                self.memories.forgotten(&id);
                return vec![Effect::MemoryChanged(id)];
            }
            Event::MemoryChangeFailed { message } => self.memories.change_failed(message),
            Event::ProfileSaved(profile) => {
                self.saving_profile = false;
                self.profile_error = None;
                // Replace the bot in the list with what the host now has.
                if let Some(bot) = self.bots.iter_mut().find(|bot| bot.id == profile.id) {
                    *bot = profile.clone();
                }
                return vec![Effect::ProfileSaved(profile)];
            }
            Event::ProfileFailed { message, .. } => {
                self.saving_profile = false;
                self.profile_error = Some(message);
            }
            Event::Bots(bots) => self.bots = bots,
            Event::BotSelected { bot_id } => self.select_bot(bot_id),
            Event::Sessions { bot_id, page, more } => {
                if self.bot_id.as_deref() == Some(bot_id.as_str()) {
                    self.sessions_page(page, more);
                }
            }
            Event::ArchivedSessions { bot_id, sessions } => {
                if self.bot_id.as_deref() == Some(bot_id.as_str()) {
                    self.archived = Some(sessions);
                }
            }
            Event::ArchivedFailed { bot_id, message } => {
                if self.bot_id.as_deref() == Some(bot_id.as_str()) {
                    // An empty list rather than one loading for ever; the
                    // notice says why.
                    self.archived.get_or_insert_with(Vec::new);
                    self.notice = Some(message);
                }
            }
            Event::Archived {
                bot_id,
                session_id,
                archived_at,
            } => {
                if self.bot_id.as_deref() == Some(bot_id.as_str()) {
                    self.archived_changed(&session_id, archived_at);
                }
            }
            Event::SessionCreated { bot_id, session_id } => {
                // Only follow the new session if the owner is still on that
                // bot's new conversation.
                if self.bot_id.as_deref() == Some(bot_id.as_str()) && self.conversation.is_none() {
                    self.conversation = Some(Conversation::new(session_id));
                }
            }
            Event::Observation {
                session_id,
                observation,
            } => {
                if let Some(conversation) = self.open(&session_id) {
                    conversation.observe(*observation);
                }
            }
            Event::Stream { session_id, status } => {
                if let Some(conversation) = self.open(&session_id) {
                    conversation.stream = status;
                }
            }
            Event::OlderTurns { session_id, page } => {
                if let Some(conversation) = self.open(&session_id) {
                    conversation.prepend(page);
                }
            }
            Event::OlderFailed {
                session_id,
                message,
            } => {
                if let Some(conversation) = self.open(&session_id) {
                    conversation.loading_older = false;
                    self.notice = Some(message);
                }
            }
            Event::MessageAccepted { receipt: _ } => {
                self.sending = false;
                self.attachments.sent();
                return vec![Effect::ClearComposer];
            }
            Event::MessageFailed { message } => {
                // The draft stays in the composer so nothing typed is lost.
                self.sending = false;
                self.attachments.not_sent();
                self.notice = Some(message);
            }
            Event::InboxSessions { bot_id, sessions } => {
                self.inbox.sessions_loaded(bot_id, sessions);
            }
            Event::JobUpdates { bot_id, updates } => self.inbox.jobs_loaded(bot_id, updates),
            Event::JobUpdatesFailed { bot_id } => self.inbox.jobs_failed(bot_id),
            Event::RunAcknowledged { bot_id, run_id } => {
                self.inbox.acknowledged(&bot_id, &run_id);
            }
            Event::RunAcknowledgeFailed => self.inbox.acknowledge_failed(),
            Event::PreviewLoaded { bot_id, id, bytes } => {
                self.previews.loaded(&bot_id, &id, bytes);
            }
            Event::PreviewFailed { bot_id, id } => self.previews.failed(&bot_id, &id),
            Event::ProviderSignIn { bot_id, sign_in } => {
                // A sign-in that ended stays ended: a poll answered before
                // it connected can arrive after, and must not bring it back.
                if sign_in.status == SignInStatus::Waiting
                    && self.finished_sign_in.as_deref() == Some(sign_in.id.as_str())
                {
                    return Vec::new();
                }
                if sign_in.status != SignInStatus::Waiting {
                    self.finished_sign_in = Some(sign_in.id.clone());
                }
                self.sign_in_busy = false;
                self.sign_in_error = None;
                let connected = sign_in.status == SignInStatus::Connected;
                self.sign_in = Some((bot_id.clone(), sign_in));
                if connected {
                    return vec![Effect::SignedIn(bot_id)];
                }
            }
            Event::ProviderSignInFailed { bot_id: _, message } => {
                self.sign_in_busy = false;
                self.sign_in_error = Some(message);
            }
            Event::LocalInstall(found) => self.local_install = found,
            Event::Reach(reach) => {
                self.reach = reach;
                self.checking_reach = false;
            }
            Event::UpdateChecked(result) => {
                self.update = match result {
                    Ok(Some(update)) => UpdateStatus::Available(update),
                    Ok(None) => UpdateStatus::UpToDate,
                    Err(why) => UpdateStatus::Failed(why),
                };
            }
            Event::ApprovalMode { session_id, mode } => {
                self.command_mode.loaded(&session_id, mode);
            }
            Event::ApprovalModeFailed { session_id } => self.command_mode.load_failed(&session_id),
            Event::ApprovalModeSaved { session_id, mode } => {
                self.command_mode.saved(&session_id, mode);
            }
            Event::ApprovalModeSaveFailed { session_id } => {
                self.command_mode.save_failed(&session_id);
            }
            Event::ModelChosen { session_id, model } => {
                self.choosing_model = false;
                // The session is listed (maybe twice) and may be open; each
                // copy learns its new model without waiting for the stream.
                let listed = self.sessions.iter_mut().chain(&mut self.more_sessions);
                let open = self
                    .conversation
                    .as_mut()
                    .and_then(|conversation| conversation.observation.as_mut())
                    .map(|observation| &mut observation.session);
                for session in listed.chain(open) {
                    if session.id == session_id {
                        session.model = Some(model.clone());
                    }
                }
                return vec![Effect::ModelChosen];
            }
            Event::ModelChoiceFailed { message } => {
                self.choosing_model = false;
                self.model_error = Some(message);
            }
            Event::Attached { bot_id, file } => self.attachments.added(&bot_id, file),
            Event::AttachFailed { bot_id, message } => self.attachments.failed(&bot_id, message),
            Event::AttachFinished { bot_id } => self.attachments.finished(&bot_id),
            Event::AttachmentSaved { saved_as } => {
                self.saving_attachment = None;
                self.notice = Some(format!("Saved to your Downloads folder as {saved_as}."));
            }
            Event::AttachmentSaveFailed { message } => {
                self.saving_attachment = None;
                self.notice = Some(message);
            }
            Event::Decided {
                approval_id,
                outcome,
            } => {
                self.deciding.remove(&approval_id);
                self.notice = match outcome {
                    DecisionOutcome::Applied => None,
                    DecisionOutcome::AlreadySettled(status) => Some(settled_notice(status)),
                    DecisionOutcome::Gone => {
                        Some("That approval is no longer available.".to_owned())
                    }
                    DecisionOutcome::Failed(message) => Some(message),
                };
            }
            Event::Answered { ask_id, outcome } => {
                self.answering.remove(&ask_id);
                self.notice = match outcome {
                    AnswerOutcome::Applied => None,
                    AnswerOutcome::Late => {
                        Some("That question is no longer waiting for an answer.".to_owned())
                    }
                    AnswerOutcome::Gone => Some("That question is no longer available.".to_owned()),
                    AnswerOutcome::Failed(message) => Some(message),
                };
            }
            Event::Problem(message) => self.notice = Some(message),
        }
        Vec::new()
    }

    /// The owner chose a bot (or the engine chose the default one).
    pub fn select_bot(&mut self, bot_id: String) {
        if self.bot_id.as_deref() != Some(bot_id.as_str()) {
            self.bot_id = Some(bot_id);
            self.sessions.clear();
            self.more_sessions.clear();
            self.sessions_next = None;
            self.archived = None;
            self.conversation = None;
        }
    }

    /// A session was archived or brought back. The live list and the
    /// archived one are sent again; until then, each copy changes here.
    fn archived_changed(&mut self, session_id: &str, archived_at: Option<i64>) {
        if archived_at.is_some() {
            self.sessions.retain(|session| session.id != session_id);
            self.more_sessions
                .retain(|session| session.id != session_id);
        } else if let Some(archived) = &mut self.archived {
            archived.retain(|session| session.id != session_id);
        }
        let open = self
            .conversation
            .as_mut()
            .filter(|conversation| conversation.session_id == session_id)
            .and_then(|conversation| conversation.observation.as_mut());
        if let Some(observation) = open {
            observation.session.archived_at = archived_at;
        }
    }

    /// Whether the open conversation is archived.
    pub fn open_archived(&self) -> bool {
        let Some(conversation) = &self.conversation else {
            return false;
        };
        match &conversation.observation {
            Some(observation) => observation.session.archived_at.is_some(),
            // Before its first observation, the archived list knows.
            None => self.archived.as_ref().is_some_and(|archived| {
                archived
                    .iter()
                    .any(|session| session.id == conversation.session_id)
            }),
        }
    }

    /// The owner opened a session, or `None` for a new conversation.
    pub fn select_session(&mut self, session_id: Option<String>) {
        let current = self.conversation.as_ref().map(|c| c.session_id.as_str());
        if current != session_id.as_deref() {
            self.conversation = session_id.map(Conversation::new);
        }
    }

    /// The owner asked for earlier messages. Returns the cursor to request, or
    /// `None` when there is nothing to load (or a load is already running).
    pub fn begin_load_older(&mut self) -> Option<String> {
        let conversation = self.conversation.as_mut()?;
        if conversation.loading_older {
            return None;
        }
        let cursor = conversation.older_cursor()?;
        conversation.loading_older = true;
        Some(cursor)
    }

    /// The owner chose a model for the open session. Returns false while
    /// an earlier choice is on its way.
    pub fn begin_choose_model(&mut self) -> bool {
        if self.choosing_model {
            return false;
        }
        self.choosing_model = true;
        self.model_error = None;
        true
    }

    /// The model the open session answers with, if one was chosen for it.
    pub fn session_model(&self) -> Option<&ModelSelection> {
        let open = self.conversation.as_ref()?;
        // The observation is the freshest; the list covers the moment
        // before the stream's first event.
        let observed = open.observation.as_ref().map(|seen| &seen.session);
        let listed = self
            .sessions
            .iter()
            .chain(&self.more_sessions)
            .find(|session| session.id == open.session_id);
        observed.or(listed)?.model.as_ref()
    }

    /// The owner asked to save a message's file. Returns false while
    /// another is being saved.
    pub fn begin_save_attachment(&mut self, id: &str) -> bool {
        if self.saving_attachment.is_some() {
            return false;
        }
        self.saving_attachment = Some(id.to_owned());
        self.notice = None;
        true
    }

    /// The owner sent a message. Returns false when one is already on its way.
    pub fn begin_send(&mut self) -> bool {
        if self.sending {
            return false;
        }
        self.sending = true;
        self.notice = None;
        true
    }

    /// The owner saved memory settings. Returns false while a save or a
    /// test is on its way.
    pub fn begin_save_memory(&mut self) -> bool {
        if self.saving_memory || self.testing_memory {
            return false;
        }
        self.saving_memory = true;
        self.memory_save_error = None;
        self.memory_message = None;
        true
    }

    /// The owner flipped the telemetry switch. Returns false while a change
    /// is already on its way.
    pub fn begin_set_telemetry(&mut self) -> bool {
        if self.setting_telemetry {
            return false;
        }
        self.setting_telemetry = true;
        self.telemetry_error = None;
        true
    }

    /// The owner asked for an export. Returns false while one is being
    /// written.
    pub fn begin_export(&mut self) -> bool {
        if self.exporting {
            return false;
        }
        self.exporting = true;
        self.export_saved = None;
        self.export_error = None;
        true
    }

    /// The owner scheduled or changed a job. Returns false while another
    /// change is on its way.
    pub fn begin_change_job(&mut self) -> bool {
        if self.changing_job {
            return false;
        }
        self.changing_job = true;
        self.job_error = None;
        self.job_message = None;
        true
    }

    /// The owner created a bot. Returns false while one is being created.
    pub fn begin_create_bot(&mut self) -> bool {
        if self.creating_bot {
            return false;
        }
        self.creating_bot = true;
        self.profile_error = None;
        true
    }

    /// The owner confirmed deleting a bot. Returns false while a delete is
    /// already on its way.
    pub fn begin_delete_bot(&mut self) -> bool {
        if self.deleting_bot {
            return false;
        }
        self.deleting_bot = true;
        self.delete_bot_error = None;
        true
    }

    /// The owner changed a skill. Returns false while another change is on
    /// its way.
    pub fn begin_change_skill(&mut self) -> bool {
        if self.changing_skill {
            return false;
        }
        self.changing_skill = true;
        self.skill_change_error = None;
        self.skill_message = None;
        true
    }

    /// The owner saved their profile. Returns false while a save is
    /// already on its way.
    pub fn begin_save_owner(&mut self) -> bool {
        if self.saving_owner {
            return false;
        }
        self.saving_owner = true;
        self.owner_save_error = None;
        self.owner_message = None;
        true
    }

    /// The owner saved sandbox settings. Returns false while a save is
    /// already on its way.
    pub fn begin_save_sandbox(&mut self) -> bool {
        if self.saving_sandbox {
            return false;
        }
        self.saving_sandbox = true;
        self.sandbox_save_error = None;
        self.sandbox_message = None;
        true
    }

    /// The owner changed something on the Channels page. Returns false
    /// while another change is on its way.
    pub fn begin_change_channel(&mut self, channel: Channel) -> bool {
        if self.changing_channel {
            return false;
        }
        self.changing_channel = true;
        self.channel_messages.remove(&channel);
        self.channel_errors.remove(&channel);
        true
    }

    /// The pairing code to show for `bot_id`: the one that was issued, as
    /// long as the runtime says that same code has not been used or expired.
    pub fn live_pairing(&self, bot_id: &str) -> Option<&TelegramPairingCode> {
        let (bot, code) = self.telegram_pairing.as_ref()?;
        let telegram = self.channels.get(bot_id)?.telegram.as_ref()?;
        (bot == bot_id && telegram.pairing_expires_at == Some(code.expires_at)).then_some(code)
    }

    /// The owner added or changed an MCP connection. Returns false while
    /// another change is on its way.
    pub fn begin_change_mcp(&mut self) -> bool {
        if self.changing_mcp {
            return false;
        }
        self.changing_mcp = true;
        self.mcp_change_error = None;
        self.mcp_message = None;
        true
    }

    /// The owner asked for a test of the memory back end. Returns false
    /// while a save or a test is on its way.
    pub fn begin_test_memory(&mut self) -> bool {
        if self.saving_memory || self.testing_memory {
            return false;
        }
        self.testing_memory = true;
        self.memory_message = None;
        true
    }

    /// The owner picked a default model. Returns false when a change is
    /// already on its way.
    pub fn begin_set_model(&mut self) -> bool {
        if self.setting_model {
            return false;
        }
        self.setting_model = true;
        self.model_message = None;
        true
    }

    /// The owner changed or tested a connection. Returns false when one is
    /// already on its way.
    pub fn begin_change_connection(&mut self) -> bool {
        if self.changing_connection {
            return false;
        }
        self.changing_connection = true;
        self.connection_message = None;
        true
    }

    /// The owner saved a profile. Returns false when a save is already on
    /// its way.
    pub fn begin_save_profile(&mut self) -> bool {
        if self.saving_profile {
            return false;
        }
        self.saving_profile = true;
        self.profile_error = None;
        true
    }

    /// The owner decided an approval. Returns false if a decision for it is
    /// already on its way, so double clicks send one request.
    /// Marks `ask_id` as being answered; false when an answer is on its way.
    pub fn begin_answer(&mut self, ask_id: &str, answer: AskAnswer) -> bool {
        if self.answering.contains_key(ask_id) {
            return false;
        }
        self.answering.insert(ask_id.to_owned(), answer);
        true
    }

    pub fn begin_decide(&mut self, approval_id: &str) -> bool {
        self.deciding.insert(approval_id.to_owned())
    }

    /// The session list as shown: the live first page, then later pages.
    /// Archived sessions are never in it; the runtime leaves them out too.
    pub fn session_list(&self) -> impl Iterator<Item = &SessionSummary> {
        let first: HashSet<&str> = self.sessions.iter().map(|s| s.id.as_str()).collect();
        self.sessions
            .iter()
            .chain(
                self.more_sessions
                    .iter()
                    .filter(move |s| !first.contains(s.id.as_str())),
            )
            .filter(|s| s.archived_at.is_none())
    }

    pub fn selected_bot(&self) -> Option<&BotProfile> {
        let id = self.bot_id.as_deref()?;
        self.bots.iter().find(|b| b.id == id)
    }

    fn sessions_page(&mut self, page: Page<SessionSummary>, more: bool) {
        if more {
            self.more_sessions.extend(page.items);
            self.sessions_next = page.next;
        } else {
            // The live first page replaces itself. Keep a cursor we already
            // advanced past it.
            if self.more_sessions.is_empty() {
                self.sessions_next = page.next;
            }
            self.sessions = page.items;
        }
    }

    fn open(&mut self, session_id: &str) -> Option<&mut Conversation> {
        self.conversation
            .as_mut()
            .filter(|c| c.session_id == session_id)
    }
}

fn settled_notice(status: ApprovalStatus) -> String {
    match status {
        ApprovalStatus::Approved => "That action had already been approved.".into(),
        ApprovalStatus::Rejected => "That action had already been rejected.".into(),
        ApprovalStatus::Expired => "That approval expired before your decision arrived.".into(),
        ApprovalStatus::Pending | ApprovalStatus::Unknown => {
            "The approval is still waiting; try again.".into()
        }
    }
}
