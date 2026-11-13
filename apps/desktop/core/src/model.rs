//! What the app knows, and how each piece of news changes it.
//!
//! The engine reports news as [`Event`]s; [`Model::apply`] folds each one into
//! the model. `apply` does no I/O and never blocks, so it can run on the UI
//! thread every frame and is tested without a network or a window. A UI only
//! reads the model and calls the small `select_*`/`begin_*` methods when the
//! owner acts, then sends the matching [`Command`](crate::engine::Command).

use std::collections::HashSet;

use crate::auth::DeviceCode;
use crate::contracts::{
    ApprovalStatus, BotProfile, Page, Receipt, SessionApproval, SessionObservation, SessionSummary,
    SessionTurn,
};
use crate::origin::Origin;

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
    Decided {
        approval_id: String,
        outcome: DecisionOutcome,
    },
    /// Something went wrong that the owner should know about.
    Problem(String),
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

#[derive(Clone, Debug, PartialEq)]
pub enum AuthState {
    SignedOut { notice: Option<String> },
    Connecting,
    AwaitingApproval(DeviceCode),
    SignedIn,
}

/// Something the UI should do once, beyond redrawing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    /// The message was admitted: empty the composer.
    ClearComposer,
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
    pub bots: Vec<BotProfile>,
    pub bot_id: Option<String>,
    /// The live first page of sessions, newest first.
    pub sessions: Vec<SessionSummary>,
    /// Later pages the owner asked for.
    pub more_sessions: Vec<SessionSummary>,
    pub sessions_next: Option<String>,
    /// The open conversation; `None` means a new, unsent conversation.
    pub conversation: Option<Conversation>,
    pub sending: bool,
    /// Approvals with a decision on its way.
    pub deciding: HashSet<String>,
    /// A message for the owner, shown until dismissed or replaced.
    pub notice: Option<String>,
}

impl Default for Model {
    fn default() -> Model {
        Model {
            origin: None,
            auth: AuthState::SignedOut { notice: None },
            bots: Vec::new(),
            bot_id: None,
            sessions: Vec::new(),
            more_sessions: Vec::new(),
            sessions_next: None,
            conversation: None,
            sending: false,
            deciding: HashSet::new(),
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
                self.notice = None;
            }
            Event::SignedOut { notice } => {
                // Keep the origin so the sign-in screen offers it again; drop
                // everything that belonged to the signed-in host.
                let origin = self.origin.take();
                *self = Model {
                    origin,
                    auth: AuthState::SignedOut { notice },
                    ..Model::default()
                };
            }
            Event::Bots(bots) => self.bots = bots,
            Event::BotSelected { bot_id } => self.select_bot(bot_id),
            Event::Sessions { bot_id, page, more } => {
                if self.bot_id.as_deref() == Some(bot_id.as_str()) {
                    self.sessions_page(page, more);
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
                return vec![Effect::ClearComposer];
            }
            Event::MessageFailed { message } => {
                // The draft stays in the composer so nothing typed is lost.
                self.sending = false;
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
            self.conversation = None;
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

    /// The owner sent a message. Returns false when one is already on its way.
    pub fn begin_send(&mut self) -> bool {
        if self.sending {
            return false;
        }
        self.sending = true;
        self.notice = None;
        true
    }

    /// The owner decided an approval. Returns false if a decision for it is
    /// already on its way, so double clicks send one request.
    pub fn begin_decide(&mut self, approval_id: &str) -> bool {
        self.deciding.insert(approval_id.to_owned())
    }

    /// The session list as shown: the live first page, then later pages.
    pub fn session_list(&self) -> impl Iterator<Item = &SessionSummary> {
        let first: HashSet<&str> = self.sessions.iter().map(|s| s.id.as_str()).collect();
        self.sessions.iter().chain(
            self.more_sessions
                .iter()
                .filter(move |s| !first.contains(s.id.as_str())),
        )
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
        ApprovalStatus::Approved => "That action was already approved elsewhere.".into(),
        ApprovalStatus::Rejected => "That action was already rejected elsewhere.".into(),
        ApprovalStatus::Expired => "That approval expired before your decision arrived.".into(),
        ApprovalStatus::Pending | ApprovalStatus::Unknown => {
            "The approval is still waiting; try again.".into()
        }
    }
}
