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

use crate::api::{ApiClient, ApiError, bot_path};
use crate::auth::{AccessToken, DevicePolicy, DevicePoll, TokenStore};
use crate::contracts::{
    ApprovalStatus, BotProfile, ControlAction, Decision, Page, Scope, SessionObservation,
    SessionSummary, SubmitMessage,
};
use crate::model::{DecisionOutcome, Event, StreamStatus};
use crate::origin::Origin;
use crate::settings::Settings;
use crate::sse::SseParser;

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
    LoadOlder {
        session_id: String,
        before: String,
    },
    Send {
        text: String,
    },
    Decide {
        approval_id: String,
        decision: Decision,
        scope: Scope,
    },
    /// Stop a session's run, or steer or re-queue one of its queued messages.
    Control {
        session_id: String,
        action: ControlAction,
        turn_id: Option<String>,
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
}

impl Default for EngineConfig {
    fn default() -> EngineConfig {
        EngineConfig {
            device: DevicePolicy::default(),
            reconnect_min: Duration::from_secs(1),
            reconnect_max: Duration::from_secs(15),
            send_retries: vec![Duration::from_secs(1), Duration::from_secs(3)],
            settings_path: Settings::default_path(),
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
            Command::SelectBot { bot_id } => self.select_bot(bot_id),
            Command::SelectSession { session_id } => self.open_session(session_id),
            Command::LoadMoreSessions { after } => self.load_more_sessions(after),
            Command::LoadOlder { session_id, before } => self.load_older(session_id, before),
            Command::Send { text } => self.send(text),
            Command::Decide {
                approval_id,
                decision,
                scope,
            } => self.decide(approval_id, decision, scope),
            Command::Control {
                session_id,
                action,
                turn_id,
            } => self.control(session_id, action, turn_id),
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

    fn sign_out(&mut self, origin: Origin, notice: Option<String>) {
        self.sign_in = None;
        self.sessions_stream = None;
        self.session_stream = None;
        self.bot_id = None;
        self.session_id = None;
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

    fn send(&mut self, text: String) {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        assert_eq!(
            default_bot(&[bot("a"), bot("default")]).as_deref(),
            Some("default")
        );
        assert_eq!(default_bot(&[bot("a"), bot("b")]).as_deref(), Some("a"));
        assert_eq!(default_bot(&[]), None);
    }
}
