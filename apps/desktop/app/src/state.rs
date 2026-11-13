//! The UI's state: the core [`Model`] plus what only the window needs (text
//! being typed, the sidebar's width), and the bridge to the engine.

use std::sync::Arc;

use raphie_core::auth::KeychainStore;
use raphie_core::engine::{Client, Command, EngineConfig};
use raphie_core::model::{AuthState, Effect, Model};
use raphie_core::origin::Origin;
use raphie_core::settings::Settings;
use rune::{TextEdit, Tx, Waker};
use rune_kit::shell::PaneState;

/// The fixture's web host: the default for a first launch from a checkout.
pub const DEFAULT_ORIGIN: &str = "http://127.0.0.1:4321";

pub struct Ui {
    /// Everything the core knows. The view only reads it.
    pub model: Model,
    /// The running engine. `None` in headless runs and tests, where commands
    /// are recorded in `sent` instead of going to a network.
    client: Option<Client>,
    /// Commands sent while there was no engine (for tests).
    pub sent: Vec<Command>,
    /// The sign-in screen's address field.
    pub origin_field: TextEdit,
    /// What the owner is typing to Raphie.
    pub composer: TextEdit,
    pub sidebar: PaneState,
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
            origin_field: TextEdit::new(origin),
            composer: TextEdit::new(""),
            sidebar: PaneState::new(272.0).range(200.0, 420.0),
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

    pub fn decide(&mut self, approval_id: &str, decision: raphie_core::contracts::Decision) {
        if self.model.begin_decide(approval_id) {
            self.command(Command::Decide {
                approval_id: approval_id.to_owned(),
                decision,
            });
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
    if let Ok(origin) = Origin::parse(&ui.origin_field.text) {
        ui.command(Command::Restore { origin });
    }
}

/// `AppSpec::poll`: runs before each frame. Applies whatever the engine
/// reported; returns true when the view should be rebuilt.
pub fn poll(ui: &mut Ui, _clock: f64, tx: &mut Tx) -> bool {
    let Some(client) = &ui.client else {
        return false;
    };
    let events = client.drain();
    if events.is_empty() {
        return false;
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
