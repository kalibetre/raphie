//! Settings → Memory: what a save carries and the checks made before one
//! is sent, and the list of saved memories on "Browse memory".
//!
//! The limits are the runtime's (`memoryConfigurationInput` in
//! `packages/runtime/src/domains/memory/infrastructure/runtime-memory.ts`),
//! repeated here so the owner hears about a mistake before sending. The
//! runtime still checks everything itself, and its word is final.

use crate::auth::Secret;
use crate::contracts::{MemoryConfiguration, MemoryEvidence, MemoryPage, MemoryProvider};

/// What to do with the Hindsight API key the runtime holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeyChange {
    /// Leave the saved key as it is.
    Keep,
    /// Save this key in its place.
    Replace(Secret),
    /// Forget the saved key.
    Clear,
}

/// One save of a bot's memory settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryUpdate {
    pub enabled: bool,
    pub provider: MemoryProvider,
    pub scope: String,
    pub endpoint: String,
    pub bank_id: String,
    pub key: KeyChange,
}

impl MemoryUpdate {
    /// Whether this save would change anything in `saved`.
    pub fn changes(&self, saved: &MemoryConfiguration) -> bool {
        self.enabled != saved.enabled
            || self.provider != saved.provider
            || self.scope != saved.scope
            || self.endpoint != saved.endpoint
            || self.bank_id != saved.bank_id
            || self.key != KeyChange::Keep
    }

    /// What is wrong with these settings, if anything, in words for the
    /// owner.
    pub fn problem(&self) -> Option<&'static str> {
        if !is_identifier(&self.scope) {
            return Some("The scope takes up to 80 letters, numbers, underscores or hyphens.");
        }
        if self.provider == MemoryProvider::Hindsight {
            if self.endpoint.trim().is_empty() {
                return Some("Enter the Hindsight endpoint.");
            }
            if !is_identifier(&self.bank_id) {
                return Some(
                    "The bank ID takes up to 80 letters, numbers, underscores or hyphens.",
                );
            }
        }
        if let KeyChange::Replace(key) = &self.key
            && key.expose().chars().any(char::is_whitespace)
        {
            return Some("An API key has no spaces.");
        }
        None
    }
}

/// The runtime's rule for a scope and a bank ID: `[a-zA-Z0-9_-]{1,80}`.
fn is_identifier(text: &str) -> bool {
    (1..=80).contains(&text.len())
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The most a search may say, and the most a memory may say: the runtime's
/// limits in `memory/presentation/http/routes.ts`.
pub const QUERY_LIMIT: usize = 2000;
pub const CONTENT_LIMIT: usize = 8000;

/// The saved memories on "Browse memory": every memory page by page, or the
/// matches of one search.
///
/// Loads carry a ticket. Clearing the list or starting another load takes a
/// new ticket, so an answer that arrives late (for an earlier search, or
/// another bot) no longer matches and is dropped.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MemoryBrowser {
    /// The memories on screen; `None` until a load has answered.
    pub evidence: Option<Vec<MemoryEvidence>>,
    /// How many memories there are in all. Only known while browsing every
    /// memory; a search does not say.
    pub total: Option<u64>,
    /// The cursor for the page after the ones on screen, when there is one.
    pub next: Option<String>,
    /// A load is on its way.
    pub loading: bool,
    /// A correction or a forget is on its way.
    pub changing: bool,
    /// Why the last load or change failed, until the next attempt.
    pub error: Option<String>,
    ticket: u64,
}

impl MemoryBrowser {
    pub fn busy(&self) -> bool {
        self.loading || self.changing
    }

    /// Empties the list and retires any load still on its way.
    pub fn clear(&mut self) {
        // Keeping the ticket counting up is what retires the old load.
        *self = MemoryBrowser {
            ticket: self.ticket + 1,
            ..MemoryBrowser::default()
        };
    }

    /// A load is starting. Returns the ticket its answer must carry.
    pub fn begin_load(&mut self) -> u64 {
        self.ticket += 1;
        self.loading = true;
        self.error = None;
        self.ticket
    }

    /// One page of every memory arrived. `more` says it follows the pages
    /// already on screen rather than replacing them.
    pub fn listed(&mut self, ticket: u64, more: bool, page: MemoryPage) {
        if ticket != self.ticket {
            return;
        }
        self.show(more, page.evidence);
        self.total = Some(page.total);
        self.next = page.next;
    }

    /// The matches of a search arrived.
    pub fn recalled(&mut self, ticket: u64, evidence: Vec<MemoryEvidence>) {
        if ticket != self.ticket {
            return;
        }
        self.show(false, evidence);
        self.total = None;
        self.next = None;
    }

    fn show(&mut self, more: bool, evidence: Vec<MemoryEvidence>) {
        self.loading = false;
        match &mut self.evidence {
            // A memory saved while paging can come back twice; show it once.
            Some(shown) if more => {
                for item in evidence {
                    if !shown.iter().any(|known| known.id == item.id) {
                        shown.push(item);
                    }
                }
            }
            _ => self.evidence = Some(evidence),
        }
    }

    /// A load failed. A failed "Load more" keeps the pages already here.
    pub fn load_failed(&mut self, ticket: u64, more: bool, message: String) {
        if ticket != self.ticket {
            return;
        }
        self.loading = false;
        if !more {
            self.evidence = None;
            self.total = None;
            self.next = None;
        }
        self.error = Some(message);
    }

    /// A correction or a forget is starting. Returns false while anything
    /// else is on its way.
    pub fn begin_change(&mut self) -> bool {
        if self.busy() {
            return false;
        }
        self.changing = true;
        self.error = None;
        true
    }

    /// The runtime saved a correction: the memory says `content` now.
    pub fn revised(&mut self, id: &str, content: String) {
        self.changing = false;
        let shown = self.evidence.iter_mut().flatten();
        if let Some(item) = shown.into_iter().find(|item| item.id == id) {
            item.content = content;
            item.revision += 1;
        }
    }

    /// The runtime forgot a memory: it leaves the list and the count.
    pub fn forgotten(&mut self, id: &str) {
        self.changing = false;
        let Some(shown) = &mut self.evidence else {
            return;
        };
        let before = shown.len();
        shown.retain(|item| item.id != id);
        if shown.len() < before {
            self.total = self.total.map(|total| total.saturating_sub(1));
        }
    }

    pub fn change_failed(&mut self, message: String) {
        self.changing = false;
        self.error = Some(message);
    }
}

/// The session a memory came from, when its source names one
/// (`session:<uuid>/turn:<id>`), so the conversation can be opened.
pub fn source_session(source: &str) -> Option<&str> {
    let rest = source.strip_prefix("session:")?;
    let (id, _) = rest.split_once("/turn:")?;
    // A UUID: 36 characters, hex digits in groups of 8-4-4-4-12.
    let is_uuid = id.len() == 36
        && id.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        });
    is_uuid.then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::MemoryKind;

    fn item(id: &str) -> MemoryEvidence {
        MemoryEvidence {
            id: id.into(),
            content: format!("memory {id}"),
            kind: MemoryKind::Fact,
            source: "session:x/turn:1".into(),
            event_time: 0,
            revision: 1,
        }
    }

    fn page(ids: &[&str], next: Option<&str>, total: u64) -> MemoryPage {
        MemoryPage {
            evidence: ids.iter().map(|id| item(id)).collect(),
            next: next.map(str::to_owned),
            total,
        }
    }

    fn ids(browser: &MemoryBrowser) -> Vec<&str> {
        let shown = browser.evidence.as_deref().unwrap_or_default();
        shown.iter().map(|item| item.id.as_str()).collect()
    }

    #[test]
    fn pages_append_and_a_repeat_shows_once() {
        let mut browser = MemoryBrowser::default();
        let first = browser.begin_load();
        browser.listed(first, false, page(&["a", "b"], Some("cursor"), 3));
        assert_eq!(browser.next.as_deref(), Some("cursor"));
        let second = browser.begin_load();
        browser.listed(second, true, page(&["b", "c"], None, 3));
        assert_eq!(ids(&browser), ["a", "b", "c"]);
        assert_eq!(browser.total, Some(3));
        assert!(!browser.busy());
    }

    #[test]
    fn a_late_answer_is_dropped() {
        let mut browser = MemoryBrowser::default();
        let old = browser.begin_load();
        // The owner typed something else before the answer came.
        browser.clear();
        let new = browser.begin_load();
        browser.recalled(old, vec![item("stale")]);
        assert!(browser.evidence.is_none());
        assert!(browser.loading, "the newer search is still on its way");
        browser.recalled(new, vec![item("fresh")]);
        assert_eq!(ids(&browser), ["fresh"]);
        assert_eq!(browser.total, None, "a search has no total");
    }

    #[test]
    fn a_failed_load_more_keeps_what_is_shown() {
        let mut browser = MemoryBrowser::default();
        let first = browser.begin_load();
        browser.listed(first, false, page(&["a"], Some("cursor"), 2));
        let more = browser.begin_load();
        browser.load_failed(more, true, "offline".into());
        assert_eq!(ids(&browser), ["a"]);
        assert_eq!(browser.error.as_deref(), Some("offline"));
        // A failed first load leaves nothing.
        let again = browser.begin_load();
        browser.load_failed(again, false, "offline".into());
        assert!(browser.evidence.is_none());
    }

    #[test]
    fn corrections_and_forgets_update_the_list() {
        let mut browser = MemoryBrowser::default();
        let first = browser.begin_load();
        browser.listed(first, false, page(&["a", "b"], None, 2));
        assert!(browser.begin_change());
        assert!(!browser.begin_change(), "one change at a time");
        browser.revised("a", "corrected".into());
        let shown = browser.evidence.as_ref().unwrap();
        assert_eq!(
            (shown[0].content.as_str(), shown[0].revision),
            ("corrected", 2)
        );
        assert!(browser.begin_change());
        browser.forgotten("b");
        assert_eq!(ids(&browser), ["a"]);
        assert_eq!(browser.total, Some(1));
        assert!(browser.begin_change());
        browser.change_failed("busy".into());
        assert_eq!(browser.error.as_deref(), Some("busy"));
        assert!(!browser.busy());
    }

    #[test]
    fn a_source_names_its_session() {
        let id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
        assert_eq!(source_session(&format!("session:{id}/turn:t-1")), Some(id));
        assert_eq!(source_session("session:not-a-uuid/turn:t-1"), None);
        assert_eq!(source_session("hindsight:bank/42"), None);
    }

    fn update() -> MemoryUpdate {
        MemoryUpdate {
            enabled: true,
            provider: MemoryProvider::Builtin,
            scope: "owner".into(),
            endpoint: String::new(),
            bank_id: String::new(),
            key: KeyChange::Keep,
        }
    }

    #[test]
    fn built_in_memory_needs_only_a_scope() {
        assert_eq!(update().problem(), None);
        let spaced = MemoryUpdate {
            scope: "my scope".into(),
            ..update()
        };
        assert!(spaced.problem().unwrap().contains("scope"));
        let long = MemoryUpdate {
            scope: "a".repeat(81),
            ..update()
        };
        assert!(long.problem().is_some());
    }

    #[test]
    fn hindsight_needs_an_endpoint_and_a_bank() {
        let hindsight = MemoryUpdate {
            provider: MemoryProvider::Hindsight,
            ..update()
        };
        assert!(hindsight.problem().unwrap().contains("endpoint"));
        let no_bank = MemoryUpdate {
            endpoint: "http://127.0.0.1:8888".into(),
            ..hindsight.clone()
        };
        assert!(no_bank.problem().unwrap().contains("bank"));
        let ready = MemoryUpdate {
            bank_id: "raphie".into(),
            ..no_bank
        };
        assert_eq!(ready.problem(), None);
        let spaced_key = MemoryUpdate {
            key: KeyChange::Replace(Secret::new("two words")),
            ..ready
        };
        assert!(spaced_key.problem().unwrap().contains("key"));
    }

    #[test]
    fn a_key_change_alone_counts_as_a_change() {
        let saved = MemoryConfiguration {
            enabled: true,
            provider: MemoryProvider::Builtin,
            scope: "owner".into(),
            endpoint: String::new(),
            bank_id: String::new(),
            has_credential: true,
        };
        assert!(!update().changes(&saved));
        let cleared = MemoryUpdate {
            key: KeyChange::Clear,
            ..update()
        };
        assert!(cleared.changes(&saved));
    }
}
