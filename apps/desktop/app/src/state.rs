//! The UI's state: the core [`Model`] plus what only the window needs (text
//! being typed, which side panels are open), and the bridge to the engine.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use raphie_core::auth::KeychainStore;
use raphie_core::contracts::{ControlAction, Decision, Scope, TurnStatus};
use raphie_core::engine::{Client, Command, EngineConfig};
use raphie_core::model::{AuthState, Effect, Model};
use raphie_core::origin::Origin;
use raphie_core::settings::Settings;
use rune::{TextEdit, Tx, Waker};

/// The fixture's web host: the default for a first launch from a checkout.
pub const DEFAULT_ORIGIN: &str = "http://127.0.0.1:4321";

/// Which conversations the panel lists (the web's filter chips).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    All,
    /// Only conversations with an action waiting for approval.
    Approvals,
}

/// A page of the web workspace that this app opens in the browser because
/// it has no screen of its own for it yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebPage {
    /// The selected bot's settings.
    Settings,
    /// Account settings: password, passkeys, connected devices.
    Account,
}

pub struct Ui {
    /// Everything the core knows. The view only reads it.
    pub model: Model,
    /// The running engine. `None` in headless runs and tests, where commands
    /// are recorded in `sent` instead of going to a network.
    client: Option<Client>,
    /// Commands sent while there was no engine (for tests).
    pub sent: Vec<Command>,
    /// Web pages opened while there was no engine (for tests).
    pub opened: Vec<String>,
    /// The sign-in screen's address field.
    pub origin_field: TextEdit,
    /// What the owner is typing to Raphie.
    pub composer: TextEdit,
    /// Whether the bot roster on the left shows (⌘B).
    pub roster_open: bool,
    /// Whether the conversations panel on the right shows.
    pub panel_open: bool,
    /// The conversations panel's search box.
    pub search: TextEdit,
    pub filter: Filter,
    /// Turns whose list of tool steps is unfolded.
    pub open_runs: HashSet<String>,
    /// Tool steps whose arguments and result are unfolded.
    pub open_steps: HashSet<String>,
    /// The frame clock (seconds) when the view last refreshed its "elapsed"
    /// labels.
    ticked_at: f64,
}

impl Ui {
    /// A UI with no engine attached yet (`setup` attaches one in a window),
    /// offering the last origin this machine signed in to.
    pub fn new() -> Ui {
        let saved = Settings::default_path()
            .map(|path| Settings::load(&path))
            .unwrap_or_default();
        Ui::with_origin(saved.origin.as_deref().unwrap_or(DEFAULT_ORIGIN))
    }

    /// A UI offering `origin` on the sign-in screen.
    pub fn with_origin(origin: &str) -> Ui {
        Ui {
            model: Model::new(),
            client: None,
            sent: Vec::new(),
            opened: Vec::new(),
            origin_field: TextEdit::new(origin),
            composer: TextEdit::new(""),
            roster_open: true,
            // Closed until asked for, like the web workspace's panel.
            panel_open: false,
            search: TextEdit::new(""),
            filter: Filter::All,
            open_runs: HashSet::new(),
            open_steps: HashSet::new(),
            ticked_at: 0.0,
        }
    }

    /// Sends a command to the engine, or records it when there is none.
    pub fn command(&mut self, command: Command) {
        match &self.client {
            Some(client) => client.send(command),
            None => self.sent.push(command),
        }
    }

    // ----- What the owner does -----

    pub fn connect(&mut self) {
        match Origin::parse(&self.origin_field.text) {
            Ok(origin) => {
                self.model.notice = None;
                self.command(Command::Connect { origin });
            }
            Err(error) => {
                self.model.auth = AuthState::SignedOut {
                    notice: Some(error.to_string()),
                };
            }
        }
    }

    pub fn select_bot(&mut self, bot_id: &str) {
        self.model.select_bot(bot_id.to_owned());
        self.command(Command::SelectBot {
            bot_id: bot_id.to_owned(),
        });
    }

    pub fn select_session(&mut self, session_id: Option<&str>) {
        self.model.select_session(session_id.map(str::to_owned));
        self.command(Command::SelectSession {
            session_id: session_id.map(str::to_owned),
        });
    }

    /// Puts a suggested message in the composer for the owner to send or edit.
    pub fn suggest(&mut self, text: &str) {
        self.composer = TextEdit::new(text);
    }

    pub fn load_older(&mut self) {
        let Some(session_id) = self
            .model
            .conversation
            .as_ref()
            .map(|c| c.session_id.clone())
        else {
            return;
        };
        if let Some(before) = self.model.begin_load_older() {
            self.command(Command::LoadOlder { session_id, before });
        }
    }

    pub fn send(&mut self) {
        let text = self.composer.text.trim().to_owned();
        if text.is_empty() || !self.model.begin_send() {
            return;
        }
        // The runtime accepts up to 4,000 characters per message.
        if text.chars().count() > 4000 {
            self.model.sending = false;
            self.model.notice = Some("Messages can be at most 4,000 characters.".into());
            return;
        }
        self.command(Command::Send { text });
    }

    pub fn decide(&mut self, approval_id: &str, decision: Decision, scope: Scope) {
        if self.model.begin_decide(approval_id) {
            self.command(Command::Decide {
                approval_id: approval_id.to_owned(),
                decision,
                scope,
            });
        }
    }

    /// Stops the open conversation's run.
    pub fn stop(&mut self) {
        self.control(ControlAction::Stop, None);
    }

    /// Stops the run, or steers or re-queues the queued message `turn_id`.
    pub fn control(&mut self, action: ControlAction, turn_id: Option<&str>) {
        // `let ... else` returns early when there is no open conversation.
        let Some(conversation) = &self.model.conversation else {
            return;
        };
        self.command(Command::Control {
            session_id: conversation.session_id.clone(),
            action,
            turn_id: turn_id.map(str::to_owned),
        });
    }

    /// Whether Raphie is working in the open conversation: its newest turn
    /// has no finished reply yet.
    pub fn busy(&self) -> bool {
        self.model.conversation.as_ref().is_some_and(|c| {
            c.turns()
                .last()
                .is_some_and(|turn| turn.status == TurnStatus::Pending)
        })
    }

    /// Unfolds or folds something by id: a run's steps, or one step's details.
    pub fn toggle(set: &mut HashSet<String>, id: &str) {
        // `remove` says whether the id was there; if not, add it.
        if !set.remove(id) {
            set.insert(id.to_owned());
        }
    }

    /// The address of a web workspace page on the signed-in host.
    pub fn web_url(&self, page: WebPage) -> Option<String> {
        let origin = self.model.origin.as_ref()?;
        let query = match page {
            WebPage::Account => "view=settings&section=account".to_owned(),
            WebPage::Settings => match &self.model.bot_id {
                // Bot ids are letters, digits and dashes, so they need no
                // escaping; anything else is left out rather than guessed at.
                Some(id) if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => {
                    format!("view=settings&bot={id}")
                }
                _ => "view=settings".to_owned(),
            },
        };
        Some(origin.url(&format!("/?{query}")))
    }

    /// Opens a web workspace page in the owner's browser.
    pub fn open_web(&mut self, page: WebPage, tx: &mut Tx) {
        let Some(url) = self.web_url(page) else {
            return;
        };
        if self.client.is_none() {
            // Tests and headless runs: note it instead of opening a browser.
            self.opened.push(url);
        } else if tx.open_url(&url).is_err() {
            self.model.notice = Some("Could not open a browser.".into());
        }
    }
}

impl Default for Ui {
    fn default() -> Ui {
        Ui::new()
    }
}

/// `AppSpec::setup`: runs once with Rune's waker. Starts the engine and, if
/// this machine signed in before, quietly restores that sign-in.
pub fn setup(ui: &mut Ui, waker: Waker) {
    // Headless runs (`--snap`, `--tree`, `--script`) render scenes; they must
    // never touch the network or the Keychain.
    if rune::tooling::headless_run().is_some() {
        return;
    }
    // `Waker` is `Arc<dyn Fn() + Send + Sync>`, the same type the core calls
    // `Notify`, so it passes straight through.
    let client = Client::start(
        Arc::new(KeychainStore::new()),
        EngineConfig::default(),
        waker,
    );
    ui.client = Some(client);
    // `raphie-desktop --origin https://…` signs in to that origin at once;
    // otherwise reuse the last origin's stored token, if there is one.
    if let Some(origin) = origin_argument(rune::extra_args()) {
        ui.origin_field = TextEdit::new(origin);
        ui.connect();
    } else if let Ok(origin) = Origin::parse(&ui.origin_field.text) {
        ui.command(Command::Restore { origin });
    }
}

/// The value after `--origin` among the arguments Rune did not recognise.
fn origin_argument(args: &[String]) -> Option<&str> {
    let flag = args.iter().position(|a| a == "--origin")?;
    args.get(flag + 1).map(String::as_str)
}

/// `AppSpec::poll`: runs before each frame. Applies whatever the engine
/// reported; returns true when the view should be rebuilt.
pub fn poll(ui: &mut Ui, clock: f64, tx: &mut Tx) -> bool {
    let Some(client) = &ui.client else {
        return false;
    };
    let events = client.drain();
    // While Raphie works, wake up every second so "12s elapsed" keeps
    // counting and an approval's deadline is noticed. Asking again on every
    // poll adds no extra polls.
    let busy = ui.busy();
    if busy {
        tx.wake_after(Duration::from_secs(1));
    }
    let ticked = busy && clock - ui.ticked_at >= 1.0;
    if ticked {
        ui.ticked_at = clock;
    }
    if events.is_empty() {
        return ticked;
    }
    for event in events {
        for effect in ui.model.apply(event) {
            match effect {
                Effect::ClearComposer => {
                    ui.composer.clear();
                    tx.scroll_to_bottom("rd-transcript");
                }
            }
        }
    }
    true
}
