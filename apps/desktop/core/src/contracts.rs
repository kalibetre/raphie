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
//! `apps/docs/src/content/docs/contribute/desktop-development.mdx`); until then, the decoding tests in `tests/contracts.rs`
//! use JSON captured from the runtime's own shapes.

use serde::{Deserialize, Serialize};

use crate::mcp::{McpAction, McpTransport};

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
    /// The bot's personality: tone, values, working style.
    #[serde(default)]
    pub personality: String,
    /// How it writes its replies. Older runtimes omit it: the defaults.
    #[serde(default)]
    pub reply_style: ReplyStyle,
    /// What the bot may change by itself. Older runtimes omit it: `None`,
    /// and the profile page leaves the switches out.
    #[serde(default)]
    pub self_updates: Option<SelfUpdates>,
    /// Who saved this revision: `"owner"` or `"bot"`. Absent on revisions
    /// saved before bots could.
    #[serde(default)]
    pub changed_by: Option<String>,
    /// Counts saves. A save names the revision it was edited from, so two
    /// clients cannot silently overwrite each other.
    #[serde(default)]
    pub revision: u32,
}

/// `SelfUpdates` in `packages/contracts/src/bots/views.ts`: what a bot may
/// change by itself, without asking. Each change is saved at once, shown in
/// the conversation, and can be undone.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SelfUpdates {
    /// Its own personality, saved as a new revision.
    pub personality: bool,
    /// The owner's profile, shared by every bot.
    pub owner: bool,
    /// Its own skills: writing new ones and editing any of them. On when a
    /// runtime older than the switch does not send it, as it then allows it.
    #[serde(default = "allowed")]
    pub skills: bool,
}

fn allowed() -> bool {
    true
}

impl SelfUpdates {
    /// What a new bot may change: its personality and skills, not the
    /// owner's profile.
    pub const NEW_BOT: SelfUpdates = SelfUpdates {
        personality: true,
        owner: false,
        skills: true,
    };
}

/// `PersonalityPreset`: a built-in personality to start a bot from, as
/// `GET /api/bots/personalities` lists them.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct PersonalityPreset {
    pub id: String,
    pub name: String,
    /// One line on what the personality is like.
    #[serde(default)]
    pub summary: String,
    pub personality: String,
}

/// What `GET /api/bots/personalities` answers.
#[derive(Debug, Deserialize)]
pub(crate) struct PersonalityPresetList {
    pub items: Vec<PersonalityPreset>,
}

/// `ReplyStyle` in `packages/contracts/src/bots/views.ts`: how a bot writes
/// its replies. The defaults keep them short and plain.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ReplyStyle {
    pub length: ReplyLength,
    pub warmth: ReplyWarmth,
    pub formatting: ReplyFormatting,
    pub emoji: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReplyLength {
    /// The answer first; most replies under 80 words.
    #[default]
    Short,
    Balanced,
    Detailed,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReplyWarmth {
    Plain,
    #[default]
    Default,
    Warm,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReplyFormatting {
    /// Short plain paragraphs.
    Prose,
    /// Short lists or tables rather than paragraphs.
    #[default]
    Default,
    /// Headings, lists and tables.
    Structured,
}

/// `SkillSummary` in `packages/contracts/src/skills/views.ts`: one of a
/// bot's skills, kept in its workspace at `skills/<name>/SKILL.md`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Off skills stay in the workspace but are not offered to the bot.
    pub enabled: bool,
    /// Paths inside the skill's folder, `SKILL.md` first.
    #[serde(default)]
    pub files: Vec<String>,
    /// Why the bot cannot use it, if it cannot.
    #[serde(default)]
    pub problem: Option<String>,
    /// The bot's last change to it with `save_skill`, unless the owner has
    /// saved it since.
    #[serde(default)]
    pub bot_change: Option<SkillBotChange>,
}

/// `SkillChangeKind`: whether the bot made the skill or edited it.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SkillChangeKind {
    Created,
    Edited,
}

/// `SkillSummary.botChange`: the bot's last change, as Settings shows it.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub struct SkillBotChange {
    pub kind: SkillChangeKind,
    /// Milliseconds since the epoch, on the runtime's clock.
    pub at: i64,
}

/// `SkillChange` in `packages/contracts/src/skills/views.ts`: a change the
/// bot made to a skill with `save_skill`, as its reply shows it.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillChange {
    pub id: String,
    /// The `save_skill` call that made it, as the reply's step names it.
    pub call_id: String,
    pub name: String,
    pub kind: SkillChangeKind,
    pub at: i64,
    /// While the skill is as the bot left it and nothing changed it since.
    pub undoable: bool,
    /// The owner undid it.
    #[serde(default)]
    pub undone: bool,
}

/// `GET /api/skills`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SkillList {
    pub items: Vec<SkillSummary>,
}

/// `SkillFile`: one file of a skill; files that are not text have none.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SkillFile {
    pub path: String,
    pub bytes: u64,
    pub text: Option<String>,
}

/// `SkillDetail`: a skill with its files, for the editor.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SkillDetail {
    #[serde(flatten)]
    pub summary: SkillSummary,
    pub contents: Vec<SkillFile>,
}

/// One text file the editor saves.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SkillText {
    pub path: String,
    pub text: String,
}

/// `SaveSkill`: the body of `POST` (create) or `PUT` (save) `/api/skills/<name>`.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SaveSkill {
    pub files: Vec<SkillText>,
}

/// `SkillImport`: what an import installed.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SkillImport {
    pub installed: Vec<String>,
}

/// `OwnerProfile` in `packages/contracts/src/bots/views.ts`: who every bot
/// is talking to, as `GET /api/owner` answers. Shared by every bot.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnerProfile {
    #[serde(default)]
    pub name: String,
    /// What bots call the owner.
    #[serde(default)]
    pub call_me: String,
    /// An IANA time zone such as `Africa/Addis_Ababa`, or empty.
    #[serde(default)]
    pub time_zone: String,
    #[serde(default)]
    pub about: String,
    /// When it was last saved, in milliseconds; `None` before the first save.
    #[serde(default)]
    pub updated_at: Option<f64>,
}

/// `SaveOwnerProfile`: the body of `PUT /api/owner`
/// (`packages/runtime/src/domains/bots/presentation/http/owner-routes.ts`).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveOwnerProfile {
    pub name: String,
    pub call_me: String,
    pub time_zone: String,
    pub about: String,
}

/// Body of `POST /api/bots/<id>/profile`
/// (`packages/runtime/src/domains/bots/presentation/http/routes.ts`).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct UpdateBotProfile {
    pub name: String,
    pub description: String,
    pub personality: String,
    #[serde(rename = "replyStyle")]
    pub reply_style: ReplyStyle,
    /// `None` is sent as `null`: let Raphie pick a colour.
    pub color: Option<String>,
    /// `None` leaves them out: the runtime keeps what the bot has.
    #[serde(rename = "selfUpdates", skip_serializing_if = "Option::is_none")]
    pub self_updates: Option<SelfUpdates>,
    /// The revision these edits started from.
    pub revision: u32,
}

/// `RuntimeSettings` in `packages/contracts/src/settings/views.ts`: one bot's
/// model connections and the models they offer. Only what the Models page
/// reads is mirrored.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    /// The connection the default model runs through.
    pub provider: String,
    /// The default model for new sessions.
    pub model_id: String,
    #[serde(default)]
    pub providers: Vec<ConnectionProvider>,
    #[serde(default)]
    pub connections: Vec<ProviderConnection>,
    #[serde(default)]
    pub models: Vec<LibraryModel>,
    /// Whether the runtime records diagnostic traces.
    #[serde(default)]
    pub telemetry_enabled: bool,
}

/// `ProviderConnection` in the same file: a named set of credentials for
/// one provider. A bot can connect the same provider more than once.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnection {
    pub id: String,
    /// The provider service this connects to.
    pub provider: String,
    pub name: String,
    /// `None` from a runtime too old to have subscriptions: an API key.
    #[serde(default)]
    pub auth: Option<ConnectionAuth>,
    /// A subscription whose sign-in expired and could not be renewed.
    #[serde(default)]
    pub needs_sign_in: bool,
}

impl ProviderConnection {
    pub fn is_subscription(&self) -> bool {
        self.auth == Some(ConnectionAuth::Subscription)
    }
}

/// How a connection authenticates: an API key, or a subscription sign-in.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionAuth {
    ApiKey,
    Subscription,
    /// Something a newer runtime offers; treated as unknown.
    #[serde(other)]
    Unknown,
}

/// `ConnectionProvider`: a provider a connection can be made to, and how.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProvider {
    pub id: String,
    pub name: String,
    /// Empty from a runtime too old to say: API keys only.
    #[serde(default)]
    pub auth: Vec<ConnectionAuth>,
    /// The subscription sign-in's button label, "Sign in with ChatGPT".
    #[serde(default)]
    pub sign_in_label: Option<String>,
}

impl ConnectionProvider {
    /// True for a provider connected by signing in rather than with a key.
    pub fn signs_in(&self) -> bool {
        self.auth.contains(&ConnectionAuth::Subscription)
            && !self.auth.contains(&ConnectionAuth::ApiKey)
    }
}

/// `ProviderSignIn`: one subscription sign-in, in progress or finished.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSignIn {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub status: SignInStatus,
    /// Oldest first.
    #[serde(default)]
    pub events: Vec<SignInEvent>,
    /// The question waiting for an answer, if any.
    #[serde(default)]
    pub prompt: Option<SignInPrompt>,
    #[serde(default)]
    pub error: Option<String>,
    /// The connection made or renewed, once connected.
    #[serde(default)]
    pub connection_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SignInStatus {
    Waiting,
    Connected,
    Failed,
    Cancelled,
}

/// `SignInEvent`: what a provider's sign-in reports along the way. The
/// `type` field picks the variant (`#[serde(tag = "type")]`).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SignInEvent {
    /// A page to open and sign in on.
    #[serde(rename_all = "camelCase")]
    AuthUrl {
        url: String,
        #[serde(default)]
        instructions: Option<String>,
    },
    /// A code to enter on the provider's page.
    #[serde(rename_all = "camelCase")]
    DeviceCode {
        user_code: String,
        verification_uri: String,
        #[serde(default)]
        expires_in_seconds: Option<u64>,
    },
    Progress {
        message: String,
    },
    Info {
        message: String,
    },
    #[serde(other)]
    Unknown,
}

/// `SignInPrompt`: what a provider's sign-in asks the owner for.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignInPrompt {
    /// Answered with this id, so a stale answer cannot reach a newer question.
    pub id: String,
    #[serde(rename = "type")]
    pub kind: SignInPromptKind,
    pub message: String,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub options: Vec<SignInOption>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignInPromptKind {
    Text,
    Secret,
    Select,
    ManualCode,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SignInOption {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// Body of `POST /api/settings/sign-ins`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartSignInBody<'a> {
    pub provider: &'a str,
    pub name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<&'a str>,
}

/// Body of `POST /api/settings/sign-ins/<id>/answer`. The value is
/// borrowed from a `Secret` only while the request is built.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnswerSignInBody<'a> {
    pub prompt_id: &'a str,
    pub value: &'a str,
}

/// Bodies of the connection routes under `/api/settings/connections`
/// (`packages/runtime/src/domains/settings/presentation/http/routes.ts`).
/// The key is borrowed from a `Secret` only while the request is built.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddConnectionBody<'a> {
    pub provider: &'a str,
    pub name: &'a str,
    pub api_key: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditConnectionBody<'a> {
    pub name: &'a str,
    /// Left out to keep the saved key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TestConnectionBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<&'a str>,
}

/// Something with an id and a display name (a provider, a connection).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Named {
    pub id: String,
    pub name: String,
}

/// One model a bot can run, through one connection.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryModel {
    pub id: String,
    pub name: String,
    /// The provider service, such as OpenRouter.
    pub provider: String,
    /// Which of the bot's connections supplies the credentials.
    pub connection_id: String,
    pub connection_name: String,
    pub context_window: u64,
    pub max_output_tokens: u64,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default)]
    pub input_modalities: Vec<String>,
    /// US dollars per million tokens, when the catalogue knows.
    #[serde(default)]
    pub pricing: Option<Pricing>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Pricing {
    pub input: f64,
    pub output: f64,
}

/// Body of `POST /api/settings` that picks the default model
/// (`UpdateRuntimeSettings` in the same file).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefaultModelBody<'a> {
    pub model_id: &'a str,
    pub connection_id: &'a str,
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

/// The body of `GET /_raphie/version`: the release the web host was built
/// from, which the runtime beside it shares.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct HostBuild {
    pub version: String,
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

/// `ModelSelection` in `packages/contracts/src/index.ts`: one model, and
/// which of the bot's connections runs it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSelection {
    /// A connection's id (the web calls it the provider instance).
    pub provider: String,
    pub model_id: String,
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
    /// A bot waits for the owner to answer its question.
    #[serde(default)]
    pub asking: bool,
    pub preview: String,
    pub turn_count: u32,
    #[serde(default)]
    pub reply_preview: Option<String>,
    /// Finished replies in the session; `None` from a runtime too old to
    /// count them.
    #[serde(default)]
    pub reply_count: Option<u32>,
    /// The turn the latest finished reply answers, when the runtime says.
    #[serde(default)]
    pub reply_turn_id: Option<String>,
    /// Finished replies the owner has read in any client; `None` from a
    /// runtime too old to share them.
    #[serde(default)]
    pub read_reply_count: Option<u32>,
    /// The model chosen for this session; `None` uses the bot's default.
    #[serde(default)]
    pub model: Option<ModelSelection>,
    /// When the owner archived the session (milliseconds since the Unix
    /// epoch); `None` while it is active.
    #[serde(default)]
    pub archived_at: Option<i64>,
    /// The bot that handed this session's task off, and its session the
    /// task came from.
    #[serde(default)]
    pub handed_off_by: Option<HandedOffBy>,
}

/// `SessionView["handedOffBy"]` in `packages/contracts`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandedOffBy {
    pub id: String,
    pub name: String,
    /// The sending bot's session that handed the task off; `None` for
    /// sessions from before it was recorded.
    #[serde(default)]
    pub session_id: Option<String>,
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

/// Another bot, as a handoff names it.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct BotRef {
    pub id: String,
    pub name: String,
}

/// `TurnHandoff` in `packages/contracts/src/index.ts`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnHandoff {
    pub id: String,
    pub kind: HandoffKind,
    /// The other bot: the one that handed the task off, or the one that did it.
    pub bot: BotRef,
    pub title: String,
    /// How the task ended. Only on results.
    #[serde(default)]
    pub outcome: Option<HandoffOutcome>,
}

/// `ReadSession` in `packages/contracts/src/index.ts`: another bot's
/// session a reply read with `handoff_read`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadSession {
    pub handoff_id: String,
    pub bot: BotRef,
    pub session_id: String,
    pub title: String,
}

/// `TurnCompaction` in `packages/contracts/src/index.ts`: the session's
/// earlier messages were summarized during this turn, and the bot reads the
/// summary instead of them from then on.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompaction {
    pub at: i64,
    /// "threshold", "overflow" or "manual".
    pub reason: String,
    pub summary: String,
}

/// `TurnHandoff["kind"]`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HandoffKind {
    Task,
    Result,
    #[serde(other)]
    Unknown,
}

/// `HandoffOutcome` in `packages/contracts/src/bots/handoffs.ts`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HandoffOutcome {
    Completed,
    Failed,
    Cancelled,
    #[serde(other)]
    Unknown,
}

/// `Handoff["status"]`: working while any request is unfinished.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HandoffStatus {
    Working,
    Completed,
    Failed,
    Cancelled,
    #[serde(other)]
    Unknown,
}

/// `HandoffRequest` in `packages/contracts/src/bots/handoffs.ts`: one brief.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRequest {
    pub brief: String,
    /// The turn in the sending session that sent this brief.
    #[serde(default)]
    pub from_turn_id: Option<String>,
    pub sent_at: i64,
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub finished_at: Option<i64>,
    #[serde(default)]
    pub outcome: Option<HandoffOutcome>,
}

/// `Handoff` in `packages/contracts/src/bots/handoffs.ts`: a task this bot
/// handed to another bot.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub id: String,
    pub to: BotRef,
    pub title: String,
    pub from_session_id: String,
    #[serde(default)]
    pub to_session_id: Option<String>,
    pub status: HandoffStatus,
    pub created_at: i64,
    pub requests: Vec<HandoffRequest>,
    /// The other bot waits for the owner's approval.
    #[serde(default)]
    pub waiting: bool,
}

/// `GET /api/handoffs`: the bots this one can hand tasks to, and its
/// handoffs, newest first.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
pub struct HandoffList {
    #[serde(default)]
    pub targets: Vec<BotRef>,
    #[serde(default)]
    pub items: Vec<Handoff>,
}

/// `Attachment` in `packages/contracts/src/index.ts`: a file uploaded to a
/// bot, named by the hash of its contents.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// 64 hex digits. The same bytes always get the same id.
    pub id: String,
    pub name: String,
    /// In bytes.
    pub size: u64,
    /// Where the bot finds the file in its workspace.
    #[serde(default)]
    pub path: Option<String>,
    /// Decided by the runtime from the file's bytes.
    #[serde(default)]
    pub mime_type: Option<String>,
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
    /// The files sent with it. `default` reads a missing field as none.
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    pub created_at: i64,
    pub status: TurnStatus,
    /// The finished reply (Markdown), if any.
    pub answer: Option<String>,
    #[serde(default)]
    pub cancelled: Option<bool>,
    /// Why the reply failed, when it did.
    #[serde(default)]
    pub failure: Option<TurnFailure>,
    #[serde(default)]
    pub scheduled: Option<ScheduledBy>,
    /// Set when another bot, not the owner, started the turn: a task it
    /// handed off, or the result of one coming back.
    #[serde(default)]
    pub handoff: Option<TurnHandoff>,
    /// Other bots' sessions the reply read, for tasks it handed off.
    #[serde(default)]
    pub read_sessions: Vec<ReadSession>,
    /// Set when the session's earlier messages were summarized in this turn.
    #[serde(default)]
    pub compaction: Option<TurnCompaction>,
    /// Set while the message waits behind the run in progress.
    #[serde(default)]
    pub queue_mode: Option<QueueMode>,
}

/// `TurnFailure` in `packages/contracts/src/index.ts`: why a reply ended
/// without an answer.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct TurnFailure {
    /// A plain sentence: what happened and what to do next.
    pub message: String,
    /// The model provider's own error text, when there is one.
    #[serde(default)]
    pub detail: Option<String>,
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
    /// "desktop" when the decision was made in this app, which reaches
    /// Raphie through the web host and so arrives as `web`.
    #[serde(default)]
    pub decided_app: Option<String>,
    /// How far the approved action got.
    #[serde(default)]
    pub execution: Execution,
    /// Which connection proposed the action. Command approvals carry
    /// `raphie.workspace.command`.
    #[serde(default)]
    pub connection_identity: Option<String>,
    /// Asked in a task another bot handed off: each call is approved on its
    /// own, never for the session.
    #[serde(default)]
    pub each_call: bool,
}

/// `AskOption` in `packages/contracts/src/sessions/asks.ts`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct AskOption {
    pub label: String,
    #[serde(default)]
    pub detail: Option<String>,
}

/// `AskAnswer`: one of the options by position, or the owner's own words.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum AskAnswer {
    Choice { choice: usize },
    Text { text: String },
}

/// `AskStatus`. "expired" also covers a turn that stopped before an answer.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AskStatus {
    Pending,
    Answered,
    Expired,
    #[serde(other)]
    Unknown,
}

/// The answer of `POST /api/asks/<id>`.
#[derive(Clone, Debug, Deserialize)]
pub struct AnswerResult {
    pub status: AskStatus,
}

/// `SessionAsk`: a question a bot asked mid-turn, which the turn waits on.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionAsk {
    pub id: String,
    /// The turn that is waiting.
    pub turn_id: String,
    pub question: String,
    pub options: Vec<AskOption>,
    /// The first option deletes, sends or spends something.
    #[serde(default)]
    pub danger: bool,
    pub expires_at: i64,
    pub status: AskStatus,
    #[serde(default)]
    pub answer: Option<AskAnswer>,
}

/// `CardTone` in `packages/contracts/src/sessions/cards.ts`: how a badge reads.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CardTone {
    #[default]
    Neutral,
    Good,
    Attention,
    Bad,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardBadge {
    pub label: String,
    #[serde(default)]
    pub tone: CardTone,
}

/// A link out of a card. The runtime only passes http and https addresses.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardLink {
    pub label: String,
    pub url: String,
}

/// One headline number above a card's rows.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardStat {
    pub label: String,
    pub value: String,
}

/// The line under a card's items for what it leaves out.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardMore {
    pub label: String,
    #[serde(default)]
    pub url: Option<String>,
}

/// `CardRow`: one row of a list card.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct CardRow {
    /// A short identifier before the title, such as "AF-512".
    #[serde(default)]
    pub key: Option<String>,
    pub title: String,
    /// Where the title leads.
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub badge: Option<CardBadge>,
    /// A second link beside the row, such as a meeting's "Join".
    #[serde(default)]
    pub link: Option<CardLink>,
    /// A short value at the end of the row, such as its age.
    #[serde(default)]
    pub trailing: Option<String>,
    /// Positions in the card's `sources`; empty unless it has several.
    #[serde(default)]
    pub sources: Vec<usize>,
    /// Who it is assigned to, by name.
    #[serde(default)]
    pub people: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub progress: Option<CardProgress>,
    /// The calendar date it is due, as YYYY-MM-DD.
    #[serde(default)]
    pub due: Option<String>,
}

/// How far a task's checklist has got.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub struct CardProgress {
    pub done: u32,
    pub total: u32,
}

/// `CardColor`: a board column's colour by name; `theme.rs` has the shades.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CardColor {
    #[default]
    Gray,
    Blue,
    Green,
    Yellow,
    Orange,
    Red,
    Pink,
    Purple,
    #[serde(other)]
    Unknown,
}

/// `CardColumn`: one column of a board card, such as a status.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardColumn {
    pub label: String,
    #[serde(default)]
    pub color: CardColor,
    /// Every item in the column, which may be more than the rows shown.
    pub count: u32,
    pub rows: Vec<CardRow>,
}

/// `CardField`: one labelled fact about an item.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct CardField {
    pub label: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub badge: Option<CardBadge>,
    #[serde(default)]
    pub people: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// A calendar date, as YYYY-MM-DD.
    #[serde(default)]
    pub due: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardStep {
    pub label: String,
    #[serde(default)]
    pub done: bool,
}

/// `CardSteps`: an item's checklist, counted, with its first few steps.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardSteps {
    pub done: u32,
    pub total: u32,
    pub items: Vec<CardStep>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CardGroup {
    #[serde(default)]
    pub label: Option<String>,
    pub rows: Vec<CardRow>,
}

/// `CardEvent`: one event of a timeline card, in milliseconds since the epoch.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CardEvent {
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub badge: Option<CardBadge>,
    #[serde(default)]
    pub link: Option<CardLink>,
    #[serde(default)]
    pub sources: Vec<usize>,
    pub start: i64,
    #[serde(default)]
    pub end: Option<i64>,
    /// The event has a date and no time of day; `start` is then midnight
    /// UTC of that date.
    #[serde(default)]
    pub all_day: bool,
}

/// `CardTimelineItem`: an event, free time between two, or a new day.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CardTimelineItem {
    Event(CardEvent),
    Gap {
        start: i64,
        end: i64,
    },
    /// The start of another day: its calendar date as YYYY-MM-DD.
    Day {
        date: String,
    },
    #[serde(other)]
    Unknown,
}

/// What a card holds: rows in groups, or the events of one or more days.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum CardBody {
    List {
        groups: Vec<CardGroup>,
    },
    Timeline {
        items: Vec<CardTimelineItem>,
    },
    /// The columns of a board, each with its count and first rows.
    Board {
        columns: Vec<CardColumn>,
    },
    /// One task or ticket opened up.
    Item {
        /// A short identifier above the title, such as "#107".
        #[serde(default)]
        key: Option<String>,
        #[serde(default)]
        fields: Vec<CardField>,
        /// The start of its description, as plain text.
        #[serde(default)]
        body: Option<String>,
        #[serde(default)]
        steps: Option<CardSteps>,
    },
    /// A kind of card a newer runtime sends; it is not drawn.
    #[serde(other)]
    Unknown,
}

/// `Card`: what a bot shows in place of a list in its reply.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Card {
    pub title: String,
    /// Where the title leads: the board, query or calendar.
    #[serde(default)]
    pub url: Option<String>,
    /// Where the items came from. With several, each item names its own.
    #[serde(default)]
    pub sources: Vec<String>,
    /// Something the card is missing, such as an account that was not read.
    #[serde(default)]
    pub warning: Option<String>,
    #[serde(default)]
    pub stats: Vec<CardStat>,
    #[serde(default)]
    pub more: Option<CardMore>,
    #[serde(flatten)]
    pub body: CardBody,
}

/// `SessionCard`: a card a bot showed, under the reply of the turn that made it.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionCard {
    pub id: String,
    pub turn_id: String,
    /// When the bot read the data: the card's "as of" time.
    pub created_at: i64,
    pub card: Card,
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
    /// scope for command approvals only, and never in a task another bot
    /// handed off (the web's `ToolDecision`).
    pub fn allows_session_scope(&self) -> bool {
        !self.each_call
            && self.server == "workspace"
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
    /// A bot's question waits for the owner's answer.
    Question,
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
    /// Questions the bot asked the owner; absent from older runtimes.
    #[serde(default)]
    pub asks: Vec<SessionAsk>,
    /// Cards the bot showed; absent from older runtimes.
    #[serde(default)]
    pub cards: Vec<SessionCard>,
    pub live: Option<LiveConversation>,
    /// The session's latest journal entries (at most 200), oldest first.
    #[serde(default)]
    pub activity: Vec<SessionActivity>,
    /// History cursor for turns older than `turns`, or `None` at the start.
    pub next_before: Option<String>,
    pub phase: RunPhase,
    pub error: Option<ObservationError>,
}

/// The body and the answer of `POST /api/sessions/<id>/archive`
/// (`packages/runtime/src/domains/conversations/presentation/http/routes.ts`).
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct ArchiveBody {
    pub archived: bool,
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
    /// Ids of uploaded files to send with the text, at most four.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<String>,
    /// The model for a new session. The runtime ignores it for a session
    /// that exists; that one is changed with its own route.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelSelection>,
    /// The command mode for a new session; later it is changed with the
    /// session's own route.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_mode: Option<ApprovalMode>,
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

/// How a session treats commands: `"ask"` or `"full-access"` on the wire.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalMode {
    /// Each command and tool call waits for the owner's approval.
    #[default]
    Ask,
    /// Commands and tool calls run without asking in this conversation.
    /// Sandbox restrictions and an MCP server's own approvals still apply.
    FullAccess,
}

/// The answer of `GET /api/sessions/:id/approval-mode` and the body and
/// answer of its `PUT`.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApprovalModeBody {
    pub mode: ApprovalMode,
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

/// `MemoryProvider` in `packages/contracts/src/memory/views.ts`: where a
/// bot's memories are kept.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MemoryProvider {
    /// In the runtime's own database, on the Raphie machine.
    Builtin,
    /// On a Hindsight server the owner runs or rents.
    Hindsight,
}

/// `MemoryConfiguration` in the same file: one bot's memory settings.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConfiguration {
    pub enabled: bool,
    pub provider: MemoryProvider,
    /// The namespace the bot's memories live in.
    pub scope: String,
    /// The Hindsight server's address; empty until one is set.
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub bank_id: String,
    /// Whether the runtime holds a Hindsight API key. The key itself never
    /// leaves the Raphie machine.
    #[serde(default)]
    pub has_credential: bool,
}

/// How the active back end answers "what do you know about …".
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Reflection {
    /// The conversation model reasons over the evidence it recalls.
    ModelAssisted,
    /// The back end reasons itself (Hindsight).
    Provider,
}

/// What the active memory back end can do. Only what the Memory page reads
/// is mirrored; serde skips the other fields.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct MemoryCapabilities {
    /// Whether every saved memory can be listed, not only searched.
    pub browse: bool,
    pub reflect: Reflection,
    /// Whether memories can be corrected through Raphie.
    pub revise: bool,
    /// Whether memories can be forgotten through Raphie.
    pub forget: bool,
}

/// `MemoryStatus`: what `GET /api/memory` answers.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct MemoryStatus {
    pub configuration: MemoryConfiguration,
    pub capabilities: MemoryCapabilities,
}

/// What kind of thing a memory records.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MemoryKind {
    Fact,
    Experience,
}

/// `MemoryEvidence`: one saved memory, with where it came from.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEvidence {
    pub id: String,
    pub content: String,
    pub kind: MemoryKind,
    /// Where the memory came from, such as `session:<id>/turn:<id>`.
    pub source: String,
    /// When what it records happened, in milliseconds since the Unix epoch;
    /// zero when the back end did not say.
    pub event_time: i64,
    /// Counts up with each correction.
    pub revision: u32,
}

/// `MemoryRecall`: what a search answers.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct MemoryRecall {
    pub evidence: Vec<MemoryEvidence>,
}

/// `MemoryPage`: one page of every saved memory, newest first. `next` is
/// the cursor for the page after it, when there is one.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct MemoryPage {
    pub evidence: Vec<MemoryEvidence>,
    pub next: Option<String>,
    pub total: u64,
}

/// The body of `POST /api/memory/recall`.
#[derive(Serialize)]
pub(crate) struct RecallBody<'a> {
    pub query: &'a str,
}

/// The body of `POST /api/memory/evidence/:id`: a correction.
#[derive(Serialize)]
pub(crate) struct ReviseMemoryBody<'a> {
    pub content: &'a str,
}

/// The body of `POST /api/memory` (`SaveMemoryConfiguration`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveMemoryBody<'a> {
    pub enabled: bool,
    pub provider: MemoryProvider,
    pub scope: &'a str,
    pub endpoint: &'a str,
    pub bank_id: &'a str,
    /// Three cases, as the runtime reads them: the field left out keeps the
    /// saved key (`None`), `null` clears it (`Some(None)`), and a string
    /// replaces it (`Some(Some(key))`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<Option<&'a str>>,
}

/// `BotMcpConnection` in `packages/contracts/src/bots/automation.ts`: one of
/// a bot's connections to an MCP server, and how it is doing.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConnection {
    /// Set by the host's environment rather than saved for this bot. Such
    /// a connection can only be imported.
    #[serde(default, deserialize_with = "from_environment", rename = "source")]
    pub from_environment: bool,
    pub id: String,
    pub name: String,
    pub transport: McpTransport,
    /// The server's URL, or the command the runtime starts.
    pub address: String,
    pub enabled: bool,
    pub connected: bool,
    pub tool_count: u32,
    /// Where the owner signs in, while the server waits for authorization.
    #[serde(default)]
    pub authorization_url: Option<String>,
    #[serde(default)]
    pub authorization_failed: bool,
}

/// Reads `source`: `"environment"` or `"saved"`.
fn from_environment<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    let source = Option::<String>::deserialize(deserializer)?;
    Ok(source.as_deref() == Some("environment"))
}

/// What every `/api/mcp` route answers: the bot's connections as they are
/// after the request.
#[derive(Debug, Deserialize)]
pub(crate) struct McpList {
    pub items: Vec<McpConnection>,
}

/// The body of `POST /api/mcp` (`SaveMcpConnection`). `tag` writes the
/// variant's name into a `transport` field beside the others.
#[derive(Serialize)]
#[serde(tag = "transport", rename_all = "lowercase")]
pub(crate) enum SaveMcpBody<'a> {
    Http {
        name: &'a str,
        url: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        token: Option<&'a str>,
    },
    Stdio {
        name: &'a str,
        command: &'a str,
        args: &'a [String],
        env: std::collections::BTreeMap<&'a str, &'a str>,
    },
}

/// The body of `POST /api/mcp/:id`.
#[derive(Serialize)]
pub(crate) struct McpActionBody {
    pub action: McpAction,
}

/// `DiscordChannel` in `packages/contracts/src/bots/channels.ts`: a bot's
/// Discord connection. The bot token is never part of it.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscordChannel {
    /// The Discord users who may message the bot.
    pub allowed_user_ids: Vec<String>,
    /// The one channel the bot answers in; empty for anywhere.
    #[serde(default)]
    pub channel_id: String,
    pub connected: bool,
    /// Another bot on this runtime already uses this Discord application.
    #[serde(default)]
    pub conflict: bool,
}

/// `TelegramProblem`: why a saved Telegram connection is not receiving.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TelegramProblem {
    /// Another poller or a webhook is taking this bot's messages.
    Conflict,
    /// Telegram rejected the saved token.
    Token,
    Network,
    /// The same Telegram bot is connected to another Raphie bot.
    Duplicate,
    #[serde(other)]
    Unknown,
}

/// `TelegramChannel`: a bot's Telegram connection, without its token.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelegramChannel {
    pub enabled: bool,
    pub connected: bool,
    #[serde(default)]
    pub bot_username: String,
    /// The Telegram accounts that may use the bot, by numeric id.
    pub verified_user_ids: Vec<String>,
    /// When the pairing code that is out expires (milliseconds since the
    /// Unix epoch), if one is.
    #[serde(default)]
    pub pairing_expires_at: Option<i64>,
    #[serde(default)]
    pub problem: Option<TelegramProblem>,
}

/// `ChannelSettings`: what `GET /api/channels` answers.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ChannelSettings {
    pub discord: Option<DiscordChannel>,
    #[serde(default)]
    pub telegram: Option<TelegramChannel>,
}

/// `TelegramPairingCode`: shown once when issued.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelegramPairingCode {
    pub code: String,
    pub expires_at: i64,
}

/// Where a home channel lives.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChannelPlatform {
    Discord,
    Telegram,
}

/// `HomeDestination`: a conversation scheduled results can be sent to.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeDestination {
    pub id: String,
    pub platform: ChannelPlatform,
    pub conversation_id: String,
    pub user_id: String,
}

/// `ChannelHomeSettings`: what `/api/channels/home` answers. `selected` is
/// a destination's id, or `None` for web only.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ChannelHomeSettings {
    pub selected: Option<String>,
    pub destinations: Vec<HomeDestination>,
}

/// The body of `POST /api/channels/discord`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDiscordBody<'a> {
    pub allowed_user_ids: &'a [String],
    pub channel_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_token: Option<&'a str>,
}

/// The body of `POST /api/channels/telegram` (`SaveTelegramChannel`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveTelegramBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_token: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

/// The body of `POST /api/channels/telegram/unpair`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnpairTelegramBody<'a> {
    pub user_id: &'a str,
}

/// The body of `POST /api/channels/home`.
#[derive(Serialize)]
pub(crate) struct SelectHomeBody<'a> {
    pub id: Option<&'a str>,
}

/// `SandboxProvider` in `packages/contracts/src/workspaces/views.ts`: what
/// runs a bot's commands.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxProvider {
    /// Shell commands over a virtual filesystem, with no network.
    JustBash,
    /// Native programs in a container of the bot's own.
    Container,
}

/// `SandboxSettings`: what the owner chose for one bot.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxSettings {
    pub provider: SandboxProvider,
    /// How long an idle container is kept before it is stopped.
    pub idle_minutes: u32,
    /// The container's disk limit in MiB; `None` is no limit.
    #[serde(rename = "diskQuotaMiB")]
    pub disk_quota_mib: Option<u64>,
    /// The owner accepted that a container can reach host and LAN services.
    pub host_network_acknowledged: bool,
    /// Counts up with each save.
    pub revision: u64,
}

/// `SandboxProviderInfo`: a provider the runtime knows, and whether this
/// machine can run it.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SandboxProviderInfo {
    pub id: SandboxProvider,
    pub name: String,
    pub available: bool,
    /// Why it is unavailable, when it is.
    #[serde(default)]
    pub reason: Option<String>,
}

/// The provider that is running the bot's commands now.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ActiveSandbox {
    pub id: SandboxProvider,
    pub name: String,
    pub version: String,
}

/// How busy the bot's workspace is.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxExecutions {
    /// Operations running or waiting.
    pub admitted: u32,
    /// The most a bot may have admitted at once.
    pub capacity: u32,
    /// Workers running at once across every bot.
    pub runtime_concurrency: u32,
}

/// What the workspace holds; `None` where the provider does not measure.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxUsage {
    pub file_bytes: Option<u64>,
    pub entries: Option<u64>,
    pub receipt_bytes: Option<u64>,
}

/// The limits on one execution and on the workspace; `None` is no limit.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxLimits {
    pub timeout_ms: u64,
    pub source_bytes: u64,
    pub output_bytes: u64,
    pub file_bytes: Option<u64>,
    pub entries: Option<u64>,
    pub receipts_bytes: Option<u64>,
}

/// `SandboxInfo`: what `GET /api/workspace` answers.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SandboxInfo {
    pub settings: SandboxSettings,
    /// Every provider the runtime knows.
    pub providers: Vec<SandboxProviderInfo>,
    pub provider: ActiveSandbox,
    /// Where the bot's files appear to its commands (`/workspace`).
    pub root: String,
    pub executions: SandboxExecutions,
    pub usage: SandboxUsage,
    pub limits: SandboxLimits,
}

/// The body of `POST /api/workspace/settings` (`SaveSandboxSettings`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveSandboxBody {
    pub provider: SandboxProvider,
    pub host_network_acknowledged: bool,
    pub idle_minutes: u32,
    /// Always written: `null` is how "no limit" is said.
    #[serde(rename = "diskQuotaMiB")]
    pub disk_quota_mib: Option<u64>,
    pub revision: u64,
}

/// What a workspace entry is.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    File,
    Directory,
    /// A symbolic link. The runtime does not follow it.
    Symlink,
}

/// `WorkspaceEntry` in `packages/contracts/src/workspaces/views.ts`: one
/// file, folder or link in a bot's workspace.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    /// Where it is, from `/workspace` down.
    pub path: String,
    pub name: String,
    pub kind: WorkspaceKind,
    pub bytes: u64,
    /// When it last changed, in milliseconds since the Unix epoch.
    pub modified_at: i64,
}

/// `WorkspaceListing`: what one folder holds. A download names the
/// `revision` it saw, so the runtime can refuse a file that changed since.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct WorkspaceListing {
    pub path: String,
    pub revision: u64,
    pub items: Vec<WorkspaceEntry>,
}

/// How a job's last submission went, for runs from before the runtime
/// tracked each run's outcome.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LastStatus {
    Submitted,
    Failed,
}

/// `ScheduledJob` in `packages/contracts/src/bots/automation.ts`: a prompt
/// a bot is given on a schedule.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledJob {
    pub id: String,
    pub name: String,
    pub prompt: String,
    /// How often it repeats; `None` runs it once.
    pub every_minutes: Option<u32>,
    pub enabled: bool,
    /// When it runs next, in milliseconds since the Unix epoch.
    pub next_run_at: i64,
    /// The conversation its results go to, once it has one.
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub last_run_at: Option<i64>,
    #[serde(default)]
    pub last_status: Option<LastStatus>,
    #[serde(default)]
    pub last_run: Option<JobRun>,
}

/// Where a run stands.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Interrupted,
    #[serde(other)]
    Unknown,
}

/// Why a run failed, when the runtime knows.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailureReason {
    Unknown,
    /// The bot has no model to run the prompt with.
    NoModel,
}

/// `ScheduledJobRun`: one time a job ran.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobRun {
    pub id: String,
    pub job_id: String,
    /// The job's name when it ran; the job may have been removed since.
    pub name: String,
    /// It started later than it was scheduled for.
    #[serde(default)]
    pub late: bool,
    /// It is held behind the bot's active turn or an approval.
    #[serde(default)]
    pub waiting_for_bot: bool,
    #[serde(default)]
    pub failure_reason: Option<FailureReason>,
    pub started_at: i64,
    /// When it ended; `None` while it is queued or running.
    #[serde(default)]
    pub finished_at: Option<i64>,
    pub status: RunStatus,
    /// The conversation its reply is in, once the prompt was admitted.
    #[serde(default)]
    pub session_id: Option<String>,
    /// The turn that answers it, once the prompt was admitted.
    #[serde(default)]
    pub turn_id: Option<String>,
}

/// What `GET /api/jobs/notifications` answers: a bot's job runs the owner
/// has not dismissed, newest first.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct JobNotifications {
    pub items: Vec<JobRun>,
    /// Cursor for older ones, or `None` when these are all.
    #[serde(default)]
    pub next: Option<String>,
    /// How many there are in all, when the runtime counts them.
    #[serde(default)]
    pub total: Option<usize>,
}

/// What `/api/jobs` answers: the bot's jobs as they are after the request.
#[derive(Debug, Deserialize)]
pub(crate) struct JobList {
    pub items: Vec<ScheduledJob>,
}

/// The body of `POST /api/jobs` (`SaveScheduledJob`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveJobBody<'a> {
    pub name: &'a str,
    pub prompt: &'a str,
    /// Always written: `null` is how "run once" is said.
    pub every_minutes: Option<u32>,
    pub first_run_at: i64,
}

/// The body of `POST /api/jobs/:id`.
#[derive(Serialize)]
pub(crate) struct JobActionBody {
    pub action: crate::jobs::JobAction,
}

/// A span's outcome.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpanStatus {
    /// The code that made the span did not say.
    Unset,
    Ok,
    Error,
    #[serde(other)]
    Unknown,
}

impl SpanStatus {
    /// The status as the runtime spells it.
    pub fn word(self) -> &'static str {
        match self {
            SpanStatus::Unset => "unset",
            SpanStatus::Ok => "ok",
            SpanStatus::Error => "error",
            SpanStatus::Unknown => "unknown",
        }
    }
}

/// `DiagnosticSpan` in `packages/contracts/src/diagnostics/views.ts`: one
/// timed operation from an exported trace. It also serializes, in the
/// runtime's shape, so an export reads like the web's.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSpan {
    pub trace_id: String,
    pub span_id: String,
    /// The span this one ran inside; `None` for a trace's first span.
    pub parent_span_id: Option<String>,
    pub name: String,
    /// When it started, in milliseconds since the Unix epoch.
    pub started_at: i64,
    pub duration_ms: f64,
    pub status: SpanStatus,
    /// Extra facts about the operation: an object of strings, numbers and
    /// booleans, kept as JSON because the keys vary by operation.
    pub attributes: serde_json::Value,
}

/// Whether the runtime has traces to show.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TraceState {
    Ready,
    /// No trace backend is set up.
    Unconfigured,
    /// One is set up but did not answer.
    #[serde(other)]
    Unavailable,
}

/// `TraceDiagnostics`: what `GET /api/diagnostics/traces` answers.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceDiagnostics {
    pub source: String,
    pub state: TraceState,
    /// Whether new traces are being exported; when not, only retained ones
    /// are shown.
    pub export_enabled: bool,
    pub spans: Vec<DiagnosticSpan>,
    pub from: i64,
    pub to: i64,
    /// The most spans one answer carries; this is not a full history.
    pub span_limit: u32,
}

/// `ActivityEvent` in `packages/contracts/src/index.ts`, as
/// `GET /api/inspection/activity` lists them: one durable step a bot took,
/// in any of its conversations. Serializes in the runtime's shape for
/// exports.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub id: i64,
    /// Milliseconds since the Unix epoch.
    pub at: i64,
    pub attempt_id: String,
    pub run_id: Option<String>,
    pub operation_id: Option<String>,
    pub plugin_id: Option<String>,
    /// `model.completed`, `tool.started`, ... `type` is a Rust keyword, so
    /// the field is `kind` here.
    #[serde(rename = "type")]
    pub kind: String,
    pub summary: String,
    /// Extra data as JSON text; `{}` when there is none.
    pub details_json: String,
}

/// The body of `POST /api/settings` that switches trace collection
/// (`UpdateRuntimeSettings`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TelemetryBody {
    pub telemetry_enabled: bool,
}

/// One saved version of a bot's profile, as `GET /api/bots/<id>/history`
/// lists them (a `BotProfile` with when it was saved).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BotRevision {
    pub revision: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub color: Option<String>,
    /// The personality as it was at this revision.
    #[serde(default)]
    pub personality: String,
    /// Who saved it: `"owner"` or `"bot"`; absent on older revisions.
    #[serde(default)]
    pub changed_by: Option<String>,
    /// The id of the built-in personality this revision's text is, if any.
    #[serde(default)]
    pub preset: Option<String>,
    /// When it was saved, in milliseconds since the Unix epoch.
    #[serde(default)]
    pub updated_at: i64,
}

/// What `GET /api/bots/<id>/history` answers.
#[derive(Debug, Deserialize)]
pub(crate) struct BotHistory {
    pub items: Vec<BotRevision>,
}

/// A bot to create: the body of `POST /api/bots`.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct NewBot {
    pub name: String,
    pub description: String,
    pub personality: String,
    #[serde(rename = "replyStyle")]
    pub reply_style: ReplyStyle,
    /// `None` is sent as `null`: let Raphie pick a colour.
    pub color: Option<String>,
    /// `None` leaves them out: the runtime starts the bot at its defaults.
    #[serde(rename = "selfUpdates", skip_serializing_if = "Option::is_none")]
    pub self_updates: Option<SelfUpdates>,
}

/// The body of `DELETE /api/bots/<id>`. The runtime deletes only if both
/// still match, so a bot renamed or saved elsewhere is not removed by an
/// out-of-date confirmation.
#[derive(Serialize)]
pub(crate) struct DeleteBotBody<'a> {
    pub name: &'a str,
    pub revision: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn questions_and_answers_read_and_write_as_the_runtime_sends_them() {
        let ask: SessionAsk = serde_json::from_value(serde_json::json!({
            "id": "a", "conversationId": "s", "turnId": "t",
            "question": "Which one?", "options": [{ "label": "Tue" }, { "label": "Wed", "detail": "Bole" }],
            "createdAt": 1, "expiresAt": 2, "status": "answered",
            "answer": { "text": "Any morning" }, "answeredVia": "web"
        }))
        .expect("a question parses");
        assert_eq!(ask.options[1].detail.as_deref(), Some("Bole"));
        assert!(!ask.danger);
        assert_eq!(
            ask.answer,
            Some(AskAnswer::Text {
                text: "Any morning".into()
            })
        );
        assert_eq!(
            serde_json::to_value(AskAnswer::Choice { choice: 1 }).unwrap(),
            serde_json::json!({ "choice": 1 })
        );
        let unknown: AskStatus = serde_json::from_value(serde_json::json!("withdrawn")).unwrap();
        assert_eq!(unknown, AskStatus::Unknown);
    }

    #[test]
    fn cards_read_as_the_runtime_sends_them() {
        let list: SessionCard = serde_json::from_value(serde_json::json!({
            "id": "c", "conversationId": "s", "turnId": "t", "createdAt": 5,
            "card": {
                "type": "list", "title": "AF board", "sources": ["Jira"],
                "url": "https://example.com/board",
                "stats": [{ "label": "Open", "value": "7" }],
                "more": { "label": "and 3 more" },
                "groups": [{ "label": "Blocked", "rows": [{
                    "key": "AF-471", "title": "Rotate keys",
                    "badge": { "label": "Blocked", "tone": "attention" },
                    "trailing": "9d"
                }] }]
            }
        }))
        .expect("a list card parses");
        assert_eq!(list.card.sources, ["Jira"]);
        assert_eq!(list.card.more.as_ref().and_then(|m| m.url.as_deref()), None);
        let CardBody::List { groups } = &list.card.body else {
            panic!("a list card has groups");
        };
        let row = &groups[0].rows[0];
        assert_eq!(
            row.badge.as_ref().map(|b| b.tone),
            Some(CardTone::Attention)
        );
        assert!(row.sources.is_empty());

        let timeline: Card = serde_json::from_value(serde_json::json!({
            "type": "timeline", "title": "Monday", "sources": ["Work", "Personal"],
            "warning": "One calendar was not read",
            "items": [
                { "kind": "day", "date": "2026-11-23" },
                { "kind": "event", "title": "Birthday", "start": 0, "allDay": true, "sources": [1] },
                { "kind": "gap", "start": 2, "end": 3 },
                { "kind": "event", "title": "Standup", "start": 3, "end": 4,
                  "badge": { "label": "New", "tone": "sparkly" },
                  "link": { "label": "Join", "url": "https://meet.example.com/a" } },
                { "kind": "holiday" }
            ]
        }))
        .expect("a timeline card parses");
        let CardBody::Timeline { items } = &timeline.body else {
            panic!("a timeline card has items");
        };
        assert_eq!(
            items[0],
            CardTimelineItem::Day {
                date: "2026-11-23".into()
            }
        );
        assert!(matches!(&items[1], CardTimelineItem::Event(e) if e.all_day && e.sources == [1]));
        assert_eq!(items[2], CardTimelineItem::Gap { start: 2, end: 3 });
        assert!(matches!(
            &items[3],
            CardTimelineItem::Event(e)
                if e.end == Some(4) && e.badge.as_ref().map(|b| b.tone) == Some(CardTone::Unknown)
        ));
        // A part a newer runtime sends is skipped, not an error.
        assert_eq!(items[4], CardTimelineItem::Unknown);
        let board: Card = serde_json::from_value(serde_json::json!({
            "type": "board", "title": "ALX - FIT", "sources": ["Fizzy"],
            "columns": [
                { "label": "Priority", "color": "orange", "count": 2, "rows": [{
                    "key": "#107", "title": "Update the document",
                    "people": ["Kalkidan Betre"], "tags": ["docs"],
                    "progress": { "done": 2, "total": 5 }, "due": "2026-11-27"
                }] },
                { "label": "Later", "color": "teal", "count": 0, "rows": [] }
            ]
        }))
        .expect("a board card parses");
        let CardBody::Board { columns } = &board.body else {
            panic!("a board card has columns");
        };
        assert_eq!(columns[0].color, CardColor::Orange);
        assert_eq!(columns[1].color, CardColor::Unknown);
        let row = &columns[0].rows[0];
        assert_eq!(row.people, ["Kalkidan Betre"]);
        assert_eq!(row.progress, Some(CardProgress { done: 2, total: 5 }));
        assert_eq!(row.due.as_deref(), Some("2026-11-27"));

        let item: Card = serde_json::from_value(serde_json::json!({
            "type": "item", "title": "Update the document", "sources": ["Fizzy"],
            "key": "#107",
            "fields": [
                { "label": "Column", "badge": { "label": "Priority", "tone": "attention" } },
                { "label": "Due", "due": "2026-11-27" }
            ],
            "body": "Fold the notes in.",
            "steps": { "done": 1, "total": 3, "items": [
                { "label": "Collect", "done": true }, { "label": "Draft" }
            ] }
        }))
        .expect("an item card parses");
        let CardBody::Item {
            key,
            fields,
            body,
            steps,
        } = &item.body
        else {
            panic!("an item card has fields");
        };
        assert_eq!(key.as_deref(), Some("#107"));
        assert_eq!(fields[1].due.as_deref(), Some("2026-11-27"));
        assert_eq!(body.as_deref(), Some("Fold the notes in."));
        let steps = steps.as_ref().expect("steps");
        assert!(steps.items[0].done && !steps.items[1].done);

        let newer: Card = serde_json::from_value(serde_json::json!({
            "type": "gallery", "title": "Later", "sources": []
        }))
        .expect("an unknown kind of card parses");
        assert_eq!(newer.body, CardBody::Unknown);
    }
}
