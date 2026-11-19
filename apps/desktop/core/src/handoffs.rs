//! Tasks a bot handed to other bots, as the conversation and the composer
//! show them: which are open in a session, who works on them, what each
//! brief's card says.
//!
//! Mirrors `apps/web/src/domains/conversations/application/handoffs.ts`.

use crate::contracts::{BotRef, Handoff, HandoffOutcome, HandoffRequest, HandoffStatus};

/// The open handoffs a session started.
pub fn open_handoffs<'a>(items: &'a [Handoff], session_id: Option<&str>) -> Vec<&'a Handoff> {
    items
        .iter()
        .filter(|item| {
            item.status == HandoffStatus::Working
                && Some(item.from_session_id.as_str()) == session_id
        })
        .collect()
}

/// One bot working for a session, with its open handoffs.
#[derive(Debug, PartialEq)]
pub struct DelegateGroup<'a> {
    pub bot: &'a BotRef,
    pub handoffs: Vec<&'a Handoff>,
    /// It waits for the owner's approval.
    pub waiting: bool,
}

/// Bots working for a session, the ones waiting for the owner first.
pub fn delegate_groups<'a>(open: &[&'a Handoff]) -> Vec<DelegateGroup<'a>> {
    let mut groups: Vec<DelegateGroup<'a>> = Vec::new();
    for &handoff in open {
        match groups
            .iter_mut()
            .find(|group| group.bot.id == handoff.to.id)
        {
            Some(group) => {
                group.handoffs.push(handoff);
                group.waiting |= handoff.waiting;
            }
            None => groups.push(DelegateGroup {
                bot: &handoff.to,
                handoffs: vec![handoff],
                waiting: handoff.waiting,
            }),
        }
    }
    // Stable, so bots keep their order within each half.
    groups.sort_by_key(|group| !group.waiting);
    groups
}

/// One line for the composer: who needs the owner, or who is working.
pub fn delegate_label(groups: &[DelegateGroup<'_>]) -> String {
    let tasks: usize = groups.iter().map(|group| group.handoffs.len()).sum();
    if let Some(waiting) = groups.iter().find(|group| group.waiting) {
        let others = groups
            .iter()
            .flat_map(|group| &group.handoffs)
            .filter(|handoff| !handoff.waiting)
            .count();
        return if others > 0 {
            format!("{} needs you · {others} more working", waiting.bot.name)
        } else {
            format!("{} needs you", waiting.bot.name)
        };
    }
    match groups {
        [one] if tasks > 1 => format!("{} is on it · {tasks} tasks", one.bot.name),
        [one] => format!("{} is on it", one.bot.name),
        _ => format!("{} bots on it · {tasks} tasks", groups.len()),
    }
}

/// A brief a turn sent: its handoff, and which request it is.
#[derive(Debug, PartialEq)]
pub struct SentRequest<'a> {
    pub handoff: &'a Handoff,
    pub request: &'a HandoffRequest,
    /// 0 for the first brief, then each follow-up in order.
    pub index: usize,
}

/// The briefs a turn sent, so their cards sit under its reply.
pub fn requests_from_turn<'a>(items: &'a [Handoff], turn_id: &str) -> Vec<SentRequest<'a>> {
    items
        .iter()
        .flat_map(|handoff| {
            handoff
                .requests
                .iter()
                .enumerate()
                .filter(|(_, request)| request.from_turn_id.as_deref() == Some(turn_id))
                .map(move |(index, request)| SentRequest {
                    handoff,
                    request,
                    index,
                })
        })
        .collect()
}

/// Where one brief stands, as its card's badge says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestStatus {
    Working,
    Waiting,
    Completed,
    Failed,
    Cancelled,
}

impl RequestStatus {
    pub fn label(self) -> &'static str {
        match self {
            RequestStatus::Working => "Working",
            RequestStatus::Waiting => "Needs your approval",
            RequestStatus::Completed => "Done",
            RequestStatus::Failed => "Failed",
            RequestStatus::Cancelled => "Cancelled",
        }
    }

    /// Still being worked on, whether or not it waits for the owner.
    pub fn open(self) -> bool {
        matches!(self, RequestStatus::Working | RequestStatus::Waiting)
    }

    pub fn of_outcome(outcome: HandoffOutcome) -> RequestStatus {
        match outcome {
            HandoffOutcome::Completed => RequestStatus::Completed,
            HandoffOutcome::Cancelled => RequestStatus::Cancelled,
            HandoffOutcome::Failed | HandoffOutcome::Unknown => RequestStatus::Failed,
        }
    }
}

/// A request's own status: the handoff's waiting flag applies to the open one.
pub fn request_status(sent: &SentRequest<'_>) -> RequestStatus {
    match sent.request.outcome {
        Some(outcome) => RequestStatus::of_outcome(outcome),
        None if sent.handoff.waiting => RequestStatus::Waiting,
        None => RequestStatus::Working,
    }
}

/// How long a brief took: seconds under a minute, then minutes, then hours.
pub fn duration(ms: i64) -> String {
    if ms < 60_000 {
        return format!("{} s", (ms as f64 / 1000.0).round().max(1.0) as i64);
    }
    let minutes = (ms as f64 / 60_000.0).round() as i64;
    if minutes < 60 {
        format!("{minutes} min")
    } else {
        format!("{} h", (minutes as f64 / 6.0).round() / 10.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handoff(id: &str, bot: &str, patch: serde_json::Value) -> Handoff {
        let mut value = serde_json::json!({
            "id": id,
            "to": { "id": bot, "name": format!("{}{}", bot[..1].to_uppercase(), &bot[1..]) },
            "title": id,
            "fromSessionId": "s1",
            "toSessionId": format!("{bot}-session"),
            "status": "working",
            "createdAt": 1,
            "requests": [{
                "brief": "Do it", "fromTurnId": "t1", "sentAt": 1,
                "turnId": "r1", "finishedAt": null, "outcome": null
            }],
        });
        for (key, field) in patch.as_object().unwrap() {
            value[key] = field.clone();
        }
        serde_json::from_value(value).unwrap()
    }

    // The same cases as apps/web/test/handoffs.test.ts.
    #[test]
    fn only_a_sessions_open_handoffs_count_as_working_for_it() {
        let items = [
            handoff("a", "research", serde_json::json!({})),
            handoff(
                "b",
                "research",
                serde_json::json!({ "status": "completed" }),
            ),
            handoff(
                "c",
                "writer",
                serde_json::json!({ "fromSessionId": "other" }),
            ),
        ];
        let ids: Vec<&str> = open_handoffs(&items, Some("s1"))
            .iter()
            .map(|h| h.id.as_str())
            .collect();
        assert_eq!(ids, ["a"]);
        assert!(open_handoffs(&items, None).is_empty());
    }

    #[test]
    fn the_composer_names_who_needs_the_owner_first_then_who_is_working() {
        let one = [handoff("a", "research", serde_json::json!({}))];
        let refs: Vec<&Handoff> = one.iter().collect();
        assert_eq!(delegate_label(&delegate_groups(&refs)), "Research is on it");
        let two = [
            handoff("a", "research", serde_json::json!({})),
            handoff("b", "research", serde_json::json!({})),
        ];
        let refs: Vec<&Handoff> = two.iter().collect();
        assert_eq!(
            delegate_label(&delegate_groups(&refs)),
            "Research is on it · 2 tasks"
        );
        let mixed = [
            handoff("a", "research", serde_json::json!({})),
            handoff("b", "writer", serde_json::json!({})),
            handoff("c", "finance", serde_json::json!({ "waiting": true })),
            handoff("d", "research", serde_json::json!({})),
        ];
        let refs: Vec<&Handoff> = mixed.iter().collect();
        let groups = delegate_groups(&refs);
        let order: Vec<&str> = groups.iter().map(|g| g.bot.id.as_str()).collect();
        assert_eq!(order, ["finance", "research", "writer"]);
        assert_eq!(
            delegate_label(&groups),
            "Finance needs you · 3 more working"
        );
        let pair = [
            handoff("a", "research", serde_json::json!({})),
            handoff("b", "writer", serde_json::json!({})),
        ];
        let refs: Vec<&Handoff> = pair.iter().collect();
        assert_eq!(
            delegate_label(&delegate_groups(&refs)),
            "2 bots on it · 2 tasks"
        );
    }

    #[test]
    fn each_briefs_card_belongs_under_the_turn_that_sent_it() {
        let followed = handoff(
            "a",
            "research",
            serde_json::json!({
                "requests": [
                    { "brief": "Do it", "fromTurnId": "t1", "sentAt": 1, "turnId": "r1",
                      "finishedAt": 2, "outcome": "completed" },
                    { "brief": "More", "fromTurnId": "t2", "sentAt": 3, "turnId": null,
                      "finishedAt": null, "outcome": null },
                ],
                "waiting": true,
            }),
        );
        let items = [followed];
        let first = requests_from_turn(&items, "t1");
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].index, 0);
        assert_eq!(request_status(&first[0]), RequestStatus::Completed);
        let later = requests_from_turn(&items, "t2");
        assert_eq!(later[0].index, 1);
        assert_eq!(request_status(&later[0]), RequestStatus::Waiting);
    }

    #[test]
    fn short_tasks_show_seconds() {
        assert_eq!(duration(400), "1 s");
        assert_eq!(duration(5_200), "5 s");
        assert_eq!(duration(90_000), "2 min");
        assert_eq!(duration(2 * 60 * 60_000), "2 h");
    }
}
