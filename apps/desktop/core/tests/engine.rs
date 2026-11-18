//! The engine against a fake web host: sign-in, streams, paging, sending and
//! approvals, end to end over real HTTP on loopback. No model calls.

mod support;

use std::sync::Arc;

use raphie_core::attachments::{FileBytes, Preview, TOO_LARGE, Upload};
use raphie_core::auth::{AccessToken, MemoryStore, Secret, TokenStore};
use raphie_core::channels::{Channel, ChannelChange, DiscordUpdate, telegram_summary};
use raphie_core::contracts::{ApprovalMode, ModelSelection, NewBot, TraceState};
use raphie_core::contracts::{
    ApprovalStatus, ControlAction, Decision, MemoryProvider, Reflection, SandboxProvider, Scope,
    UpdateBotProfile, WorkspaceKind,
};
use raphie_core::engine::{Command, ConnectionChange, EngineConfig};
use raphie_core::inspection::{pretty_json, span_matches};
use raphie_core::jobs::{JobAction, NewJob, job_badge, job_interval, run_description};
use raphie_core::mcp::{McpAction, NewMcpConnection, summary};
use raphie_core::memory::{KeyChange, MemoryUpdate};
use raphie_core::model::{AuthState, DecisionOutcome, Event, Reach, StreamStatus};
use raphie_core::sandbox::{SandboxUpdate, files_summary};
use raphie_core::updates::UpdateStatus;
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
fn a_stopped_runtime_is_noticed_and_so_is_its_return() {
    let host = FakeHost::start();
    let store = MemoryStore::new();
    let config = EngineConfig {
        reach_every: std::time::Duration::from_millis(20),
        ..support::fast_config()
    };
    let mut driver = Driver::with_config(Arc::new(store), config);
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("signed in", |m, _| m.auth == AuthState::SignedIn);
    assert!(driver.model.reach.is_up());

    host.with(|h| h.runtime_down = true);
    driver.until(
        "the runtime reported down",
        |m, _| matches!(&m.reach, Reach::RuntimeDown(message) if message.contains("unavailable")),
    );
    // Still signed in: the token is kept for when Raphie is back.
    assert_eq!(driver.model.auth, AuthState::SignedIn);

    host.with(|h| h.runtime_down = false);
    driver.until("the runtime reported back", |m, _| m.reach.is_up());
    // Each check asks with the device's token.
    for seen in host.requests("/api/runtime") {
        assert_eq!(
            seen.authorization.as_deref(),
            Some(&*format!("Bearer {TOKEN}"))
        );
    }
}

#[test]
fn the_signed_in_raphies_version_is_learned_and_relearned_after_a_stop() {
    let host = FakeHost::start();
    let store = MemoryStore::new();
    let config = EngineConfig {
        reach_every: std::time::Duration::from_millis(20),
        ..support::fast_config()
    };
    let mut driver = Driver::with_config(Arc::new(store), config);
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("the version", |m, _| m.host_version.is_some());
    assert_eq!(driver.model.host_version.as_deref(), Some("v0.0.4"));
    assert_eq!(
        host.requests("/_raphie/version")[0]
            .authorization
            .as_deref(),
        Some(&*format!("Bearer {TOKEN}"))
    );

    // Stopped, updated, started again: the new version shows.
    host.with(|h| h.runtime_down = true);
    driver.until("the runtime reported down", |m, _| !m.reach.is_up());
    host.with(|h| {
        h.version = Some("v0.0.5".into());
        h.runtime_down = false;
    });
    driver.until("the new version", |m, _| {
        m.host_version.as_deref() == Some("v0.0.5")
    });
}

#[test]
fn checking_for_updates_asks_the_signed_in_raphie_again() {
    let host = FakeHost::start();
    let (mut driver, _store) = signed_in(&host);
    driver.until("the version", |m, _| m.host_version.is_some());
    host.with(|h| h.version = Some("v0.0.5".into()));
    driver.send(Command::CheckForUpdates);
    driver.until("the new version", |m, _| {
        m.host_version.as_deref() == Some("v0.0.5")
    });
}

#[test]
fn checking_now_answers_even_when_nothing_changed() {
    let host = FakeHost::start();
    let (mut driver, _store) = signed_in(&host);
    host.with(|h| h.runtime_down = true);
    driver.model.checking_reach = true;
    driver.send(Command::CheckReach);
    driver.until("the check's answer", |m, _| !m.checking_reach);
    assert!(matches!(driver.model.reach, Reach::RuntimeDown(_)));
}

#[test]
fn a_revoked_token_found_by_a_check_signs_out() {
    let host = FakeHost::start();
    let (mut driver, _store) = signed_in(&host);
    host.with(|h| h.revoked = true);
    driver.send(Command::CheckReach);
    driver.until("signed out", |m, _| {
        matches!(m.auth, AuthState::SignedOut { notice: Some(_) })
    });
}

#[test]
fn changing_address_keeps_this_address_signed_in_for_later() {
    let host = FakeHost::start();
    let (mut driver, store) = signed_in(&host);
    driver.send(Command::ChangeAddress);
    driver.until("the sign-in screen", |m, _| {
        m.auth == AuthState::SignedOut { notice: None }
    });
    // The address stays in the field, and its token in the Keychain.
    assert_eq!(driver.model.origin.as_ref(), Some(&host.origin));
    assert_eq!(store.load(&host.origin).unwrap().unwrap().expose(), TOKEN);

    // Connecting to it again needs no new device code.
    let codes = host.requests("/api/auth/device/code").len();
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("signed in again", |m, _| m.auth == AuthState::SignedIn);
    assert_eq!(host.requests("/api/auth/device/code").len(), codes);
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
        attachments: Vec::new(),
        model: None,
        approval_mode: None,
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
fn a_bots_models_load_and_the_default_can_be_changed() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    driver.send(Command::LoadSettings {
        bot_id: "b-research".into(),
    });
    driver.until("the models", |m, _| m.settings.contains_key("b-research"));
    let settings = &driver.model.settings["b-research"];
    assert_eq!(
        (settings.model_id.as_str(), settings.models.len()),
        ("fast", 2)
    );
    assert_eq!(settings.models[0].pricing.unwrap().output, 15.0);
    // A named bot's settings live under its own route.
    assert_eq!(host.requests("/api/bots/b-research/settings").len(), 1);

    assert!(driver.model.begin_set_model());
    driver.send(Command::SetDefaultModel {
        bot_id: "b-research".into(),
        model_id: "deep".into(),
        connection_id: "c-main".into(),
    });
    driver.until("the new default", |m, _| !m.setting_model);
    assert_eq!(driver.model.settings["b-research"].model_id, "deep");
    assert_eq!(
        driver.model.model_message.as_deref(),
        Some("Anthropic: Deep is now the default for new sessions.")
    );
    let changes = host.requests("/api/bots/b-research/settings");
    assert_eq!(
        changes.last().unwrap().client_marker.as_deref(),
        Some("web")
    );
}

#[test]
fn connections_are_added_edited_tested_and_removed() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    let change = |driver: &mut Driver, change: ConnectionChange| {
        assert!(driver.model.begin_change_connection());
        driver.send(Command::ChangeConnection {
            bot_id: "default".into(),
            change,
        });
        driver.until("the change", |m, _| !m.changing_connection);
        driver.model.connection_message.clone().unwrap_or_default()
    };
    let key = || Secret::new("sk-test-key");

    // A key not saved yet is tried through the provider test route.
    let said = change(
        &mut driver,
        ConnectionChange::Test {
            id: None,
            key: Some(key()),
        },
    );
    assert_eq!(said, "Connection successful.");

    let said = change(
        &mut driver,
        ConnectionChange::Add {
            provider: "openrouter".into(),
            name: "Work".into(),
            key: key(),
        },
    );
    assert_eq!(said, "Connection added.");
    let names = |driver: &Driver| -> Vec<String> {
        driver.model.settings["default"]
            .connections
            .iter()
            .map(|c| c.name.clone())
            .collect()
    };
    assert_eq!(names(&driver), ["Main", "Work"]);

    // Renaming without a key leaves the key out of the request.
    change(
        &mut driver,
        ConnectionChange::Edit {
            id: "c-2".into(),
            name: "Office".into(),
            key: None,
        },
    );
    assert_eq!(names(&driver), ["Main", "Office"]);

    host.with(|h| h.reject_key = true);
    let said = change(
        &mut driver,
        ConnectionChange::Test {
            id: Some("c-2".into()),
            key: None,
        },
    );
    assert!(said.contains("rejected"), "{said}");

    let said = change(
        &mut driver,
        ConnectionChange::Remove {
            id: "c-2".into(),
            name: "Office".into(),
        },
    );
    assert_eq!(said, "Office removed. Other connections are unchanged.");
    assert_eq!(names(&driver), ["Main"]);

    let requests = host.with(|h| h.connection_requests.clone());
    let tails: Vec<&str> = requests.iter().map(|(tail, _)| tail.as_str()).collect();
    assert_eq!(
        tails,
        [
            "provider/test",
            "connections",
            "connections/c-2",
            "connections/c-2/test",
            "connections/c-2/remove"
        ]
    );
    assert_eq!(requests[1].1["apiKey"], "sk-test-key");
    assert!(
        requests[2].1.get("apiKey").is_none(),
        "no key: keep the saved one"
    );
    assert_eq!(requests[4].1, serde_json::json!({}));
    // The key never appears when a command is printed.
    let printed = format!(
        "{:?}",
        Command::ChangeConnection {
            bot_id: "default".into(),
            change: ConnectionChange::Test {
                id: None,
                key: Some(key()),
            },
        }
    );
    assert!(!printed.contains("sk-test-key"), "{printed}");
}

#[test]
fn memory_settings_load_save_and_test() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    driver.send(Command::LoadMemory {
        bot_id: "default".into(),
    });
    driver.until("memory settings", |m, _| m.memory.contains_key("default"));
    let loaded = &driver.model.memory["default"];
    assert_eq!(loaded.configuration.provider, MemoryProvider::Builtin);
    assert_eq!(loaded.capabilities.reflect, Reflection::ModelAssisted);
    assert!(loaded.capabilities.revise);

    let hindsight = |key: KeyChange| MemoryUpdate {
        enabled: true,
        provider: MemoryProvider::Hindsight,
        scope: "owner".into(),
        endpoint: "http://127.0.0.1:8888/".into(),
        bank_id: "raphie".into(),
        key,
    };
    let save = |driver: &mut Driver, update: MemoryUpdate| {
        assert!(driver.model.begin_save_memory());
        driver.send(Command::SaveMemory {
            bot_id: "default".into(),
            update,
        });
        driver.until("the save", |m, _| !m.saving_memory);
    };

    // A typed key is sent once; the answer only says that one is held.
    save(
        &mut driver,
        hindsight(KeyChange::Replace(Secret::new("hs-test-key"))),
    );
    let saved = driver.model.memory["default"].clone();
    assert!(saved.configuration.has_credential);
    assert_eq!(saved.configuration.endpoint, "http://127.0.0.1:8888");
    assert_eq!(saved.capabilities.reflect, Reflection::Provider);
    assert!(!saved.capabilities.revise);
    assert_eq!(
        driver.model.memory_message.as_deref(),
        Some("Memory settings saved.")
    );

    // Keeping the key leaves the field out; clearing it sends null.
    save(&mut driver, hindsight(KeyChange::Keep));
    assert!(driver.model.memory["default"].configuration.has_credential);
    save(&mut driver, hindsight(KeyChange::Clear));
    assert!(!driver.model.memory["default"].configuration.has_credential);
    host.with(|h| {
        assert_eq!(h.memory_saves[0]["apiKey"], "hs-test-key");
        assert!(h.memory_saves[1].get("apiKey").is_none());
        assert!(h.memory_saves[2]["apiKey"].is_null());
        assert!(h.memory_saves[2].get("apiKey").is_some());
    });

    // What the runtime refuses is reported and leaves the settings alone.
    save(
        &mut driver,
        MemoryUpdate {
            endpoint: "not a url".into(),
            ..hindsight(KeyChange::Keep)
        },
    );
    let error = driver.model.memory_save_error.clone().unwrap_or_default();
    assert!(error.contains("valid Hindsight endpoint"), "{error}");
    assert_eq!(
        driver.model.memory["default"].configuration.endpoint,
        "http://127.0.0.1:8888"
    );

    let test = |driver: &mut Driver| {
        assert!(driver.model.begin_test_memory());
        driver.send(Command::TestMemory {
            bot_id: "default".into(),
        });
        driver.until("the test", |m, _| !m.testing_memory);
        driver.model.memory_message.clone().unwrap_or_default()
    };
    assert_eq!(test(&mut driver), "Connection successful.");
    host.with(|h| h.memory_unreachable = true);
    let said = test(&mut driver);
    assert!(said.contains("did not answer"), "{said}");
}

#[test]
fn a_bot_is_created_its_history_read_and_it_is_deleted_only_as_confirmed() {
    let host = FakeHost::start();
    host.with(|h| h.profile_revision = 3);
    let (mut driver, _) = signed_in(&host);
    let names = |driver: &Driver| -> Vec<String> {
        driver
            .model
            .bots
            .iter()
            .map(|bot| bot.name.clone())
            .collect()
    };
    assert_eq!(names(&driver), ["Raphie", "Research"]);

    // Saved versions come newest first, each with what it said.
    driver.send(Command::LoadBotHistory {
        bot_id: "b-research".into(),
    });
    driver.until("the history", |m, _| {
        m.bot_history.contains_key("b-research")
    });
    let history = driver.model.bot_history["b-research"].clone();
    let revisions: Vec<u32> = history.iter().map(|item| item.revision).collect();
    assert_eq!(revisions, [3, 2, 1]);
    assert_eq!(history[0].soul, "Be brief. (revision 3)");
    assert!(history[0].updated_at > history[2].updated_at);

    let create = |driver: &mut Driver, name: &str| {
        assert!(driver.model.begin_create_bot());
        driver.send(Command::CreateBot {
            bot: NewBot {
                name: name.into(),
                description: "Plans trips".into(),
                soul: "Be practical.".into(),
                color: None,
            },
        });
        driver.until("the create", |m, _| !m.creating_bot);
    };
    // What the runtime refuses is reported and creates nothing.
    create(&mut driver, "Research");
    let error = driver.model.profile_error.clone().unwrap_or_default();
    assert!(error.contains("already exists"), "{error}");
    assert_eq!(names(&driver), ["Raphie", "Research"]);

    create(&mut driver, "Travel");
    assert_eq!(names(&driver), ["Raphie", "Research", "Travel"]);
    let created = driver.model.bots[2].clone();
    assert_eq!((created.id.as_str(), created.revision), ("b-new-1", 1));

    let delete = |driver: &mut Driver, id: &str, name: &str, revision: u32| {
        assert!(driver.model.begin_delete_bot());
        driver.send(Command::DeleteBot {
            bot_id: id.into(),
            name: name.into(),
            revision,
        });
        driver.until("the delete", |m, _| !m.deleting_bot);
    };
    // A confirmation for an older revision deletes nothing.
    delete(&mut driver, "b-research", "Research", 2);
    let error = driver.model.delete_bot_error.clone().unwrap_or_default();
    assert!(error.contains("changed"), "{error}");
    assert_eq!(names(&driver).len(), 3);
    // The default bot stays, whatever is confirmed.
    delete(&mut driver, "default", "Raphie", 1);
    assert!(driver.model.delete_bot_error.is_some());

    delete(&mut driver, "b-research", "Research", 3);
    assert_eq!(names(&driver), ["Raphie", "Travel"]);
    assert_eq!(driver.model.delete_bot_error, None);
    assert!(!driver.model.bot_history.contains_key("b-research"));
    host.with(|h| {
        let (id, body) = h.bot_deletes.last().unwrap();
        assert_eq!(id, "b-research");
        assert_eq!(
            *body,
            serde_json::json!({ "name": "Research", "revision": 3 })
        );
    });
}

#[test]
fn traces_activity_telemetry_and_exports() {
    let host = FakeHost::start();
    host.with(|h| {
        h.spans = vec![serde_json::json!({
            "traceId": "4bf92f3577b34da6", "spanId": "00f067aa", "parentSpanId": null,
            "name": "model.call", "startedAt": 1_700_000_000_000_i64, "durationMs": 812.4,
            "status": "ok", "attributes": { "session.id": "s-1", "tokens": 42 },
        })];
        h.activity = vec![serde_json::json!({
            "id": 7, "at": 1_700_000_000_000_i64, "attemptId": "a-1", "conversationId": 3,
            "runId": "run-7", "operationId": null, "pluginId": null,
            "type": "model.completed", "summary": "model completed",
            "detailsJson": "{\"stopReason\":\"stop\"}",
        })];
    });
    // Exports go to a folder of this test's own, never the real one.
    let folder = std::env::temp_dir().join(format!("raphie-engine-exports-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let config = EngineConfig {
        downloads: Some(folder.clone()),
        ..support::fast_config()
    };
    let mut driver = Driver::with_config(Arc::new(MemoryStore::new()), config);
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("the session list", |m, _| !m.sessions.is_empty());
    let bot_id = || "default".to_owned();

    let load_traces = |driver: &mut Driver, hours: u8| {
        driver.model.traces.open("default", hours);
        driver.send(Command::LoadTraces {
            bot_id: "default".into(),
            hours,
        });
        driver.until("the traces", |m, _| !m.traces.loading);
    };
    load_traces(&mut driver, 6);
    let data = driver.model.traces.data.clone().unwrap();
    assert_eq!(data.state, TraceState::Ready);
    assert_eq!(data.spans[0].name, "model.call");
    assert!(span_matches(&data.spans[0], None, "s-1"));
    host.with(|h| {
        let asked = h.requests.iter().any(|seen| seen.path.ends_with("hours=6"));
        assert!(asked, "the window is part of the request");
    });
    // A backend that is down keeps the traces and marks them unavailable.
    host.with(|h| h.traces_down = true);
    load_traces(&mut driver, 6);
    assert!(driver.model.traces.failed && driver.model.traces.data.is_some());
    host.with(|h| h.traces_down = false);

    driver.send(Command::LoadBotActivity { bot_id: bot_id() });
    driver.until("the activity", |m, _| m.activity.contains_key("default"));
    let event = driver.model.activity["default"][0].clone();
    assert_eq!(event.kind, "model.completed");
    assert_eq!(
        pretty_json(&event.details_json),
        "{\n  \"stopReason\": \"stop\"\n}"
    );

    // The telemetry switch is a setting of the runtime.
    driver.send(Command::LoadSettings { bot_id: bot_id() });
    driver.until("the settings", |m, _| m.settings.contains_key("default"));
    assert!(driver.model.settings["default"].telemetry_enabled);
    assert!(driver.model.begin_set_telemetry());
    driver.send(Command::SetTelemetry {
        bot_id: bot_id(),
        enabled: false,
    });
    driver.until("the switch", |m, _| !m.setting_telemetry);
    assert!(!driver.model.settings["default"].telemetry_enabled);
    load_traces(&mut driver, 6);
    assert!(!driver.model.traces.data.as_ref().unwrap().export_enabled);

    // An export is written beside any file already there, never over it.
    let export = |driver: &mut Driver| {
        assert!(driver.model.begin_export());
        driver.send(Command::SaveExport {
            name: "raphie-traces-1.json".into(),
            contents: "{\"spans\":[]}".into(),
        });
        driver.until("the export", |m, _| !m.exporting);
        driver.model.export_saved.clone().unwrap_or_default()
    };
    assert_eq!(export(&mut driver), "raphie-traces-1.json");
    assert_eq!(export(&mut driver), "raphie-traces-1 (1).json");
    assert_eq!(
        std::fs::read_to_string(folder.join("raphie-traces-1.json")).unwrap(),
        "{\"spans\":[]}"
    );
    std::fs::remove_dir_all(&folder).unwrap();
}

#[test]
fn jobs_are_scheduled_run_paused_and_their_runs_paged() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    let bot_id = || "default".to_owned();
    driver.send(Command::LoadJobs { bot_id: bot_id() });
    driver.until("the jobs", |m, _| m.jobs.contains_key("default"));
    assert!(driver.model.jobs["default"].is_empty());

    let add = |driver: &mut Driver, job: NewJob| {
        assert!(driver.model.begin_change_job());
        driver.send(Command::AddJob {
            bot_id: "default".into(),
            job,
        });
        driver.until("the add", |m, _| !m.changing_job);
    };
    let job = |name: &str, every_minutes: Option<u32>, first_run_at: i64| NewJob {
        name: name.into(),
        prompt: "Summarise the open tasks.".into(),
        every_minutes,
        first_run_at,
    };
    // What the runtime refuses is reported and schedules nothing.
    add(&mut driver, job("Past", Some(60), 5));
    let error = driver.model.job_error.clone().unwrap_or_default();
    assert!(error.contains("in the future"), "{error}");
    assert!(driver.model.jobs["default"].is_empty());

    add(
        &mut driver,
        job("Morning brief", Some(60), 1_800_000_000_000),
    );
    add(&mut driver, job("Reminder", None, 1_800_000_000_000));
    let jobs = driver.model.jobs["default"].clone();
    assert_eq!(job_interval(&jobs[0]), "Every 60 minutes");
    assert_eq!(job_interval(&jobs[1]), "One-time reminder");
    assert_eq!(job_badge(&jobs[0]), "Active");
    let said = driver.model.job_message.clone().unwrap_or_default();
    assert!(said.starts_with("Job scheduled."), "{said}");
    // "Run once" is sent as null, not left out.
    host.with(|h| {
        let once = h.job_adds.last().unwrap();
        assert!(
            once.get("everyMinutes")
                .is_some_and(serde_json::Value::is_null)
        );
    });

    let change = |driver: &mut Driver, id: &str, action: JobAction| {
        assert!(driver.model.begin_change_job());
        driver.send(Command::ChangeJob {
            bot_id: "default".into(),
            id: id.into(),
            action,
        });
        driver.until("the change", |m, _| !m.changing_job);
    };
    change(&mut driver, "job-1", JobAction::Disable);
    assert_eq!(job_badge(&driver.model.jobs["default"][0]), "Paused");
    assert_eq!(driver.model.job_message, None, "pausing says nothing");
    // Three runs of the first job and one of the second.
    for id in ["job-1", "job-1", "job-2", "job-1"] {
        change(&mut driver, id, JobAction::Run);
    }
    let said = driver.model.job_message.clone().unwrap_or_default();
    assert!(said.starts_with("Run queued."), "{said}");

    let load = |driver: &mut Driver, job_id: Option<&str>, before: Option<String>| {
        let older = before.is_some();
        let ticket = driver.model.runs.begin_load(older);
        driver.send(Command::LoadJobRuns {
            bot_id: "default".into(),
            job_id: job_id.map(str::to_owned),
            before,
            ticket,
        });
        driver.until("the runs", |m, _| !m.runs.loading && !m.runs.loading_older);
    };
    let ids = |driver: &Driver| -> Vec<String> {
        let runs = driver.model.runs.runs.clone().unwrap_or_default();
        runs.into_iter().map(|run| run.id).collect()
    };
    // Every job's runs, newest first, then the page after the cursor.
    load(&mut driver, None, None);
    assert_eq!(ids(&driver), ["run-4", "run-3"]);
    let before = driver.model.runs.next.clone();
    load(&mut driver, None, before);
    assert_eq!(ids(&driver), ["run-4", "run-3", "run-2", "run-1"]);
    assert_eq!(driver.model.runs.next, None);

    // One job's runs only.
    driver.model.runs.show(Some("job-2".into()));
    load(&mut driver, Some("job-2"), None);
    assert_eq!(ids(&driver), ["run-3"]);
    let run = driver.model.runs.runs.clone().unwrap()[0].clone();
    assert_eq!(run_description(&run), "Waiting for prompt admission.");

    change(&mut driver, "job-2", JobAction::Remove);
    assert_eq!(driver.model.jobs["default"].len(), 1);
}

#[test]
fn workspace_folders_are_listed_and_a_file_is_saved_without_replacing_one() {
    let host = FakeHost::start();
    host.with(|h| {
        h.workspace_revision = 7;
        h.workspace = vec![
            ("/workspace/README.md".into(), b"# Notes".to_vec()),
            (
                "/workspace/reports/q3 summary.csv".into(),
                b"a,b\n1,2\n".to_vec(),
            ),
        ];
    });
    // Downloads go to a folder of this test's own, never the real one.
    let folder =
        std::env::temp_dir().join(format!("raphie-engine-downloads-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let config = EngineConfig {
        downloads: Some(folder.clone()),
        ..support::fast_config()
    };
    let mut driver = Driver::with_config(Arc::new(MemoryStore::new()), config);
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("the session list", |m, _| !m.sessions.is_empty());

    let open = |driver: &mut Driver, path: &str| {
        driver.model.files.open("default", path);
        driver.send(Command::LoadWorkspaceFiles {
            bot_id: "default".into(),
            path: path.into(),
        });
        driver.until("the listing", |m, _| !m.files.loading);
    };
    open(&mut driver, "/workspace");
    let listing = driver.model.files.listing.clone().unwrap();
    assert_eq!(listing.revision, 7);
    let kinds: Vec<_> = listing
        .items
        .iter()
        .map(|item| (item.name.as_str(), item.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            ("README.md", WorkspaceKind::File),
            ("reports", WorkspaceKind::Directory)
        ]
    );

    // A folder with a space in a file's name: the path is escaped on the way.
    open(&mut driver, "/workspace/reports");
    let listing = driver.model.files.listing.clone().unwrap();
    let file = listing.items[0].clone();
    assert_eq!(file.name, "q3 summary.csv");

    let download = |driver: &mut Driver, revision: u64| {
        assert!(driver.model.files.begin_download(&file.path));
        driver.send(Command::DownloadWorkspaceFile {
            bot_id: "default".into(),
            path: file.path.clone(),
            name: file.name.clone(),
            revision,
        });
        driver.until("the download", |m, _| m.files.downloading.is_none());
    };
    download(&mut driver, 7);
    assert_eq!(driver.model.files.saved.as_deref(), Some("q3 summary.csv"));
    assert_eq!(
        std::fs::read(folder.join("q3 summary.csv")).unwrap(),
        b"a,b\n1,2\n"
    );
    // A second download keeps the first file and takes another name.
    download(&mut driver, 7);
    assert_eq!(
        driver.model.files.saved.as_deref(),
        Some("q3 summary (1).csv")
    );

    // A listing that is out of date is refused, and nothing is written.
    download(&mut driver, 6);
    let error = driver
        .model
        .files
        .download_error
        .clone()
        .unwrap_or_default();
    assert!(error.contains("workspace changed"), "{error}");
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 2);

    // A folder that is gone is reported, not shown as empty.
    open(&mut driver, "/workspace/missing");
    let error = driver.model.files.error.clone().unwrap_or_default();
    assert!(error.contains("not found"), "{error}");
    std::fs::remove_dir_all(&folder).unwrap();
}

#[test]
fn sandbox_settings_load_save_and_notice_a_change_elsewhere() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    driver.send(Command::LoadSandbox {
        bot_id: "default".into(),
    });
    driver.until("the sandbox", |m, _| m.sandbox.contains_key("default"));
    let info = driver.model.sandbox["default"].clone();
    assert_eq!(info.settings.provider, SandboxProvider::JustBash);
    assert_eq!(info.settings.disk_quota_mib, None);
    assert_eq!(
        files_summary(&info),
        "1.5 KiB used of 100.0 MiB · 12 of 10,000 checkpoint entries"
    );

    let save = |driver: &mut Driver, update: SandboxUpdate| {
        assert!(driver.model.begin_save_sandbox());
        driver.send(Command::SaveSandbox {
            bot_id: "default".into(),
            update,
        });
        driver.until("the save", |m, _| !m.saving_sandbox);
    };
    let container = |acknowledged: bool, revision: u64| SandboxUpdate {
        provider: SandboxProvider::Container,
        host_network_acknowledged: acknowledged,
        idle_minutes: 45,
        disk_quota_mib: Some(2048),
        revision,
    };

    // What the runtime refuses is reported and leaves the settings alone.
    save(&mut driver, container(false, 1));
    let error = driver.model.sandbox_save_error.clone().unwrap_or_default();
    assert!(error.contains("Acknowledge host"), "{error}");
    assert_eq!(driver.model.sandbox["default"].settings.revision, 1);

    save(&mut driver, container(true, 1));
    let saved = driver.model.sandbox["default"].settings.clone();
    assert_eq!(saved.provider, SandboxProvider::Container);
    assert_eq!((saved.idle_minutes, saved.disk_quota_mib), (45, Some(2048)));
    assert_eq!(saved.revision, 2);
    assert_eq!(
        driver.model.sandbox_message.as_deref(),
        Some("Saved revision 2.")
    );
    host.with(|h| {
        let body = h.sandbox_saves.last().unwrap();
        assert_eq!(body["provider"], "container");
        assert_eq!(body["diskQuotaMiB"], 2048);
    });

    // "No limit" is sent as null, not left out.
    save(
        &mut driver,
        SandboxUpdate {
            disk_quota_mib: None,
            ..container(true, 2)
        },
    );
    host.with(|h| {
        let body = h.sandbox_saves.last().unwrap();
        assert!(
            body.get("diskQuotaMiB")
                .is_some_and(serde_json::Value::is_null)
        );
    });

    // A save from an old revision conflicts, and the settings are read
    // again so the form can show what changed.
    host.with(|h| {
        if let Some(settings) = h.sandbox.as_mut() {
            settings["revision"] = serde_json::json!(9);
            settings["idleMinutes"] = serde_json::json!(5);
        }
    });
    save(&mut driver, container(true, 3));
    let error = driver.model.sandbox_save_error.clone().unwrap_or_default();
    assert!(error.contains("changed elsewhere"), "{error}");
    driver.until("the reload", |m, _| {
        m.sandbox["default"].settings.revision == 9
    });
    assert_eq!(driver.model.sandbox["default"].settings.idle_minutes, 5);
}

#[test]
fn channels_connect_pair_and_choose_a_home() {
    let host = FakeHost::start();
    host.with(|h| {
        h.home_destinations = vec![serde_json::json!({
            "id": "telegram:42", "platform": "telegram",
            "conversationId": "telegram:42", "userId": "42",
        })];
    });
    let (mut driver, _) = signed_in(&host);
    let bot_id = || "default".to_owned();
    driver.send(Command::LoadChannels { bot_id: bot_id() });
    driver.send(Command::LoadChannelHome { bot_id: bot_id() });
    driver.until("the channels", |m, _| {
        m.channels.contains_key("default") && m.channel_home.contains_key("default")
    });
    assert_eq!(driver.model.channels["default"].discord, None);
    assert_eq!(driver.model.channel_home["default"].selected, None);

    let change = |driver: &mut Driver, change: ChannelChange| {
        assert!(
            driver
                .model
                .begin_change_channel(change.outcome().channel())
        );
        driver.send(Command::ChangeChannel {
            bot_id: "default".into(),
            change,
        });
        driver.until("the change", |m, _| !m.changing_channel);
    };
    let discord = |token: Option<&str>| {
        ChannelChange::SaveDiscord(DiscordUpdate {
            token: token.map(Secret::new),
            allowed_user_ids: vec!["1001".into(), "1002".into()],
            channel_id: String::new(),
        })
    };

    // What the runtime refuses is reported under Discord and saves nothing.
    change(&mut driver, discord(None));
    let error = driver.model.channel_errors[&Channel::Discord].clone();
    assert!(error.contains("Discord bot token"), "{error}");
    assert_eq!(driver.model.channels["default"].discord, None);

    // The token is sent once; the settings never carry it back.
    change(&mut driver, discord(Some("discord-test-token")));
    let saved = driver.model.channels["default"].discord.clone().unwrap();
    assert!(saved.connected);
    assert_eq!(saved.allowed_user_ids, ["1001", "1002"]);
    assert_eq!(
        driver.model.channel_messages[&Channel::Discord],
        "Discord settings saved."
    );
    assert!(!driver.model.channel_errors.contains_key(&Channel::Discord));
    // Keeping the token leaves the field out.
    change(&mut driver, discord(None));
    host.with(|h| {
        assert_eq!(h.channel_requests[1].1["botToken"], "discord-test-token");
        assert!(h.channel_requests[2].1.get("botToken").is_none());
    });
    let printed = format!("{:?}", driver.model.channels);
    assert!(!printed.contains("discord-test-token"), "{printed}");

    // Telegram: connect, pair, revoke, pause.
    change(
        &mut driver,
        ChannelChange::SaveTelegram(Secret::new("123456:telegram-test-token-xxxx")),
    );
    let telegram = driver.model.channels["default"].telegram.clone().unwrap();
    assert_eq!(
        telegram_summary(Some(&telegram)),
        "Connected as @raphie_test_bot · 1 verified account"
    );
    assert!(driver.model.live_pairing("default").is_none());
    change(&mut driver, ChannelChange::PairTelegram);
    let code = driver.model.live_pairing("default").cloned().unwrap();
    assert_eq!(code.code, "K7Q2-M9XD");
    change(&mut driver, ChannelChange::UnpairTelegram("42".into()));
    let telegram = driver.model.channels["default"].telegram.clone().unwrap();
    assert!(telegram.verified_user_ids.is_empty());
    change(&mut driver, ChannelChange::EnableTelegram(false));
    assert_eq!(
        driver.model.channel_messages[&Channel::Telegram],
        "Telegram disabled."
    );
    host.with(|h| {
        let (path, body) = h.channel_requests.last().unwrap();
        assert_eq!(path, "telegram");
        assert_eq!(*body, serde_json::json!({ "enabled": false }));
    });

    // The home channel is chosen by id, and web only is `null`.
    change(
        &mut driver,
        ChannelChange::SelectHome(Some("telegram:42".into())),
    );
    assert_eq!(
        driver.model.channel_home["default"].selected.as_deref(),
        Some("telegram:42")
    );
    change(&mut driver, ChannelChange::SelectHome(None));
    assert_eq!(driver.model.channel_home["default"].selected, None);
    host.with(|h| assert!(h.channel_requests.last().unwrap().1["id"].is_null()));

    // Removing Telegram also drops the pairing code that was out.
    change(&mut driver, ChannelChange::RemoveTelegram);
    assert_eq!(driver.model.channels["default"].telegram, None);
    assert!(driver.model.telegram_pairing.is_none());
    change(&mut driver, ChannelChange::RemoveDiscord);
    assert_eq!(driver.model.channels["default"].discord, None);
}

#[test]
fn mcp_connections_are_listed_added_and_changed() {
    let host = FakeHost::start();
    host.with(|h| {
        h.mcp = vec![serde_json::json!({
            "source": "environment", "id": "env-1", "name": "Host tools",
            "transport": "stdio", "address": "npx", "enabled": true,
            "connected": true, "toolCount": 5, "credentialConfigured": false,
        })];
    });
    let (mut driver, _) = signed_in(&host);
    let bot_id = || "default".to_owned();
    driver.send(Command::LoadMcp { bot_id: bot_id() });
    driver.until("the connections", |m, _| m.mcp.contains_key("default"));
    let listed = &driver.model.mcp["default"];
    assert!(listed[0].from_environment);
    assert_eq!(summary(&listed[0]), "5 tools · Local command · npx");

    let add = |driver: &mut Driver, connection: NewMcpConnection| {
        assert!(driver.model.begin_change_mcp());
        driver.send(Command::AddMcp {
            bot_id: "default".into(),
            connection,
        });
        driver.until("the add", |m, _| !m.changing_mcp);
    };
    // A URL server without a token waits for the owner to authorize it.
    add(
        &mut driver,
        NewMcpConnection::Http {
            name: "Project tools".into(),
            url: "https://tools.example.com/mcp".into(),
            token: None,
        },
    );
    let added = &driver.model.mcp["default"][1];
    assert!(added.authorization_url.is_some());
    assert!(summary(added).starts_with("Authorization required · Streamable HTTP"));
    let said = driver.model.mcp_message.clone().unwrap_or_default();
    assert!(said.contains("Choose Authorize"), "{said}");

    // A local command carries its arguments and environment once.
    add(
        &mut driver,
        NewMcpConnection::Stdio {
            name: "Local".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "a-server".into()],
            env: vec![("API_TOKEN".into(), Secret::new("mcp-test-token"))],
        },
    );
    host.with(|h| {
        assert!(h.mcp_adds[0].get("token").is_none());
        assert_eq!(h.mcp_adds[1]["transport"], "stdio");
        assert_eq!(h.mcp_adds[1]["args"][1], "a-server");
        assert_eq!(h.mcp_adds[1]["env"]["API_TOKEN"], "mcp-test-token");
    });
    let printed = format!("{:?}", driver.model.mcp["default"]);
    assert!(!printed.contains("mcp-test-token"), "{printed}");

    // What the runtime refuses is reported and adds nothing.
    add(
        &mut driver,
        NewMcpConnection::Http {
            name: "Broken".into(),
            url: "not a url".into(),
            token: Some(Secret::new("mcp-test-token")),
        },
    );
    let error = driver.model.mcp_change_error.clone().unwrap_or_default();
    assert!(error.contains("valid server URL"), "{error}");
    assert_eq!(driver.model.mcp["default"].len(), 3);

    let change = |driver: &mut Driver, id: &str, action: McpAction| {
        assert!(driver.model.begin_change_mcp());
        driver.send(Command::ChangeMcp {
            bot_id: "default".into(),
            id: id.into(),
            action,
        });
        driver.until("the change", |m, _| !m.changing_mcp);
    };
    change(&mut driver, "mcp-3", McpAction::Disable);
    assert!(summary(&driver.model.mcp["default"][2]).starts_with("Paused"));
    change(&mut driver, "env-1", McpAction::Import);
    assert!(!driver.model.mcp["default"][0].from_environment);
    change(&mut driver, "mcp-2", McpAction::Remove);
    assert_eq!(driver.model.mcp["default"].len(), 2);
}

#[test]
fn saved_memories_page_search_correct_and_forget() {
    let host = FakeHost::start();
    host.with(|h| {
        h.memories = vec![
            ("m-3".into(), "Prefers tea in the morning".into()),
            ("m-2".into(), "Works from Addis on Fridays".into()),
            ("m-1".into(), "Allergic to peanuts".into()),
        ];
    });
    let (mut driver, _) = signed_in(&host);
    let ids = |driver: &Driver| -> Vec<String> {
        let shown = driver.model.memories.evidence.clone().unwrap_or_default();
        shown.into_iter().map(|item| item.id).collect()
    };
    let bot_id = || "default".to_owned();

    // The first page, then the one after its cursor.
    let ticket = driver.model.memories.begin_load();
    driver.send(Command::BrowseMemory {
        bot_id: bot_id(),
        after: None,
        ticket,
    });
    driver.until("the first page", |m, _| !m.memories.loading);
    assert_eq!(ids(&driver), ["m-3", "m-2"]);
    assert_eq!(driver.model.memories.total, Some(3));
    let after = driver.model.memories.next.clone();
    assert!(after.is_some());
    let ticket = driver.model.memories.begin_load();
    driver.send(Command::BrowseMemory {
        bot_id: bot_id(),
        after,
        ticket,
    });
    driver.until("the second page", |m, _| !m.memories.loading);
    assert_eq!(ids(&driver), ["m-3", "m-2", "m-1"]);
    assert_eq!(driver.model.memories.next, None);

    // A search replaces the list with its matches.
    let ticket = driver.model.memories.begin_load();
    driver.send(Command::SearchMemory {
        bot_id: bot_id(),
        query: "peanuts".into(),
        ticket,
    });
    driver.until("the search", |m, _| !m.memories.loading);
    assert_eq!(ids(&driver), ["m-1"]);

    // A correction changes what the memory says, here and on the host.
    assert!(driver.model.memories.begin_change());
    driver.send(Command::ReviseMemory {
        bot_id: bot_id(),
        id: "m-1".into(),
        content: "Allergic to peanuts and cashews".into(),
    });
    driver.until("the correction", |m, _| !m.memories.changing);
    let corrected = &driver.model.memories.evidence.as_ref().unwrap()[0];
    assert_eq!(corrected.content, "Allergic to peanuts and cashews");
    assert_eq!(corrected.revision, 2);
    host.with(|h| assert_eq!(h.memories[2].1, "Allergic to peanuts and cashews"));

    // What the runtime refuses is reported and changes nothing.
    host.with(|h| h.memory_busy = true);
    assert!(driver.model.memories.begin_change());
    driver.send(Command::ForgetMemory {
        bot_id: bot_id(),
        id: "m-1".into(),
    });
    driver.until("the refusal", |m, _| !m.memories.changing);
    let error = driver.model.memories.error.clone().unwrap_or_default();
    assert!(error.contains("active turns"), "{error}");
    assert_eq!(ids(&driver), ["m-1"]);

    host.with(|h| h.memory_busy = false);
    assert!(driver.model.memories.begin_change());
    driver.send(Command::ForgetMemory {
        bot_id: bot_id(),
        id: "m-1".into(),
    });
    driver.until("the forget", |m, _| !m.memories.changing);
    assert!(ids(&driver).is_empty());
    host.with(|h| assert_eq!(h.memories.len(), 2));
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

#[test]
fn files_are_uploaded_sent_with_a_message_and_saved_back() {
    let host = FakeHost::start();
    // Files are read from and saved to a folder of this test's own.
    let folder =
        std::env::temp_dir().join(format!("raphie-engine-attachments-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let config = EngineConfig {
        downloads: Some(folder.clone()),
        ..support::fast_config()
    };
    let mut driver = Driver::with_config(Arc::new(MemoryStore::new()), config);
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("the session list", |m, _| !m.sessions.is_empty());
    let attach = |driver: &mut Driver, uploads: Vec<Upload>| {
        assert!(driver.model.attachments.begin("default", uploads.len()));
        driver.send(Command::Attach {
            bot_id: "default".into(),
            uploads,
        });
        driver.until("the uploads", |m, _| !m.attachments.uploading);
    };

    // A file on disk and a pasted image go up in the order chosen.
    let notes = folder.join("notes to send.md");
    std::fs::write(&notes, b"# Notes").unwrap();
    let pasted = FileBytes::from(vec![137, 80, 78, 71, 1, 2, 3]);
    attach(
        &mut driver,
        vec![
            Upload::File(notes),
            Upload::Bytes {
                name: "Pasted image.png".into(),
                bytes: pasted,
            },
        ],
    );
    let files = driver.model.attachments.files.clone();
    let names: Vec<_> = files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(names, ["notes to send.md", "Pasted image.png"]);
    assert_eq!(files[0].size, 7);
    assert_eq!(files[1].mime_type.as_deref(), Some("image/png"));
    host.with(|h| {
        assert_eq!(h.uploads[0].2, b"# Notes");
        assert!(
            h.requests
                .iter()
                .filter(|seen| seen.path == "/api/attachments")
                .all(|seen| seen.authorization.as_deref() == Some(&format!("Bearer {TOKEN}"))),
            "uploads carry the token"
        );
    });

    // One file over the limit refuses the whole choice before any upload.
    let too_large = FileBytes::from(vec![0; 8 * 1024 * 1024 + 1]);
    attach(
        &mut driver,
        vec![
            Upload::Bytes {
                name: "ok.txt".into(),
                bytes: FileBytes::from(b"ok".to_vec()),
            },
            Upload::Bytes {
                name: "huge.bin".into(),
                bytes: too_large,
            },
        ],
    );
    assert_eq!(driver.model.attachments.error.as_deref(), Some(TOO_LARGE));
    assert_eq!(driver.model.attachments.files.len(), 2);
    host.with(|h| assert_eq!(h.uploads.len(), 2));

    // A runtime that cannot take uploads says so, and the composer is freed.
    host.with(|h| h.uploads_down = true);
    attach(
        &mut driver,
        vec![Upload::Bytes {
            name: "later.txt".into(),
            bytes: FileBytes::from(b"later".to_vec()),
        }],
    );
    assert_eq!(
        driver.model.attachments.error.as_deref(),
        Some("Workspace uploads are unavailable.")
    );
    host.with(|h| h.uploads_down = false);

    // The message names the files by id, and they leave the composer.
    assert!(driver.model.begin_send());
    let ids = driver.model.attachments.take_for_send("default");
    assert_eq!(ids.len(), 2);
    driver.send(Command::Send {
        text: String::new(),
        attachments: ids.clone(),
        model: None,
        approval_mode: None,
    });
    driver.until("acceptance", |m, _| !m.sending);
    assert!(driver.model.attachments.files.is_empty());
    host.with(|h| {
        let sent = h.submits.last().unwrap();
        assert_eq!(sent["attachments"], serde_json::json!(ids));
    });

    // A message's file is saved to Downloads without replacing anything.
    assert!(driver.model.begin_save_attachment(&ids[0]));
    assert!(
        !driver.model.begin_save_attachment(&ids[1]),
        "one at a time"
    );
    driver.send(Command::DownloadAttachment {
        bot_id: "default".into(),
        id: ids[0].clone(),
        name: "notes to send.md".into(),
    });
    driver.until("the save", |m, _| m.saving_attachment.is_none());
    assert_eq!(
        driver.model.notice.as_deref(),
        Some("Saved to your Downloads folder as notes to send (1).md.")
    );
    assert_eq!(
        std::fs::read(folder.join("notes to send (1).md")).unwrap(),
        b"# Notes"
    );

    // A file the runtime no longer has says why.
    assert!(driver.model.begin_save_attachment("gone"));
    driver.send(Command::DownloadAttachment {
        bot_id: "default".into(),
        id: "gone".into(),
        name: "gone.txt".into(),
    });
    driver.until("the failure", |m, _| m.saving_attachment.is_none());
    assert_eq!(driver.model.notice.as_deref(), Some("File not found."));
    let _ = std::fs::remove_dir_all(&folder);
}

#[test]
fn a_session_is_archived_and_brought_back() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    let archived = serde_json::json!({
        "id": "s-9", "title": "Old plans", "origin": "web", "lastAt": 1,
        "working": false, "failed": false, "waiting": false, "preview": "",
        "turnCount": 1, "archivedAt": 2,
    });
    host.with(|h| h.archived_sessions = vec![archived]);

    // The archived list is fetched when asked for.
    assert_eq!(driver.model.archived, None);
    driver.send(Command::LoadArchived);
    driver.until("the archived list", |m, _| m.archived.is_some());
    let listed = driver.model.archived.clone().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].archived_at, Some(2));
    let seen = host.requests("/api/sessions");
    assert!(
        seen.iter()
            .any(|r| r.method == "GET" && r.path == "/api/sessions"),
        "{seen:?}"
    );

    // Archiving the open session keeps it open, marks it archived and
    // takes it out of the list.
    let listed_first = driver.model.sessions[0].id.clone();
    driver.model.select_session(Some(listed_first.clone()));
    driver.send(Command::SelectSession {
        session_id: Some(listed_first.clone()),
    });
    driver.until("the conversation", |m, _| {
        m.conversation
            .as_ref()
            .is_some_and(|open| open.observation.is_some())
    });
    assert!(!driver.model.open_archived());
    driver.send(Command::Archive {
        session_id: listed_first.clone(),
        archived: true,
    });
    driver.until("the archive", |m, _| m.open_archived());
    assert!(driver.model.session_list().all(|s| s.id != listed_first));
    host.with(|h| {
        let (path, body) = h.archives.last().unwrap();
        assert_eq!(path, &format!("/api/sessions/{listed_first}/archive"));
        assert_eq!(*body, serde_json::json!({ "archived": true }));
    });
    let archive = host.requests(&format!("/api/sessions/{listed_first}/archive"));
    assert_eq!(archive[0].method, "POST");
    assert_eq!(archive[0].client_marker.as_deref(), Some("web"));

    // Bringing it back sends `false`.
    driver.send(Command::Archive {
        session_id: listed_first.clone(),
        archived: false,
    });
    driver.until("the unarchive", |m, _| !m.open_archived());
    host.with(|h| {
        assert_eq!(
            h.archives.last().unwrap().1,
            serde_json::json!({ "archived": false })
        );
    });

    // An unknown session says why.
    driver.send(Command::Archive {
        session_id: "gone".into(),
        archived: true,
    });
    driver.until("the refusal", |m, _| m.notice.is_some());
    assert_eq!(driver.model.notice.as_deref(), Some("Session not found."));
}

#[test]
fn a_sessions_model_is_changed_and_a_new_session_starts_with_the_one_chosen() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    let pick = |model_id: &str| ModelSelection {
        provider: "openrouter-1".into(),
        model_id: model_id.into(),
    };

    // An open session: the change goes to its own route, and the session
    // carries the model once the runtime agrees.
    driver.model.select_session(Some("s-1".into()));
    driver.send(Command::SelectSession {
        session_id: Some("s-1".into()),
    });
    driver.until("the conversation", |m, _| {
        m.conversation
            .as_ref()
            .is_some_and(|open| open.observation.is_some())
    });
    assert_eq!(driver.model.session_model(), None);
    assert!(driver.model.begin_choose_model());
    assert!(!driver.model.begin_choose_model(), "one change at a time");
    driver.send(Command::ChooseModel {
        session_id: "s-1".into(),
        model: pick("anthropic/claude-x"),
    });
    driver.until("the change", |m, _| !m.choosing_model);
    assert_eq!(
        driver.model.session_model(),
        Some(&pick("anthropic/claude-x"))
    );
    host.with(|h| {
        let (path, body) = h.model_choices.last().unwrap();
        assert_eq!(path, "/api/sessions/s-1/model");
        assert_eq!(
            *body,
            serde_json::json!({ "provider": "openrouter-1", "modelId": "anthropic/claude-x" })
        );
    });

    // A refusal says why and leaves the model as it was.
    host.with(|h| h.model_unavailable = true);
    assert!(driver.model.begin_choose_model());
    driver.send(Command::ChooseModel {
        session_id: "s-1".into(),
        model: pick("gone"),
    });
    driver.until("the refusal", |m, _| !m.choosing_model);
    assert_eq!(
        driver.model.model_error.as_deref(),
        Some("That model is not available.")
    );
    assert_eq!(
        driver.model.session_model(),
        Some(&pick("anthropic/claude-x"))
    );

    // A message to an existing session never carries a model.
    assert!(driver.model.begin_send());
    driver.send(Command::Send {
        text: "Again".into(),
        attachments: Vec::new(),
        model: Some(pick("openai/gpt-x")),
        approval_mode: None,
    });
    driver.until("acceptance", |m, _| !m.sending);
    host.with(|h| assert!(h.submits.last().unwrap().get("model").is_none()));

    // A new session starts with the model chosen for it.
    driver.model.select_session(None);
    driver.send(Command::SelectSession { session_id: None });
    assert!(driver.model.begin_send());
    driver.send(Command::Send {
        text: "Hello".into(),
        attachments: Vec::new(),
        model: Some(pick("openai/gpt-x")),
        approval_mode: None,
    });
    driver.until("acceptance", |m, _| !m.sending);
    host.with(|h| {
        assert_eq!(
            h.submits.last().unwrap()["model"],
            serde_json::json!({ "provider": "openrouter-1", "modelId": "openai/gpt-x" })
        );
    });
}

#[test]
fn a_sessions_command_mode_is_read_changed_and_sent_with_a_new_session() {
    let host = FakeHost::start();
    let (mut driver, _) = signed_in(&host);
    driver.model.select_session(Some("s-1".into()));
    driver.send(Command::SelectSession {
        session_id: Some("s-1".into()),
    });
    let load = |driver: &mut Driver| {
        driver.model.command_mode.open("s-1");
        driver.send(Command::LoadApprovalMode {
            session_id: "s-1".into(),
        });
        driver.until("the mode", |m, _| !m.command_mode.loading);
    };

    // A session asks before each command until told otherwise.
    load(&mut driver);
    assert_eq!(driver.model.command_mode.mode, Some(ApprovalMode::Ask));
    assert!(driver.model.command_mode.begin_save());
    driver.send(Command::SetApprovalMode {
        session_id: "s-1".into(),
        mode: ApprovalMode::FullAccess,
    });
    driver.until("the change", |m, _| !m.command_mode.saving);
    assert_eq!(
        driver.model.command_mode.mode,
        Some(ApprovalMode::FullAccess)
    );
    host.with(|h| {
        assert_eq!(h.approval_modes["s-1"], "full-access");
        let put = h
            .requests
            .iter()
            .find(|seen| seen.method == "PUT")
            .expect("a PUT");
        assert_eq!(put.path, "/api/sessions/s-1/approval-mode");
        assert_eq!(put.client_marker.as_deref(), Some("web"));
    });
    // Asked again, the runtime remembers.
    load(&mut driver);
    assert_eq!(
        driver.model.command_mode.mode,
        Some(ApprovalMode::FullAccess)
    );

    // A refused change leaves the mode as it was and says so.
    host.with(|h| h.approval_mode_down = true);
    assert!(driver.model.command_mode.begin_save());
    driver.send(Command::SetApprovalMode {
        session_id: "s-1".into(),
        mode: ApprovalMode::Ask,
    });
    driver.until("the refusal", |m, _| !m.command_mode.saving);
    assert!(driver.model.command_mode.save_failed);
    assert_eq!(
        driver.model.command_mode.mode,
        Some(ApprovalMode::FullAccess)
    );
    // A failed load leaves the mode unknown.
    load(&mut driver);
    assert!(driver.model.command_mode.load_failed);
    assert_eq!(driver.model.command_mode.mode, None);
    host.with(|h| h.approval_mode_down = false);

    // A message to an existing session never carries a mode.
    assert!(driver.model.begin_send());
    driver.send(Command::Send {
        text: "Again".into(),
        attachments: Vec::new(),
        model: None,
        approval_mode: Some(ApprovalMode::FullAccess),
    });
    driver.until("acceptance", |m, _| !m.sending);
    host.with(|h| assert!(h.submits.last().unwrap().get("approvalMode").is_none()));

    // A new session starts with the mode chosen for it.
    driver.model.select_session(None);
    driver.send(Command::SelectSession { session_id: None });
    assert!(driver.model.begin_send());
    driver.send(Command::Send {
        text: "Hello".into(),
        attachments: Vec::new(),
        model: None,
        approval_mode: Some(ApprovalMode::FullAccess),
    });
    driver.until("acceptance", |m, _| !m.sending);
    host.with(|h| assert_eq!(h.submits.last().unwrap()["approvalMode"], "full-access"));
}

#[test]
fn other_bots_conversations_and_job_updates_are_loaded_and_a_job_is_dismissed() {
    let host = FakeHost::start();
    let run = |id: &str, status: &str| {
        serde_json::json!({
            "id": id, "jobId": "j-1", "name": "Morning brief", "startedAt": 50,
            "finishedAt": 60, "status": status, "sessionId": null, "turnId": null,
        })
    };
    host.with(|h| {
        h.bot_sessions.insert(
            "b-research".into(),
            vec![serde_json::json!({
                "id": "r-1", "title": "Papers", "origin": "web", "lastAt": 9,
                "working": false, "failed": false, "waiting": true, "preview": "",
                "turnCount": 2, "replyCount": 3, "replyTurnId": "t-3",
            })],
        );
        h.job_updates.insert(
            "default".into(),
            vec![
                run("r-1", "failed"),
                run("r-2", "completed"),
                run("r-3", "failed"),
            ],
        );
    });
    let (mut driver, _) = signed_in(&host);
    let load = |driver: &mut Driver| {
        driver.send(Command::LoadInbox {
            session_bots: vec!["b-research".into()],
            job_bots: vec!["default".into(), "b-research".into()],
        });
    };
    load(&mut driver);
    driver.until("the inbox", |m, _| {
        m.inbox.sessions.contains_key("b-research") && m.inbox.jobs.len() == 2
    });
    let papers = &driver.model.inbox.sessions["b-research"][0];
    assert!(papers.waiting);
    assert_eq!(papers.reply_count, Some(3));
    assert_eq!(papers.reply_turn_id.as_deref(), Some("t-3"));
    // Two of the default bot's three updates fit a page; the total says so.
    let updates = driver.model.inbox.jobs["default"].clone();
    assert_eq!(updates.runs.len(), 2);
    assert_eq!((updates.total, updates.more), (3, true));
    assert_eq!(updates.runs[0].finished_at, Some(60));
    assert!(driver.model.inbox.jobs["b-research"].runs.is_empty());
    assert_eq!(host.requests("/api/bots/b-research/sessions").len(), 1);
    assert_eq!(
        host.requests("/api/bots/b-research/jobs/notifications")
            .len(),
        1
    );

    // Dismissing a run tells the runtime and takes it off the list.
    assert!(driver.model.inbox.begin_acknowledge());
    driver.send(Command::AcknowledgeRun {
        bot_id: "default".into(),
        run_id: "r-1".into(),
    });
    driver.until("the dismissal", |m, _| !m.inbox.acknowledging);
    assert_eq!(driver.model.inbox.jobs["default"].runs.len(), 1);
    assert_eq!(host.requests("/api/jobs/runs/r-1/read").len(), 1);
    host.with(|h| assert_eq!(h.job_updates["default"].len(), 2));

    // A refused dismissal says so and keeps the run.
    host.with(|h| h.acknowledge_down = true);
    assert!(driver.model.inbox.begin_acknowledge());
    driver.send(Command::AcknowledgeRun {
        bot_id: "default".into(),
        run_id: "r-2".into(),
    });
    driver.until("the refusal", |m, _| !m.inbox.acknowledging);
    assert!(driver.model.inbox.acknowledge_failed);
    assert_eq!(driver.model.inbox.jobs["default"].runs.len(), 1);

    // Job updates that cannot be loaded are flagged, and what was known stays.
    host.with(|h| h.job_updates_down = true);
    load(&mut driver);
    driver.until("the failure", |m, _| m.inbox.jobs_failed.len() == 2);
    assert_eq!(driver.model.inbox.jobs["default"].runs.len(), 1);
}

#[test]
fn an_update_check_offers_the_newest_release_and_sends_no_token() {
    let host = FakeHost::start();
    let config = EngineConfig {
        releases_url: Some(host.origin.url("/github/releases")),
        ..support::fast_config()
    };
    let mut driver = Driver::with_config(Arc::new(MemoryStore::new()), config);
    // Signed in first, so a token exists that must not be sent.
    driver.send(Command::Connect {
        origin: host.origin.clone(),
    });
    driver.until("signed in", |m, _| m.auth == AuthState::SignedIn);
    driver.send(Command::CheckForUpdates);
    driver.until("the check's answer", |m, _| {
        matches!(m.update, UpdateStatus::Available(_))
    });
    let UpdateStatus::Available(update) = &driver.model.update else {
        unreachable!()
    };
    // The draft v100 is skipped.
    assert_eq!(update.version, "v99.0.0");
    let requests = host.requests("/github/releases");
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].authorization, None,
        "the host's token went to the release list"
    );
}

#[test]
fn raphie_on_this_computer_is_found_at_the_port_its_installer_saved() {
    let host = FakeHost::start();
    let folder = std::env::temp_dir().join(format!("raphie-local-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let ports = folder.join(".ports");
    let port = host.origin.as_str().rsplit(':').next().unwrap().to_owned();
    std::fs::write(&ports, format!("runtime=1\nweb={port}\n")).unwrap();
    let find = |file: &std::path::Path| {
        let config = EngineConfig {
            local_ports_file: Some(file.to_owned()),
            ..support::fast_config()
        };
        let mut driver = Driver::with_config(Arc::new(MemoryStore::new()), config);
        // Something that answers, then nothing: the event says which.
        driver.model.local_install = Some(host.origin.clone());
        driver.send(Command::FindLocalInstall);
        driver
    };
    let mut driver = find(&ports);
    driver.model.local_install = None;
    driver.until("found", |m, _| m.local_install.is_some());
    assert_eq!(driver.model.local_install.as_ref(), Some(&host.origin));
    assert_eq!(host.requests("/_raphie/health").len(), 1);
    assert_eq!(host.requests("/_raphie/health")[0].authorization, None);

    // A port where nothing answers finds nothing.
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let closed_port = closed.local_addr().unwrap().port();
    drop(closed);
    std::fs::write(&ports, format!("web={closed_port}\n")).unwrap();
    let mut driver = find(&ports);
    driver.until("nothing found", |m, _| m.local_install.is_none());
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn an_update_check_with_nowhere_to_ask_says_so() {
    let mut driver = Driver::new(Arc::new(MemoryStore::new()));
    driver.send(Command::CheckForUpdates);
    driver.until("the check's answer", |m, _| {
        matches!(m.update, UpdateStatus::Failed(_))
    });
}

#[test]
fn an_image_preview_is_fetched_once_and_a_missing_one_fails() {
    let host = FakeHost::start();
    host.with(|h| {
        h.uploads
            .push(("img-1".into(), "photo.png".into(), b"PNG bytes".to_vec()));
    });
    let (mut driver, _store) = signed_in(&host);
    assert!(driver.model.previews.begin("default", "img-1"));
    driver.send(Command::LoadPreview {
        bot_id: "default".into(),
        id: "img-1".into(),
    });
    driver.until("the preview", |m, _| {
        matches!(m.previews.get("default", "img-1"), Some(Preview::Ready(_)))
    });
    assert_eq!(
        driver.model.previews.get("default", "img-1"),
        Some(&Preview::Ready(FileBytes::from(b"PNG bytes".to_vec())))
    );
    assert_eq!(host.requests("/api/files/img-1").len(), 1);

    assert!(driver.model.previews.begin("default", "gone"));
    driver.send(Command::LoadPreview {
        bot_id: "default".into(),
        id: "gone".into(),
    });
    driver.until("the failure", |m, _| {
        m.previews.get("default", "gone") == Some(&Preview::Failed)
    });
}

#[test]
fn a_read_count_is_shared_with_the_runtime_for_any_bot() {
    let host = FakeHost::start();
    let (mut driver, _store) = signed_in(&host);
    driver.send(Command::MarkRead {
        bot_id: "default".into(),
        session_id: "s-1".into(),
        reply_count: 2,
    });
    driver.send(Command::MarkRead {
        bot_id: "research".into(),
        session_id: "s-9".into(),
        reply_count: 1,
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while host.with(|h| h.reads.len()) < 2 {
        assert!(std::time::Instant::now() < deadline, "the reads arrive");
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let mut reads = host.with(|h| h.reads.clone());
    reads.sort();
    assert_eq!(
        reads,
        [
            ("/api/bots/research/sessions/s-9/read".to_owned(), 1),
            ("/api/sessions/s-1/read".to_owned(), 2),
        ]
    );
    // Sent as a client change: with the marker the runtime requires.
    let seen = host.requests("/api/sessions/s-1/read");
    assert_eq!(seen[0].client_marker.as_deref(), Some("web"));
}

#[test]
fn a_subscription_sign_in_is_started_followed_answered_and_cancelled() {
    use raphie_core::contracts::SignInStatus;
    let host = FakeHost::start();
    let (mut driver, _store) = signed_in(&host);
    let status = |driver: &Driver| driver.model.sign_in.as_ref().map(|(_, s)| s.status);
    driver.send(Command::StartProviderSignIn {
        bot_id: "default".into(),
        provider: "openai".into(),
        name: "OpenAI 1".into(),
        connection_id: None,
    });
    driver.until("the sign-in started", |m, _| m.sign_in.is_some());
    assert_eq!(status(&driver), Some(SignInStatus::Waiting));
    let (_, sign_in) = driver.model.sign_in.clone().unwrap();
    assert_eq!(sign_in.prompt.as_ref().map(|p| p.id.as_str()), Some("p-1"));
    host.with(|h| {
        assert_eq!(
            h.sign_in_starts,
            [serde_json::json!({ "provider": "openai", "name": "OpenAI 1" })]
        );
    });

    driver.send(Command::PollProviderSignIn {
        bot_id: "default".into(),
        id: "sign-in-1".into(),
    });
    driver.send(Command::AnswerProviderSignIn {
        bot_id: "default".into(),
        id: "sign-in-1".into(),
        prompt_id: "p-1".into(),
        value: Secret::new("http://127.0.0.1:1455/auth/callback?code=c"),
    });
    driver.until("connected", |m, _| {
        m.sign_in
            .as_ref()
            .is_some_and(|(_, s)| s.status == SignInStatus::Connected)
    });
    host.with(|h| {
        assert_eq!(
            h.sign_in_answers,
            [serde_json::json!({ "promptId": "p-1", "value": "http://127.0.0.1:1455/auth/callback?code=c" })]
        );
    });
    // Sent as client changes, with the marker the runtime requires.
    let answer = host.requests("/api/settings/sign-ins/sign-in-1/answer");
    assert_eq!(answer[0].client_marker.as_deref(), Some("web"));

    driver.send(Command::CancelProviderSignIn {
        bot_id: "default".into(),
        id: "sign-in-1".into(),
    });
    driver.until("cancelled", |m, _| {
        m.sign_in
            .as_ref()
            .is_some_and(|(_, s)| s.status == SignInStatus::Cancelled)
    });
}
