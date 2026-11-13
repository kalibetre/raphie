//! Raphie's desktop UI, drawn with Rune.
//!
//! This crate only presents [`raphie_core`]'s state and turns the owner's
//! clicks and keys into commands. Network, sign-in, storage and state rules
//! live in the core crate so they outlive any change of UI framework.
//!
//! - [`state`]: the UI's state and the bridge to the engine (`setup`, `poll`).
//! - [`view`]: `view(&Ui) -> El`, every screen.
//! - [`scenes`]: fixture states for headless snapshots and tests.
//! - [`format`]: small text helpers.

pub mod format;
pub mod scenes;
pub mod state;
pub mod view;

use rune::{AppSpec, KeyEvent, Tx};
use rune_kit::shell;

pub use state::Ui;

/// Everything Rune needs to run the app, in a window or headless.
pub fn spec() -> AppSpec<Ui> {
    AppSpec {
        min_size: Some((640.0, 480.0)),
        scenes: scenes::SCENES,
        setup: Some(state::setup),
        poll: Some(state::poll),
        on_key: Some(on_key),
        ..AppSpec::new("Raphie", (1080.0, 720.0), Ui::new, view::view)
    }
}

/// Window-wide keys: ⇧⌘B shows and hides the sidebar.
fn on_key(ui: &mut Ui, ev: &KeyEvent, _: &mut Tx) -> bool {
    if shell::is_sidebar_toggle(ev) {
        ui.sidebar.toggle();
        return true;
    }
    false
}
