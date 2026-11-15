//! System notifications: a banner from the operating system for an update
//! that arrives while this window is not in front.
//!
//! What to announce is decided in the core
//! (`raphie_core::inbox::Announcements`); this only hands it to the system.
//!
//! On macOS the system shows notifications only for an app bundle with its
//! own identifier, and only once the owner has allowed them. A bare binary
//! (`cargo run`) has no bundle, so there both functions do nothing;
//! `scripts/bundle.sh` builds `Raphie.app`, which has one.

use raphie_core::inbox::Announcement;

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
pub fn post(announcement: Announcement) {
    // The system call can take a moment, so it runs on its own thread.
    std::thread::spawn(move || {
        if !can_post() {
            return;
        }
        let _ = notify_rust::Notification::new()
            .appname("Raphie")
            .summary(&announcement.title)
            .body(&announcement.body)
            .show();
    });
}
