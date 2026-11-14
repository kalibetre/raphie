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

use crate::auth::{AccessToken, CLIENT_ID, DeviceCode, DevicePoll};
use crate::contracts::{
    ApprovalStatus, BotList, BotProfile, ControlAction, ControlBody, Decision, DecisionBody,
    DecisionResult, DeviceCodeResponse, DeviceTokenResponse, ErrorBody, Page, Receipt, Scope,
    SessionObservation, SessionSummary, SessionTurn, SubmitMessage,
};
use crate::origin::Origin;

/// Ordinary requests give up after this long. Event streams have no overall
/// timeout (they stay open for as long as the conversation is on screen).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

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

    pub async fn bots(&self) -> Result<Vec<BotProfile>, ApiError> {
        let list: BotList = self.get_json("/api/bots").await?;
        Ok(list.items)
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
