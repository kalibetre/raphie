//! Named states for headless snapshots and tests, filled with made-up data.
//!
//! `raphie-desktop --snap out.png --scene conversation --theme dark` renders
//! one without a window or a network. They are synthetic on purpose: never
//! paste real conversations here.

use raphie_core::auth::DeviceCode;
use raphie_core::contracts::{
    Account, BotProfile, Page as Paged, SessionObservation, SessionSummary,
};
use raphie_core::model::{AuthState, Event};
use raphie_core::origin::Origin;
use rune::TextEdit;
use serde_json::{Value, json};

use crate::format::now_ms;
use crate::sections::{BotSection, Page};
use crate::state::Ui;

/// A named change to a fresh [`Ui`], as `AppSpec::scenes` takes them.
pub type Scene = (&'static str, fn(&mut Ui));

pub const SCENES: &[Scene] = &[
    ("sign-in", sign_in),
    ("sign-in-error", sign_in_error),
    ("device-code", device_code),
    ("new-conversation", new_conversation),
    ("conversations", conversations),
    ("conversation", conversation),
    ("tools", tools),
    ("streaming", streaming),
    ("working", working),
    ("approval", approval),
    ("command-approval", command_approval),
    ("settings-account", settings_account),
    ("settings-appearance", settings_appearance),
    ("settings-profile", settings_profile),
    ("settings-profile-edited", settings_profile_edited),
    ("settings-bot", settings_bot),
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
        bot("default", "Raphie", "Your personal assistant.", None),
        bot("b-research", "Research", "Reads and summarises.", None),
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
            "What's on my calendar on 21 October?",
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
        page: Paged {
            items: sessions,
            next: None,
        },
        more: false,
    });
}

/// Settings → Account.
pub fn settings_account(ui: &mut Ui) {
    new_conversation(ui);
    ui.model.apply(Event::Account(Some(Account {
        email: "owner@example.com".into(),
        name: "Owner".into(),
    })));
    ui.open_settings(Some(Page::Account));
    ui.expanded_bots.insert("default".into());
}

/// Settings → Appearance.
pub fn settings_appearance(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::Appearance));
}

/// Settings → Profile, as opened.
pub fn settings_profile(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Profile,
    }));
}

/// Settings → Profile with unsaved changes, so the save bar shows.
pub fn settings_profile_edited(ui: &mut Ui) {
    settings_profile(ui);
    ui.profile.description = TextEdit::new("Plans my week and keeps notes.");
    ui.profile.color = Some("#83bcb4".into());
}

/// A bot's settings page (Research → Models).
pub fn settings_bot(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::Bot {
        bot_id: "b-research".into(),
        section: BotSection::Models,
    }));
}

/// The same, with the conversations panel open.
pub fn conversations(ui: &mut Ui) {
    new_conversation(ui);
    ui.panel_open = true;
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
            finished_activity(),
        ),
    );
}

/// The same conversation with the second reply's tool steps unfolded.
pub fn tools(ui: &mut Ui) {
    conversation(ui);
    ui.open_runs.insert("t2".into());
    ui.open_steps.insert("op-1".into());
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
            vec![activity(
                1,
                -900,
                "t2",
                None,
                "model.started",
                "model started",
                json!({}),
            )],
        ),
    );
}

/// A tool is running, and a second message waits in the queue.
pub fn working(ui: &mut Ui) {
    let mut queued = turn("t3", -4_000, "Also check Friday.", None, "pending");
    queued["queueMode"] = json!("followUp");
    open(
        ui,
        "s-1",
        observation(
            "Plan the week",
            vec![
                turn("t2", -12_000, "What's on this week?", None, "pending"),
                queued,
            ],
            None,
            "tool",
            vec![],
            vec![
                activity(
                    1,
                    -11_000,
                    "t2",
                    None,
                    "model.completed",
                    "model completed",
                    json!({"stopReason": "toolUse"}),
                ),
                activity(
                    2,
                    -10_500,
                    "t2",
                    Some("op-1"),
                    "tool.started",
                    "mcp_calendar_list_events started",
                    json!({"week": "2026-W43"}),
                ),
            ],
        ),
    );
    ui.open_runs.insert("t2".into());
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
                "id": APPROVAL_ID, "conversationId": "s-2",
                "server": "calendar", "tool": "execute",
                "argumentsJson": "{\"code\":\"return calendar.events.list({ date: \\\"2026-10-21\\\" });\"}",
                "createdAt": now - 30_000, "expiresAt": now + 570_000, "status": "pending",
                "decidedVia": null, "execution": "waiting"
            })],
            vec![
                activity(
                    1,
                    -31_000,
                    "t1",
                    Some("op-1"),
                    "tool.started",
                    "mcp_calendar_execute started",
                    json!({}),
                ),
                activity(
                    2,
                    -30_000,
                    "t1",
                    Some(APPROVAL_ID),
                    "approval.requested",
                    "approval requested",
                    json!({}),
                ),
            ],
        ),
    );
}

/// A shell command waiting for approval, which can also be allowed for the
/// rest of the conversation.
pub fn command_approval(ui: &mut Ui) {
    let now = now_ms();
    open(
        ui,
        "s-2",
        observation(
            "Tidy the notes",
            vec![turn(
                "t1",
                -20_000,
                "List my notes folder.",
                None,
                "pending",
            )],
            None,
            "approval",
            vec![json!({
                "id": COMMAND_APPROVAL_ID, "conversationId": "s-2",
                "connectionIdentity": "raphie.workspace.command",
                "server": "workspace", "tool": "bash",
                "argumentsJson": "{\"command\":\"ls -la notes\\nwc -l notes/*.md\"}",
                "createdAt": now - 10_000, "expiresAt": now + 590_000, "status": "pending",
                "decidedVia": null, "execution": "waiting"
            })],
            vec![
                activity(
                    1,
                    -11_000,
                    "t1",
                    Some("op-1"),
                    "tool.started",
                    "bash started",
                    json!({}),
                ),
                activity(
                    2,
                    -10_000,
                    "t1",
                    Some(COMMAND_APPROVAL_ID),
                    "approval.requested",
                    "approval requested",
                    json!({}),
                ),
            ],
        ),
    );
}

pub const APPROVAL_ID: &str = "6f1d7f8e-2a7b-4f1e-9c4e-1b2a3c4d5e6f";
pub const COMMAND_APPROVAL_ID: &str = "0b7c1a52-93de-4c1f-8a44-5d6e7f809a1b";

// ───────────────────────── builders ─────────────────────────

/// A bot's personality, as Settings → Profile shows it.
const SOUL: &str = "Be thoughtful and candid. Explain uncertainty.\n\nNever claim an action succeeded without confirmation.";

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

fn bot(id: &str, name: &str, description: &str, color: Option<&str>) -> BotProfile {
    BotProfile {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        color: color.map(str::to_owned),
        soul: SOUL.into(),
        revision: 3,
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

/// One journal entry, `offset_ms` from now.
fn activity(
    id: i64,
    offset_ms: i64,
    run_id: &str,
    operation_id: Option<&str>,
    kind: &str,
    summary: &str,
    details: Value,
) -> Value {
    json!({
        "id": id, "at": now_ms() + offset_ms, "attemptId": "a", "conversationId": "s-1",
        "runId": run_id, "operationId": operation_id, "pluginId": null,
        "type": kind, "summary": summary, "detailsJson": details.to_string()
    })
}

/// The journal behind the finished conversation: one plain reply, then a
/// reply that read a file and searched the web first.
fn finished_activity() -> Vec<Value> {
    let usage = |tokens: u64, cost: f64| json!({"stopReason": "stop", "usage": {"totalTokens": tokens, "cost": {"total": cost}}});
    vec![
        activity(
            1,
            -598_000,
            "t1",
            None,
            "model.completed",
            "model completed",
            usage(88, 0.0004),
        ),
        activity(
            2,
            -299_000,
            "t2",
            None,
            "model.completed",
            "model completed",
            json!({"stopReason": "toolUse", "usage": {"totalTokens": 640, "cost": {"total": 0.0031}}}),
        ),
        activity(
            3,
            -298_500,
            "t2",
            Some("op-1"),
            "tool.started",
            "read_file started",
            json!({"path": "notes/rust.md"}),
        ),
        activity(
            4,
            -298_200,
            "t2",
            Some("op-1"),
            "tool.completed",
            "read_file completed",
            json!({}),
        ),
        activity(
            5,
            -298_000,
            "t2",
            Some("op-2"),
            "tool.started",
            "mcp_docs_search started",
            json!({"query": "std::fs::read_dir"}),
        ),
        activity(
            6,
            -295_700,
            "t2",
            Some("op-2"),
            "tool.completed",
            "mcp_docs_search completed",
            json!({}),
        ),
        activity(
            7,
            -294_000,
            "t2",
            None,
            "model.completed",
            "model completed",
            usage(1210, 0.0092),
        ),
    ]
}

fn observation(
    title: &str,
    turns: Vec<Value>,
    live: Option<&str>,
    phase: &str,
    approvals: Vec<Value>,
    activity: Vec<Value>,
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
        "activity": activity,
        "nextBefore": null,
        "phase": phase,
        "error": null
    }))
}

fn from_json<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("scene data matches the contract types")
}
