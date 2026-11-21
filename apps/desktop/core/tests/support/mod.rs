//! A fake Raphie web host for tests: just enough of the authenticated API,
//! device sign-in and event streams, on a random loopback port. It mirrors the
//! behaviour documented in `apps/docs/src/content/docs/operate/authentication.mdx` and
//! `apps/docs/src/content/docs/architecture/http-api.mdx`; it makes no model calls.

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
    /// The runtime behind the web host is stopped: `/api/runtime` answers
    /// 503, as the web host's proxy does.
    pub runtime_down: bool,
    /// The release `/_raphie/version` names, `v0.0.4` when unset.
    pub version: Option<String>,
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
    /// Connections added by tests: `(id, provider, name)`.
    pub added_connections: Vec<(String, String, String)>,
    /// Connection requests: the path's tail and the body as received.
    pub connection_requests: Vec<(String, Value)>,
    /// Answer connection tests with a failure, as a wrong key would.
    pub reject_key: bool,
    /// The memory settings, once a test saved some.
    pub memory: Option<Value>,
    /// Memory saves, as received.
    pub memory_saves: Vec<Value>,
    /// Answer memory tests with a failure, as an unreachable server would.
    pub memory_unreachable: bool,
    /// Bots created by tests, as the runtime lists them.
    pub created_bots: Vec<Value>,
    /// Ids of bots deleted by tests.
    pub deleted_bots: Vec<String>,
    /// Bodies of bot deletes: the id and the confirmation sent.
    pub bot_deletes: Vec<(String, Value)>,
    /// Each session's command mode, once a test or a change set one;
    /// a session not listed asks.
    pub approval_modes: HashMap<String, String>,
    /// Answer command mode requests with a failure.
    pub approval_mode_down: bool,
    /// Model choices: the path asked and the body.
    pub model_choices: Vec<(String, Value)>,
    /// Answer model choices as a runtime that no longer has the model.
    pub model_unavailable: bool,
    /// Uploaded files: the id given, the name sent and the bytes.
    pub uploads: Vec<(String, String, Vec<u8>)>,
    /// Answer uploads as a runtime whose workspace is unavailable does.
    pub uploads_down: bool,
    /// Read counts shared by the client: the request path and `replyCount`.
    pub reads: Vec<(String, u64)>,
    /// Subscription sign-ins: the start bodies and the answers given.
    pub sign_in_starts: Vec<Value>,
    pub sign_in_answers: Vec<Value>,
    /// Trace collection is switched off.
    pub telemetry_off: bool,
    /// The exported spans, and the bot's durable events oldest first, as
    /// the runtime lists them.
    pub spans: Vec<Value>,
    pub activity: Vec<Value>,
    /// Answer trace requests with a failure, as a trace backend that is
    /// down would.
    pub traces_down: bool,
    /// The bot's scheduled jobs, and their runs newest first, as the
    /// runtime lists them.
    pub jobs: Vec<Value>,
    pub job_runs: Vec<Value>,
    /// Each named bot's conversations, as its sessions page lists them.
    pub bot_sessions: HashMap<String, Vec<Value>>,
    /// The archived conversations, as `?archived=1` lists them.
    pub archived_sessions: Vec<Value>,
    /// Archive requests: the path asked and the body.
    pub archives: Vec<(String, Value)>,
    /// Each bot's undismissed job runs ("default" for the default bot).
    pub job_updates: HashMap<String, Vec<Value>>,
    /// Answer job update requests with a failure.
    pub job_updates_down: bool,
    /// Refuse to dismiss job runs.
    pub acknowledge_down: bool,
    /// Bodies of job adds, as received.
    pub job_adds: Vec<Value>,
    /// The default bot's handoffs, newest first, and the bots it can hand
    /// tasks to, as `GET /api/handoffs` lists them.
    pub handoffs: Vec<Value>,
    pub handoff_targets: Vec<Value>,
    /// The workspace's files: `(path, bytes)`. Folders are implied by the
    /// paths. `workspace_revision` is the listing revision downloads name.
    pub workspace: Vec<(String, Vec<u8>)>,
    pub workspace_revision: u64,
    /// The sandbox settings, once a test saved some.
    pub sandbox: Option<Value>,
    /// Sandbox saves, as received.
    pub sandbox_saves: Vec<Value>,
    /// The Discord and Telegram settings, as the runtime answers them.
    pub discord: Option<Value>,
    pub telegram: Option<Value>,
    /// Bodies of channel changes: the path's tail and the body.
    pub channel_requests: Vec<(String, Value)>,
    /// The home channel's selected destination, and the known ones.
    pub home_selected: Option<String>,
    pub home_destinations: Vec<Value>,
    /// The bot's MCP connections, as the runtime lists them.
    pub mcp: Vec<Value>,
    /// Bodies of MCP adds, as received.
    pub mcp_adds: Vec<Value>,
    /// The saved memories, newest first: `(id, content)`.
    pub memories: Vec<(String, String)>,
    /// Answer corrections and forgets with 409, as while a turn is running.
    pub memory_busy: bool,
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
        .route("/_raphie/health", get(health))
        .route("/api/runtime", get(runtime_info))
        .route("/_raphie/version", get(host_version))
        .route("/api/bots", get(bots).post(create_bot))
        .route("/api/bots/{id}", axum::routing::delete(delete_bot))
        .route("/api/bots/{id}/history", get(bot_history))
        .route("/api/sessions/events", get(session_list_events))
        .route("/api/bots/{bot}/sessions/events", get(session_list_events))
        .route("/api/sessions/messages", post(submit))
        .route("/api/attachments", post(upload))
        .route("/api/bots/{bot}/attachments", post(upload))
        .route("/api/files/{id}", get(uploaded_file))
        .route("/api/bots/{bot}/sessions/messages", post(submit))
        .route("/api/sessions/{id}/events", get(session_events))
        .route("/api/sessions/{id}/history", get(history))
        .route("/api/tool-approvals/{id}", post(decide))
        .route("/api/sessions/{id}/control", post(control))
        .route("/api/sessions/{id}/model", post(choose_model))
        .route(
            "/api/sessions/{id}/approval-mode",
            get(approval_mode).put(set_approval_mode),
        )
        .route("/api/bots/{bot}/sessions/{id}/model", post(choose_model))
        .route("/api/bots/{id}/profile", post(save_profile))
        .route("/api/settings", get(settings).post(set_default_model))
        .route("/api/settings/connections", post(connection))
        .route("/api/settings/connections/{id}", post(connection))
        .route("/api/settings/connections/{id}/{action}", post(connection))
        .route("/api/settings/provider/test", post(connection))
        .route(
            "/api/bots/{bot}/settings",
            get(settings).post(set_default_model),
        )
        .route("/api/memory", get(memory).post(save_memory))
        .route("/api/memory/test", post(test_memory))
        .route("/api/workspace", get(sandbox))
        .route("/api/workspace/settings", post(save_sandbox))
        .route("/api/diagnostics/traces", get(traces))
        .route("/api/inspection/activity", get(bot_activity))
        .route("/api/jobs", get(jobs).post(add_job))
        .route("/api/handoffs", get(handoffs))
        .route("/api/handoffs/{id}/cancel", post(cancel_handoff))
        .route("/api/jobs/runs", get(job_runs))
        .route("/api/bots/{bot}/sessions", get(bot_sessions))
        .route("/api/sessions", get(bot_sessions))
        .route("/api/sessions/{id}/archive", post(archive))
        .route("/api/bots/{bot}/sessions/{id}/archive", post(archive))
        .route("/github/releases", get(github_releases))
        .route("/api/jobs/notifications", get(job_updates))
        .route("/api/bots/{bot}/jobs/notifications", get(job_updates))
        .route("/api/jobs/runs/{id}/read", post(acknowledge_run))
        .route("/api/sessions/{id}/read", post(mark_read))
        .route("/api/settings/sign-ins", post(start_sign_in))
        .route("/api/settings/sign-ins/{id}", get(read_sign_in))
        .route("/api/settings/sign-ins/{id}/answer", post(answer_sign_in))
        .route("/api/settings/sign-ins/{id}/cancel", post(cancel_sign_in))
        .route("/api/bots/{bot}/sessions/{id}/read", post(mark_read))
        .route("/api/bots/{bot}/jobs/runs/{id}/read", post(acknowledge_run))
        .route("/api/jobs/{id}", post(change_job))
        .route("/api/workspace/files", get(workspace_files))
        .route("/api/workspace/download", get(workspace_download))
        .route("/api/channels", get(channels))
        .route("/api/channels/home", get(channel_home).post(channel_home))
        .route("/api/channels/{channel}", post(change_channel))
        .route("/api/channels/{channel}/{action}", post(change_channel))
        .route("/api/mcp", get(mcp).post(add_mcp))
        .route("/api/mcp/{id}", post(change_mcp))
        .route("/api/memory/evidence", get(memory_evidence))
        .route("/api/memory/recall", post(recall_memory))
        .route("/api/memory/evidence/{id}", post(change_memory))
        .route("/api/memory/evidence/{id}/{action}", post(change_memory))
        .with_state(fake)
}

/// The memory settings as the runtime answers them: built-in until a test
/// saves something else. The key never comes back, only whether one is held.
fn memory_json(fake: &Fake) -> Value {
    let saved = fake.host.lock().unwrap().memory.clone();
    let configuration = saved.unwrap_or_else(|| {
        json!({
            "enabled": true, "provider": "builtin", "scope": "owner",
            "endpoint": "", "bankId": "", "hasCredential": false,
        })
    });
    let hindsight = configuration["provider"] == "hindsight";
    json!({
        "configuration": configuration,
        "capabilities": {
            "browse": !hindsight, "retain": true, "recall": true,
            "reflect": if hindsight { "provider" } else { "model-assisted" },
            "revise": !hindsight, "forget": !hindsight,
            "consolidation": if hindsight { "provider" } else { "none" },
        },
        "error": null,
    })
}

async fn memory(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    Json(memory_json(&fake)).into_response()
}

async fn save_memory(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    {
        let mut host = fake.host.lock().unwrap();
        host.memory_saves.push(body.clone());
        if body["provider"] == "hindsight"
            && !body["endpoint"].as_str().unwrap_or("").starts_with("http")
        {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Enter a valid Hindsight endpoint." })),
            )
                .into_response();
        }
        // As the runtime does: a string saves a key, null clears it, and a
        // missing field keeps whatever was there.
        let had = host
            .memory
            .as_ref()
            .is_some_and(|m| m["hasCredential"] == true);
        let has = match body.get("apiKey") {
            Some(Value::String(_)) => true,
            Some(Value::Null) => false,
            _ => had,
        };
        host.memory = Some(json!({
            "enabled": body["enabled"], "provider": body["provider"], "scope": body["scope"],
            "endpoint": body["endpoint"].as_str().unwrap_or("").trim_end_matches('/'),
            "bankId": body["bankId"], "hasCredential": has,
        }));
    }
    Json(memory_json(&fake)).into_response()
}

/// Exported spans for a window of 1, 6 or 24 hours.
async fn traces(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.to_string(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    let refused = |status: StatusCode, message: &str| {
        (status, Json(json!({ "error": message }))).into_response()
    };
    if host.traces_down {
        return refused(StatusCode::BAD_GATEWAY, "The trace backend did not answer.");
    }
    let hours = query_value(&uri, "hours").unwrap_or_default();
    if !["1", "6", "24"].contains(&hours.as_str()) {
        return refused(
            StatusCode::BAD_REQUEST,
            "Choose a 1, 6 or 24 hour trace window.",
        );
    }
    Json(json!({
        "source": "otlp", "state": "ready", "exportEnabled": !host.telemetry_off,
        "spans": host.spans, "from": 0, "to": 1, "spanLimit": 500,
    }))
    .into_response()
}

async fn bot_activity(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", uri.to_string(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let items = fake.host.lock().unwrap().activity.clone();
    Json(json!({ "items": items, "next": null })).into_response()
}

fn jobs_json(fake: &Fake) -> Response {
    let items = fake.host.lock().unwrap().jobs.clone();
    Json(json!({ "items": items })).into_response()
}

async fn jobs(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    jobs_json(&fake)
}

async fn handoffs(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    Json(json!({ "targets": host.handoff_targets, "items": host.handoffs })).into_response()
}

/// Stops a working handoff; a finished one answers 409, as the runtime does.
async fn cancel_handoff(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    let Some(item) = host.handoffs.iter_mut().find(|item| item["id"] == id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Handoff not found." })),
        )
            .into_response();
    };
    if item["status"] != "working" {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "This task has already finished." })),
        )
            .into_response();
    }
    item["status"] = json!("cancelled");
    Json(json!({ "ok": true })).into_response()
}

/// Schedules a job, unless its first run is in the past.
async fn add_job(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    {
        let mut host = fake.host.lock().unwrap();
        host.job_adds.push(body.clone());
        if body["firstRunAt"].as_i64().unwrap_or(0) < 1_000 {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Choose a first run in the future." })),
            )
                .into_response();
        }
        let id = format!("job-{}", host.jobs.len() + 1);
        host.jobs.push(json!({
            "id": id, "name": body["name"], "prompt": body["prompt"],
            "everyMinutes": body["everyMinutes"], "firstRunAt": body["firstRunAt"],
            "enabled": true, "nextRunAt": body["firstRunAt"], "sessionId": null,
            "lastRunAt": null, "lastStatus": null,
        }));
    }
    let mut response = jobs_json(&fake);
    *response.status_mut() = StatusCode::CREATED;
    response
}

/// Resumes, pauses or removes a job; "run" records a queued run.
async fn change_job(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let id = uri.path().rsplit('/').next().unwrap_or("").to_owned();
    {
        let mut host = fake.host.lock().unwrap();
        let Some(index) = host.jobs.iter().position(|job| job["id"] == id.as_str()) else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Scheduled job not found." })),
            )
                .into_response();
        };
        match body["action"].as_str() {
            Some("remove") => {
                host.jobs.remove(index);
            }
            Some("disable") => host.jobs[index]["enabled"] = json!(false),
            Some("enable") => host.jobs[index]["enabled"] = json!(true),
            Some("run") => {
                let run = json!({
                    "id": format!("run-{}", host.job_runs.len() + 1), "jobId": id,
                    "name": host.jobs[index]["name"], "scheduledFor": 1_700_000_000_000_i64,
                    "startedAt": 1_700_000_000_000_i64, "finishedAt": null,
                    "status": "queued", "sessionId": null, "turnId": null,
                    "acknowledgedAt": null,
                });
                // Newest first, as the runtime lists them.
                host.job_runs.insert(0, run);
            }
            _ => {}
        }
    }
    jobs_json(&fake)
}

/// Runs two to a page, newest first; the cursor is the index to go on
/// from. `jobId` narrows them to one job.
async fn job_runs(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.to_string(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let only = query_value(&uri, "jobId");
    let from: usize = query_value(&uri, "before")
        .and_then(|cursor| cursor.parse().ok())
        .unwrap_or(0);
    let host = fake.host.lock().unwrap();
    let matching: Vec<&Value> = host
        .job_runs
        .iter()
        .filter(|run| only.as_deref().is_none_or(|id| run["jobId"] == id))
        .collect();
    let items: Vec<&Value> = matching.iter().skip(from).take(2).copied().collect();
    let next = (from + 2 < matching.len()).then(|| (from + 2).to_string());
    Json(json!({ "items": items, "next": next })).into_response()
}

/// The bot a request is for: the `/api/bots/<id>/` prefix, or the default.
fn bot_of(uri: &axum::http::Uri) -> String {
    uri.path()
        .strip_prefix("/api/bots/")
        .and_then(|rest| rest.split('/').next())
        .unwrap_or("default")
        .to_owned()
}

async fn bot_sessions(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    let archived = uri
        .query()
        .is_some_and(|query| query.split('&').any(|pair| pair == "archived=1"));
    let items = if archived {
        host.archived_sessions.clone()
    } else {
        host.bot_sessions
            .get(&bot_of(&uri))
            .cloned()
            .unwrap_or_default()
    };
    Json(json!({ "items": items, "next": null })).into_response()
}

/// `POST /api/sessions/<id>/archive`: records the request and answers as
/// the runtime does; an unknown session is not found.
async fn archive(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    if uri.path().contains("/sessions/gone/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Session not found." })),
        )
            .into_response();
    }
    let archived = body["archived"].as_bool().unwrap_or(false);
    fake.host
        .lock()
        .unwrap()
        .archives
        .push((uri.path().to_owned(), body));
    Json(json!({ "archived": archived })).into_response()
}

/// A bot's undismissed job runs: at most two a page, with the total.
async fn job_updates(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    if host.job_updates_down {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "The runtime is unavailable. Please retry." })),
        )
            .into_response();
    }
    let all = host
        .job_updates
        .get(&bot_of(&uri))
        .cloned()
        .unwrap_or_default();
    let items: Vec<&Value> = all.iter().take(2).collect();
    let next = (all.len() > 2).then(|| "2".to_owned());
    Json(json!({ "items": items, "next": next, "total": all.len() })).into_response()
}

/// A sign-in as the runtime reports it: waiting on a pasted address, or
/// in another state.
fn sign_in_json(status: &str) -> Value {
    let mut value = json!({
        "id": "sign-in-1", "provider": "openai", "name": "OpenAI 1", "status": status,
        "events": [{ "type": "auth_url", "url": "https://auth.example.test/authorize" }],
    });
    match status {
        "waiting" => {
            value["prompt"] = json!({
                "id": "p-1", "type": "manual_code", "message": "Paste the final redirect URL here:"
            });
        }
        "connected" => value["connectionId"] = json!("openai_1"),
        _ => {}
    }
    value
}

async fn start_sign_in(
    State(fake): State<Fake>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", "/api/settings/sign-ins".into(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    fake.host.lock().unwrap().sign_in_starts.push(body);
    (StatusCode::CREATED, Json(sign_in_json("waiting"))).into_response()
}

async fn read_sign_in(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(
        &fake,
        "GET",
        "/api/settings/sign-ins/sign-in-1".into(),
        &headers,
    );
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    Json(sign_in_json("waiting")).into_response()
}

async fn answer_sign_in(
    State(fake): State<Fake>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(
        &fake,
        "POST",
        "/api/settings/sign-ins/sign-in-1/answer".into(),
        &headers,
    );
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    fake.host.lock().unwrap().sign_in_answers.push(body);
    Json(sign_in_json("connected")).into_response()
}

async fn cancel_sign_in(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(
        &fake,
        "POST",
        "/api/settings/sign-ins/sign-in-1/cancel".into(),
        &headers,
    );
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    Json(sign_in_json("cancelled")).into_response()
}

/// Keeps what a client says it read; answers as the runtime does.
async fn mark_read(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let count = body["replyCount"].as_u64().unwrap_or(0);
    fake.host
        .lock()
        .unwrap()
        .reads
        .push((uri.path().to_owned(), count));
    Json(json!({ "readReplyCount": count })).into_response()
}

async fn acknowledge_run(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    if host.acknowledge_down {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "The runtime is unavailable. Please retry." })),
        )
            .into_response();
    }
    // ".../jobs/runs/<id>/read": the id is the part before "read".
    let id = uri
        .path()
        .trim_end_matches("/read")
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_owned();
    let bot = bot_of(&uri);
    if let Some(runs) = host.job_updates.get_mut(&bot) {
        runs.retain(|run| run["id"] != id.as_str());
    }
    Json(json!({ "ok": true })).into_response()
}

/// One query value from a request's address, percent-decoded.
fn query_value(uri: &axum::http::Uri, key: &str) -> Option<String> {
    let pairs = url::form_urlencoded::parse(uri.query()?.as_bytes());
    pairs
        .into_owned()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value)
}

/// Lists the files and folders directly inside the asked-for folder.
async fn workspace_files(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let folder = query_value(&uri, "path").unwrap_or_else(|| "/workspace".into());
    let host = fake.host.lock().unwrap();
    let prefix = format!("{folder}/");
    let mut items: Vec<Value> = Vec::new();
    for (path, bytes) in &host.workspace {
        let Some(rest) = path.strip_prefix(&prefix) else {
            continue;
        };
        let (name, kind, size) = match rest.split_once('/') {
            Some((child, _)) => (child, "directory", 0),
            None => (rest, "file", bytes.len()),
        };
        let seen = items.iter().any(|item| item["name"] == name);
        if !seen {
            items.push(json!({
                "path": format!("{prefix}{name}"), "name": name, "kind": kind,
                "bytes": size, "modifiedAt": 1_700_000_000_000_i64,
            }));
        }
    }
    if items.is_empty() && folder != "/workspace" {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Workspace folder not found." })),
        )
            .into_response();
    }
    Json(json!({ "path": folder, "revision": host.workspace_revision, "items": items }))
        .into_response()
}

/// A file's bytes, as long as the request names the current revision.
async fn workspace_download(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    let refused = |status: StatusCode, message: &str| {
        (status, Json(json!({ "error": message }))).into_response()
    };
    let revision = query_value(&uri, "revision").and_then(|raw| raw.parse::<u64>().ok());
    if revision != Some(host.workspace_revision) {
        return refused(
            StatusCode::CONFLICT,
            "The workspace changed. Refresh and try again.",
        );
    }
    let wanted = query_value(&uri, "path").unwrap_or_default();
    match host.workspace.iter().find(|(path, _)| *path == wanted) {
        Some((_, bytes)) => bytes.clone().into_response(),
        None => refused(StatusCode::NOT_FOUND, "Workspace file not found."),
    }
}

/// The sandbox settings as the runtime holds them: just-bash at revision 1
/// until a test saves something else.
fn sandbox_settings(host: &Host) -> Value {
    host.sandbox.clone().unwrap_or_else(|| {
        json!({
            "provider": "just-bash", "idleMinutes": 30, "diskQuotaMiB": null,
            "hostNetworkAcknowledged": false, "revision": 1,
        })
    })
}

async fn sandbox(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let settings = sandbox_settings(&fake.host.lock().unwrap());
    let container = settings["provider"] == "container";
    Json(json!({
        "settings": settings,
        "providers": [
            { "id": "just-bash", "name": "just-bash", "available": true, "reason": null },
            { "id": "container", "name": "Container", "available": true, "reason": null },
        ],
        "provider": {
            "id": settings["provider"],
            "name": if container { "Container" } else { "just-bash" },
            "version": "2.9.0",
        },
        "isolation": if container { "container" } else { "virtual-filesystem" },
        "capabilities": { "network": container, "hostFiles": false, "nativeCode": container },
        "root": "/workspace", "revision": 7,
        "executions": { "admitted": 0, "capacity": 8, "runtimeConcurrency": 4 },
        "usage": { "fileBytes": 1536, "entries": 12, "receiptBytes": 2048 },
        "limits": {
            "timeoutMs": 120_000, "sourceBytes": 65_536, "outputBytes": 1_048_576,
            "fileBytes": 104_857_600, "entries": 10_000, "receiptsBytes": 10_485_760,
        },
    }))
    .into_response()
}

/// Saves the settings at the next revision, as long as the save started
/// from the current one and a container is acknowledged.
async fn save_sandbox(
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
    let current = sandbox_settings(&host);
    host.sandbox_saves.push(body.clone());
    let refused = |status: StatusCode, message: &str| {
        (status, Json(json!({ "error": message }))).into_response()
    };
    if body["revision"] != current["revision"] {
        return refused(StatusCode::CONFLICT, "Sandbox settings changed elsewhere.");
    }
    if body["provider"] == "container" && body["hostNetworkAcknowledged"] != true {
        return refused(
            StatusCode::BAD_REQUEST,
            "Acknowledge host and local network access to enable Container.",
        );
    }
    let saved = json!({
        "provider": body["provider"], "idleMinutes": body["idleMinutes"],
        "diskQuotaMiB": body["diskQuotaMiB"],
        "hostNetworkAcknowledged": body["hostNetworkAcknowledged"],
        "revision": current["revision"].as_u64().unwrap_or(0) + 1,
    });
    host.sandbox = Some(saved.clone());
    Json(saved).into_response()
}

fn channels_json(fake: &Fake) -> Value {
    let host = fake.host.lock().unwrap();
    json!({ "discord": host.discord, "telegram": host.telegram })
}

async fn channels(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    Json(channels_json(&fake)).into_response()
}

/// Reads the home channel, or with a body selects one.
async fn channel_home(
    State(fake): State<Fake>,
    method: axum::http::Method,
    uri: axum::http::Uri,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Response {
    let posted = method == axum::http::Method::POST;
    record(
        &fake,
        if posted { "POST" } else { "GET" },
        uri.path().to_owned(),
        &headers,
    );
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    if let (true, Some(Json(body))) = (posted, body) {
        host.channel_requests.push(("home".into(), body.clone()));
        host.home_selected = body["id"].as_str().map(str::to_owned);
    }
    Json(json!({ "selected": host.home_selected, "destinations": host.home_destinations }))
        .into_response()
}

/// Discord and Telegram changes, behaving as the runtime does where the
/// client depends on it.
async fn change_channel(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let tail = uri
        .path()
        .rsplit_once("/channels/")
        .map_or("", |(_, tail)| tail)
        .to_owned();
    let refused = |message: &str| {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
    };
    {
        let mut host = fake.host.lock().unwrap();
        host.channel_requests.push((tail.clone(), body.clone()));
        match tail.as_str() {
            "discord" => {
                if host.discord.is_none() && body.get("botToken").is_none() {
                    return refused("Enter a Discord bot token.");
                }
                host.discord = Some(json!({
                    "allowedUserIds": body["allowedUserIds"], "channelId": body["channelId"],
                    "connected": true, "tokenConfigured": true, "conflict": false,
                }));
            }
            "discord/remove" => host.discord = None,
            "telegram" => {
                if let Some(enabled) = body.get("enabled") {
                    let Some(telegram) = host.telegram.as_mut() else {
                        return refused("Telegram is not configured.");
                    };
                    telegram["enabled"] = enabled.clone();
                    telegram["connected"] = enabled.clone();
                } else {
                    host.telegram = Some(json!({
                        "enabled": true, "connected": true, "tokenConfigured": true,
                        "botUsername": "raphie_test_bot", "verifiedUserIds": ["42"],
                        "pairingExpiresAt": null, "problem": null,
                    }));
                }
            }
            "telegram/pairing" => {
                let Some(telegram) = host.telegram.as_mut() else {
                    return refused("Connect a Telegram bot first.");
                };
                telegram["pairingExpiresAt"] = json!(1_800_000_000_000_i64);
                return Json(json!({ "code": "K7Q2-M9XD", "expiresAt": 1_800_000_000_000_i64 }))
                    .into_response();
            }
            "telegram/unpair" => {
                let Some(telegram) = host.telegram.as_mut() else {
                    return refused("Telegram is not configured.");
                };
                let user = body["userId"].clone();
                if let Some(ids) = telegram["verifiedUserIds"].as_array_mut() {
                    ids.retain(|id| *id != user);
                }
            }
            "telegram/remove" => host.telegram = None,
            _ => return refused("Unknown channel route."),
        }
    }
    Json(channels_json(&fake)).into_response()
}

fn mcp_json(fake: &Fake) -> Response {
    let items = fake.host.lock().unwrap().mcp.clone();
    Json(json!({ "items": items })).into_response()
}

async fn mcp(State(fake): State<Fake>, uri: axum::http::Uri, headers: HeaderMap) -> Response {
    record(&fake, "GET", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    mcp_json(&fake)
}

/// Adds a connection. As the runtime does: a URL server without a token
/// waits for authorization; anything else connects with three tools.
async fn add_mcp(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    {
        let mut host = fake.host.lock().unwrap();
        host.mcp_adds.push(body.clone());
        let http = body["transport"] == "http";
        let address = if http { &body["url"] } else { &body["command"] };
        if http && !address.as_str().unwrap_or("").starts_with("http") {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Enter a valid server URL." })),
            )
                .into_response();
        }
        let waiting = http && body.get("token").is_none();
        let id = format!("mcp-{}", host.mcp.len() + 1);
        let mut item = json!({
            "source": "saved", "id": id, "name": body["name"],
            "transport": body["transport"], "address": address,
            "enabled": true, "connected": !waiting,
            "toolCount": if waiting { 0 } else { 3 },
            "credentialConfigured": !waiting,
        });
        if waiting {
            item["authorizationUrl"] = json!("https://tools.example.com/authorize?state=abc");
        }
        host.mcp.push(item);
    }
    let mut response = mcp_json(&fake);
    *response.status_mut() = StatusCode::CREATED;
    response
}

async fn change_mcp(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let id = uri.path().rsplit('/').next().unwrap_or("").to_owned();
    {
        let mut host = fake.host.lock().unwrap();
        let Some(index) = host.mcp.iter().position(|item| item["id"] == id.as_str()) else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "MCP connection not found." })),
            )
                .into_response();
        };
        match body["action"].as_str() {
            Some("remove") => {
                host.mcp.remove(index);
            }
            Some("disable") => {
                let item = &mut host.mcp[index];
                item["enabled"] = json!(false);
                item["connected"] = json!(false);
                item.as_object_mut().unwrap().remove("authorizationUrl");
            }
            Some("enable") => {
                host.mcp[index]["enabled"] = json!(true);
                host.mcp[index]["connected"] = json!(true);
            }
            Some("import") => host.mcp[index]["source"] = json!("saved"),
            _ => {}
        }
    }
    mcp_json(&fake)
}

fn evidence_json(id: &str, content: &str) -> Value {
    json!({
        "id": id, "content": content, "kind": "fact",
        "source": "session:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/turn:t-1",
        "eventTime": 1_700_000_000_000_i64, "revision": 1,
    })
}

/// Saved memories two to a page; the cursor is the index to go on from.
async fn memory_evidence(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", uri.to_string(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let from: usize = uri
        .query()
        .and_then(|query| query.strip_prefix("after="))
        .and_then(|cursor| cursor.parse().ok())
        .unwrap_or(0);
    let host = fake.host.lock().unwrap();
    let total = host.memories.len();
    let page: Vec<Value> = host
        .memories
        .iter()
        .skip(from)
        .take(2)
        .map(|(id, content)| evidence_json(id, content))
        .collect();
    let next = (from + 2 < total).then(|| (from + 2).to_string());
    Json(json!({ "evidence": page, "next": next, "total": total })).into_response()
}

/// The memories whose words contain the query.
async fn recall_memory(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let query = body["query"].as_str().unwrap_or("").to_lowercase();
    let host = fake.host.lock().unwrap();
    let matches: Vec<Value> = host
        .memories
        .iter()
        .filter(|(_, content)| content.to_lowercase().contains(&query))
        .map(|(id, content)| evidence_json(id, content))
        .collect();
    Json(json!({ "evidence": matches })).into_response()
}

/// A correction (`/evidence/<id>`) or a forget (`/evidence/<id>/forget`).
async fn change_memory(
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
    if host.memory_busy {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Wait for active turns to finish before changing memory." })),
        )
            .into_response();
    }
    let tail = uri
        .path()
        .rsplit_once("/evidence/")
        .map_or("", |(_, tail)| tail);
    if let Some(id) = tail.strip_suffix("/forget") {
        host.memories.retain(|(known, _)| known != id);
        return Json(json!({ "forgotten": true })).into_response();
    }
    let content = body["content"].as_str().unwrap_or("").to_owned();
    for (id, saved) in &mut host.memories {
        if id == tail {
            *saved = content.clone();
        }
    }
    Json(json!({ "updated": true })).into_response()
}

async fn test_memory(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(_): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    if fake.host.lock().unwrap().memory_unreachable {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "Hindsight did not answer." })),
        )
            .into_response();
    }
    Json(json!({ "connected": true })).into_response()
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
/// A stand-in for GitHub's list of Raphie releases: a nightly older than
/// any build, a far-future release, and a draft that must be ignored.
async fn github_releases(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(&fake, "GET", "/github/releases".into(), &headers);
    let page = |tag: &str| format!("https://github.com/kalibetre/raphie/releases/tag/{tag}");
    Json(json!([
        { "tag_name": "v0.0.1-nightly.1", "html_url": page("v0.0.1-nightly.1"), "draft": false },
        { "tag_name": "v99.0.0", "html_url": page("v99.0.0"), "draft": false },
        { "tag_name": "v100.0.0", "html_url": page("v100.0.0"), "draft": true }
    ]))
    .into_response()
}

/// What `raphie status` and the app's connection check ask the runtime.
async fn runtime_info(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(&fake, "GET", "/api/runtime".into(), &headers);
    if let Some(refused) = refuse(&fake, &headers) {
        return refused;
    }
    if fake.host.lock().unwrap().runtime_down {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "The runtime is unavailable. Please retry." })),
        )
            .into_response();
    }
    Json(json!({ "identity": { "id": "workspace-1" } })).into_response()
}

/// The release the web host was built from; sign-in required, as on the
/// real web host.
async fn host_version(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(&fake, "GET", "/_raphie/version".into(), &headers);
    if let Some(refused) = refuse(&fake, &headers) {
        return refused;
    }
    let version = fake.host.lock().unwrap().version.clone();
    Json(json!({ "id": "abc123", "version": version.as_deref().unwrap_or("v0.0.4") }))
        .into_response()
}

/// The web host's health check: up, without an administrator yet.
async fn health(State(fake): State<Fake>, headers: HeaderMap) -> Response {
    record(&fake, "GET", "/_raphie/health".into(), &headers);
    Json(json!({ "status": "locked" })).into_response()
}

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
    Json(json!({ "items": bot_list(&fake.host.lock().unwrap()) })).into_response()
}

/// The bots as the runtime lists them: the two it starts with, less any a
/// test deleted, then any a test created.
fn bot_list(host: &Host) -> Vec<Value> {
    let revision = host.profile_revision.max(1);
    let mut items = vec![
        json!({ "id": "default", "name": "Raphie", "description": "", "personality": "", "color": null,
                "revision": 1, "createdAt": 1, "updatedAt": 1 }),
        json!({ "id": "b-research", "name": "Research", "description": "Reads papers",
                "personality": "Be brief.", "revision": revision, "createdAt": 2, "updatedAt": 2 }),
    ];
    items.extend(host.created_bots.iter().cloned());
    items.retain(|bot| {
        let id = bot["id"].as_str().unwrap_or("");
        !host.deleted_bots.iter().any(|deleted| deleted == id)
    });
    items
}

/// Creates a bot at revision 1, unless one already has its name.
async fn create_bot(
    State(fake): State<Fake>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", "/api/bots".into(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    if bot_list(&host)
        .iter()
        .any(|bot| bot["name"] == body["name"])
    {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "A bot with this name already exists." })),
        )
            .into_response();
    }
    let created = json!({
        "id": format!("b-new-{}", host.created_bots.len() + 1),
        "name": body["name"], "description": body["description"], "personality": body["personality"],
        "color": body["color"], "revision": 1, "createdAt": 5, "updatedAt": 5,
    });
    host.created_bots.push(created.clone());
    (StatusCode::CREATED, Json(created)).into_response()
}

/// Deletes a bot if the confirmation names it as it is now, as the
/// runtime does; the default bot cannot be deleted.
async fn delete_bot(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "DELETE", format!("/api/bots/{id}"), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    host.bot_deletes.push((id.clone(), body.clone()));
    let refused = |status: StatusCode, message: &str| {
        (status, Json(json!({ "error": message }))).into_response()
    };
    if id == "default" {
        return refused(
            StatusCode::BAD_REQUEST,
            "The default bot cannot be deleted.",
        );
    }
    let Some(bot) = bot_list(&host)
        .into_iter()
        .find(|bot| bot["id"] == id.as_str())
    else {
        return refused(StatusCode::NOT_FOUND, "Bot not found.");
    };
    if bot["name"] != body["name"] || bot["revision"] != body["revision"] {
        return refused(
            StatusCode::CONFLICT,
            "This bot changed. Reload and try again.",
        );
    }
    host.deleted_bots.push(id);
    StatusCode::NO_CONTENT.into_response()
}

/// The research bot's saved versions, newest first: one per revision.
async fn bot_history(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", format!("/api/bots/{id}/history"), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let latest = fake.host.lock().unwrap().profile_revision.max(1);
    let items: Vec<Value> = (1..=latest)
        .rev()
        .map(|revision| {
            json!({
                "id": id, "name": "Research", "description": "Reads papers", "color": null,
                "personality": format!("Be brief. (revision {revision})"), "revision": revision,
                "createdAt": 2, "updatedAt": 1_700_000_000_000_i64 + i64::from(revision),
            })
        })
        .collect();
    Json(json!({ "items": items })).into_response()
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
        "telemetryEnabled": !fake.host.lock().unwrap().telemetry_off, "provider": connection, "providerEnabled": true,
        "credentialSource": "saved", "modelId": model,
        "providers": [{ "id": "openrouter", "name": "OpenRouter" }],
        "connections": connections_json(fake),
        "models": [entry("fast", "Anthropic: Fast"), entry("deep", "Anthropic: Deep")]
    })
}

fn connections_json(fake: &Fake) -> Value {
    let mut all = vec![
        json!({ "id": "c-main", "provider": "openrouter", "name": "Main",
                               "credentialSource": "saved" }),
    ];
    for (id, provider, name) in &fake.host.lock().unwrap().added_connections {
        all.push(json!({ "id": id, "provider": provider, "name": name,
                         "credentialSource": "saved" }));
    }
    Value::Array(all)
}

/// Every connection route: add, edit, remove and the two tests. Records the
/// request, then answers as the runtime does.
async fn connection(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let tail = uri.path().trim_start_matches("/api/settings/").to_owned();
    {
        let mut host = fake.host.lock().unwrap();
        host.connection_requests.push((tail.clone(), body.clone()));
        if tail.ends_with("test") {
            return if host.reject_key {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "The provider rejected this API key." })),
                )
                    .into_response()
            } else {
                Json(json!({ "connected": true })).into_response()
            };
        }
        if tail == "connections" {
            let id = format!("c-{}", host.added_connections.len() + 2);
            host.added_connections.push((
                id,
                body["provider"].as_str().unwrap_or_default().to_owned(),
                body["name"].as_str().unwrap_or_default().to_owned(),
            ));
        } else if let Some(id) = tail.strip_suffix("/remove") {
            let id = id.trim_start_matches("connections/").to_owned();
            host.added_connections.retain(|(added, _, _)| *added != id);
        } else {
            let id = tail.trim_start_matches("connections/").to_owned();
            for added in host
                .added_connections
                .iter_mut()
                .filter(|(a, _, _)| *a == id)
            {
                added.2 = body["name"].as_str().unwrap_or_default().to_owned();
            }
        }
    }
    // The lock is released above, before the settings are read again.
    Json(settings_json(&fake)).into_response()
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
    // The same route also switches trace collection.
    if let Some(enabled) = body["telemetryEnabled"].as_bool() {
        fake.host.lock().unwrap().telemetry_off = !enabled;
        return Json(settings_json(&fake)).into_response();
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
        "personality": body["personality"], "color": body["color"],
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

async fn approval_mode(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let path = format!("/api/sessions/{id}/approval-mode");
    record(&fake, "GET", path, &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    if host.approval_mode_down {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "The runtime is unavailable. Please retry." })),
        )
            .into_response();
    }
    let mode = host.approval_modes.get(&id).map_or("ask", String::as_str);
    Json(json!({ "mode": mode })).into_response()
}

async fn set_approval_mode(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let path = format!("/api/sessions/{id}/approval-mode");
    record(&fake, "PUT", path, &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let mut host = fake.host.lock().unwrap();
    if host.approval_mode_down {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "The runtime is unavailable. Please retry." })),
        )
            .into_response();
    }
    let mode = body["mode"].as_str().unwrap_or("ask").to_owned();
    host.approval_modes.insert(id, mode.clone());
    Json(json!({ "mode": mode })).into_response()
}

async fn choose_model(
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
    host.model_choices
        .push((uri.path().to_owned(), body.clone()));
    if host.model_unavailable {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "That model is not available." })),
        )
            .into_response();
    }
    Json(json!({ "model": body })).into_response()
}

/// `POST /api/attachments`: files one multipart upload and answers as the
/// runtime does. The id is made from the bytes, so the same file twice
/// gets the same id.
async fn upload(
    State(fake): State<Fake>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    record(&fake, "POST", uri.path().to_owned(), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let refused = |status: StatusCode, message: &str| {
        (status, Json(json!({ "error": message }))).into_response()
    };
    let mut host = fake.host.lock().unwrap();
    if host.uploads_down {
        return refused(
            StatusCode::SERVICE_UNAVAILABLE,
            "Workspace uploads are unavailable.",
        );
    }
    let content_type = headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let Some(boundary) = content_type.strip_prefix("multipart/form-data; boundary=") else {
        return refused(StatusCode::BAD_REQUEST, "Choose a file to upload.");
    };
    // One part: headers, a blank line, the bytes, the closing boundary.
    let find = |haystack: &[u8], needle: &[u8]| {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    };
    let closing = format!("\r\n--{boundary}--\r\n");
    let (Some(blank), Some(end)) = (find(&body, b"\r\n\r\n"), find(&body, closing.as_bytes()))
    else {
        return refused(StatusCode::BAD_REQUEST, "Choose a file to upload.");
    };
    let head = String::from_utf8_lossy(&body[..blank]).into_owned();
    let name = head
        .split("filename=\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .unwrap_or("attachment")
        .to_owned();
    let bytes = body[blank + 4..end].to_vec();
    // 64 hex digits from a small hash of the bytes, repeated.
    let hash = bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    });
    let id = format!("{hash:016x}").repeat(4);
    let mime = if bytes.starts_with(&[137, 80, 78, 71]) {
        "image/png"
    } else {
        "application/octet-stream"
    };
    let answer = json!({
        "id": id,
        "name": name,
        "size": bytes.len(),
        "path": format!("/workspace/uploads/{id}/{name}"),
        "mimeType": mime,
    });
    host.uploads.push((id, name, bytes));
    (StatusCode::CREATED, Json(answer)).into_response()
}

async fn uploaded_file(
    State(fake): State<Fake>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    record(&fake, "GET", format!("/api/files/{id}"), &headers);
    if let Some(denied) = refuse(&fake, &headers) {
        return denied;
    }
    let host = fake.host.lock().unwrap();
    match host.uploads.iter().find(|(known, _, _)| *known == id) {
        Some((_, _, bytes)) => bytes.clone().into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found." })),
        )
            .into_response(),
    }
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
        // Tests never write to the real Downloads folder.
        downloads: None,
        // Nor ask GitHub anything: a test that checks for updates points
        // this at the fake host's `/github/releases`.
        releases_url: None,
        // Nor look for a Raphie on this computer: a test that does points
        // this at a ports file naming the fake host.
        local_ports_file: None,
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
        Driver::with_config(store, fast_config())
    }

    /// A driver whose engine uses `config`, for tests that need a setting
    /// of their own (a folder to download into, say).
    pub fn with_config(
        store: Arc<dyn raphie_core::auth::TokenStore>,
        config: EngineConfig,
    ) -> Driver {
        Driver {
            client: Client::start(store, config, Arc::new(|| {})),
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
