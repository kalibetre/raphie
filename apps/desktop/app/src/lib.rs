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
//! - [`icons`]: the web workspace's icons.
//! - [`scenes`]: fixture states for headless snapshots and tests.
//! - [`format`]: small text helpers.

pub mod avatar;
pub mod format;
pub mod icons;
pub mod scenes;
pub mod state;
pub mod theme;
pub mod view;
pub mod widgets;

use rune::{AppSpec, KeyEvent, Tx};

pub use state::Ui;

/// Everything Rune needs to run the app, in a window or headless.
pub fn spec() -> AppSpec<Ui> {
    AppSpec {
        min_size: Some((960.0, 560.0)),
        scenes: scenes::SCENES,
        setup: Some(state::setup),
        poll: Some(state::poll),
        on_key: Some(on_key),
        ..AppSpec::new("Raphie", (1280.0, 800.0), Ui::new, view::view)
    }
}

/// Window-wide keys: ⌘B shows and hides the bot roster, as in the web
/// workspace (Ctrl+B off macOS).
fn on_key(ui: &mut Ui, ev: &KeyEvent, _: &mut Tx) -> bool {
    if ev.is_command('b') && !ev.mods.shift && !ev.mods.alt {
        ui.roster_open = !ui.roster_open;
        return true;
    }
    false
}
