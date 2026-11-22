//! Raphie's desktop UI, drawn with Rune.
//!
//! This crate only presents [`raphie_core`]'s state and turns the owner's
//! clicks and keys into commands. Network, sign-in, storage and state rules
//! live in the core crate so they outlive any change of UI framework.
//!
//! - [`state`]: the UI's state and the bridge to the engine (`setup`, `poll`).
//! - [`view`]: `view(&Ui) -> El`, every screen, one module per region.
//! - [`theme`]: the web workspace's colours and type, which the views use.
//! - [`widgets`]: buttons and fields shared by the screens.
//! - [`avatar`]: a bot's face and colour, computed as the web computes them.
//! - [`app_icon`]: the app's icon, drawn at build time.
//! - [`icons`]: the web workspace's icons.
//! - [`sections`]: the pages of Settings, named as the web names them.
//! - [`profile`]: the edits in progress on a bot's Profile page.
//! - [`channels`]: what is typed on a bot's Channels page.
//! - [`mcp`]: the "Add a connection" form on a bot's MCP tools page.
//! - [`memory`]: the edits in progress on a bot's Memory page.
//! - [`skills`]: what is open and typed on a bot's Skills page.
//! - [`owner`]: the edits in progress on Settings → You, shared by every bot.
//! - [`scenes`]: fixture states for headless snapshots and tests.
//! - [`format`]: small text helpers.

pub mod app_icon;
pub mod avatar;
pub mod channels;
pub mod format;
pub mod icons;
pub mod jobs;
pub mod mcp;
pub mod memory;
pub mod notify;
pub mod owner;
pub mod profile;
pub mod sandbox;
pub mod scenes;
pub mod sections;
pub mod skills;
pub mod state;
pub mod theme;
pub mod view;
pub mod widgets;

use raphie_core::flavor::Flavor;
use rune::{AppSpec, Key, KeyEvent, Tx};

pub use state::Ui;

/// Everything Rune needs to run the app, in a window or headless.
pub fn spec() -> AppSpec<Ui> {
    AppSpec {
        // As narrow as a phone: below 768 points one column shows at a time.
        min_size: Some((360.0, 480.0)),
        scenes: scenes::SCENES,
        setup: Some(state::setup),
        poll: Some(state::poll),
        on_key: Some(on_key),
        // "Raphie", or "Raphie Dev" for a debug build.
        ..AppSpec::new(
            Flavor::current().app_name(),
            (1280.0, 800.0),
            Ui::new,
            view::view,
        )
    }
}

/// Window-wide keys, as in the web workspace: ⌘B shows and hides the
/// sidebar, and ⌘, opens Settings as Mac apps do (Ctrl off macOS).
fn on_key(ui: &mut Ui, ev: &KeyEvent, tx: &mut Tx) -> bool {
    // Escape closes an enlarged picture.
    if ev.key == Key::Escape && ui.viewer.is_some() {
        ui.viewer = None;
        return true;
    }
    // Up and Down move between the model picker's rows, as on the web.
    if ui.model_picker.open && (ev.key == Key::Up || ev.key == Key::Down) {
        let step = if ev.key == Key::Down { 1 } else { -1 };
        if let Some(row) = ui.picker_step(tx.focused(), step) {
            tx.focus(row, true);
            return true;
        }
        return false;
    }
    if ev.mods.shift || ev.mods.alt {
        return false;
    }
    if ev.is_command('b') {
        // In a narrow window the roster is a screen: ⌘B goes to it and back.
        if ui.narrow() {
            match ui.screen {
                state::Screen::Settings(_) => ui.settings_nav_home = !ui.settings_nav_home,
                state::Screen::Workspace => ui.narrow_home = !ui.narrow_home,
            }
        } else {
            ui.roster_open = !ui.roster_open;
        }
        return true;
    }
    if ev.is_command(',') && ui.model.auth == raphie_core::model::AuthState::SignedIn {
        ui.open_settings(None);
        return true;
    }
    false
}
