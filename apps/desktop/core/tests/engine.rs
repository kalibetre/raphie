//! The engine against a fake web host: sign-in, streams, paging, sending and
//! approvals, end to end over real HTTP on loopback. No model calls.

mod support;

use std::sync::Arc;

use raphie_core::auth::{AccessToken, MemoryStore, TokenStore};
use raphie_core::contracts::{ApprovalStatus, ControlAction, Decision, Scope, UpdateBotProfile};
use raphie_core::engine::Command;
use raphie_core::model::{AuthState, DecisionOutcome, Event, StreamStatus};
use support::{Driver, FakeHost, TOKEN, observation_json, sessions_json, turn_json};

fn signed_in(host: &FakeHost) -> (Driver, MemoryStore) {
    let store = MemoryStore::new();
    let mut driver = Driver::new(Arc::new(store.clone()));
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("the session list", |m, _| !m.sessions.is_empty());
    (driver, store)
}

#[test]
fn device_sign_in_stores_the_token_and_opens_the_default_bot() {
    let host = FakeHost::start();
    host.with(|h| h.pending_polls = 2);
    let (driver, store) = signed_in(&host);

    assert!(driver.seen.iter().any(|e| matches!(
        e,
        Event::DeviceCode(code) if code.user_code == "WXYZ-1234"
            && code.verification_url.starts_with(host.origin.as_str())
    )));
    assert_eq!(driver.model.auth, AuthState::SignedIn);
    assert_eq!(driver.model.bot_id.as_deref(), Some("default"));
    assert_eq!(driver.model.bots.len(), 2);
    assert_eq!(store.load(&host.origin).unwrap().unwrap().expose(), TOKEN);
    // Three polls: two pending, then the token.
    assert_eq!(host.requests("/api/auth/device/token").len(), 3);

    // Sign-in requests carry no credentials; API requests carry only the
    // bearer token, never a cookie or an Origin header.
    for seen in host.requests("/api/auth/device") {
        assert!(seen.authorization.is_none() && !seen.cookie && !seen.origin_header);
    }
    for seen in host.requests("/api/bots") {
        assert_eq!(
            seen.authorization.as_deref(),
            Some(&*format!("Bearer {TOKEN}"))
        );
        assert!(!seen.cookie && !seen.origin_header);
    }
}

#[test]
fn an_approval_link_to_another_origin_is_refused() {
    let host = FakeHost::start();
    host.with(|h| h.verification_override = Some("https://evil.example/device?user_code=X".into()));
    let mut driver = Driver::new(Arc::new(MemoryStore::new()));
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("the refusal", |m, _| {
        matches!(&m.auth, AuthState::SignedOut { notice: Some(n) } if n.contains("somewhere other"))
    });
    assert!(host.requests("/api/auth/device/token").is_empty());
}

#[test]
fn a_denied_code_returns_to_sign_in() {
    let host = FakeHost::start();
    host.with(|h| h.deny = true);
    let store = MemoryStore::new();
    let mut driver = Driver::new(Arc::new(store.clone()));
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until(
        "denial",
        |m, _| matches!(&m.auth, AuthState::SignedOut { notice: Some(n) } if n.contains("denied")),
    );
    assert_eq!(store.load(&host.origin).unwrap(), None);
}

#[test]
fn restore_uses_a_saved_token_without_a_new_code() {
    let host = FakeHost::start();
    let store = MemoryStore::new();
    store
        .save(&host.origin, &AccessToken::new(TOKEN.into()))
        .unwrap();
    let mut driver = Driver::new(Arc::new(store));
    driver.send(Command::Restore {
        origin: host.origin.clone(),
    });
    driver.until("sign-in", |m, _| m.auth == AuthState::SignedIn);
    assert!(host.requests("/api/auth/device").is_empty());
}

#[test]
fn restore_without_a_token_waits_for_the_owner() {
    let host = FakeHost::start();
    let mut driver = Driver::new(Arc::new(MemoryStore::new()));
    driver.send(Command::Restore {
        origin: host.origin.clone(),
    });
    driver.until("the sign-in screen", |_, seen| {
        seen.iter()
            .any(|e| matches!(e, Event::SignedOut { notice: None }))
    });
    assert!(host.requests("/api/auth/device").is_empty());
}

#[test]
fn revocation_signs_out_and_forgets_the_token() {
    let host = FakeHost::start();
    let (mut driver, store) = signed_in(&host);
    driver.model.select_session(Some("s-1".into()));
    driver.send(Command::SelectSession {
        session_id: Some("s-1".into()),
    });
    driver.until("the conversation", |m, _| {
        m.conversation
            .as_ref()
            .is_some_and(|c| c.observation.is_some())
    });

    // Disconnected in Settings → Account: open streams close, and the next
    // request is refused.
    host.with(|h| h.revoked = true);
    host.fake.observation.send_modify(|_| {});
    host.fake.sessions.send_modify(|_| {});
    driver.until("sign-out", |m, _| {
        matches!(&m.auth, AuthState::SignedOut { notice: Some(n) } if n.contains("signed out"))
    });
    assert_eq!(store.load(&host.origin).unwrap(), None);
    assert!(driver.model.conversation.is_none() && driver.model.sessions.is_empty());
    assert_eq!(driver.model.origin.as_ref(), Some(&host.origin));
}

#[test]
fn the_conversation_streams_live_text_and_pages_history() {
    let host = FakeHost::start();
    let older: Vec<_> = (1..=5)
        .map(|i| {
            turn_json(
                &format!("t{i}"),
                i,
                &format!("question {i}"),
                Some("answer"),
                "done",
            )
        })
        .collect();
    host.with(|h| h.history = older.clone());
    host.fake
        .observation
        .send_replace(observation_json(&older[4..], None, "idle"));
    let (mut driver, _) = signed_in(&host);
    driver.model.select_session(Some("s-1".into()));
    driver.send(Command::SelectSession {
        session_id: Some("s-1".into()),
    });
    driver.until("the first observation", |m, _| {
        m.conversation
            .as_ref()
            .is_some_and(|c| c.turns().len() == 1)
    });

    // A reply streams in: each change is a whole new observation.
    let pending = turn_json("t6", 6, "plan my day", None, "pending");
    let mut turns = vec![older[4].clone(), pending];
    for live in ["Let", "Let's make some room"] {
        host.fake
            .observation
            .send_replace(observation_json(&turns, Some(live), "writing"));
        driver.until("live text", |m, _| {
            m.conversation.as_ref().and_then(|c| c.live_text()) == Some(live)
        });
    }
    turns[1]["status"] = "done".into();
    turns[1]["answer"] = "Let's make some room for the day.".into();
    host.fake
        .observation
        .send_replace(observation_json(&turns, None, "idle"));
    driver.until("the finished reply", |m, _| {
        m.conversation
            .as_ref()
            .is_some_and(|c| c.live_text().is_none() && c.turns()[1].answer.is_some())
    });
    assert_eq!(
        driver.model.conversation.as_ref().unwrap().stream,
        StreamStatus::Live
    );

    // "Show earlier messages" twice reaches the start of the session.
    // The fake pages two turns at a time: t3–t4, then t1–t2.
    for expected in [4, 6] {
        let before = driver.model.begin_load_older().expect("a cursor");
        driver.send(Command::LoadOlder {
            session_id: "s-1".into(),
            before,
        });
        driver.until("older turns", |m, _| {
            m.conversation
                .as_ref()
                .is_some_and(|c| c.turns().len() == expected)
        });
    }
    let conversation = driver.model.conversation.as_ref().unwrap();
    let ids: Vec<&str> = conversation.turns().iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["t1", "t2", "t3", "t4", "t5", "t6"]);
    assert_eq!(conversation.older_cursor(), None);
}

#[test]
fn a_first_message_creates_and_opens_a_session() {
    let host = FakeHost::start();
    host.with(|h| h.failing_submits = 1);
    let (mut driver, _) = signed_in(&host);
    assert!(driver.model.begin_send());
    driver.send(Command::Send {
        text: "Hello".into(),
    });
    driver.until("acceptance", |m, _| !m.sending);
    assert!(driver.seen.contains(&Event::SessionCreated {
        bot_id: "default".into(),
        session_id: "s-new".into(),
    }));
    assert_eq!(
        driver
            .model
            .conversation
            .as_ref()
            .map(|c| c.session_id.as_str()),
        Some("s-new")
    );

    // The 503 was retried with the same event id, so the runtime admits the
    // message once; mutations carry the runtime's client marker.
    let submits = host.with(|h| h.submits.clone());
    assert_eq!(submits.len(), 2);
    assert_eq!(submits[0]["eventId"], submits[1]["eventId"]);
    assert!(submits[0].get("sessionId").is_none());
    for seen in host.requests("/api/sessions/messages") {
        assert_eq!(seen.client_marker.as_deref(), Some("web"));
    }
}

#[test]
fn approvals_handle_fresh_stale_and_unknown_decisions() {
    let host = FakeHost::start();
    host.with(|h| {
        h.approvals.insert("a-1".into(), "pending");
        h.approvals.insert("a-2".into(), "expired");
    });
    let (mut driver, _) = signed_in(&host);
    let decide = |driver: &mut Driver, id: &str, decision| {
        assert!(driver.model.begin_decide(id));
        driver.send(Command::Decide {
            approval_id: id.into(),
            decision,
            scope: Scope::Once,
        });
        let id = id.to_owned();
        driver.until("the decision", move |m, _| !m.deciding.contains(&id));
        driver.seen.iter().rev().find_map(|e| match e {
            Event::Decided { outcome, .. } => Some(outcome.clone()),
            _ => None,
        })
    };
    assert_eq!(
        decide(&mut driver, "a-1", Decision::Approved),
        Some(DecisionOutcome::Applied)
    );
    // Already approved (here, by this client a moment ago; equally by Discord).
    assert_eq!(
        decide(&mut driver, "a-1", Decision::Rejected),
        Some(DecisionOutcome::AlreadySettled(ApprovalStatus::Approved))
    );
    assert!(
        driver
            .model
            .notice
            .as_deref()
            .unwrap()
            .contains("already been approved")
    );
    assert_eq!(
        decide(&mut driver, "a-2", Decision::Approved),
        Some(DecisionOutcome::AlreadySettled(ApprovalStatus::Expired))
    );
    assert_eq!(
        decide(&mut driver, "a-404", Decision::Approved),
        Some(DecisionOutcome::Gone)
    );
}

#[test]
fn signing_in_learns_who_the_administrator_is() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    driver.until("the account", |m, _| m.account.is_some());
    let account = driver.model.account.clone().unwrap();
    assert_eq!(
        (account.email.as_str(), account.name.as_str()),
        ("owner@example.com", "Owner")
    );
    let seen = host.requests("/auth/status");
    assert_eq!(
        seen[0].authorization.as_deref(),
        Some("Bearer device-token-1")
    );
}

#[test]
fn saving_a_profile_bumps_its_revision_and_a_stale_save_conflicts() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    let update = |revision| UpdateBotProfile {
        name: "Research".into(),
        description: "Reads and summarises".into(),
        soul: "Be brief.".into(),
        color: None,
        revision,
    };
    assert!(driver.model.begin_save_profile());
    assert!(!driver.model.begin_save_profile(), "one save at a time");
    driver.send(Command::SaveProfile {
        bot_id: "b-research".into(),
        update: update(1),
    });
    driver.until("the save", |m, _| !m.saving_profile);
    let saved = driver
        .model
        .bots
        .iter()
        .find(|b| b.id == "b-research")
        .unwrap();
    assert_eq!(
        (saved.revision, saved.description.as_str()),
        (2, "Reads and summarises")
    );
    // An automatic colour is sent as an explicit null, not left out.
    let sent = host.with(|h| h.profile_saves[0].clone());
    assert!(sent["color"].is_null() && sent.get("color").is_some());

    // Another client saved meanwhile: this save started from revision 2.
    host.with(|h| h.profile_revision = 5);
    assert!(driver.model.begin_save_profile());
    driver.send(Command::SaveProfile {
        bot_id: "b-research".into(),
        update: update(2),
    });
    driver.until("the conflict", |m, _| m.profile_error.is_some());
    assert!(!driver.model.saving_profile);
    // The list was refreshed, so the page can see the newer revision.
    let latest = driver
        .model
        .bots
        .iter()
        .find(|b| b.id == "b-research")
        .unwrap();
    assert_eq!(latest.revision, 5);
}

#[test]
fn a_session_scoped_approval_carries_its_scope() {
    let host = FakeHost::start();
    host.with(|h| {
        h.approvals.insert("a-1".into(), "pending");
    });
    let (mut driver, _) = signed_in(&host);
    assert!(driver.model.begin_decide("a-1"));
    driver.send(Command::Decide {
        approval_id: "a-1".into(),
        decision: Decision::Approved,
        scope: Scope::Session,
    });
    driver.until("the decision", |m, _| m.deciding.is_empty());
    let decisions = host.with(|h| h.decisions.clone());
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0]["decision"], "approved");
    assert_eq!(decisions[0]["scope"], "session");
}

#[test]
fn stop_and_steer_reach_the_sessions_control_route() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    driver.send(Command::Control {
        session_id: "s-1".into(),
        action: ControlAction::Stop,
        turn_id: None,
    });
    driver.send(Command::Control {
        session_id: "s-1".into(),
        action: ControlAction::Steer,
        turn_id: Some("t-9".into()),
    });
    // Each command is sent on its own task, so wait for both to arrive
    // before making the host refuse the next one.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while host.with(|h| h.controls.len()) < 2 {
        assert!(std::time::Instant::now() < deadline, "two control requests");
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(driver.model.notice, None, "success is silent");

    // A stop that arrives after the run ended is reported, not ignored.
    host.with(|h| h.control_conflict = true);
    driver.send(Command::Control {
        session_id: "s-1".into(),
        action: ControlAction::Stop,
        turn_id: None,
    });
    driver.until("the failed stop", |m, _| {
        m.notice
            .as_deref()
            .is_some_and(|n| n.contains("Could not stop"))
    });
    let controls = host.with(|h| h.controls.clone());
    let sent = |action: &str| {
        controls
            .iter()
            .find(|(_, body)| body["action"] == action)
            .cloned()
            .unwrap_or_else(|| panic!("no {action} request"))
    };
    let (session, stop) = sent("stop");
    assert_eq!(session, "s-1");
    assert!(stop.get("turnId").is_none(), "stop names no message");
    assert_eq!(sent("steer").1["turnId"], "t-9");
    for seen in host.requests("/api/sessions/s-1/control") {
        assert_eq!(seen.client_marker.as_deref(), Some("web"));
    }
}

#[test]
fn another_bot_uses_its_own_routes() {
    let host = FakeHost::start();
    host.fake
        .sessions
        .send_replace(sessions_json(&["r-1", "r-2"]));
    let (mut driver, _) = signed_in(&host);
    driver.model.select_bot("b-research".into());
    driver.send(Command::SelectBot {
        bot_id: "b-research".into(),
    });
    driver.until("the research sessions", |m, _| {
        m.bot_id.as_deref() == Some("b-research") && m.sessions.len() == 2
    });
    assert_eq!(
        host.requests("/api/bots/b-research/sessions/events").len(),
        1
    );
}

#[test]
fn a_missing_session_is_reported() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    driver.model.select_session(Some("missing".into()));
    driver.send(Command::SelectSession {
        session_id: Some("missing".into()),
    });
    driver.until("the problem", |m, _| {
        m.notice.as_deref() == Some("This conversation no longer exists.")
    });
}
