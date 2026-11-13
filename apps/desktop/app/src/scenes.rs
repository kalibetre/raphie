//! Named states for headless snapshots and tests, filled with made-up data.
//!
//! `raphie-desktop --snap out.png --scene conversation --theme dark` renders
//! one without a window or a network. They are synthetic on purpose: never
//! paste real conversations here.

use raphie_core::auth::DeviceCode;
use raphie_core::contracts::{BotProfile, Page, SessionObservation, SessionSummary};
use raphie_core::model::{AuthState, Event};
use raphie_core::origin::Origin;
use rune::TextEdit;
use serde_json::{Value, json};

use crate::format::now_ms;
use crate::state::Ui;

/// A named change to a fresh [`Ui`], as `AppSpec::scenes` takes them.
pub type Scene = (&'static str, fn(&mut Ui));

pub const SCENES: &[Scene] = &[
    ("sign-in", sign_in),
    ("sign-in-error", sign_in_error),
    ("device-code", device_code),
    ("new-conversation", new_conversation),
    ("conversation", conversation),
    ("streaming", streaming),
    ("approval", approval),
];

const ORIGIN: &str = "https://raphie.example.ts.net";

pub fn sign_in(ui: &mut Ui) {
    ui.origin_field = TextEdit::new(ORIGIN);
    ui.model.auth = AuthState::SignedOut { notice: None };
}

pub fn sign_in_error(ui: &mut Ui) {
    ui.origin_field = TextEdit::new("http://raphie.example.ts.net");
    ui.model.auth = AuthState::SignedOut {
        notice: Some("Use https://, or http:// only for 127.0.0.1 or localhost.".into()),
    };
}

pub fn device_code(ui: &mut Ui) {
    sign_in(ui);
    ui.model.auth = AuthState::AwaitingApproval(DeviceCode {
        user_code: "WXYZ-1234".into(),
        verification_url: format!("{ORIGIN}/device?user_code=WXYZ-1234"),
        expires_in: 600,
    });
}

/// Signed in, with two bots and a few sessions, on a new conversation.
pub fn new_conversation(ui: &mut Ui) {
    let origin = Origin::parse(ORIGIN).expect("a valid origin");
    ui.model.apply(Event::SignedIn { origin });
    ui.model.apply(Event::Bots(vec![
        bot("default", "Raphie", None),
        bot("b-research", "Research", Some("#7c5cff")),
    ]));
    ui.model.apply(Event::BotSelected {
        bot_id: "default".into(),
    });
    let now = now_ms();
    let sessions = vec![
        summary(
            "s-1",
            "Plan the week",
            "Let’s make some room for the day.",
            now - 4 * 60_000,
            false,
            false,
        ),
        summary(
            "s-2",
            "Check the calendar",
            "Waiting for approval",
            now - 3_600_000,
            true,
            true,
        ),
        summary(
            "s-3",
            "Tea preferences",
            "Noted: jasmine tea.",
            now - 2 * 86_400_000,
            false,
            false,
        ),
    ];
    ui.model.apply(Event::Sessions {
        bot_id: "default".into(),
        page: Page {
            items: sessions,
            next: None,
        },
        more: false,
    });
}

pub fn conversation(ui: &mut Ui) {
    open(
        ui,
        "s-1",
        observation(
            "Plan the week",
            vec![
                turn(
                    "t1",
                    -600_000,
                    "What should I focus on today?",
                    Some(PLAN),
                    "done",
                ),
                turn(
                    "t2",
                    -300_000,
                    "Show me how to list files in Rust.",
                    Some(CODE),
                    "done",
                ),
            ],
            None,
            "idle",
            vec![],
        ),
    );
}

pub fn streaming(ui: &mut Ui) {
    open(
        ui,
        "s-1",
        observation(
            "Plan the week",
            vec![
                turn(
                    "t1",
                    -600_000,
                    "What should I focus on today?",
                    Some(PLAN),
                    "done",
                ),
                turn("t2", -1_000, "And tomorrow?", None, "pending"),
            ],
            Some("Tomorrow, start with the **review**, then"),
            "writing",
            vec![],
        ),
    );
}

pub fn approval(ui: &mut Ui) {
    let now = now_ms();
    open(
        ui,
        "s-2",
        observation(
            "Check the calendar",
            vec![turn(
                "t1",
                -60_000,
                "What's on my calendar on 21 October?",
                None,
                "pending",
            )],
            None,
            "approval",
            vec![json!({
                "id": "6f1d7f8e-2a7b-4f1e-9c4e-1b2a3c4d5e6f", "conversationId": "s-2",
                "server": "calendar", "tool": "execute",
                "argumentsJson": "{\"code\":\"return calendar.events.list({ date: \\\"2026-10-21\\\" });\"}",
                "createdAt": now - 30_000, "expiresAt": now + 570_000, "status": "pending",
                "decidedVia": null, "execution": "waiting"
            })],
        ),
    );
}

// ───────────────────────── builders ─────────────────────────

const PLAN: &str = "Let’s make some room for the day.\n\n1. **Choose one priority.** Start with the work that matters most.\n2. **Leave a little breathing room.** Keep a gap between meetings.\n3. **Close the loop.** Write down your next step before you finish.\n\nWhat would you like to focus on first?";

const CODE: &str = "Use `std::fs::read_dir`; each entry can fail on its own, so handle both levels:\n\n```rust\nuse std::fs;\n\nfn main() -> std::io::Result<()> {\n    for entry in fs::read_dir(\".\")? {\n        let entry = entry?;\n        println!(\"{}\", entry.path().display());\n    }\n    Ok(())\n}\n```\n\nThe `?` returns the error to the caller instead of panicking.";

fn open(ui: &mut Ui, session_id: &str, observation: SessionObservation) {
    new_conversation(ui);
    ui.model.select_session(Some(session_id.into()));
    ui.model.apply(Event::Observation {
        session_id: session_id.into(),
        observation: Box::new(observation),
    });
}

fn bot(id: &str, name: &str, color: Option<&str>) -> BotProfile {
    BotProfile {
        id: id.into(),
        name: name.into(),
        description: String::new(),
        color: color.map(str::to_owned),
    }
}

fn summary(
    id: &str,
    title: &str,
    preview: &str,
    last_at: i64,
    working: bool,
    waiting: bool,
) -> SessionSummary {
    from_json(json!({
        "id": id, "title": title, "origin": "web", "lastAt": last_at, "working": working,
        "failed": false, "waiting": waiting, "preview": preview, "turnCount": 2
    }))
}

fn turn(id: &str, offset_ms: i64, text: &str, answer: Option<&str>, status: &str) -> Value {
    json!({
        "id": id, "source": "web", "text": text, "createdAt": now_ms() + offset_ms,
        "status": status, "answer": answer
    })
}

fn observation(
    title: &str,
    turns: Vec<Value>,
    live: Option<&str>,
    phase: &str,
    approvals: Vec<Value>,
) -> SessionObservation {
    from_json(json!({
        "session": {
            "id": "s-1", "title": title, "origin": "web", "lastAt": now_ms(),
            "working": phase != "idle", "failed": false, "waiting": phase == "approval",
            "preview": "", "turnCount": turns.len()
        },
        "turns": turns,
        "toolApprovals": approvals,
        "live": live.map(|text| json!({ "text": text, "generating": true })),
        "nextBefore": null,
        "phase": phase,
        "error": null
    }))
}

fn from_json<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("scene data matches the contract types")
}
