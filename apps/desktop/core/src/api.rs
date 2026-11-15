//! HTTP calls to the web host's authenticated API.
//!
//! Every call is `async`: it returns a future that does nothing until awaited
//! on the engine's Tokio runtime, so the UI thread never waits on the network.
//!
//! Native requests carry `Authorization: Bearer <token>` and never a cookie or
//! an `Origin` header (the web host treats those as browser requests). State
//! changes also send `x-raphie-client: web`: the runtime behind the web host
//! requires that marker on every mutation, whichever client sends it.

use std::time::Duration;

use reqwest::{RequestBuilder, Response, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::attachments::multipart;
use crate::auth::{AccessToken, CLIENT_ID, DeviceCode, DevicePoll, Secret};
use crate::channels::ChannelChange;
use crate::contracts::Attachment;
use crate::contracts::WorkspaceListing;
use crate::contracts::{
    Account, AddConnectionBody, ApprovalStatus, AuthStatus, BotList, BotProfile,
    ChannelHomeSettings, ChannelSettings, ControlAction, ControlBody, Decision, DecisionBody,
    DecisionResult, DefaultModelBody, DeviceCodeResponse, DeviceTokenResponse, EditConnectionBody,
    ErrorBody, McpActionBody, McpConnection, McpList, MemoryPage, MemoryRecall, MemoryStatus, Page,
    RecallBody, Receipt, ReviseMemoryBody, RuntimeSettings, SandboxInfo, SandboxSettings,
    SaveDiscordBody, SaveMcpBody, SaveMemoryBody, SaveSandboxBody, SaveTelegramBody, Scope,
    SelectHomeBody, SessionObservation, SessionSummary, SessionTurn, SubmitMessage,
    TelegramPairingCode, TestConnectionBody, UnpairTelegramBody, UpdateBotProfile,
};
use crate::contracts::{ActivityEvent, TelemetryBody, TraceDiagnostics};
use crate::contracts::{BotHistory, BotRevision, DeleteBotBody, NewBot};
use crate::contracts::{JobActionBody, JobList, JobRun, SaveJobBody, ScheduledJob};
use crate::jobs::{JobAction, NewJob};
use crate::mcp::{McpAction, NewMcpConnection};
use crate::memory::{KeyChange, MemoryUpdate};
use crate::origin::Origin;
use crate::sandbox::SandboxUpdate;
use crate::workspace::DOWNLOAD_LIMIT;

/// Ordinary requests give up after this long. Event streams have no overall
/// timeout (they stay open for as long as the conversation is on screen).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// How long one file upload may take.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// Why a call failed, sorted by what the caller should do about it.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ApiError {
    /// 401: the token was revoked or expired. Sign in again.
    #[error("This device was signed out. Sign in again to continue.")]
    Unauthenticated,
    /// 503 `locked`: no administrator exists yet on that host.
    #[error("Raphie is locked. Create the administrator with `raphie auth setup` on the host.")]
    Locked,
    #[error("{0}")]
    NotFound(String),
    /// 409: for example, a reused message id with different text.
    #[error("{0}")]
    Conflict(String),
    /// Any other refusal, with the server's message.
    #[error("{message}")]
    Rejected { status: u16, message: String },
    /// The request never got an answer (offline, DNS, TLS, timeout).
    #[error("Could not reach Raphie: {0}")]
    Network(String),
    /// The answer was not the JSON this client expects.
    #[error("Unexpected answer from Raphie: {0}")]
    Decode(String),
}

impl ApiError {
    /// Worth retrying with the same request (and the same message id).
    pub fn is_transient(&self) -> bool {
        matches!(self, ApiError::Network(_))
            || matches!(self, ApiError::Rejected { status, .. } if *status >= 500)
    }
}

/// What a change to a bot's channels answered with.
#[derive(Debug)]
pub enum ChannelAnswer {
    /// The change was made; the settings are read again.
    Done,
    /// The one-time code that verifies a Telegram account.
    Pairing(TelegramPairingCode),
    /// The home channel settings after choosing one.
    Home(ChannelHomeSettings),
}

/// The path for one bot's API. The default bot keeps the unprefixed routes,
/// as the web workspace does; other bots live under `/api/bots/<id>/`.
pub fn bot_path(bot_id: &str, path: &str) -> String {
    debug_assert!(path.starts_with("/api/"), "bot paths are API paths: {path}");
    if bot_id == "default" {
        path.to_owned()
    } else {
        format!("/api/bots/{}/{}", encode(bot_id), &path["/api/".len()..])
    }
}

/// The path of one connection's route: `suffix` is "", "/remove" or "/test".
fn connection_path(bot_id: &str, connection_id: &str, suffix: &str) -> String {
    bot_path(
        bot_id,
        &format!(
            "/api/settings/connections/{}{suffix}",
            encode(connection_id)
        ),
    )
}

/// Percent-encodes one path segment or query value: everything except
/// unreserved characters (RFC 3986 §2.3) becomes `%XX`.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// A client for one origin. Cheap to clone: `reqwest::Client` is a handle to a
/// shared connection pool, so every clone reuses the same connections.
#[derive(Clone)]
pub struct ApiClient {
    http: reqwest::Client,
    origin: Origin,
    token: Option<AccessToken>,
}

impl ApiClient {
    pub fn new(origin: Origin) -> Result<ApiClient, ApiError> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("Raphie Desktop/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            // Never follow a redirect with a bearer token attached.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Ok(ApiClient {
            http,
            origin,
            token: None,
        })
    }

    pub fn origin(&self) -> &Origin {
        &self.origin
    }

    /// A copy of this client that sends `token`.
    pub fn with_token(&self, token: AccessToken) -> ApiClient {
        ApiClient {
            token: Some(token),
            ..self.clone()
        }
    }

    // ----- Device sign-in (public endpoints, no token) -----

    /// Starts sign-in. The approval link must point back at this origin; a
    /// host that sends the owner elsewhere is refused.
    pub async fn request_device_code(&self) -> Result<(DeviceCode, String, u64), ApiError> {
        let body = serde_json::json!({ "client_id": CLIENT_ID });
        let request = self
            .http
            .post(self.origin.url("/api/auth/device/code"))
            .json(&body);
        let code: DeviceCodeResponse = read_json(send(request).await?).await?;
        if !self.origin.owns(&code.verification_uri_complete)
            || !code.verification_uri_complete.contains("/device?")
        {
            return Err(ApiError::Decode(
                "the approval link points somewhere other than this Raphie".into(),
            ));
        }
        let shown = DeviceCode {
            user_code: code.user_code,
            verification_url: code.verification_uri_complete,
            expires_in: code.expires_in,
        };
        Ok((shown, code.device_code, code.interval))
    }

    /// Asks once whether the owner has approved `device_code`.
    pub async fn poll_device_token(&self, device_code: &str) -> Result<DevicePoll, ApiError> {
        let body = serde_json::json!({
            "client_id": CLIENT_ID,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        });
        let request = self
            .http
            .post(self.origin.url("/api/auth/device/token"))
            .json(&body);
        let response = request
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(network)?;
        // OAuth reports "not yet" as a 400 with an error code, so read the
        // body whatever the status.
        let status = response.status();
        let answer: DeviceTokenResponse = response
            .json()
            .await
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        if let (true, Some(token)) = (status.is_success(), answer.access_token) {
            return Ok(DevicePoll::Granted(AccessToken::new(token)));
        }
        Ok(match answer.error.as_deref() {
            Some("authorization_pending") => DevicePoll::Pending,
            Some("slow_down") => DevicePoll::SlowDown,
            Some("access_denied") => DevicePoll::Denied,
            Some("expired_token") => DevicePoll::Expired,
            _ if status == StatusCode::SERVICE_UNAVAILABLE => return Err(ApiError::Locked),
            other => {
                return Err(ApiError::Rejected {
                    status: status.as_u16(),
                    message: format!("Sign-in failed ({}).", other.unwrap_or("no reason given")),
                });
            }
        })
    }

    // ----- Reads -----

    /// The signed-in administrator, if the host says who it is.
    pub async fn account(&self) -> Result<Option<Account>, ApiError> {
        let status: AuthStatus = self.get_json("/auth/status").await?;
        Ok(status.account)
    }

    pub async fn bots(&self) -> Result<Vec<BotProfile>, ApiError> {
        let list: BotList = self.get_json("/api/bots").await?;
        Ok(list.items)
    }

    /// Saves a bot's profile and returns it at its new revision. Fails with
    /// [`ApiError::Conflict`] when the bot changed since `update.revision`.
    pub async fn save_profile(
        &self,
        bot_id: &str,
        update: &UpdateBotProfile,
    ) -> Result<BotProfile, ApiError> {
        self.post_json(&format!("/api/bots/{}/profile", encode(bot_id)), update)
            .await
    }

    /// The saved versions of a bot's profile, newest first.
    pub async fn bot_history(&self, bot_id: &str) -> Result<Vec<BotRevision>, ApiError> {
        let path = format!("/api/bots/{}/history", encode(bot_id));
        let history: BotHistory = self.get_json(&path).await?;
        Ok(history.items)
    }

    /// Creates a bot and returns it.
    pub async fn create_bot(&self, bot: &NewBot) -> Result<BotProfile, ApiError> {
        self.post_json("/api/bots", bot).await
    }

    /// Deletes a bot and everything the runtime keeps for it. `name` and
    /// `revision` are the bot as the owner confirmed it; the runtime
    /// refuses if it changed since.
    pub async fn delete_bot(
        &self,
        bot_id: &str,
        name: &str,
        revision: u32,
    ) -> Result<(), ApiError> {
        let path = format!("/api/bots/{}", encode(bot_id));
        let request = self
            .authorized(self.http.delete(self.origin.url(&path)))
            .header("x-raphie-client", "web")
            .json(&DeleteBotBody { name, revision });
        // The answer is 204 with no body; a failure is an error.
        send(request).await?;
        Ok(())
    }

    /// One bot's model connections and models.
    pub async fn settings(&self, bot_id: &str) -> Result<RuntimeSettings, ApiError> {
        self.get_json(&bot_path(bot_id, "/api/settings")).await
    }

    /// Makes a model the default for the bot's new sessions and returns the
    /// settings afterwards.
    pub async fn set_default_model(
        &self,
        bot_id: &str,
        model_id: &str,
        connection_id: &str,
    ) -> Result<RuntimeSettings, ApiError> {
        let body = DefaultModelBody {
            model_id,
            connection_id,
        };
        self.post_json(&bot_path(bot_id, "/api/settings"), &body)
            .await
    }

    /// Adds a provider connection and returns the settings afterwards.
    pub async fn add_connection(
        &self,
        bot_id: &str,
        provider: &str,
        name: &str,
        key: &Secret,
    ) -> Result<RuntimeSettings, ApiError> {
        let body = AddConnectionBody {
            provider,
            name,
            api_key: key.expose(),
        };
        self.post_json(&bot_path(bot_id, "/api/settings/connections"), &body)
            .await
    }

    /// Renames a connection, replacing its key when one is given.
    pub async fn edit_connection(
        &self,
        bot_id: &str,
        connection_id: &str,
        name: &str,
        key: Option<&Secret>,
    ) -> Result<RuntimeSettings, ApiError> {
        let body = EditConnectionBody {
            name,
            api_key: key.map(Secret::expose),
        };
        self.post_json(&connection_path(bot_id, connection_id, ""), &body)
            .await
    }

    pub async fn remove_connection(
        &self,
        bot_id: &str,
        connection_id: &str,
    ) -> Result<RuntimeSettings, ApiError> {
        // The route takes an empty JSON object.
        self.post_json(
            &connection_path(bot_id, connection_id, "/remove"),
            &serde_json::json!({}),
        )
        .await
    }

    /// Asks the host to try a connection: a saved one (`connection_id`),
    /// optionally with a new key, or a key for a connection not added yet.
    pub async fn test_connection(
        &self,
        bot_id: &str,
        connection_id: Option<&str>,
        key: Option<&Secret>,
    ) -> Result<(), ApiError> {
        let path = match connection_id {
            Some(id) => connection_path(bot_id, id, "/test"),
            None => bot_path(bot_id, "/api/settings/provider/test"),
        };
        let body = TestConnectionBody {
            api_key: key.map(Secret::expose),
        };
        // The answer is `{ "connected": true }`; a failure is an error.
        let _: serde_json::Value = self.post_json(&path, &body).await?;
        Ok(())
    }

    /// One bot's memory settings and what its back end can do.
    pub async fn memory(&self, bot_id: &str) -> Result<MemoryStatus, ApiError> {
        self.get_json(&bot_path(bot_id, "/api/memory")).await
    }

    /// Saves a bot's memory settings and returns them as the runtime now
    /// has them (it tidies the endpoint, for one).
    pub async fn save_memory(
        &self,
        bot_id: &str,
        update: &MemoryUpdate,
    ) -> Result<MemoryStatus, ApiError> {
        let body = SaveMemoryBody {
            enabled: update.enabled,
            provider: update.provider,
            scope: &update.scope,
            endpoint: &update.endpoint,
            bank_id: &update.bank_id,
            api_key: match &update.key {
                KeyChange::Keep => None,
                KeyChange::Clear => Some(None),
                KeyChange::Replace(key) => Some(Some(key.expose())),
            },
        };
        self.post_json(&bot_path(bot_id, "/api/memory"), &body)
            .await
    }

    /// Asks the runtime to reach the saved memory back end.
    pub async fn test_memory(&self, bot_id: &str) -> Result<(), ApiError> {
        // The answer is `{ "connected": true }`; a failure is an error.
        let _: serde_json::Value = self
            .post_json(
                &bot_path(bot_id, "/api/memory/test"),
                &serde_json::json!({}),
            )
            .await?;
        Ok(())
    }

    /// A bot's sandbox: its settings, the provider running its commands,
    /// and that provider's limits and usage.
    pub async fn sandbox(&self, bot_id: &str) -> Result<SandboxInfo, ApiError> {
        self.get_json(&bot_path(bot_id, "/api/workspace")).await
    }

    /// Saves a bot's sandbox settings and returns them at their new
    /// revision. Fails with [`ApiError::Conflict`] when they changed since
    /// `update.revision`.
    pub async fn save_sandbox(
        &self,
        bot_id: &str,
        update: &SandboxUpdate,
    ) -> Result<SandboxSettings, ApiError> {
        let body = SaveSandboxBody {
            provider: update.provider,
            host_network_acknowledged: update.host_network_acknowledged,
            idle_minutes: update.idle_minutes,
            disk_quota_mib: update.disk_quota_mib,
            revision: update.revision,
        };
        self.post_json(&bot_path(bot_id, "/api/workspace/settings"), &body)
            .await
    }

    /// Exported traces from the last `hours` hours (1, 6 or 24).
    pub async fn traces(&self, bot_id: &str, hours: u8) -> Result<TraceDiagnostics, ApiError> {
        let path = format!("/api/diagnostics/traces?hours={hours}");
        self.get_json(&bot_path(bot_id, &path)).await
    }

    /// A bot's most recent durable events, across its conversations.
    pub async fn bot_activity(&self, bot_id: &str) -> Result<Vec<ActivityEvent>, ApiError> {
        let page: Page<ActivityEvent> = self
            .get_json(&bot_path(bot_id, "/api/inspection/activity?limit=100"))
            .await?;
        Ok(page.items)
    }

    /// Switches the runtime's trace collection on or off and returns the
    /// settings afterwards.
    pub async fn set_telemetry(
        &self,
        bot_id: &str,
        enabled: bool,
    ) -> Result<RuntimeSettings, ApiError> {
        let body = TelemetryBody {
            telemetry_enabled: enabled,
        };
        self.post_json(&bot_path(bot_id, "/api/settings"), &body)
            .await
    }

    /// A bot's scheduled jobs.
    pub async fn jobs(&self, bot_id: &str) -> Result<Vec<ScheduledJob>, ApiError> {
        let list: JobList = self.get_json(&bot_path(bot_id, "/api/jobs")).await?;
        Ok(list.items)
    }

    /// Schedules a job and returns the bot's jobs with it.
    pub async fn add_job(&self, bot_id: &str, job: &NewJob) -> Result<Vec<ScheduledJob>, ApiError> {
        let body = SaveJobBody {
            name: &job.name,
            prompt: &job.prompt,
            every_minutes: job.every_minutes,
            first_run_at: job.first_run_at,
        };
        let list: JobList = self
            .post_json(&bot_path(bot_id, "/api/jobs"), &body)
            .await?;
        Ok(list.items)
    }

    /// Resumes, pauses, removes or runs one job and returns the bot's jobs
    /// as they are afterwards.
    pub async fn change_job(
        &self,
        bot_id: &str,
        id: &str,
        action: JobAction,
    ) -> Result<Vec<ScheduledJob>, ApiError> {
        let path = format!("/api/jobs/{}", encode(id));
        let list: JobList = self
            .post_json(&bot_path(bot_id, &path), &JobActionBody { action })
            .await?;
        Ok(list.items)
    }

    /// One page of a bot's job runs, newest first: every job's, or only
    /// `job_id`'s. `before` is the cursor the page before it gave.
    pub async fn job_runs(
        &self,
        bot_id: &str,
        job_id: Option<&str>,
        before: Option<&str>,
    ) -> Result<Page<JobRun>, ApiError> {
        let mut query = Vec::new();
        if let Some(job_id) = job_id {
            query.push(format!("jobId={}", encode(job_id)));
        }
        if let Some(before) = before {
            query.push(format!("before={}", encode(before)));
        }
        let path = format!("/api/jobs/runs?{}", query.join("&"));
        self.get_json(&bot_path(bot_id, &path)).await
    }

    /// What one folder of a bot's workspace holds.
    pub async fn workspace_files(
        &self,
        bot_id: &str,
        path: &str,
    ) -> Result<WorkspaceListing, ApiError> {
        let route = format!("/api/workspace/files?path={}", encode(path));
        self.get_json(&bot_path(bot_id, &route)).await
    }

    /// The bytes of one workspace file, as it was at `revision`. The
    /// runtime refuses if the file changed since that listing.
    pub async fn download_workspace_file(
        &self,
        bot_id: &str,
        path: &str,
        revision: u64,
    ) -> Result<Vec<u8>, ApiError> {
        let route = format!(
            "/api/workspace/download?path={}&revision={revision}",
            encode(path)
        );
        let request = self.authorized(self.http.get(self.origin.url(&bot_path(bot_id, &route))));
        read_file(send(request).await?).await
    }

    /// Uploads one file to a bot and returns how the runtime filed it. The
    /// message that carries it names it by the returned id.
    pub async fn upload_attachment(
        &self,
        bot_id: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<Attachment, ApiError> {
        // A random boundary cannot occur in the file by accident.
        let boundary = format!("raphie-{}", uuid::Uuid::new_v4().simple());
        let (content_type, body) = multipart(&boundary, name, bytes);
        let request = self
            .authorized(
                self.http
                    .post(self.origin.url(&bot_path(bot_id, "/api/attachments"))),
            )
            .header("x-raphie-client", "web")
            .header("content-type", content_type)
            .body(body);
        // Megabytes over a slow link need longer than a JSON call.
        let response = request
            .timeout(UPLOAD_TIMEOUT)
            .send()
            .await
            .map_err(network)?;
        read_json(check(response).await?).await
    }

    /// The bytes of one uploaded file, by its id.
    pub async fn download_attachment(&self, bot_id: &str, id: &str) -> Result<Vec<u8>, ApiError> {
        let route = format!("/api/files/{}", encode(id));
        let request = self.authorized(self.http.get(self.origin.url(&bot_path(bot_id, &route))));
        read_file(send(request).await?).await
    }

    /// A bot's Discord and Telegram connections.
    pub async fn channels(&self, bot_id: &str) -> Result<ChannelSettings, ApiError> {
        self.get_json(&bot_path(bot_id, "/api/channels")).await
    }

    /// Where a bot's scheduled results go, and where they could.
    pub async fn channel_home(&self, bot_id: &str) -> Result<ChannelHomeSettings, ApiError> {
        self.get_json(&bot_path(bot_id, "/api/channels/home")).await
    }

    /// Makes one change to a bot's channels. `Ok` carries the pairing code
    /// when the change asked for one, and the home settings when it chose
    /// a home channel; the other routes answer with settings the caller
    /// reloads instead.
    pub async fn change_channel(
        &self,
        bot_id: &str,
        change: &ChannelChange,
    ) -> Result<ChannelAnswer, ApiError> {
        let path = |tail: &str| bot_path(bot_id, &format!("/api/channels/{tail}"));
        let empty = serde_json::json!({});
        // Most routes answer with settings this client reads again from
        // `/api/channels`, so their bodies are decoded as plain JSON.
        let done = |_: serde_json::Value| ChannelAnswer::Done;
        match change {
            ChannelChange::SaveDiscord(update) => {
                let body = SaveDiscordBody {
                    allowed_user_ids: &update.allowed_user_ids,
                    channel_id: &update.channel_id,
                    bot_token: update.token.as_ref().map(Secret::expose),
                };
                self.post_json(&path("discord"), &body).await.map(done)
            }
            ChannelChange::RemoveDiscord => self
                .post_json(&path("discord/remove"), &empty)
                .await
                .map(done),
            ChannelChange::SaveTelegram(token) => {
                let body = SaveTelegramBody {
                    bot_token: Some(token.expose()),
                    enabled: None,
                };
                self.post_json(&path("telegram"), &body).await.map(done)
            }
            ChannelChange::EnableTelegram(enabled) => {
                let body = SaveTelegramBody {
                    bot_token: None,
                    enabled: Some(*enabled),
                };
                self.post_json(&path("telegram"), &body).await.map(done)
            }
            ChannelChange::RemoveTelegram => self
                .post_json(&path("telegram/remove"), &empty)
                .await
                .map(done),
            ChannelChange::UnpairTelegram(user_id) => {
                let body = UnpairTelegramBody { user_id };
                self.post_json(&path("telegram/unpair"), &body)
                    .await
                    .map(done)
            }
            ChannelChange::PairTelegram => self
                .post_json(&path("telegram/pairing"), &empty)
                .await
                .map(ChannelAnswer::Pairing),
            ChannelChange::SelectHome(id) => {
                let body = SelectHomeBody { id: id.as_deref() };
                self.post_json(&path("home"), &body)
                    .await
                    .map(ChannelAnswer::Home)
            }
        }
    }

    /// A bot's connections to MCP servers.
    pub async fn mcp(&self, bot_id: &str) -> Result<Vec<McpConnection>, ApiError> {
        let list: McpList = self.get_json(&bot_path(bot_id, "/api/mcp")).await?;
        Ok(list.items)
    }

    /// Adds a connection and returns the bot's connections with it.
    pub async fn add_mcp(
        &self,
        bot_id: &str,
        connection: &NewMcpConnection,
    ) -> Result<Vec<McpConnection>, ApiError> {
        let body = match connection {
            NewMcpConnection::Http { name, url, token } => SaveMcpBody::Http {
                name,
                url,
                token: token.as_ref().map(Secret::expose),
            },
            NewMcpConnection::Stdio {
                name,
                command,
                args,
                env,
            } => SaveMcpBody::Stdio {
                name,
                command,
                args,
                env: env
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.expose()))
                    .collect(),
            },
        };
        let list: McpList = self.post_json(&bot_path(bot_id, "/api/mcp"), &body).await?;
        Ok(list.items)
    }

    /// Enables, pauses, removes or imports one connection and returns the
    /// bot's connections as they are afterwards.
    pub async fn change_mcp(
        &self,
        bot_id: &str,
        id: &str,
        action: McpAction,
    ) -> Result<Vec<McpConnection>, ApiError> {
        let path = format!("/api/mcp/{}", encode(id));
        let list: McpList = self
            .post_json(&bot_path(bot_id, &path), &McpActionBody { action })
            .await?;
        Ok(list.items)
    }

    /// One page of a bot's saved memories, newest first; `after` is the
    /// cursor the page before it gave.
    pub async fn memory_evidence(
        &self,
        bot_id: &str,
        after: Option<&str>,
    ) -> Result<MemoryPage, ApiError> {
        let path = match after {
            Some(cursor) => format!("/api/memory/evidence?after={}", encode(cursor)),
            None => "/api/memory/evidence".to_owned(),
        };
        self.get_json(&bot_path(bot_id, &path)).await
    }

    /// The saved memories that best match `query`.
    pub async fn recall_memory(&self, bot_id: &str, query: &str) -> Result<MemoryRecall, ApiError> {
        self.post_json(
            &bot_path(bot_id, "/api/memory/recall"),
            &RecallBody { query },
        )
        .await
    }

    /// Replaces what one memory says.
    pub async fn revise_memory(
        &self,
        bot_id: &str,
        id: &str,
        content: &str,
    ) -> Result<(), ApiError> {
        let path = format!("/api/memory/evidence/{}", encode(id));
        // The answer is `{ "updated": true }`; a failure is an error.
        let _: serde_json::Value = self
            .post_json(&bot_path(bot_id, &path), &ReviseMemoryBody { content })
            .await?;
        Ok(())
    }

    /// Removes one memory from what the bot remembers.
    pub async fn forget_memory(&self, bot_id: &str, id: &str) -> Result<(), ApiError> {
        let path = format!("/api/memory/evidence/{}/forget", encode(id));
        // The answer is `{ "forgotten": true }`; a failure is an error.
        let _: serde_json::Value = self
            .post_json(&bot_path(bot_id, &path), &serde_json::json!({}))
            .await?;
        Ok(())
    }

    pub async fn sessions(
        &self,
        bot_id: &str,
        after: Option<&str>,
    ) -> Result<Page<SessionSummary>, ApiError> {
        let mut path = bot_path(bot_id, "/api/sessions?limit=100");
        if let Some(after) = after {
            path.push_str("&after=");
            path.push_str(&encode(after));
        }
        self.get_json(&path).await
    }

    pub async fn session(
        &self,
        bot_id: &str,
        session_id: &str,
    ) -> Result<SessionObservation, ApiError> {
        let path = bot_path(bot_id, &format!("/api/sessions/{}", encode(session_id)));
        self.get_json(&path).await
    }

    /// Turns before `before` (a turn id), oldest first within the page.
    pub async fn history(
        &self,
        bot_id: &str,
        session_id: &str,
        before: &str,
    ) -> Result<Page<SessionTurn>, ApiError> {
        let path = bot_path(
            bot_id,
            &format!(
                "/api/sessions/{}/history?before={}&limit=50",
                encode(session_id),
                encode(before)
            ),
        );
        self.get_json(&path).await
    }

    /// Opens an event stream. The caller reads `bytes_stream()` and feeds an
    /// [`SseParser`](crate::sse::SseParser).
    pub async fn open_stream(&self, path: &str) -> Result<Response, ApiError> {
        let request = self
            .authorized(self.http.get(self.origin.url(path)))
            .header("accept", "text/event-stream");
        // No `.timeout()`: it would cut the stream off mid-conversation.
        let response = request.send().await.map_err(network)?;
        check(response).await
    }

    // ----- Commands -----

    pub async fn submit(&self, bot_id: &str, message: &SubmitMessage) -> Result<Receipt, ApiError> {
        self.post_json(&bot_path(bot_id, "/api/sessions/messages"), message)
            .await
    }

    /// Records a decision and returns the approval's status afterwards. That
    /// status differs from `decision` when the approval had already been
    /// settled elsewhere or expired.
    pub async fn decide(
        &self,
        bot_id: &str,
        approval_id: &str,
        decision: Decision,
        scope: Scope,
    ) -> Result<ApprovalStatus, ApiError> {
        let path = bot_path(
            bot_id,
            &format!("/api/tool-approvals/{}", encode(approval_id)),
        );
        let body = DecisionBody { decision, scope };
        let result: DecisionResult = self.post_json(&path, &body).await?;
        Ok(result.status)
    }

    /// Stops the session's run, or changes how a queued message joins it.
    pub async fn control(
        &self,
        bot_id: &str,
        session_id: &str,
        action: ControlAction,
        turn_id: Option<&str>,
    ) -> Result<(), ApiError> {
        let path = bot_path(
            bot_id,
            &format!("/api/sessions/{}/control", encode(session_id)),
        );
        // The answer is `{ "ok": true }`; only success or failure matters,
        // so read it as any JSON value and drop it.
        let _: serde_json::Value = self
            .post_json(&path, &ControlBody { action, turn_id })
            .await?;
        Ok(())
    }

    // ----- Plumbing -----

    fn authorized(&self, request: RequestBuilder) -> RequestBuilder {
        match &self.token {
            Some(token) => request.bearer_auth(token.expose()),
            None => request,
        }
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        let request = self.authorized(self.http.get(self.origin.url(path)));
        read_json(send(request).await?).await
    }

    async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ApiError> {
        let request = self
            .authorized(self.http.post(self.origin.url(path)))
            .header("x-raphie-client", "web")
            .json(body);
        read_json(send(request).await?).await
    }
}

async fn send(request: RequestBuilder) -> Result<Response, ApiError> {
    let response = request
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(network)?;
    check(response).await
}

/// Reads a file's bytes from a response, refusing one too large to hold.
async fn read_file(response: Response) -> Result<Vec<u8>, ApiError> {
    let too_large = || ApiError::Decode("This file is too large to download here.".into());
    // Refuse early when the server says how large the file is.
    if response
        .content_length()
        .is_some_and(|length| length > DOWNLOAD_LIMIT as u64)
    {
        return Err(too_large());
    }
    let bytes = response.bytes().await.map_err(network)?;
    if bytes.len() > DOWNLOAD_LIMIT {
        return Err(too_large());
    }
    Ok(bytes.to_vec())
}

/// Turns an unsuccessful response into an [`ApiError`], using the server's own
/// message where it gave one.
async fn check(response: Response) -> Result<Response, ApiError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body: ErrorBody = response.json().await.unwrap_or_default();
    let message = body
        .error
        .unwrap_or_else(|| format!("Request failed ({}).", status.as_u16()));
    Err(match status {
        StatusCode::UNAUTHORIZED => ApiError::Unauthenticated,
        StatusCode::SERVICE_UNAVAILABLE if body.code.as_deref() == Some("locked") => {
            ApiError::Locked
        }
        StatusCode::NOT_FOUND => ApiError::NotFound(message),
        StatusCode::CONFLICT => ApiError::Conflict(message),
        _ => ApiError::Rejected {
            status: status.as_u16(),
            message,
        },
    })
}

async fn read_json<T: DeserializeOwned>(response: Response) -> Result<T, ApiError> {
    // Read the bytes first so a network failure mid-body is reported as one,
    // and only a malformed body as a decode error.
    let bytes = response.bytes().await.map_err(network)?;
    serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(e.to_string()))
}

fn network(error: reqwest::Error) -> ApiError {
    // `without_url` keeps query strings (and anything in them) out of messages.
    ApiError::Network(error.without_url().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_bot_keeps_unprefixed_routes() {
        assert_eq!(bot_path("default", "/api/sessions"), "/api/sessions");
        assert_eq!(
            bot_path("b1 2", "/api/sessions/x/events"),
            "/api/bots/b1%202/sessions/x/events"
        );
    }

    #[test]
    fn transient_errors_are_network_and_server_failures() {
        assert!(ApiError::Network("down".into()).is_transient());
        assert!(
            ApiError::Rejected {
                status: 503,
                message: String::new()
            }
            .is_transient()
        );
        assert!(!ApiError::Unauthenticated.is_transient());
        assert!(!ApiError::Conflict(String::new()).is_transient());
    }
}
