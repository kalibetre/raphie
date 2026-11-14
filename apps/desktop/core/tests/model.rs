//! State logic, with no network: how events change the model.

mod support;

use raphie_core::contracts::{ApprovalStatus, Page, SessionObservation, SessionTurn};
use raphie_core::model::{AuthState, DecisionOutcome, Effect, Event, Model};
use raphie_core::origin::Origin;
use serde_json::json;
use support::{observation_json, turn_json};

fn observation(turns: &[serde_json::Value], live: Option<&str>) -> Box<SessionObservation> {
    Box::new(serde_json::from_str(&observation_json(turns, live, "idle")).unwrap())
}

fn turn(id: &str, at: i64) -> serde_json::Value {
    turn_json(id, at, &format!("q {id}"), Some("a"), "done")
}

fn open(model: &mut Model, session: &str) {
    model.select_bot("default".into());
    model.select_session(Some(session.into()));
}

fn ids(model: &Model) -> Vec<String> {
    let conversation = model.conversation.as_ref().unwrap();
    conversation.turns().iter().map(|t| t.id.clone()).collect()
}

#[test]
fn turns_that_leave_the_window_stay_on_screen() {
    let mut model = Model::new();
    open(&mut model, "s-1");
    model.apply(Event::Observation {
        session_id: "s-1".into(),
        observation: observation(&[turn("t1", 1), turn("t2", 2)], None),
    });
    // A new turn pushes t1 out of the runtime's 50-turn window.
    model.apply(Event::Observation {
        session_id: "s-1".into(),
        observation: observation(&[turn("t2", 2), turn("t3", 3)], None),
    });
    assert_eq!(ids(&model), ["t1", "t2", "t3"]);
    // The next history page starts before the oldest turn held.
    assert_eq!(
        model
            .conversation
            .as_ref()
            .unwrap()
            .older_cursor()
            .as_deref(),
        Some("t1")
    );
}

#[test]
fn a_pending_turn_outside_the_window_sorts_by_time() {
    // The runtime prepends the first pending turn even when it is older than
    // the window; the display stays in time order.
    let mut model = Model::new();
    open(&mut model, "s-1");
    let pending = turn_json("t0", 0, "old pending", None, "pending");
    model.apply(Event::Observation {
        session_id: "s-1".into(),
        observation: observation(&[pending, turn("t5", 5)], None),
    });
    assert_eq!(ids(&model), ["t0", "t5"]);
}

#[test]
fn history_pages_prepend_without_duplicates() {
    let mut model = Model::new();
    open(&mut model, "s-1");
    model.apply(Event::Observation {
        session_id: "s-1".into(),
        observation: observation(&[turn("t3", 3), turn("t4", 4)], None),
    });
    assert_eq!(model.begin_load_older().as_deref(), Some("t3"));
    // A second click while loading sends nothing.
    assert_eq!(model.begin_load_older(), None);
    let page: Page<SessionTurn> = serde_json::from_value(json!({
        "items": [turn("t1", 1), turn("t2", 2), turn("t3", 3)],
        "next": null
    }))
    .unwrap();
    model.apply(Event::OlderTurns {
        session_id: "s-1".into(),
        page,
    });
    assert_eq!(ids(&model), ["t1", "t2", "t3", "t4"]);
    assert_eq!(model.begin_load_older(), None, "reached the start");
}

#[test]
fn news_for_another_session_or_bot_is_ignored() {
    let mut model = Model::new();
    open(&mut model, "s-2");
    model.apply(Event::Observation {
        session_id: "s-1".into(),
        observation: observation(&[turn("t1", 1)], None),
    });
    assert!(model.conversation.as_ref().unwrap().observation.is_none());
    model.apply(Event::Sessions {
        bot_id: "other".into(),
        page: Page {
            items: Vec::new(),
            next: Some("x".into()),
        },
        more: false,
    });
    assert_eq!(model.sessions_next, None);
}

#[test]
fn a_new_session_opens_only_if_the_owner_is_still_waiting_for_it() {
    let mut model = Model::new();
    model.select_bot("default".into());
    model.apply(Event::SessionCreated {
        bot_id: "default".into(),
        session_id: "s-new".into(),
    });
    assert_eq!(
        model.conversation.as_ref().map(|c| c.session_id.as_str()),
        Some("s-new")
    );
    // Created after the owner had moved to another session: stay there.
    model.select_session(Some("s-1".into()));
    model.apply(Event::SessionCreated {
        bot_id: "default".into(),
        session_id: "s-other".into(),
    });
    assert_eq!(
        model.conversation.as_ref().map(|c| c.session_id.as_str()),
        Some("s-1")
    );
}

#[test]
fn sending_clears_the_composer_only_when_admitted() {
    let mut model = Model::new();
    assert!(model.begin_send());
    assert!(!model.begin_send(), "one message at a time");
    let failed = model.apply(Event::MessageFailed {
        message: "Could not reach Raphie".into(),
    });
    assert!(failed.is_empty(), "the draft stays");
    assert!(!model.sending);
    assert!(model.begin_send());
    let accepted = model.apply(Event::MessageAccepted {
        receipt: serde_json::from_value(json!({ "id": "t", "sessionId": "s" })).unwrap(),
    });
    assert_eq!(accepted, vec![Effect::ClearComposer]);
}

#[test]
fn stale_decisions_explain_themselves() {
    let mut model = Model::new();
    assert!(model.begin_decide("a"));
    assert!(
        !model.begin_decide("a"),
        "a double click sends one decision"
    );
    model.apply(Event::Decided {
        approval_id: "a".into(),
        outcome: DecisionOutcome::AlreadySettled(ApprovalStatus::Expired),
    });
    assert!(model.deciding.is_empty());
    assert!(model.notice.as_deref().unwrap().contains("expired"));
}

#[test]
fn signing_out_keeps_only_the_origin() {
    let mut model = Model::new();
    let origin = Origin::parse("http://127.0.0.1:4321").unwrap();
    model.apply(Event::SignedIn {
        origin: origin.clone(),
    });
    open(&mut model, "s-1");
    model.apply(Event::SignedOut {
        notice: Some("revoked".into()),
    });
    assert_eq!(model.origin, Some(origin));
    assert_eq!(
        model.auth,
        AuthState::SignedOut {
            notice: Some("revoked".into())
        }
    );
    assert!(model.bot_id.is_none() && model.conversation.is_none());
}

#[test]
fn live_text_shows_while_generating() {
    let mut model = Model::new();
    open(&mut model, "s-1");
    model.apply(Event::Observation {
        session_id: "s-1".into(),
        observation: observation(&[turn("t1", 1)], Some("Hel")),
    });
    assert_eq!(
        model.conversation.as_ref().unwrap().live_text(),
        Some("Hel")
    );
}
