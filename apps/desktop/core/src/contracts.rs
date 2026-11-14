//! Rust mirrors of the parts of `@raphie/contracts` this client uses.
//!
//! # Keeping these in sync
//!
//! The source of truth is TypeScript: `packages/contracts/src` (read models)
//! and the route handlers named next to each type below (request bodies and
//! device sign-in, which are not in the contracts package). Only the fields
//! the desktop app reads are mirrored. Serde ignores fields it does not know,
//! so the runtime can add fields without breaking this client; removing or
//! renaming a field it does read is a breaking change and must update this
//! file in the same change.
//!
//! Enums that the runtime may grow (phases, statuses) carry an `Unknown`
//! variant marked `#[serde(other)]`, so a newer runtime degrades to a neutral
//! display instead of failing to decode a whole observation.
//!
//! Generating these from the TypeScript types is a proposed follow-up (see
//! `docs/desktop.md`); until then, the decoding tests in `tests/contracts.rs`
//! use JSON captured from the runtime's own shapes.

use serde::{Deserialize, Serialize};

/// `Page<T>` in `packages/contracts/src/sessions/views.ts`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Page<T> {
    pub items: Vec<T>,
    /// Cursor for the next page, or `None` at the end.
    pub next: Option<String>,
}

/// `BotProfile` in `packages/contracts/src/bots/views.ts`, as listed by
/// `GET /api/bots` (`{ items: BotProfile[] }`).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BotProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Six-digit hex colour chosen by the owner, if any.
    #[serde(default)]
    pub color: Option<String>,
    /// The bot's personality (its SOUL.md): tone, values, working style.
    #[serde(default)]
    pub soul: String,
    /// Counts saves. A save names the revision it was edited from, so two
    /// clients cannot silently overwrite each other.
    #[serde(default)]
    pub revision: u32,
}

/// Body of `POST /api/bots/<id>/profile`
/// (`packages/runtime/src/domains/bots/presentation/http/routes.ts`).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct UpdateBotProfile {
    pub name: String,
    pub description: String,
    pub soul: String,
    /// `None` is sent as `null`: let Raphie pick a colour.
    pub color: Option<String>,
    /// The revision these edits started from.
    pub revision: u32,
}

/// The administrator signed in to the host, from `GET /auth/status`
/// (`apps/web/src/infrastructure/auth/gateway.ts`).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub email: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct AuthStatus {
    #[serde(default)]
    pub account: Option<Account>,
}

/// The body of `GET /api/bots`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct BotList {
    pub items: Vec<BotProfile>,
}

/// `Channel` in `packages/contracts/src/index.ts`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Web,
    Discord,
    Telegram,
    #[serde(other)]
    Unknown,
}

/// `SessionSummary` in `packages/contracts/src/sessions/views.ts`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    /// Public session UUID (the same value as `sessionId`).
    pub id: String,
    pub title: String,
    pub origin: Channel,
    /// Milliseconds since the Unix epoch.
    pub last_at: i64,
    pub working: bool,
    pub failed: bool,
    pub waiting: bool,
    pub preview: String,
    pub turn_count: u32,
    #[serde(default)]
    pub reply_preview: Option<String>,
}

/// `Turn["status"]` in `packages/contracts/src/index.ts`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TurnStatus {
    Pending,
    Done,
    Error,
    #[serde(other)]
    Unknown,
}

/// `Turn["scheduled"]`: present when a scheduled job started the turn.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ScheduledBy {
    pub name: String,
}

/// `SessionTurn` in `packages/contracts/src/sessions/views.ts`: one owner
/// message and the reply that answers it.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTurn {
    pub id: String,
    pub source: Channel,
    /// The owner's message.
    pub text: String,
    pub created_at: i64,
    pub status: TurnStatus,
    /// The finished reply (Markdown), if any.
    pub answer: Option<String>,
    #[serde(default)]
    pub cancelled: Option<bool>,
    #[serde(default)]
    pub scheduled: Option<ScheduledBy>,
    /// Set while the message waits behind the run in progress.
    #[serde(default)]
    pub queue_mode: Option<QueueMode>,
}

/// `Turn["queueMode"]`: how a message sent during a run joins it.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QueueMode {
    /// Answered after the current run finishes.
    FollowUp,
    /// Handed to the current run after its next step.
    Steer,
    #[serde(other)]
    Unknown,
}

/// `ApprovalStatus` in `packages/contracts/src/index.ts`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
    #[serde(other)]
    Unknown,
}

/// `SessionApproval` in `packages/contracts/src/sessions/views.ts`: an exact
/// proposed action waiting for (or settled by) an owner decision.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionApproval {
    pub id: String,
    pub server: String,
    pub tool: String,
    /// The exact arguments, as JSON text. Shown to the owner before deciding.
    pub arguments_json: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub status: ApprovalStatus,
    /// The channel the decision came from, once there is one.
    #[serde(default)]
    pub decided_via: Option<Channel>,
    /// How far the approved action got.
    #[serde(default)]
    pub execution: Execution,
    /// Which connection proposed the action. Command approvals carry
    /// `raphie.workspace.command`.
    #[serde(default)]
    pub connection_identity: Option<String>,
}

/// `ToolApprovalView["execution"]` in `packages/contracts/src/index.ts`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Execution {
    #[default]
    Waiting,
    Running,
    Done,
    /// The action may or may not have run (the runtime lost track of it).
    Uncertain,
    #[serde(other)]
    Unknown,
}

impl SessionApproval {
    /// Whether "Approve for session" applies: the runtime grants session
    /// scope for command approvals only (the web's `ToolDecision`).
    pub fn allows_session_scope(&self) -> bool {
        self.server == "workspace"
            && self.connection_identity.as_deref() == Some("raphie.workspace.command")
            && (self.tool == "bash" || self.tool == "workspace_exec")
    }
}

/// `LiveConversation` in `packages/contracts/src/index.ts`: the reply text
/// streamed so far for the turn being answered.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct LiveConversation {
    pub text: String,
    pub generating: bool,
}

/// `SessionActivity` in `packages/contracts/src/sessions/views.ts`: one
/// entry of the runtime's journal (a model call, a tool call, an approval).
/// `projections.rs` turns these into tool steps and usage.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivity {
    pub id: i64,
    /// Milliseconds since the Unix epoch.
    pub at: i64,
    /// The turn this happened in, when known.
    pub run_id: Option<String>,
    /// A tool call id or an approval id, tying related events together.
    pub operation_id: Option<String>,
    /// `model.completed`, `tool.started`, `approval.requested`, ... `type` is
    /// a Rust keyword, so the field is `kind` here.
    #[serde(rename = "type")]
    pub kind: String,
    pub summary: String,
    /// Extra data as JSON text; `{}` when there is none.
    pub details_json: String,
}

/// `RunPhase` in `packages/contracts/src/sessions/views.ts`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunPhase {
    Idle,
    Queued,
    Model,
    Writing,
    Tool,
    Approval,
    Failed,
    #[serde(other)]
    Unknown,
}

/// `SessionObservation["error"]`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ObservationError {
    pub code: String,
    pub message: String,
}

/// `SessionObservation` in `packages/contracts/src/sessions/views.ts`. Each
/// event on `GET /api/sessions/<id>/events` is one whole observation that
/// replaces the previous one.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionObservation {
    pub session: SessionSummary,
    /// The most recent turns, oldest first.
    pub turns: Vec<SessionTurn>,
    pub tool_approvals: Vec<SessionApproval>,
    pub live: Option<LiveConversation>,
    /// The session's latest journal entries (at most 200), oldest first.
    #[serde(default)]
    pub activity: Vec<SessionActivity>,
    /// History cursor for turns older than `turns`, or `None` at the start.
    pub next_before: Option<String>,
    pub phase: RunPhase,
    pub error: Option<ObservationError>,
}

/// Body of `POST /api/sessions/messages`
/// (`packages/runtime/src/domains/conversations/presentation/http/routes.ts`).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitMessage {
    pub text: String,
    /// Stable per message: resending the same id and text returns the same
    /// receipt instead of admitting the message twice.
    pub event_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// The runtime's receipt for an admitted message. Admission, not completion.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub id: String,
    pub session_id: String,
}

/// An owner decision, as sent to `POST /api/tool-approvals/<id>`
/// (`packages/runtime/src/domains/approvals/presentation/http/routes.ts`).
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Approved,
    Rejected,
}

/// How far an approval reaches.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// This one invocation.
    Once,
    /// The same command with the same arguments for the rest of this
    /// conversation. Command approvals only.
    Session,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct DecisionBody {
    pub decision: Decision,
    pub scope: Scope,
}

/// What to do with a run or a queued message, as sent to
/// `POST /api/sessions/<id>/control`
/// (`packages/runtime/src/domains/conversations/presentation/http/routes.ts`).
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ControlAction {
    /// Stop the run in progress.
    Stop,
    /// Hand a queued message to the run after its next step.
    Steer,
    /// Keep a message queued until the run finishes.
    Queue,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlBody<'a> {
    pub action: ControlAction,
    /// The queued message that `steer` or `queue` is about.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<&'a str>,
}

/// The runtime answers a decision with the approval's status *after* it.
/// Settled approvals are immutable, so a stale decision returns the earlier
/// outcome (or `expired`) rather than an error.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct DecisionResult {
    pub status: ApprovalStatus,
}

/// `POST /api/auth/device/code` response (Better Auth's device authorization
/// plugin, behind `apps/web/src/infrastructure/auth/gateway.ts`).
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri_complete: String,
    /// Seconds between polls.
    pub interval: u64,
    /// Seconds until the code expires.
    pub expires_in: u64,
}

/// `POST /api/auth/device/token` response: a token, or an OAuth error code
/// (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`).
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct DeviceTokenResponse {
    pub access_token: Option<String>,
    pub error: Option<String>,
}

/// The JSON error body the web host and runtime return: `{ error, code? }`.
#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct ErrorBody {
    pub error: Option<String>,
    pub code: Option<String>,
}
