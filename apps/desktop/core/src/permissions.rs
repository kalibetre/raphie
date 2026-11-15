//! Command permissions: whether a conversation asks before each command
//! or runs them without asking.
//!
//! The runtime keeps the mode per session
//! (`GET` and `PUT /api/sessions/:id/approval-mode`). A conversation that
//! has not started has no session yet, so its mode is kept by the client
//! and sent with the first message. Mirrors the web's `mcp-permissions.tsx`.

use crate::contracts::ApprovalMode;

/// The open session's command mode, as far as this client knows it.
///
/// Answers name the session they are for, so one that arrives after the
/// owner opened another conversation is dropped.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommandMode {
    /// The session this is about; `None` until a conversation is open.
    pub session_id: Option<String>,
    /// `None` until the runtime has answered.
    pub mode: Option<ApprovalMode>,
    pub loading: bool,
    /// The last load failed; the mode is unknown until a retry works.
    pub load_failed: bool,
    pub saving: bool,
    /// The last change was refused; the mode is as it was.
    pub save_failed: bool,
}

impl CommandMode {
    /// A conversation was opened (or its mode is being asked for again):
    /// forget what was known and wait for the runtime.
    pub fn open(&mut self, session_id: &str) {
        *self = CommandMode {
            session_id: Some(session_id.to_owned()),
            loading: true,
            ..CommandMode::default()
        };
    }

    /// No conversation is open any more.
    pub fn close(&mut self) {
        *self = CommandMode::default();
    }

    fn owns(&self, session_id: &str) -> bool {
        self.session_id.as_deref() == Some(session_id)
    }

    pub fn loaded(&mut self, session_id: &str, mode: ApprovalMode) {
        if self.owns(session_id) {
            self.mode = Some(mode);
            self.loading = false;
            self.load_failed = false;
        }
    }

    pub fn load_failed(&mut self, session_id: &str) {
        if self.owns(session_id) {
            self.loading = false;
            self.load_failed = true;
        }
    }

    /// The owner chose a mode. Returns false when it cannot be changed
    /// now: it is not known yet, or a change is already on its way.
    pub fn begin_save(&mut self) -> bool {
        if self.mode.is_none() || self.load_failed || self.saving {
            return false;
        }
        self.saving = true;
        self.save_failed = false;
        true
    }

    /// The runtime answered a change with the mode now in force.
    pub fn saved(&mut self, session_id: &str, mode: ApprovalMode) {
        if self.owns(session_id) {
            self.mode = Some(mode);
            self.saving = false;
        }
    }

    pub fn save_failed(&mut self, session_id: &str) {
        if self.owns(session_id) {
            self.saving = false;
            self.save_failed = true;
        }
    }
}

/// What the composer's button calls a mode: "Ask", "Full access", or
/// "Permissions" while it is not known.
pub fn mode_label(mode: Option<ApprovalMode>) -> &'static str {
    match mode {
        Some(ApprovalMode::Ask) => "Ask",
        Some(ApprovalMode::FullAccess) => "Full access",
        None => "Permissions",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mode_is_unknown_until_loaded_and_cannot_be_changed_before() {
        let mut mode = CommandMode::default();
        mode.open("s-1");
        assert!(mode.loading && mode.mode.is_none());
        assert!(!mode.begin_save(), "nothing to change yet");
        mode.loaded("s-1", ApprovalMode::Ask);
        assert_eq!(mode.mode, Some(ApprovalMode::Ask));
        assert!(mode.begin_save());
        assert!(!mode.begin_save(), "one change at a time");
        mode.saved("s-1", ApprovalMode::FullAccess);
        assert_eq!(mode.mode, Some(ApprovalMode::FullAccess));
        assert!(!mode.saving);
    }

    #[test]
    fn a_refused_change_keeps_the_mode_and_says_so_until_the_next_try() {
        let mut mode = CommandMode::default();
        mode.open("s-1");
        mode.loaded("s-1", ApprovalMode::Ask);
        assert!(mode.begin_save());
        mode.save_failed("s-1");
        assert_eq!(mode.mode, Some(ApprovalMode::Ask));
        assert!(mode.save_failed);
        assert!(mode.begin_save());
        assert!(!mode.save_failed);
    }

    #[test]
    fn answers_for_another_conversation_are_dropped() {
        let mut mode = CommandMode::default();
        mode.open("s-1");
        mode.open("s-2");
        mode.loaded("s-1", ApprovalMode::FullAccess);
        mode.load_failed("s-1");
        assert!(mode.loading && mode.mode.is_none() && !mode.load_failed);
        mode.load_failed("s-2");
        assert!(mode.load_failed);
        assert!(!mode.begin_save(), "an unknown mode cannot be changed");
    }

    #[test]
    fn modes_are_named_as_the_web_names_them() {
        assert_eq!(mode_label(Some(ApprovalMode::Ask)), "Ask");
        assert_eq!(mode_label(Some(ApprovalMode::FullAccess)), "Full access");
        assert_eq!(mode_label(None), "Permissions");
    }
}
