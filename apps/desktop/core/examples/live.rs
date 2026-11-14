//! A live check of the core against a running web host, without the UI.
//!
//! ```sh
//! cargo run -p raphie-desktop-core --example live -- http://127.0.0.1:4321
//! cargo run -p raphie-desktop-core --example live -- http://127.0.0.1:4321 --exercise
//! ```
//!
//! It signs in with a device code (open the printed link and approve it), then
//! lists bots and sessions. With `--exercise` it also sends two messages, waits
//! for the streamed reply, approves the tool action the fixture proposes, and
//! prints each run's tool steps and usage as read from the activity journal.
//! `--exercise` makes model calls: use it only with the test fixture
//! (`bun run dev:fixture`), whose model is a free canned one.
//!
//! The token stays in memory and is never printed or saved. Disconnect the
//! test device in Settings → Account afterwards.

use std::sync::Arc;
use std::time::{Duration, Instant};

use raphie_core::auth::MemoryStore;
use raphie_core::contracts::{ApprovalStatus, Decision, Scope};
use raphie_core::engine::{Client, Command, EngineConfig};
use raphie_core::model::{AuthState, Event, Model};
use raphie_core::origin::Origin;
use raphie_core::projections::{format_tokens, run_usage, step_state, steps_by_turn};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let origin = Origin::parse(args.first().map_or("http://127.0.0.1:4321", String::as_str))
        .unwrap_or_else(|e| fail(&e.to_string()));
    let exercise = args.iter().any(|a| a == "--exercise");
    let config = EngineConfig {
        settings_path: None,
        ..EngineConfig::default()
    };
    let client = Client::start(Arc::new(MemoryStore::new()), config, Arc::new(|| {}));
    let mut model = Model::new();
    client.send(Command::Connect { origin });

    wait(&client, &mut model, "the session list", 660, |m, e| {
        if let Event::DeviceCode(code) = e {
            println!("Open {}", code.verification_url);
            println!("Check that the page shows: {}", code.user_code);
        }
        if let AuthState::SignedOut { notice: Some(n) } = &m.auth {
            fail(n);
        }
        m.auth == AuthState::SignedIn && waited_for_list(e)
    });
    let names: Vec<&str> = model.bots.iter().map(|b| b.name.as_str()).collect();
    println!("Signed in. Bots: {}", names.join(", "));
    println!(
        "Sessions on {}: {}",
        model.bot_id.as_deref().unwrap_or("?"),
        model.sessions.len()
    );
    if !exercise {
        println!("Read-only check passed. Add --exercise (fixture only) to send messages.");
        return;
    }

    // A new conversation: the fixture streams a canned reply.
    model.select_session(None);
    client.send(Command::SelectSession { session_id: None });
    model.begin_send();
    client.send(Command::Send {
        text: "Plan my day".into(),
    });
    wait(&client, &mut model, "the streamed reply", 60, |m, e| {
        if let Event::Observation { observation, .. } = e
            && let Some(live) = &observation.live
            && live.generating
        {
            println!("  streaming: {} characters", live.text.len());
        }
        m.conversation
            .as_ref()
            .is_some_and(|c| c.turns().last().is_some_and(|t| t.answer.is_some()))
    });
    let reply = model
        .conversation
        .as_ref()
        .unwrap()
        .turns()
        .last()
        .unwrap()
        .answer
        .clone();
    println!(
        "Reply: {}",
        reply.unwrap_or_default().lines().next().unwrap_or_default()
    );

    // Ask for a tool: the fixture proposes an action that needs approval.
    model.begin_send();
    client.send(Command::Send {
        text: "Use the calendar tool".into(),
    });
    wait(&client, &mut model, "an approval", 60, |m, _| {
        m.conversation
            .as_ref()
            .is_some_and(|c| !c.pending_approvals().is_empty())
    });
    let approval = model.conversation.as_ref().unwrap().pending_approvals()[0].clone();
    println!(
        "Approval: {} · {} {}",
        approval.server, approval.tool, approval.arguments_json
    );
    for decision in [Decision::Approved, Decision::Rejected] {
        model.begin_decide(&approval.id);
        client.send(Command::Decide {
            approval_id: approval.id.clone(),
            decision,
            scope: Scope::Once,
        });
        wait(&client, &mut model, "the decision", 30, |m, _| {
            !m.deciding.contains(&approval.id)
        });
        println!("Decided {decision:?}: notice = {:?}", model.notice);
    }
    wait(&client, &mut model, "the action's result", 60, |m, _| {
        m.conversation.as_ref().is_some_and(|c| {
            c.observation.as_ref().is_some_and(|o| {
                o.tool_approvals
                    .iter()
                    .any(|a| a.id == approval.id && a.status == ApprovalStatus::Approved)
            }) && c.turns().last().is_some_and(|t| t.answer.is_some())
        })
    });
    // What the journal says each run did (the tool steps and usage the app
    // shows under a reply).
    let conversation = model.conversation.as_ref().unwrap();
    let observation = conversation.observation.as_ref().unwrap();
    let turns = conversation.turns();
    for (turn, steps) in steps_by_turn(&turns, &observation.activity, &observation.tool_approvals) {
        let names: Vec<String> = steps
            .iter()
            .map(|step| format!("{} ({:?})", step.tool, step_state(step, i64::MAX)))
            .collect();
        let usage = run_usage(&turn.id, &observation.activity).map_or("no usage".to_owned(), |u| {
            format!("{} tokens, {} calls", format_tokens(u.tokens), u.calls)
        });
        println!(
            "Turn {:?}: steps [{}]; {usage}",
            turn.text,
            names.join(", ")
        );
    }
    println!("Exercise passed: streamed reply, approval, stale second decision reported.");
}

fn waited_for_list(event: &Event) -> bool {
    matches!(event, Event::Sessions { more: false, .. })
}

/// Applies events until `done` holds, or exits after `seconds`.
fn wait(
    client: &Client,
    model: &mut Model,
    what: &str,
    seconds: u64,
    mut done: impl FnMut(&Model, &Event) -> bool,
) {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        for event in client.drain() {
            model.apply(event.clone());
            if let Event::Problem(problem) = &event {
                println!("  problem: {problem}");
            }
            if done(model, &event) {
                return;
            }
        }
        if Instant::now() > deadline {
            fail(&format!("timed out waiting for {what}"));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn fail(message: &str) -> ! {
    eprintln!("Live check failed: {message}");
    std::process::exit(1);
}
