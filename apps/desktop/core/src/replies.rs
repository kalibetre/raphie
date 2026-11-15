//! Unread replies: how many of each conversation's replies the owner has
//! seen on this computer.
//!
//! The runtime counts a session's finished replies (`replyCount`); this
//! client remembers how many of them were on screen. The difference is the
//! "new replies" a conversation shows. Mirrors the web's `reply-ledger.ts`.
//! Read state is kept per client, not shared: the web keeps its own in the
//! browser, and this file is this computer's.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::contracts::SessionSummary;
use crate::flavor::Flavor;

/// For one Raphie: each bot's sessions, and how many replies of each were
/// read. `#[serde(transparent)]` writes it as the bare map, with no
/// wrapping field.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct ReplyLedger {
    bots: HashMap<String, HashMap<String, u32>>,
}

impl ReplyLedger {
    /// How many of `session`'s replies have not been read. A runtime that
    /// does not count replies has none to show as new.
    pub fn unread(&self, bot_id: &str, session: &SessionSummary) -> u32 {
        let read = self
            .bots
            .get(bot_id)
            .and_then(|sessions| sessions.get(&session.id))
            .copied()
            .unwrap_or(0)
            // Read in another client counts too: the furthest wins.
            .max(session.read_reply_count.unwrap_or(0));
        // `saturating_sub` stops at zero instead of wrapping below it.
        session.reply_count.unwrap_or(0).saturating_sub(read)
    }

    /// The owner saw `count` of a session's replies. Returns true when
    /// that is news; the count read never moves backwards.
    pub fn read(&mut self, bot_id: &str, session_id: &str, count: u32) -> bool {
        let sessions = self.bots.entry(bot_id.to_owned()).or_default();
        let read = sessions.entry(session_id.to_owned()).or_insert(0);
        if count <= *read {
            return false;
        }
        *read = count;
        true
    }
}

/// The ledgers of every Raphie this computer has signed in to, by origin.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct ReadReplies {
    origins: HashMap<String, ReplyLedger>,
}

impl ReadReplies {
    /// `<config dir>/raphie-desktop/read-replies.json`, beside the settings.
    pub fn default_path() -> Option<PathBuf> {
        Some(
            dirs::config_dir()?
                .join(Flavor::current().config_folder())
                .join("read-replies.json"),
        )
    }

    /// A missing or unreadable file is simply empty: every reply then
    /// shows as new once, which is harmless.
    pub fn load(path: &Path) -> ReadReplies {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        std::fs::write(path, json)
    }

    /// The ledger for one Raphie; empty if it was never signed in to.
    pub fn of(&self, origin: &str) -> Option<&ReplyLedger> {
        self.origins.get(origin)
    }

    /// See [`ReplyLedger::unread`].
    pub fn unread(&self, origin: &str, bot_id: &str, session: &SessionSummary) -> u32 {
        match self.of(origin) {
            Some(ledger) => ledger.unread(bot_id, session),
            None => session
                .reply_count
                .unwrap_or(0)
                .saturating_sub(session.read_reply_count.unwrap_or(0)),
        }
    }

    /// See [`ReplyLedger::read`].
    pub fn read(&mut self, origin: &str, bot_id: &str, session_id: &str, count: u32) -> bool {
        self.origins
            .entry(origin.to_owned())
            .or_default()
            .read(bot_id, session_id, count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, replies: Option<u32>) -> SessionSummary {
        let mut session: SessionSummary = serde_json::from_value(serde_json::json!({
            "id": id, "title": "A conversation", "origin": "web", "lastAt": 1,
            "working": false, "failed": false, "waiting": false, "preview": "",
            "turnCount": 1,
        }))
        .unwrap();
        session.reply_count = replies;
        session
    }

    #[test]
    fn replies_are_new_until_read_and_reading_never_goes_backwards() {
        let mut ledger = ReplyLedger::default();
        assert_eq!(ledger.unread("default", &session("s-1", Some(3))), 3);
        assert!(ledger.read("default", "s-1", 3));
        assert_eq!(ledger.unread("default", &session("s-1", Some(3))), 0);
        assert_eq!(ledger.unread("default", &session("s-1", Some(5))), 2);
        // An older count (a stale list, say) does not unread anything.
        assert!(!ledger.read("default", "s-1", 1));
        assert_eq!(ledger.unread("default", &session("s-1", Some(3))), 0);
    }

    #[test]
    fn replies_read_in_another_client_count_as_read_here() {
        let mut ledger = ReplyLedger::default();
        let mut shared = session("s-1", Some(3));
        shared.read_reply_count = Some(2);
        // Another client read two; this computer read none.
        assert_eq!(ledger.unread("default", &shared), 1);
        // Reading further here wins over a runtime that has heard less.
        ledger.read("default", "s-1", 3);
        assert_eq!(ledger.unread("default", &shared), 0);
        // With no ledger for this Raphie yet, the runtime's count still holds.
        let book = ReadReplies::default();
        assert_eq!(book.unread("https://h", "default", &shared), 1);
    }

    #[test]
    fn each_bot_and_session_is_counted_apart() {
        let mut ledger = ReplyLedger::default();
        ledger.read("default", "s-1", 2);
        assert_eq!(ledger.unread("research", &session("s-1", Some(2))), 2);
        assert_eq!(ledger.unread("default", &session("s-2", Some(2))), 2);
    }

    #[test]
    fn a_runtime_that_counts_no_replies_shows_none_as_new() {
        let ledger = ReplyLedger::default();
        assert_eq!(ledger.unread("default", &session("s-1", None)), 0);
    }

    #[test]
    fn each_raphie_keeps_its_own_ledger_and_the_file_round_trips() {
        let dir = std::env::temp_dir().join(format!("raphie-replies-{}", std::process::id()));
        let path = dir.join("nested").join("read-replies.json");
        assert_eq!(ReadReplies::load(&path), ReadReplies::default());

        let mut read = ReadReplies::default();
        assert!(read.read("https://one.example", "default", "s-1", 4));
        let seen = session("s-1", Some(4));
        assert_eq!(read.unread("https://one.example", "default", &seen), 0);
        assert_eq!(read.unread("https://two.example", "default", &seen), 4);

        read.save(&path).unwrap();
        assert_eq!(ReadReplies::load(&path), read);
        // The file is the plain nested map, as the web's is.
        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(written["https://one.example"]["default"]["s-1"], 4);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
