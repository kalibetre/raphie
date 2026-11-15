//! System notifications: a banner from the operating system for an update
//! that arrives while this window is not in front. A click on one brings
//! the window forward and opens what it is about.
//!
//! What to announce is decided in the core
//! (`raphie_core::inbox::Announcements`); this only hands it to the system.
//!
//! On macOS the system shows notifications only for an app bundle with its
//! own identifier, and only once the owner has allowed them. A bare binary
//! (`cargo run`) has no bundle, so there both functions do nothing;
//! `scripts/bundle.sh` builds an app bundle, which has one.

use std::sync::OnceLock;

use raphie_core::flavor::Flavor;
use raphie_core::inbox::Announcement;
use rune::AppHandle;

use crate::state::Ui;

/// The running app, for the threads that wait on notifications. A click
/// arrives on such a thread, and `AppHandle` is how another thread changes
/// the UI's state and brings the window forward.
///
/// `OnceLock` is a value set at most once and then shared, read-only, by
/// every thread; `get` is `None` until it is set.
static APP: OnceLock<AppHandle<Ui>> = OnceLock::new();

/// Called once from `main`, before the app runs.
pub fn connect(app: AppHandle<Ui>) {
    // A second call would be a mistake; keeping the first is harmless.
    let _ = APP.set(app);
}

/// True when the system will take notifications from this process.
fn can_post() -> bool {
    // `#[cfg(...)]` compiles a block only for the named platform, so each
    // system gets exactly one of these two.
    #[cfg(target_os = "macos")]
    {
        // macOS's notification centre crashes a process that has no bundle
        // identifier, so that is checked before every use.
        notify_rust::check_bundle().is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Asks the owner, once, whether this app may show notifications. macOS
/// puts up its own question the first time and remembers the answer; on
/// other systems there is nothing to ask.
pub fn prepare() {
    #[cfg(target_os = "macos")]
    // The question waits for an answer, so it is asked from a thread of
    // its own, never the UI's.
    std::thread::spawn(|| {
        if can_post() {
            // Refused or failed, the inbox still shows everything.
            let _ = notify_rust::request_auth_blocking();
        }
    });
}

/// Posts one notification. Never blocks the caller and never fails loudly:
/// a notification that cannot be shown is still in the inbox.
///
/// The thread stays to wait for the owner's response: a click opens the
/// notification's target. It ends when the notification is clicked or
/// cleared from the system's list (on macOS, which checks twice a second),
/// or when the app quits.
pub fn post(announcement: Announcement) {
    std::thread::spawn(move || {
        if !can_post() {
            return;
        }
        let shown = notify_rust::Notification::new()
            .appname(Flavor::current().app_name())
            .summary(&announcement.title)
            .body(&announcement.body)
            .show();
        let Ok(handle) = shown else {
            return;
        };
        let target = announcement.target;
        // "default" is a click on the notification itself, rather than on
        // one of its buttons (it has none) or a dismissal.
        handle.wait_for_action(|action| {
            if action != "default" {
                return;
            }
            if let Some(app) = APP.get() {
                // `update` runs the closure on the UI thread before the
                // next frame; `open` restores and activates the window.
                app.update(move |ui, _| ui.open_target(&target));
                app.open();
            }
        });
    });
}
