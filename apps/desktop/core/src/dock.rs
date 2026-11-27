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
}
