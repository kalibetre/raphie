//! What waits on the owner in the open conversation, as the dock on the
//! composer asks it: the conversation's own questions and approvals and, in
//! the bot's chat, those of its background work.
//!
//! In sync with `apps/web/src/domains/conversations/application/dock.ts`.
//! A pure function of its arguments: the clock comes in as `now`.

use crate::contracts::{
    ApprovalStatus, AskStatus, SessionApproval, SessionAsk, SessionObservation,
};

/// One question or approval waiting on the owner.
#[derive(Clone, Debug, PartialEq)]
pub struct DockItem<'a> {
    pub id: &'a str,
    /// Who asks: the work item, or the bot itself in its own conversation.
    pub title: &'a str,
    /// The work item it belongs to, for background work.
    pub item_id: Option<&'a str>,
    pub created_at: i64,
    pub waiting: Waiting<'a>,
}

/// What the owner is asked.
#[derive(Clone, Debug, PartialEq)]
pub enum Waiting<'a> {
    Question(&'a SessionAsk),
    Approval(&'a SessionApproval),
}

/// An approval the owner can still decide.
fn live(approval: &SessionApproval, now: i64) -> bool {
    approval.status == ApprovalStatus::Pending && approval.expires_at > now
}

fn questions<'a>(
    asks: &'a [SessionAsk],
    title: &'a str,
    item_id: Option<&'a str>,
) -> impl Iterator<Item = DockItem<'a>> {
    asks.iter()
        .filter(|ask| ask.status == AskStatus::Pending)
        .map(move |ask| DockItem {
            id: &ask.id,
            title,
            item_id,
            created_at: ask.created_at,
            waiting: Waiting::Question(ask),
        })
}

fn approvals<'a>(
    approvals: &'a [SessionApproval],
    title: &'a str,
    item_id: Option<&'a str>,
    now: i64,
) -> impl Iterator<Item = DockItem<'a>> {
    approvals
        .iter()
        .filter(move |approval| live(approval, now))
        .map(move |approval| DockItem {
            id: &approval.id,
            title,
            item_id,
            created_at: approval.created_at,
            waiting: Waiting::Approval(approval),
        })
}

/// Every question and approval waiting on the owner in `observation`, its
/// own titled `bot_name`, oldest first, so the dock asks in the order they
/// were asked.
pub fn dock_items<'a>(
    observation: &'a SessionObservation,
    bot_name: &'a str,
    now: i64,
) -> Vec<DockItem<'a>> {
    let mut items: Vec<DockItem> = questions(&observation.asks, bot_name, None)
        .chain(approvals(&observation.tool_approvals, bot_name, None, now))
        .collect();
    for request in &observation.background {
        let item = Some(request.item_id.as_str());
        items.extend(questions(&request.asks, &request.title, item));
        items.extend(approvals(
            &request.tool_approvals,
            &request.title,
            item,
            now,
        ));
    }
    // A stable sort keeps the order above for questions asked together.
    items.sort_by_key(|item| item.created_at);
    items
}

/// How the owner has arranged the dock in one conversation: the items they
/// skipped, in the order they skipped them, and, while it is folded away,
/// what it held when they folded it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DockView {
    pub skipped: Vec<String>,
    pub folded_with: Option<Vec<String>>,
}

/// The dock as the owner sees it: skipped items wait at the back, in the
/// order they were skipped. It stays folded until something new arrives, so
/// a new question is never hidden behind a bar. Returns the items and
/// whether the dock is folded.
pub fn arrange<'a>(items: Vec<DockItem<'a>>, view: &DockView) -> (Vec<DockItem<'a>>, bool) {
    let rank = |item: &DockItem| view.skipped.iter().position(|id| id == item.id);
    let folded = view.folded_with.as_ref().is_some_and(|with| {
        !items.is_empty() && items.iter().all(|item| with.iter().any(|id| id == item.id))
    });
    // A stable sort: the fresh ones keep their order, ahead of the skipped.
    let mut items = items;
    items.sort_by_key(|item| rank(item).map_or(0, |at| at + 1));
    (items, folded)
}

impl DockView {
    /// Sends the top item of `arranged` to the back of the dock.
    pub fn skip_top(&mut self, arranged: &[DockItem]) {
        let [top, _, ..] = arranged else {
            return;
        };
        self.skipped
            .retain(|id| id != top.id && arranged.iter().any(|item| item.id == id));
        self.skipped.push(top.id.to_owned());
    }

    /// Folds the dock to a bar until something new arrives.
    pub fn fold(&mut self, items: &[DockItem]) {
        self.folded_with = Some(items.iter().map(|item| item.id.to_owned()).collect());
    }

    pub fn unfold(&mut self) {
        self.folded_with = None;
    }

    /// Once something new arrives at a folded dock, the dock opens for good
    /// with the new item on top: what it held when folded waits behind it,
    /// as if skipped. Returns whether anything changed.
    pub fn settle(&mut self, items: Vec<DockItem>) -> bool {
        let Some(held) = self.folded_with.take() else {
            return false;
        };
        let (arranged, folded) = arrange(items, self);
        if folded {
            self.folded_with = Some(held);
            return false;
        }
        self.skipped = arranged
            .iter()
            .filter(|item| held.iter().any(|id| id == item.id))
            .map(|item| item.id.to_owned())
            .collect();
        true
    }
}

/// The dock's top item in one line, for the folded bar.
pub fn line(item: &DockItem) -> String {
    match item.waiting {
        Waiting::Question(ask) => ask.question.clone(),
        Waiting::Approval(approval) if approval.server.is_empty() => {
            format!("Run {}?", approval.tool)
        }
        Waiting::Approval(approval) => format!("Run {} on {}?", approval.tool, approval.server),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn ask(id: &str, at: i64, status: &str) -> Value {
        json!({
            "id": id, "turnId": "t1", "question": "Which one?", "options": [],
            "createdAt": at, "expiresAt": 10_000, "status": status
        })
    }

    fn approval(id: &str, at: i64, status: &str, expires_at: i64) -> Value {
        json!({
            "id": id, "server": "calendar", "tool": "execute", "argumentsJson": "{}",
            "createdAt": at, "expiresAt": expires_at, "status": status
        })
    }

    fn observation(extra: Value) -> SessionObservation {
        let mut base = json!({
            "session": {
                "id": "s-1", "title": "Chat", "origin": "web", "lastAt": 0,
                "working": false, "failed": false, "waiting": false,
                "preview": "", "turnCount": 0
            },
            "turns": [], "toolApprovals": [], "live": null, "nextBefore": null,
            "phase": "idle", "error": null
        });
        for (key, value) in extra.as_object().expect("an object") {
            base[key] = value.clone();
        }
        serde_json::from_value(base).expect("an observation")
    }

    #[test]
    fn the_dock_holds_what_waits_oldest_first_with_who_asks() {
        let seen = observation(json!({
            "asks": [ask("own", 300, "pending"), ask("done", 100, "answered")],
            "toolApprovals": [
                approval("ok", 200, "pending", 5_000),
                approval("lapsed", 50, "pending", 900),
                approval("decided", 60, "approved", 5_000),
            ],
            "background": [{
                "itemId": "w-6", "title": "Tidy the reports", "sessionId": "s-work",
                "asks": [ask("bg", 100, "pending")],
                "toolApprovals": [approval("bg-ok", 400, "pending", 5_000)]
            }]
        }));
        let items = dock_items(&seen, "Raphie", 1_000);
        let ids: Vec<_> = items.iter().map(|item| item.id).collect();
        assert_eq!(ids, ["bg", "ok", "own", "bg-ok"]);
        assert_eq!(items[0].title, "Tidy the reports");
        assert_eq!(items[0].item_id, Some("w-6"));
        assert!(matches!(items[0].waiting, Waiting::Question(_)));
        assert_eq!(items[1].title, "Raphie");
        assert_eq!(items[1].item_id, None);
        assert!(matches!(items[1].waiting, Waiting::Approval(_)));
    }

    fn ids<'a>(items: &[DockItem<'a>]) -> Vec<&'a str> {
        items.iter().map(|item| item.id).collect()
    }

    fn three() -> SessionObservation {
        observation(json!({
            "asks": [ask("a", 1, "pending"), ask("b", 2, "pending"), ask("c", 3, "pending")]
        }))
    }

    #[test]
    fn skipping_sends_the_top_item_to_the_back_in_the_order_skipped() {
        let seen = three();
        let mut view = DockView::default();
        let (items, _) = arrange(dock_items(&seen, "Raphie", 0), &view);
        view.skip_top(&items);
        let (items, _) = arrange(dock_items(&seen, "Raphie", 0), &view);
        assert_eq!(ids(&items), ["b", "c", "a"]);
        view.skip_top(&items);
        let (items, _) = arrange(dock_items(&seen, "Raphie", 0), &view);
        assert_eq!(ids(&items), ["c", "a", "b"]);
        // A lone item has nowhere to go.
        let one = observation(json!({ "asks": [ask("a", 1, "pending")] }));
        let mut lone = DockView::default();
        lone.skip_top(&dock_items(&one, "Raphie", 0));
        assert_eq!(lone, DockView::default());
    }

    #[test]
    fn a_folded_dock_stays_folded_until_something_new_arrives() {
        let two = observation(json!({
            "asks": [ask("a", 1, "pending"), ask("b", 2, "pending")]
        }));
        let mut view = DockView::default();
        view.fold(&dock_items(&two, "Raphie", 0));
        assert!(arrange(dock_items(&two, "Raphie", 0), &view).1);
        // Answering one keeps it folded.
        let one = observation(json!({ "asks": [ask("b", 2, "pending")] }));
        assert!(arrange(dock_items(&one, "Raphie", 0), &view).1);
        // A new question opens it, on top, for good: what was folded waits
        // behind it, and answering the new one does not fold it again.
        let seen = three();
        assert!(!arrange(dock_items(&seen, "Raphie", 0), &view).1);
        let mut settled = view.clone();
        assert!(settled.settle(dock_items(&seen, "Raphie", 0)));
        let (items, folded) = arrange(dock_items(&seen, "Raphie", 0), &settled);
        assert_eq!((ids(&items), folded), (vec!["c", "a", "b"], false));
        assert!(!arrange(dock_items(&two, "Raphie", 0), &settled).1);
        view.unfold();
        assert!(!arrange(dock_items(&two, "Raphie", 0), &view).1);
    }

    #[test]
    fn the_bar_says_what_the_top_item_asks() {
        let seen = observation(json!({
            "toolApprovals": [approval("ok", 200, "pending", 5_000)]
        }));
        let items = dock_items(&seen, "Raphie", 1_000);
        assert_eq!(line(&items[0]), "Run execute on calendar?");
        let asked = three();
        assert_eq!(line(&dock_items(&asked, "Raphie", 0)[0]), "Which one?");
    }
}
