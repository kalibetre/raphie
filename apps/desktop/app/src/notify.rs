//! System notifications: a banner from the operating system for an update
//! that arrives while this window is not in front.
//!
//! What to announce is decided in the core
//! (`raphie_core::inbox::Announcements`); this only hands it to the system.

use raphie_core::inbox::Announcement;

/// Posts one notification. Never blocks the caller and never fails loudly:
/// a notification that cannot be shown is still in the inbox.
pub fn post(announcement: Announcement) {
    // The system call can take a moment (and on some systems waits), so it
    // runs on a thread of its own instead of the UI's.
    std::thread::spawn(move || {
        let _ = notify_rust::Notification::new()
            .appname("Raphie")
            .summary(&announcement.title)
            .body(&announcement.body)
            .show();
    });
}
