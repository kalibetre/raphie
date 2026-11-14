//! A fake Raphie web host for tests: just enough of the authenticated API,
//! device sign-in and event streams, on a random loopback port. It mirrors the
//! behaviour documented in `docs/authentication.md` and
//! `docs/headless-interface.md`; it makes no model calls.

#![allow(dead_code)] // each test file uses a different part of it

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{Stream, StreamExt};
use raphie_core::engine::{Client, Command, EngineConfig};
use raphie_core::model::{Event, Model};
use raphie_core::origin::Origin;
use serde_json::{Value, json};
use tokio::sync::watch;
use tokio_stream::wrappers::WatchStream;

pub const TOKEN: &str = "device-token-1";

/// What the host does and has seen. Tests change it to script scenarios.
#[derive(Default)]
pub struct Host {
    pub origin: String,
    /// Token polls answered `authorization_pending` before the token.
    pub pending_polls: u32,
    pub deny: bool,
    /// Where the approval link points (defaults to this host).
    pub verification_override: Option<String>,
    pub revoked: bool,
    /// Submissions answered 503 before succeeding.
    pub failing_submits: u32,
    pub submits: Vec<Value>,
    pub approvals: HashMap<String, &'static str>,
    /// Decision bodies, as received.
    pub decisions: Vec<Value>,
    /// Control requests: the session id and the body.
    pub controls: Vec<(String, Value)>,
    /// Answer control requests with 409, as when the run already ended.
    pub control_conflict: bool,
    pub history: Vec<Value>,
    /// The research bot's current revision; saves from an older one conflict.
    pub profile_revision: u32,
    /// Profile saves, as received.
    pub profile_saves: Vec<Value>,
    /// The default model, once one was chosen: `(model id, connection id)`.
    pub default_model: Option<(String, String)>,
    /// Every request: method, path, and the headers that matter.
    pub requests: Vec<Seen>,
}

#[derive(Clone, Debug)]
pub struct Seen {
    pub method: &'static str,
    pub path: String,
    pub authorization: Option<String>,
    pub client_marker: Option<String>,
    pub origin_header: bool,
    pub cookie: bool,
}

#[derive(Clone)]
pub struct Fake {
    pub host: Arc<Mutex<Host>>,
    /// The JSON each session stream sends; updating it pushes an event.
    pub observation: watch::Sender<String>,
    pub sessions: watch::Sender<String>,
}

pub struct FakeHost {
    pub origin: Origin,
    pub fake: Fake,
    // Keeps the server's runtime alive for the test's duration.
    _runtime: tokio::runtime::Runtime,
}

impl FakeHost {
    pub fn start() -> FakeHost {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .unwrap();
        let listener = runtime
            .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
            .unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let fake = Fake {
            host: Arc::new(Mutex::new(Host {
                origin: origin.clone(),
                ..Host::default()
            })),
            observation: watch::channel(observation_json(&[], None, "idle")).0,
            sessions: watch::channel(sessions_json(&["s-1"])).0,
        };
        let app = router(fake.clone());
        runtime.spawn(async move { axum::serve(listener, app).await.unwrap() });
        FakeHost {
            origin: Origin::parse(&origin).unwrap(),
            fake,
            _runtime: runtime,
        }
    }

    pub fn with<R>(&self, f: impl FnOnce(&mut Host) -> R) -> R {
        f(&mut self.fake.host.lock().unwrap())
    }

    pub fn requests(&self, path_prefix: &str) -> Vec<Seen> {
        self.with(|h| {
            h.requests
                .iter()
                .filter(|r| r.path.starts_with(path_prefix))
                .cloned()
                .collect()
        })
    }
}

fn router(fake: Fake) -> Router {
    Router::new()
        .route("/api/auth/device/code", post(device_code))
        .route("/api/auth/device/token", post(device_token))
        .route("/auth/status", get(auth_status))
        .route("/api/bots", get(bots))
        .route("/api/sessions/events", get(session_list_events))
        .route("/api/bots/{bot}/sessions/events", get(session_list_events))
        .route("/api/sessions/messages", post(submit))
        .route("/api/bots/{bot}/sessions/messages", post(submit))
        .route("/api/sessions/{id}/events", get(session_events))
        .route("/api/sessions/{id}/history", get(history))
        .route("/api/tool-approvals/{id}", post(decide))
        .route("/api/sessions/{id}/control", post(control))
        .route("/api/bots/{id}/profile", post(save_profile))
        .route("/api/settings", get(settings).post(set_default_model))
        .route(
            "/api/bots/{bot}/settings",
            get(settings).post(set_default_model),
        )
        .with_state(fake)
}

fn record(fake: &Fake, method: &'static str, path: String, headers: &HeaderMap) {
    let header = |name: &str| headers.get(name).map(|v| v.to_str().unwrap().to_owned());
    fake.host.lock().unwrap().requests.push(Seen {
        method,
        path,
        authorization: header("authorization"),
        client_marker: header("x-raphie-client"),
        origin_header: headers.contains_key("origin"),
        cookie: headers.contains_key("cookie"),
    });
}

/// The web host's gateway: `None` for a valid bearer token, else the 401.
fn refuse(fake: &Fake, headers: &HeaderMap) -> Option<Response> {
    let host = fake.host.lock().unwrap();
    let expected = format!("Bearer {TOKEN}");
    let ok = headers.get("authorization").and_then(|v| v.to_str().ok()) == Some(expected.as_str());
    if ok && !host.revoked {
        None
    } else {
        Some(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Sign in to continue.", "code": "unauthenticated" })),
            )
                .into_response(),
        )
    }
}

async fn device_code(State(fake): State<Fake>, headers: HeaderMap) -> Json<Value> {
    record(&fake, "POST", "/api/auth/device/code".into(), &headers);
    let host = fake.host.lock().unwrap();
    let link = host
        .verification_override
        .clone()
        .unwrap_or_else(|| format!("{}/device?user_code=WXYZ-1234", host.origin));
    Json(json!({
        "device_code": "dev-code",
        "user_code": "WXYZ-1234",
        "verification_uri": format!("{}/device", host.origin),
        "verification_uri_complete": link,
        // The real host says 5; the client still enforces its own minimum,
        // which `fast_config` lowers so tests do not sleep.
        "interval": 0,
        "expires_in": 600,
    }))
}

async fn device_token(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(&fake, "POST", "/api/auth/device/token".into(), &headers);
    let mut host = fake.host.lock().unwrap();
    if host.deny {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "access_denied" })),
        )
            .into_response();
    }
    if host.pending_polls > 0 {
        host.pending_polls -= 1;
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "authorization_pending" })),
        )
            .into_response();
    }
    Json(json!({ "access_token": TOKEN, "token_type": "Bearer", "expires_in": 2592000 }))
        .into_response()
}

/// Like the real gateway: says who is signed in when the token is good.
async fn auth_status(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(&fake, "GET", "/auth/status".into(), &headers);
    let signed_in = refuse(&fake, &headers).is_none();
    let mut status = json!({ "configured": true, "authenticated": signed_in });
    if signed_in {
        status["account"] = json!({ "email": "owner@example.com", "name": "Owner" });
    }
    Json(status).into_response()
}

async fn bots(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(&fake, "GET", "/api/bots".into(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let revision = fake.host.lock().unwrap().profile_revision.max(1);
    Json(json!({ "items": [
        { "id": "default", "name": "Raphie", "description": "", "soul": "", "color": null,
          "revision": 1, "createdAt": 1, "updatedAt": 1 },
        { "id": "b-research", "name": "Research", "description": "Reads papers", "soul": "Be brief.",
          "revision": revision, "createdAt": 2, "updatedAt": 2 }
    ]}))
    .into_response()
}

/// Two models through one connection; the default is the first until the
/// test (or a POST) picks another.
fn settings_json(fake: &Fake) -> Value {
    let (model, connection) = fake
        .host
        .lock()
        .unwrap()
        .default_model
        .clone()
        .unwrap_or(("fast".into(), "c-main".into()));
    let entry = |id: &str, name: &str| {
        json!({
            "id": id, "name": name, "provider": "openrouter", "connectionId": "c-main",
            "connectionName": "Main", "contextWindow": 200000, "maxOutputTokens": 8192,
            "reasoning": false, "inputModalities": ["text"],
            "pricing": { "input": 3, "output": 15 }
        })
    };
    json!({
        "telemetryEnabled": true, "provider": connection, "providerEnabled": true,
        "credentialSource": "saved", "modelId": model,
        "providers": [{ "id": "openrouter", "name": "OpenRouter" }],
        "connections": [{ "id": "c-main", "provider": "openrouter", "name": "Main",
                          "credentialSource": "saved" }],
        "models": [entry("fast", "Anthropic: Fast"), entry("deep", "Anthropic: Deep")]
    })
}

async fn settings(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    Json(settings_json(&fake)).into_response()
}

async fn set_default_model(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let (Some(model), Some(connection)) = (body["modelId"].as_str(), body["connectionId"].as_str())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Choose a model." })),
        )
            .into_response();
    };
    fake.host.lock().unwrap().default_model = Some((model.to_owned(), connection.to_owned()));
    Json(settings_json(&fake)).into_response()
}

/// Saves the research bot's profile if the save started from its current
/// revision, as the runtime does; otherwise answers 409.
async fn save_profile(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", format!("/api/bots/{id}/profile"), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    host.profile_saves.push(body.clone());
    let current = host.profile_revision.max(1);
    if body["revision"] != current {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "This bot changed. Reload and try again." })),
        )
            .into_response();
    }
    host.profile_revision = current + 1;
    Json(json!({
        "id": id, "name": body["name"], "description": body["description"],
        "soul": body["soul"], "color": body["color"],
        "revision": current + 1, "createdAt": 2, "updatedAt": 3
    }))
    .into_response()
}

/// An SSE stream of the watch channel's values that ends when the token is
/// revoked, as the real gateway closes streams of revoked sessions.
fn stream_of(
    fake: Fake,
    values: watch::Receiver<String>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let host = fake.host.clone();
    let stream = WatchStream::new(values)
        .take_while(move |_| {
            let revoked = host.lock().unwrap().revoked;
            async move { !revoked }
        })
        .map(|json| Ok(SseEvent::default().data(json)));
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn session_list_events(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let values = fake.sessions.subscribe();
    stream_of(fake, values).into_response()
}

async fn session_events(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", format!("/api/sessions/{id}/events"), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    if id == "missing" {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Session not found." })),
        )
            .into_response();
    }
    let values = fake.observation.subscribe();
    stream_of(fake, values).into_response()
}

async fn history(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    record(
        &fake,
        "GET",
        format!("/api/sessions/{id}/history"),
        &headers,
    );
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    // The runtime's rule: items before the anchor, `next` = oldest item's id
    // when there are more.
    let before = query.get("before").cloned().unwrap_or_default();
    let end = host
        .history
        .iter()
        .position(|t| t["id"] == before.as_str())
        .unwrap_or(host.history.len());
    let start = end.saturating_sub(2);
    let items: Vec<Value> = host.history[start..end].to_vec();
    let next = if start > 0 {
        items[0]["id"].clone()
    } else {
        Value::Null
    };
    Json(json!({ "items": items, "next": next })).into_response()
}

async fn submit(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    host.submits.push(body.clone());
    if host.failing_submits > 0 {
        host.failing_submits -= 1;
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "The runtime is unavailable. Please retry." })),
        )
            .into_response();
    }
    let session = body["sessionId"].as_str().unwrap_or("s-new").to_owned();
    (
        StatusCode::CREATED,
        Json(json!({ "id": "turn-new", "sessionId": session })),
    )
        .into_response()
}

async fn decide(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", format!("/api/tool-approvals/{id}"), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    host.decisions.push(body.clone());
    let Some(status) = host.approvals.get_mut(&id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not found." })),
        )
            .into_response();
    };
    // Settled approvals are immutable: a late decision returns the old status.
    if *status == "pending" {
        *status = if body["decision"] == "approved" {
            "approved"
        } else {
            "rejected"
        };
    }
    Json(json!({ "status": *status })).into_response()
}

async fn control(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(
        &fake,
        "POST",
        format!("/api/sessions/{id}/control"),
        &headers,
    );
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    host.controls.push((id, body));
    if host.control_conflict {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Nothing is running." })),
        )
            .into_response();
    }
    Json(json!({ "ok": true })).into_response()
}

// ----- JSON in the runtime's shapes -----

pub fn turn_json(
    id: &str,
    created_at: i64,
    text: &str,
    answer: Option<&str>,
    status: &str,
) -> Value {
    json!({
        "id": id, "conversationId": "s-1", "source": "web", "text": text,
        "createdAt": created_at, "status": status, "answer": answer,
    })
}

pub fn summary_json(id: &str) -> Value {
    json!({
        "id": id, "sessionId": id, "title": format!("Session {id}"), "createdAt": 1,
        "origin": "web", "lastAt": 2, "working": false, "failed": false, "waiting": false,
        "preview": "Hello", "turnCount": 1
    })
}

pub fn sessions_json(ids: &[&str]) -> String {
    let items: Vec<Value> = ids.iter().map(|id| summary_json(id)).collect();
    json!({ "items": items, "next": null }).to_string()
}

pub fn observation_json(turns: &[Value], live: Option<&str>, phase: &str) -> String {
    json!({
        "session": summary_json("s-1"),
        "turns": turns,
        "toolApprovals": [],
        "live": live.map(|text| json!({ "text": text, "generating": true, "usage": null })),
        "activity": [],
        "nextBefore": turns.first().map(|t| t["id"].clone()),
        "phase": phase,
        "error": null,
    })
    .to_string()
}

// ----- Driving a client -----

pub fn fast_config() -> EngineConfig {
    let mut config = EngineConfig {
        settings_path: None,
        reconnect_min: Duration::from_millis(20),
        reconnect_max: Duration::from_millis(100),
        send_retries: vec![Duration::from_millis(10), Duration::from_millis(10)],
        ..EngineConfig::default()
    };
    config.device.min_interval = Duration::from_millis(10);
    config.device.slow_down_step = Duration::from_millis(10);
    config
}

/// A client plus the model a UI would keep, and every event seen so far.
pub struct Driver {
    pub client: Client,
    pub model: Model,
    pub seen: Vec<Event>,
}

impl Driver {
    pub fn new(store: Arc<dyn raphie_core::auth::TokenStore>) -> Driver {
        Driver {
            client: Client::start(store, fast_config(), Arc::new(|| {})),
            model: Model::new(),
            seen: Vec::new(),
        }
    }

    pub fn send(&mut self, command: Command) {
        self.client.send(command);
    }

    /// Applies events until `done` holds for the model, or panics after 5 s.
    pub fn until(&mut self, what: &str, done: impl Fn(&Model, &[Event]) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            for event in self.client.drain() {
                self.model.apply(event.clone());
                self.seen.push(event);
            }
            if done(&self.model, &self.seen) {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {what}; saw {:#?}",
                self.seen
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
