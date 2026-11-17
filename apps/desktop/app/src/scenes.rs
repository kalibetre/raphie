//! Named states for headless snapshots and tests, filled with made-up data.
//!
//! `raphie-desktop --snap out.png --scene conversation --theme dark` renders
//! one without a window or a network. They are synthetic on purpose: never
//! paste real conversations here.

use raphie_core::attachments::FileBytes;
use raphie_core::auth::DeviceCode;
use raphie_core::contracts::ApprovalMode;
use raphie_core::contracts::{
    Account, BotProfile, ChannelHomeSettings, ChannelSettings, McpConnection, MemoryEvidence,
    MemoryPage, MemoryStatus, Page as Paged, RuntimeSettings, SandboxInfo, SessionObservation,
    SessionSummary, TelegramPairingCode, WorkspaceListing,
};
use raphie_core::contracts::{ActivityEvent, BotRevision, TraceDiagnostics};
use raphie_core::contracts::{JobRun, ScheduledJob};
use raphie_core::engine::Command;
use raphie_core::flavor::Flavor;
use raphie_core::inbox::JobUpdates;
use raphie_core::mcp::McpTransport;
use raphie_core::model::{AuthState, Event, Reach};
use raphie_core::model_library::PickerFilter;
use raphie_core::origin::Origin;
use raphie_core::updates::{ReleaseChannel, Update, UpdateStatus};
use rune::TextEdit;
use serde_json::{Value, json};

use crate::format::now_ms;
use crate::sections::{BotSection, Page};
use crate::state::{BACKEND, Dropdown, Ui};

/// A named change to a fresh [`Ui`], as `AppSpec::scenes` takes them.
pub type Scene = (&'static str, fn(&mut Ui));

pub const SCENES: &[Scene] = &[
    ("sign-in", sign_in),
    ("sign-in-error", sign_in_error),
    ("sign-in-this-mac", sign_in_this_mac),
    ("device-code", device_code),
    ("new-conversation", new_conversation),
    ("conversations", conversations),
    ("unread", unread),
    ("inbox", inbox),
    ("inbox-empty", inbox_empty),
    ("conversation", conversation),
    ("attachments", attachments),
    ("image-viewer", image_viewer),
    ("permissions", permissions),
    ("model-picker", model_picker),
    ("model-picker-favorites", model_picker_favorites),
    ("model-picker-family", model_picker_family),
    ("tools", tools),
    ("streaming", streaming),
    ("working", working),
    ("approval", approval),
    ("command-approval", command_approval),
    ("settings-account", settings_account),
    ("settings-account-unreachable", settings_account_unreachable),
    (
        "settings-account-runtime-down",
        settings_account_runtime_down,
    ),
    ("settings-appearance", settings_appearance),
    ("settings-about", settings_about),
    ("settings-about-update", settings_about_update),
    ("dev-build", dev_build),
    ("nightly-build", nightly_build),
    ("nightly-build-narrow", nightly_build_narrow),
    ("settings-about-nightly", settings_about_nightly),
    ("settings-profile", settings_profile),
    ("settings-profile-edited", settings_profile_edited),
    ("settings-history", settings_history),
    ("settings-new-bot", settings_new_bot),
    ("settings-delete-bot", settings_delete_bot),
    ("settings-models", settings_models),
    ("settings-models-filter", settings_models_filter),
    ("settings-providers", settings_providers),
    ("settings-providers-add", settings_providers_add),
    ("settings-providers-empty", settings_providers_empty),
    ("settings-providers-edit", settings_providers_edit),
    ("settings-providers-sign-in", settings_providers_sign_in),
    (
        "settings-providers-subscription",
        settings_providers_subscription,
    ),
    ("settings-memory", settings_memory),
    ("settings-memory-hindsight", settings_memory_hindsight),
    ("settings-memory-loading", settings_memory_loading),
    ("settings-memories", settings_memories),
    ("settings-memories-editing", settings_memories_editing),
    ("settings-memories-search", settings_memories_search),
    ("settings-memories-empty", settings_memories_empty),
    ("settings-jobs", settings_jobs),
    ("settings-jobs-create", settings_jobs_create),
    ("settings-jobs-empty", settings_jobs_empty),
    ("settings-jobs-loading", settings_jobs_loading),
    ("settings-workspace", settings_workspace),
    ("settings-workspace-folder", settings_workspace_folder),
    ("settings-workspace-empty", settings_workspace_empty),
    ("settings-workspace-loading", settings_workspace_loading),
    ("settings-sandbox", settings_sandbox),
    ("settings-sandbox-container", settings_sandbox_container),
    ("settings-sandbox-loading", settings_sandbox_loading),
    ("settings-channels", settings_channels),
    ("settings-channels-discord", settings_channels_discord),
    ("settings-channels-telegram", settings_channels_telegram),
    ("settings-channels-empty", settings_channels_empty),
    ("settings-channels-loading", settings_channels_loading),
    ("settings-mcp", settings_mcp),
    ("settings-mcp-command", settings_mcp_command),
    ("settings-mcp-empty", settings_mcp_empty),
    ("settings-mcp-loading", settings_mcp_loading),
    ("settings-diagnostics", settings_diagnostics),
    (
        "settings-diagnostics-unavailable",
        settings_diagnostics_unavailable,
    ),
    ("settings-activity", settings_activity),
    ("settings-activity-empty", settings_activity_empty),
    ("settings-activity-loading", settings_activity_loading),
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

/// The remembered address no longer answers, and Raphie installed on this
/// Mac does: it is offered.
pub fn sign_in_this_mac(ui: &mut Ui) {
    ui.origin_field = TextEdit::new("http://127.0.0.1:4321");
    ui.model.auth = AuthState::SignedOut {
        notice: Some("Could not reach Raphie: error sending request".into()),
    };
    ui.model.local_install = Origin::parse("http://127.0.0.1:24320").ok();
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

/// Settings → Account when nothing answers at the address.
pub fn settings_account_unreachable(ui: &mut Ui) {
    settings_account(ui);
    ui.model.apply(Event::Reach(Reach::Unreachable(
        "error sending request".into(),
    )));
}

/// Settings → Account when the web host answers but the runtime does not.
pub fn settings_account_runtime_down(ui: &mut Ui) {
    settings_account(ui);
    ui.model.apply(Event::Reach(Reach::RuntimeDown(
        "The runtime is unavailable. Please retry.".into(),
    )));
}

/// Settings → Appearance.
pub fn settings_appearance(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::Appearance));
}

/// Settings → About, before any check.
pub fn settings_about(ui: &mut Ui) {
    settings_account(ui);
    ui.model.apply(Event::HostVersion("v0.0.4".into()));
    ui.open_settings(Some(Page::About));
}

/// Settings → About once a check has found a newer release.
pub fn settings_about_update(ui: &mut Ui) {
    settings_about(ui);
    ui.model.update = UpdateStatus::Available(Update {
        version: "v0.0.5".into(),
        url: "https://github.com/kalibetre/raphie/releases/tag/v0.0.5".into(),
    });
}

/// The conversation list as the dev build draws it, with its badge.
pub fn dev_build(ui: &mut Ui) {
    conversations(ui);
    ui.flavor = Flavor::Dev;
}

/// A nightly release: the "NIGHTLY" pill beside the brand.
pub fn nightly_build(ui: &mut Ui) {
    conversations(ui);
    ui.flavor = Flavor::Release;
    ui.release_channel = ReleaseChannel::Nightly;
}

/// A nightly release with the roster at its narrowest: only the badge's moon
/// has room beside the brand.
pub fn nightly_build_narrow(ui: &mut Ui) {
    nightly_build(ui);
    ui.roster_width = crate::state::ROSTER_MIN;
}

/// Settings → About in a nightly release.
pub fn settings_about_nightly(ui: &mut Ui) {
    settings_about(ui);
    ui.flavor = Flavor::Release;
    ui.release_channel = ReleaseChannel::Nightly;
    ui.model.apply(Event::HostVersion(
        "v0.0.4-nightly.20261116.43884865813.1".into(),
    ));
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

/// Memory settings as the runtime answers them, for the built-in back end
/// or a Hindsight server that holds a key.
pub fn memory_status(hindsight: bool) -> MemoryStatus {
    let (provider, reflect, endpoint, bank) = if hindsight {
        (
            "hindsight",
            "provider",
            "https://hindsight.example.ts.net",
            "raphie",
        )
    } else {
        ("builtin", "model-assisted", "", "")
    };
    serde_json::from_value(json!({
        "configuration": {
            "enabled": true, "provider": provider, "scope": "owner",
            "endpoint": endpoint, "bankId": bank, "hasCredential": hindsight,
        },
        "capabilities": {
            "browse": !hindsight, "retain": true, "recall": true, "reflect": reflect,
            "revise": !hindsight, "forget": !hindsight,
            "consolidation": if hindsight { "provider" } else { "none" },
        },
        "error": null,
    }))
    .expect("the scene's memory settings match the contract")
}

fn open_memory(ui: &mut Ui, status: Option<MemoryStatus>) {
    settings_account(ui);
    if let Some(status) = status {
        ui.model.apply(Event::Memory {
            bot_id: "default".into(),
            status,
        });
    }
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Memory,
    }));
}

/// Settings → Memory on the built-in back end, nothing edited.
pub fn settings_memory(ui: &mut Ui) {
    open_memory(ui, Some(memory_status(false)));
}

/// Settings → Memory before the settings have arrived.
pub fn settings_memory_loading(ui: &mut Ui) {
    open_memory(ui, None);
}

/// Settings → Memory on Hindsight, with the bank changed and a new key
/// typed, so the save bar shows.
pub fn settings_memory_hindsight(ui: &mut Ui) {
    open_memory(ui, Some(memory_status(true)));
    ui.memory.bank_id = TextEdit::new("raphie-work");
    // A made-up key. The field is secure, so the snapshot shows dots.
    ui.memory.key = TextEdit::new("hs-not-a-real-key").secure();
}

/// Made-up saved versions of the Research bot's profile, newest first.
pub fn bot_revisions() -> Vec<BotRevision> {
    serde_json::from_value(json!([
        {
            "id": "b-research", "revision": 3, "name": "Research",
            "description": "Reads and summarises.", "color": null,
            "soul": "Read the source before summarising it.\nSay what is uncertain, and why.\nPrefer the primary source to a write-up of it.",
            "createdAt": 1_794_200_400_000_i64, "updatedAt": 1_794_650_100_000_i64,
        },
        {
            "id": "b-research", "revision": 2, "name": "Research",
            "description": "Reads papers", "color": "#83bcb4",
            "soul": "Read the source before summarising it.\nSay what is uncertain.",
            "createdAt": 1_794_200_400_000_i64, "updatedAt": 1_794_563_700_000_i64,
        },
        {
            "id": "b-research", "revision": 1, "name": "Reader",
            "description": "", "color": null, "soul": "Be brief.",
            "createdAt": 1_794_200_400_000_i64, "updatedAt": 1_794_200_400_000_i64,
        },
    ]))
    .expect("the scene's revisions match the contract")
}

/// The Research bot at revision 3, on one of its settings pages.
fn open_research(ui: &mut Ui, section: BotSection) {
    settings_account(ui);
    let mut bots = ui.model.bots.clone();
    if let Some(research) = bots.iter_mut().find(|bot| bot.id == "b-research") {
        research.revision = 3;
    }
    ui.model.apply(Event::Bots(bots));
    ui.open_settings(Some(Page::Bot {
        bot_id: "b-research".into(),
        section,
    }));
}

/// Settings → Profile → Revision history, the current revision unfolded.
pub fn settings_history(ui: &mut Ui) {
    open_research(ui, BotSection::History);
    ui.model.apply(Event::BotHistory {
        bot_id: "b-research".into(),
        items: bot_revisions(),
    });
}

/// Settings → Create a bot, with a name typed.
pub fn settings_new_bot(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::NewBot));
    ui.profile.name = TextEdit::new("Travel");
    ui.profile.description = TextEdit::new("Plans trips and keeps the bookings straight.");
}

/// A bot's Profile with "Delete bot" asking for its name.
pub fn settings_delete_bot(ui: &mut Ui) {
    open_research(ui, BotSection::Profile);
    ui.ask_delete_bot();
    ui.delete_confirmation = TextEdit::new("Resear");
}

/// Made-up exported traces: a run with a model call, a tool call that
/// failed, and a span with no status of its own.
pub fn trace_diagnostics(export_enabled: bool) -> TraceDiagnostics {
    serde_json::from_value(json!({
        "source": "otlp", "state": "ready", "exportEnabled": export_enabled,
        "from": 1_794_646_500_000_i64, "to": 1_794_650_100_000_i64, "spanLimit": 500,
        "spans": [
            {
                "traceId": "4bf92f3577b34da6a3ce929d0e0e4736", "spanId": "00f067aa0ba902b7",
                "parentSpanId": null, "name": "run.turn",
                "startedAt": 1_794_650_040_000_i64, "durationMs": 9412.6, "status": "ok",
                "attributes": { "session.id": "0190a1b2-c3d4", "bot.id": "default" },
            },
            {
                "traceId": "4bf92f3577b34da6a3ce929d0e0e4736", "spanId": "a2fb4a1d1a96d312",
                "parentSpanId": "00f067aa0ba902b7", "name": "model.call",
                "startedAt": 1_794_650_041_000_i64, "durationMs": 3120.4, "status": "unset",
                "attributes": { "bot.id": "default", "model.id": "claude-fable", "model.input_tokens": 1840, "model.output_tokens": 312 },
            },
            {
                "traceId": "4bf92f3577b34da6a3ce929d0e0e4736", "spanId": "c7ad6b7169203331",
                "parentSpanId": "00f067aa0ba902b7", "name": "tool.mcp_calendar_list_events",
                "startedAt": 1_794_650_045_000_i64, "durationMs": 804.0, "status": "error",
                "attributes": { "bot.id": "b-research", "tool.name": "mcp_calendar_list_events", "execution.outcome": "timeout" },
            },
        ],
    }))
    .expect("the scene's traces match the contract")
}

/// Made-up durable events, oldest first as the runtime lists them.
pub fn bot_events() -> Vec<ActivityEvent> {
    serde_json::from_value(json!([
        {
            "id": 4101, "at": 1_794_650_040_120_i64, "attemptId": "att-7c1", "conversationId": 12,
            "runId": "run-320", "operationId": null, "pluginId": null,
            "type": "model.started", "summary": "model started", "detailsJson": "{}",
        },
        {
            "id": 4102, "at": 1_794_650_043_480_i64, "attemptId": "att-7c1", "conversationId": 12,
            "runId": "run-320", "operationId": "call-88", "pluginId": "mcp",
            "type": "tool.started", "summary": "mcp_calendar_list_events started",
            "detailsJson": "{\"range\":\"this week\"}",
        },
        {
            "id": 4103, "at": 1_794_650_044_290_i64, "attemptId": "att-7c1", "conversationId": 12,
            "runId": "run-320", "operationId": "call-88", "pluginId": "mcp",
            "type": "tool.failed", "summary": "mcp_calendar_list_events failed",
            "detailsJson": "{\"error\":\"timeout\"}",
        },
        {
            "id": 4104, "at": 1_794_650_049_530_i64, "attemptId": "att-7c1", "conversationId": 12,
            "runId": "run-320", "operationId": null, "pluginId": null,
            "type": "model.completed", "summary": "model completed",
            "detailsJson": "{\"stopReason\":\"stop\",\"tokens\":2152}",
        },
    ]))
    .expect("the scene's events match the contract")
}

/// Opens Settings → Diagnostics with `traces` for the last hour.
fn open_diagnostics(ui: &mut Ui, traces: Option<TraceDiagnostics>) {
    settings_account(ui);
    ui.model.apply(Event::BotSettings {
        bot_id: BACKEND.to_owned(),
        settings: Box::new(model_settings()),
    });
    ui.open_settings(Some(Page::Diagnostics));
    if let Some(data) = traces {
        ui.model.apply(Event::Traces {
            bot_id: BACKEND.to_owned(),
            hours: 1,
            data: Box::new(data),
        });
    }
}

/// Settings → Diagnostics with three spans, the failed one unfolded.
pub fn settings_diagnostics(ui: &mut Ui) {
    open_diagnostics(ui, Some(trace_diagnostics(true)));
    ui.spans
        .open
        .insert("4bf92f3577b34da6a3ce929d0e0e4736:c7ad6b7169203331".into());
}

/// Diagnostics while the trace backend does not answer.
pub fn settings_diagnostics_unavailable(ui: &mut Ui) {
    open_diagnostics(ui, None);
    ui.model.apply(Event::TracesFailed {
        bot_id: BACKEND.to_owned(),
        hours: 1,
    });
}

fn open_activity(ui: &mut Ui, events: Option<Vec<ActivityEvent>>) {
    settings_account(ui);
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Activity,
    }));
    if let Some(items) = events {
        ui.model.apply(Event::BotActivity {
            bot_id: "default".into(),
            items,
        });
    }
}

/// Settings → Activity with four events, the failed one unfolded.
pub fn settings_activity(ui: &mut Ui) {
    open_activity(ui, Some(bot_events()));
    ui.events.open.insert("4103".into());
}

/// Activity before the bot did anything.
pub fn settings_activity_empty(ui: &mut Ui) {
    open_activity(ui, Some(Vec::new()));
}

/// Activity before the events have arrived.
pub fn settings_activity_loading(ui: &mut Ui) {
    open_activity(ui, None);
}

/// Made-up jobs in the states a card can show: recurring and active with a
/// finished run, a one-time reminder that failed, and a paused job that
/// never ran.
pub fn scheduled_jobs() -> Vec<ScheduledJob> {
    serde_json::from_value(json!([
        {
            "id": "job-brief", "name": "Morning project brief",
            "prompt": "Summarize the project's open tasks and suggest today's priorities.",
            "everyMinutes": 1440, "firstRunAt": 1_794_200_400_000_i64,
            "enabled": true, "nextRunAt": 1_794_718_800_000_i64,
            "sessionId": "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
            "lastRunAt": 1_794_632_400_000_i64, "lastStatus": "submitted",
            "lastRun": {
                "id": "run-104", "jobId": "job-brief", "name": "Morning project brief",
                "scheduledFor": 1_794_632_400_000_i64, "startedAt": 1_794_632_400_000_i64,
                "finishedAt": 1_794_632_460_000_i64, "status": "completed",
                "sessionId": "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "turnId": "t-311",
                "acknowledgedAt": null,
            },
        },
        {
            "id": "job-renewal", "name": "Renew the domain",
            "prompt": "Remind me to renew the domain before it lapses.",
            "everyMinutes": null, "firstRunAt": 1_794_546_000_000_i64,
            "enabled": false, "nextRunAt": 1_794_546_000_000_i64, "sessionId": null,
            "lastRunAt": 1_794_546_000_000_i64, "lastStatus": "failed",
            "lastRun": {
                "id": "run-101", "jobId": "job-renewal", "name": "Renew the domain",
                "scheduledFor": 1_794_546_000_000_i64, "startedAt": 1_794_546_000_000_i64,
                "finishedAt": 1_794_546_001_000_i64, "status": "failed",
                "failureReason": "no_model", "sessionId": null, "turnId": null,
                "acknowledgedAt": null,
            },
        },
        {
            "id": "job-digest", "name": "Weekly reading digest",
            "prompt": "List what I saved to read this week, shortest first.",
            "everyMinutes": 10080, "firstRunAt": 1_794_805_200_000_i64,
            "enabled": false, "nextRunAt": 1_794_805_200_000_i64, "sessionId": null,
            "lastRunAt": null, "lastStatus": null,
        },
    ]))
    .expect("the scene's jobs match the contract")
}

/// A made-up page of runs, newest first, with more behind it.
pub fn job_runs() -> Paged<JobRun> {
    serde_json::from_value(json!({
        "items": [
            {
                "id": "run-105", "jobId": "job-brief", "name": "Morning project brief",
                "scheduledFor": 1_794_650_000_000_i64, "late": true,
                "startedAt": 1_794_650_100_000_i64, "finishedAt": null, "status": "running",
                "sessionId": "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "turnId": "t-320",
                "acknowledgedAt": null,
            },
            {
                "id": "run-104", "jobId": "job-brief", "name": "Morning project brief",
                "scheduledFor": 1_794_632_400_000_i64, "startedAt": 1_794_632_400_000_i64,
                "finishedAt": 1_794_632_460_000_i64, "status": "completed",
                "sessionId": "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "turnId": "t-311",
                "acknowledgedAt": null,
            },
            {
                "id": "run-101", "jobId": "job-renewal", "name": "Renew the domain",
                "scheduledFor": 1_794_546_000_000_i64, "startedAt": 1_794_546_000_000_i64,
                "finishedAt": 1_794_546_001_000_i64, "status": "failed",
                "failureReason": "no_model", "sessionId": null, "turnId": null,
                "acknowledgedAt": null,
            },
        ],
        "next": "cursor-older",
    }))
    .expect("the scene's runs match the contract")
}

/// Opens Settings → Scheduled jobs with `jobs`, and answers the runs it
/// asks for with `runs`.
fn open_jobs(ui: &mut Ui, jobs: Option<Vec<ScheduledJob>>, runs: Option<Paged<JobRun>>) {
    settings_account(ui);
    if let Some(items) = jobs {
        ui.model.apply(Event::Jobs {
            bot_id: "default".into(),
            items,
        });
    }
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Jobs,
    }));
    // The page asked for the newest runs; the answer carries its ticket.
    if let (Some(Command::LoadJobRuns { ticket, .. }), Some(page)) = (ui.sent.last(), runs) {
        ui.model.apply(Event::JobRuns {
            ticket: *ticket,
            older: false,
            page,
        });
    }
}

/// Settings → Scheduled jobs with three jobs and their recent runs.
pub fn settings_jobs(ui: &mut Ui) {
    open_jobs(ui, Some(scheduled_jobs()), Some(job_runs()));
}

/// Scheduled jobs with the "Create a job" dialog open on a draft whose
/// date is not one.
pub fn settings_jobs_create(ui: &mut Ui) {
    settings_jobs(ui);
    ui.open_job_form();
    ui.job.name = TextEdit::new("Friday wrap-up");
    ui.job.prompt = TextEdit::new("Summarize what shipped this week and what slipped.");
    ui.job.minutes = TextEdit::new("10080");
    ui.job.date = TextEdit::new("next Friday");
    ui.job.time = TextEdit::new("16:30");
    ui.add_job();
}

/// Scheduled jobs before any job was created.
pub fn settings_jobs_empty(ui: &mut Ui) {
    let nothing = Paged {
        items: Vec::new(),
        next: None,
    };
    open_jobs(ui, Some(Vec::new()), Some(nothing));
}

/// Scheduled jobs before the jobs have arrived.
pub fn settings_jobs_loading(ui: &mut Ui) {
    open_jobs(ui, None, None);
}

/// A made-up listing of the top of a workspace, or of its `reports` folder.
pub fn workspace_listing(folder: bool) -> WorkspaceListing {
    let items = if folder {
        json!([
            {
                "path": "/workspace/reports/q3-summary.csv", "name": "q3-summary.csv",
                "kind": "file", "bytes": 48_211, "modifiedAt": 1_794_563_700_000_i64,
            },
            {
                "path": "/workspace/reports/q3-summary.md", "name": "q3-summary.md",
                "kind": "file", "bytes": 6_402, "modifiedAt": 1_794_563_760_000_i64,
            },
        ])
    } else {
        json!([
            {
                "path": "/workspace/reports", "name": "reports",
                "kind": "directory", "bytes": 0, "modifiedAt": 1_794_563_760_000_i64,
            },
            {
                "path": "/workspace/README.md", "name": "README.md",
                "kind": "file", "bytes": 1_180, "modifiedAt": 1_794_300_000_000_i64,
            },
            {
                "path": "/workspace/latest", "name": "latest",
                "kind": "symlink", "bytes": 0, "modifiedAt": 1_794_563_760_000_i64,
            },
            {
                "path": "/workspace/plan-2027.xlsx", "name": "plan-2027.xlsx",
                "kind": "file", "bytes": 2_411_724, "modifiedAt": 1_794_650_100_000_i64,
            },
        ])
    };
    serde_json::from_value(json!({
        "path": if folder { "/workspace/reports" } else { "/workspace" },
        "revision": 41,
        "items": items,
    }))
    .expect("the scene's workspace listing matches the contract")
}

fn open_workspace(ui: &mut Ui, listing: Option<WorkspaceListing>) {
    settings_account(ui);
    ui.model.apply(Event::Sandbox {
        bot_id: "default".into(),
        info: Box::new(sandbox_info(false)),
    });
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Workspace,
    }));
    if let Some(listing) = listing {
        // A listing of a folder below the top means the owner opened it.
        ui.model.files.open("default", &listing.path);
        ui.model.apply(Event::WorkspaceFiles {
            bot_id: "default".into(),
            listing,
        });
    }
}

/// Settings → Workspace at the top of the workspace.
pub fn settings_workspace(ui: &mut Ui) {
    open_workspace(ui, Some(workspace_listing(false)));
}

/// Workspace inside a folder, just after a file was downloaded.
pub fn settings_workspace_folder(ui: &mut Ui) {
    open_workspace(ui, Some(workspace_listing(true)));
    ui.model.files.saved = Some("q3-summary.csv".into());
}

/// Workspace before the bot wrote any file.
pub fn settings_workspace_empty(ui: &mut Ui) {
    let mut listing = workspace_listing(false);
    listing.items.clear();
    open_workspace(ui, Some(listing));
}

/// Workspace before the listing has arrived.
pub fn settings_workspace_loading(ui: &mut Ui) {
    open_workspace(ui, None);
}

/// Made-up sandbox details: just-bash as first installed, or a container
/// the owner has acknowledged.
pub fn sandbox_info(container: bool) -> SandboxInfo {
    let (id, name) = if container {
        ("container", "Container")
    } else {
        ("just-bash", "just-bash")
    };
    serde_json::from_value(json!({
        "settings": {
            "provider": id, "idleMinutes": 30,
            "diskQuotaMiB": if container { json!(4096) } else { Value::Null },
            "hostNetworkAcknowledged": container, "revision": 3,
        },
        "providers": [
            { "id": "just-bash", "name": "just-bash", "available": true, "reason": null },
            { "id": "container", "name": "Container", "available": true, "reason": null },
        ],
        "provider": { "id": id, "name": name, "version": "2.9.0" },
        "isolation": if container { "container" } else { "virtual-filesystem" },
        "capabilities": { "network": container, "hostFiles": false, "nativeCode": container },
        "root": "/workspace", "revision": 41,
        "executions": { "admitted": 1, "capacity": 8, "runtimeConcurrency": 4 },
        "usage": {
            "fileBytes": 18_874_368,
            "entries": if container { Value::Null } else { json!(1284) },
            "receiptBytes": if container { Value::Null } else { json!(412_672) },
        },
        "limits": {
            "timeoutMs": 120_000, "sourceBytes": 65_536, "outputBytes": 1_048_576,
            "fileBytes": if container { json!(4_294_967_296_u64) } else { json!(104_857_600) },
            "entries": if container { Value::Null } else { json!(10_000) },
            "receiptsBytes": if container { Value::Null } else { json!(10_485_760) },
        },
    }))
    .expect("the scene's sandbox details match the contract")
}

fn open_sandbox(ui: &mut Ui, info: Option<SandboxInfo>) {
    settings_account(ui);
    if let Some(info) = info {
        ui.model.apply(Event::Sandbox {
            bot_id: "default".into(),
            info: Box::new(info),
        });
    }
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Sandbox,
    }));
}

/// Settings → Sandbox on just-bash, nothing edited.
pub fn settings_sandbox(ui: &mut Ui) {
    open_sandbox(ui, Some(sandbox_info(false)));
}

/// Sandbox on a container, with the idle minutes edited so the save bar
/// shows.
pub fn settings_sandbox_container(ui: &mut Ui) {
    open_sandbox(ui, Some(sandbox_info(true)));
    ui.sandbox.idle = TextEdit::new("90");
}

/// Sandbox before the details have arrived.
pub fn settings_sandbox_loading(ui: &mut Ui) {
    open_sandbox(ui, None);
}

/// Made-up channels: Discord connected for two users, Telegram connected
/// with one verified account. `pairing` puts a pairing code out.
pub fn channel_settings(pairing: bool) -> ChannelSettings {
    serde_json::from_value(json!({
        "discord": {
            "allowedUserIds": ["318274650912345678", "402915873364512001"],
            "channelId": "", "connected": true, "tokenConfigured": true, "conflict": false,
        },
        "telegram": {
            "enabled": true, "connected": true, "tokenConfigured": true,
            "botUsername": "raphie_example_bot", "verifiedUserIds": ["7300112233"],
            "pairingExpiresAt": if pairing { json!(PAIRING_EXPIRES) } else { Value::Null },
            "problem": null,
        },
    }))
    .expect("the scene's channels match the contract")
}

/// When the scenes' pairing code expires.
const PAIRING_EXPIRES: i64 = 1_794_650_400_000;

/// A made-up home channel: one Telegram conversation, selected or not.
pub fn channel_home(selected: bool) -> ChannelHomeSettings {
    serde_json::from_value(json!({
        "selected": if selected { json!("telegram:7300112233") } else { Value::Null },
        "destinations": [{
            "id": "telegram:7300112233", "platform": "telegram",
            "conversationId": "telegram:7300112233", "userId": "7300112233",
        }],
    }))
    .expect("the scene's home channel matches the contract")
}

fn open_channels(ui: &mut Ui, settings: Option<ChannelSettings>, home: ChannelHomeSettings) {
    settings_account(ui);
    if let Some(settings) = settings {
        ui.model.apply(Event::Channels {
            bot_id: "default".into(),
            settings,
        });
        ui.model.apply(Event::ChannelHome {
            bot_id: "default".into(),
            home,
        });
    }
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Channels,
    }));
}

/// Settings → Channels with both services connected and a home channel.
pub fn settings_channels(ui: &mut Ui) {
    open_channels(ui, Some(channel_settings(false)), channel_home(true));
}

/// Channels with the Discord form open on an application another bot
/// already uses.
pub fn settings_channels_discord(ui: &mut Ui) {
    let mut settings = channel_settings(false);
    if let Some(discord) = &mut settings.discord {
        discord.connected = false;
        discord.conflict = true;
    }
    open_channels(ui, Some(settings), channel_home(true));
    ui.toggle_discord();
}

/// Channels with the Telegram panel open and a pairing code out.
pub fn settings_channels_telegram(ui: &mut Ui) {
    open_channels(ui, Some(channel_settings(true)), channel_home(false));
    ui.toggle_telegram();
    ui.model.telegram_pairing = Some((
        "default".into(),
        TelegramPairingCode {
            code: "K7Q2-M9XD".into(),
            expires_at: PAIRING_EXPIRES,
        },
    ));
}

/// Channels before anything was connected.
pub fn settings_channels_empty(ui: &mut Ui) {
    let nothing = ChannelSettings {
        discord: None,
        telegram: None,
    };
    let home = ChannelHomeSettings {
        selected: None,
        destinations: Vec::new(),
    };
    open_channels(ui, Some(nothing), home);
}

/// Channels before the settings have arrived.
pub fn settings_channels_loading(ui: &mut Ui) {
    let home = ChannelHomeSettings {
        selected: None,
        destinations: Vec::new(),
    };
    open_channels(ui, None, home);
}

/// Made-up MCP connections in each state a row can show: connected, waiting
/// for authorization, paused, and one set by the host's environment.
pub fn mcp_connections() -> Vec<McpConnection> {
    serde_json::from_value(json!([
        {
            "source": "saved", "id": "mcp-calendar", "name": "Calendar",
            "transport": "http", "address": "https://calendar.example.com/mcp",
            "enabled": true, "connected": true, "toolCount": 12, "credentialConfigured": true,
        },
        {
            "source": "saved", "id": "mcp-docs", "name": "Team docs",
            "transport": "http", "address": "https://docs.example.com/mcp",
            "enabled": true, "connected": false, "toolCount": 0, "credentialConfigured": false,
            "authorizationUrl": "https://docs.example.com/oauth/authorize?state=made-up",
        },
        {
            "source": "saved", "id": "mcp-files", "name": "Project files",
            "transport": "stdio", "address": "npx",
            "enabled": false, "connected": false, "toolCount": 0, "credentialConfigured": false,
        },
        {
            "source": "environment", "id": "env-search", "name": "Search",
            "transport": "stdio", "address": "uvx",
            "enabled": true, "connected": true, "toolCount": 4, "credentialConfigured": false,
        },
    ]))
    .expect("the scene's MCP connections match the contract")
}

fn open_mcp(ui: &mut Ui, connections: Option<Vec<McpConnection>>) {
    settings_account(ui);
    if let Some(items) = connections {
        ui.model.apply(Event::Mcp {
            bot_id: "default".into(),
            items,
        });
    }
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Mcp,
    }));
}

/// Settings → MCP tools with connections in every state.
pub fn settings_mcp(ui: &mut Ui) {
    open_mcp(ui, Some(mcp_connections()));
}

/// MCP tools with the form set to a local command whose arguments are not
/// a JSON array, so the form says so.
pub fn settings_mcp_command(ui: &mut Ui) {
    open_mcp(ui, Some(Vec::new()));
    ui.mcp.name = TextEdit::new("Project files");
    ui.mcp.choose(McpTransport::Stdio);
    ui.mcp.address = TextEdit::new("npx");
    ui.mcp.args = TextEdit::new("-y a-server");
    // A made-up value. The field is secure, so the snapshot shows dots.
    ui.mcp.env = TextEdit::new(r#"{"API_TOKEN":"not-a-real-token"}"#).secure();
    ui.add_mcp();
}

/// MCP tools before any server was connected.
pub fn settings_mcp_empty(ui: &mut Ui) {
    open_mcp(ui, Some(Vec::new()));
}

/// MCP tools before the connections have arrived.
pub fn settings_mcp_loading(ui: &mut Ui) {
    open_mcp(ui, None);
}

/// Made-up saved memories, newest first, as the runtime lists them.
pub fn memory_evidence() -> Vec<MemoryEvidence> {
    serde_json::from_value(json!([
        {
            "id": "mem_01jc8x2v7q", "kind": "fact", "revision": 2,
            "content": "Prefers short answers with the conclusion first, then the reasoning.",
            "source": "session:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/turn:t-204",
            "eventTime": 1_794_650_100_000_i64,
        },
        {
            "id": "mem_01jc7m4k2d", "kind": "experience", "revision": 1,
            "content": "Moved the weekly planning review to Friday mornings after two Mondays were lost to travel.",
            "source": "session:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/turn:t-188",
            "eventTime": 1_794_563_700_000_i64,
        },
        {
            "id": "mem_01jc5p9s8h", "kind": "fact", "revision": 1,
            "content": "Works in UTC+3 and keeps evenings after 19:00 free.",
            "source": "session:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/turn:t-121",
            "eventTime": 0,
        },
    ]))
    .expect("the scene's memories match the contract")
}

/// Opens Settings → Memory → Browse memory, and answers the list it asks
/// for with `page` (when the back end lists memories at all).
fn open_memories(ui: &mut Ui, hindsight: bool, page: Option<MemoryPage>) {
    settings_account(ui);
    ui.model.apply(Event::Memory {
        bot_id: "default".into(),
        status: memory_status(hindsight),
    });
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::MemoryBrowse,
    }));
    // The page asked for the first page; the answer carries its ticket.
    if let (Some(Command::BrowseMemory { ticket, .. }), Some(page)) = (ui.sent.last(), page) {
        ui.model.apply(Event::MemoryListed {
            ticket: *ticket,
            more: false,
            page,
        });
    }
}

/// Browse memory with a first page of saved memories, one source unfolded.
pub fn settings_memories(ui: &mut Ui) {
    open_memories(
        ui,
        false,
        Some(MemoryPage {
            evidence: memory_evidence(),
            next: Some("cursor-2".into()),
            total: 14,
        }),
    );
    ui.memories.open_sources.insert("mem_01jc8x2v7q".into());
}

/// Browse memory with one memory being corrected and another waiting on
/// "Confirm forget".
pub fn settings_memories_editing(ui: &mut Ui) {
    open_memories(
        ui,
        false,
        Some(MemoryPage {
            evidence: memory_evidence(),
            next: None,
            total: 3,
        }),
    );
    ui.correct_memory("mem_01jc8x2v7q");
    ui.memories.forgetting = Some("mem_01jc7m4k2d".into());
}

/// Browse memory on Hindsight, which searches but does not list.
pub fn settings_memories_search(ui: &mut Ui) {
    open_memories(ui, true, None);
}

/// Browse memory before anything was remembered.
pub fn settings_memories_empty(ui: &mut Ui) {
    open_memories(
        ui,
        false,
        Some(MemoryPage {
            evidence: Vec::new(),
            next: None,
            total: 0,
        }),
    );
}

/// Settings → Providers, with two connections.
pub fn settings_providers(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Providers,
    }));
    ui.model.apply(Event::BotSettings {
        bot_id: "default".into(),
        settings: Box::new(model_settings()),
    });
}

/// Settings → Providers for a bot with no connection yet.
pub fn settings_providers_empty(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::Bot {
        bot_id: "b-research".into(),
        section: BotSection::Providers,
    }));
    let mut settings = model_settings();
    settings.connections.clear();
    settings.models.clear();
    ui.model.apply(Event::BotSettings {
        bot_id: "b-research".into(),
        settings: Box::new(settings),
    });
}

/// Settings → Providers while editing a connection, after a test of a new
/// key failed.
pub fn settings_providers_edit(ui: &mut Ui) {
    settings_providers(ui);
    ui.edit_connection("c-router", "Work");
    ui.providers.key = TextEdit::new("sk-not-a-real-key").secure();
    ui.model.apply(Event::ConnectionFailed {
        message: "The provider rejected this API key.".into(),
    });
}

/// Settings → Providers while adding a connection, with a key typed.
pub fn settings_providers_add(ui: &mut Ui) {
    settings_providers(ui);
    ui.add_connection("default");
    ui.providers.name = TextEdit::new("Side project");
    // A made-up key. The field is secure, so the snapshot shows dots.
    ui.providers.key = TextEdit::new("sk-not-a-real-key").secure();
}

/// Settings with an OpenAI subscription offered next to the API-key
/// providers, as a runtime with subscriptions lists them.
fn subscription_settings() -> RuntimeSettings {
    let mut settings = model_settings();
    settings.providers = from_json(json!([
        { "id": "anthropic", "name": "Anthropic", "auth": ["api_key"] },
        { "id": "openrouter", "name": "OpenRouter", "auth": ["api_key"] },
        { "id": "openai", "name": "OpenAI", "auth": ["subscription"], "signInLabel": "Sign in with ChatGPT" }
    ]));
    settings
}

/// Settings → Providers adding an OpenAI subscription, waiting for the
/// owner: the page to open and the redirect address to paste, as Pi's
/// "Sign in with ChatGPT" asks.
pub fn settings_providers_sign_in(ui: &mut Ui) {
    settings_providers(ui);
    ui.model.apply(Event::BotSettings {
        bot_id: "default".into(),
        settings: Box::new(subscription_settings()),
    });
    ui.add_connection("default");
    ui.choose_connection_provider("openai");
    ui.model.apply(Event::ProviderSignIn {
        bot_id: "default".into(),
        sign_in: from_json(json!({
            "id": "sign-in-1", "provider": "openai", "name": "OpenAI 1", "status": "waiting",
            "events": [{ "type": "auth_url", "url": "https://auth.openai.com/oauth/authorize?state=x",
                         "instructions": "Complete sign-in in your browser." }],
            "prompt": { "id": "p-1", "type": "manual_code",
                        "message": "Complete login in your browser, or paste the final redirect URL here:",
                        "placeholder": "http://127.0.0.1:1455/auth/callback" }
        })),
    });
}

/// Settings → Providers with an OpenAI subscription whose sign-in expired.
pub fn settings_providers_subscription(ui: &mut Ui) {
    settings_providers(ui);
    let mut settings = subscription_settings();
    settings.connections.push(from_json(json!({
        "id": "openai_1", "provider": "openai", "name": "ChatGPT",
        "auth": "subscription", "needsSignIn": true
    })));
    ui.model.apply(Event::BotSettings {
        bot_id: "default".into(),
        settings: Box::new(settings),
    });
}

/// Settings → Models, with a catalogue loaded.
pub fn settings_models(ui: &mut Ui) {
    settings_account(ui);
    ui.open_settings(Some(Page::Bot {
        bot_id: "default".into(),
        section: BotSection::Models,
    }));
    ui.model.apply(Event::BotSettings {
        bot_id: "default".into(),
        settings: Box::new(model_settings()),
    });
}

/// Settings → Models with the "Model source" list open.
pub fn settings_models_filter(ui: &mut Ui) {
    settings_models(ui);
    ui.models.open = Some(Dropdown::Source);
}

/// A made-up catalogue: two connections, five models from three makers.
pub fn model_settings() -> RuntimeSettings {
    let model = |id: &str,
                 name: &str,
                 connection: (&str, &str),
                 vision: bool,
                 price: Option<(f64, f64)>| {
        json!({
            "id": id, "name": name, "provider": if connection.0 == "c-router" { "openrouter" } else { "anthropic" },
            "connectionId": connection.0, "connectionName": connection.1,
            "contextWindow": 1_000_000, "maxOutputTokens": 128_000, "reasoning": true,
            "inputModalities": if vision { json!(["text", "image"]) } else { json!(["text"]) },
            "pricing": price.map(|(input, output)| json!({ "input": input, "output": output }))
        })
    };
    let (router, direct) = (("c-router", "Work"), ("c-direct", "Personal"));
    from_json(json!({
        "telemetryEnabled": true, "provider": "c-direct", "providerEnabled": true,
        "credentialSource": "saved", "modelId": "claude-fable",
        "providers": [{ "id": "anthropic", "name": "Anthropic" }, { "id": "openrouter", "name": "OpenRouter" }],
        "connections": [
            { "id": "c-direct", "provider": "anthropic", "name": "Personal" },
            { "id": "c-router", "provider": "openrouter", "name": "Work" }
        ],
        "models": [
            model("claude-fable", "Claude Fable Latest", direct, true, Some((10.0, 50.0))),
            model("claude-haiku", "Claude Haiku Latest", direct, true, Some((1.0, 5.0))),
            model("anthropic/claude-opus", "Anthropic: Claude Opus", router, true, Some((5.0, 25.0))),
            model("openai/gpt-next", "OpenAI: GPT Next", router, false, Some((2.5, 0.075))),
            model("~meta-llama/llama-next", "Llama Next", router, false, None),
        ]
    }))
}

/// The same, with the conversations panel open.
pub fn conversations(ui: &mut Ui) {
    new_conversation(ui);
    ui.panel_open = true;
}

/// The conversations panel with replies not read yet: two new in one
/// conversation, and one that was read to its end.
pub fn unread(ui: &mut Ui) {
    conversations(ui);
    for session in &mut ui.model.sessions {
        session.reply_count = match session.id.as_str() {
            "s-1" => Some(3),
            "s-3" => Some(1),
            _ => None,
        };
    }
    // One of "Plan the week"'s three replies was read here; "Tea
    // preferences" was read to its end.
    let origin = ui
        .model
        .origin
        .as_ref()
        .map(|origin| origin.as_str().to_owned());
    if let Some(origin) = origin {
        ui.read_replies.read(&origin, "default", "s-1", 1);
        ui.read_replies.read(&origin, "default", "s-3", 1);
    }
}

/// The inbox with something of every kind: new replies in two bots, an
/// approval, a scheduled reply that is ready and a job that failed.
pub fn inbox(ui: &mut Ui) {
    unread(ui);
    let now = now_ms();
    // The Research bot's conversations, as the inbox's last round heard them.
    let papers: SessionSummary = from_json(json!({
        "id": "r-1", "title": "This week's papers", "origin": "web",
        "lastAt": now - 20 * 60_000, "working": false, "failed": false, "waiting": false,
        "preview": "Summarise the three new papers.",
        "replyPreview": "All three argue for smaller, cheaper evaluation sets.",
        "turnCount": 4, "replyCount": 2,
    }));
    ui.model.apply(Event::InboxSessions {
        bot_id: "b-research".into(),
        sessions: vec![papers],
    });
    let run = |id: &str, name: &str, status: &str, ago_ms: i64| -> JobRun {
        from_json(json!({
            "id": id, "jobId": "j-1", "name": name, "startedAt": now - ago_ms - 30_000,
            "finishedAt": now - ago_ms, "status": status, "sessionId": null, "turnId": null,
            "failureReason": if status == "failed" { json!("no_model") } else { json!(null) },
        }))
    };
    ui.model.apply(Event::JobUpdates {
        bot_id: "default".into(),
        updates: JobUpdates {
            runs: vec![run("run-2", "Morning brief", "failed", 26 * 3_600_000)],
            total: 1,
            more: false,
        },
    });
    ui.model.apply(Event::JobUpdates {
        bot_id: "b-research".into(),
        updates: JobUpdates {
            runs: vec![run("run-1", "Weekly digest", "interrupted", 2 * 3_600_000)],
            total: 1,
            more: false,
        },
    });
    ui.inbox_open = true;
}

/// The inbox with nothing in it.
pub fn inbox_empty(ui: &mut Ui) {
    conversation(ui);
    // Nothing waits for approval and no reply is new.
    for session in &mut ui.model.sessions {
        session.waiting = false;
    }
    ui.inbox_open = true;
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

/// The conversation with the composer's command permissions open, set
/// to run commands without asking.
pub fn permissions(ui: &mut Ui) {
    conversation(ui);
    ui.model.apply(Event::BotSettings {
        bot_id: "default".into(),
        settings: Box::new(model_settings()),
    });
    ui.model.command_mode.open("s-1");
    ui.model
        .command_mode
        .loaded("s-1", ApprovalMode::FullAccess);
    ui.permissions_open = true;
}

/// The conversation with the composer's model picker open.
pub fn model_picker(ui: &mut Ui) {
    conversation(ui);
    ui.model.apply(Event::BotSettings {
        bot_id: "default".into(),
        settings: Box::new(model_settings()),
    });
    ui.favorites = vec!["c-router:openai/gpt-next".into()];
    ui.open_model_picker();
}

/// The picker showing only the starred models.
pub fn model_picker_favorites(ui: &mut Ui) {
    model_picker(ui);
    ui.model_picker.filter = PickerFilter::Favorites;
}

/// The picker narrowed to one family, with the family list open.
pub fn model_picker_family(ui: &mut Ui) {
    model_picker(ui);
    ui.model_picker.filter = PickerFilter::Family("anthropic".into());
    ui.model_picker.family_open = true;
}

/// A message sent with two files, and two more waiting in the composer.
pub fn attachments(ui: &mut Ui) {
    // Ids are 64 hex digits, as the runtime's are.
    let file = |digit: &str, name: &str, size: u64, mime: &str| {
        json!({
            "id": digit.repeat(64), "name": name, "size": size,
            "path": format!("/workspace/uploads/{}/{name}", digit.repeat(64)),
            "mimeType": mime,
        })
    };
    let mut sent = turn(
        "t1",
        -300_000,
        "Compare the floor plan with the quote and tell me what is missing.",
        Some(
            "The quote leaves out the **second bathroom** shown on the plan, and prices the kitchen at 14 m² where the plan shows 17 m².",
        ),
        "done",
    );
    sent["attachments"] = json!([
        file("a", "floor-plan.png", 1_843_200, "image/png"),
        file(
            "b",
            "Renovation quote (revised, with appendix).pdf",
            412_314,
            "application/pdf"
        ),
    ]);
    open(
        ui,
        "s-1",
        observation("Renovation quote", vec![sent], None, "idle", vec![], vec![]),
    );
    let bot_id = ui.model.bot_id.clone().unwrap_or_else(|| "default".into());
    ui.model.attachments.begin(&bot_id, 2);
    for waiting in [
        file("c", "site-photo.png", 2_306_867, "image/png"),
        file("d", "measurements.csv", 812, "application/octet-stream"),
    ] {
        let waiting = serde_json::from_value(waiting).expect("an attachment");
        ui.model.attachments.added(&bot_id, waiting);
    }
    ui.model.attachments.finished(&bot_id);
    ui.composer = TextEdit::new("And these two from this morning.");
    // Their pictures, as if fetched. Drawn as SVG so no image file is kept
    // in the repository; the decoder reads the format from the bytes.
    for (digit, picture) in [("a", FLOOR_PLAN_SVG), ("c", SITE_PHOTO_SVG)] {
        let id = digit.repeat(64);
        ui.model.previews.begin(&bot_id, &id);
        let bytes = FileBytes::from(picture.as_bytes().to_vec());
        ui.model.previews.loaded(&bot_id, &id, bytes);
    }
}

/// The floor plan from `attachments`, shown enlarged.
pub fn image_viewer(ui: &mut Ui) {
    attachments(ui);
    let bot_id = ui.model.bot_id.clone().unwrap_or_else(|| "default".into());
    ui.open_viewer(&bot_id, &"a".repeat(64), "floor-plan.png");
}

/// A made-up floor plan: walls on paper. No text: the SVG renderer has
/// no fonts.
const FLOOR_PLAN_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
<rect width="400" height="260" fill="#f4f1e8"/>
<g fill="none" stroke="#3b4a5c" stroke-width="6">
<rect x="30" y="30" width="340" height="200"/>
<path d="M200 30v120M200 190v40M30 130h110M260 130h110M260 130v100"/>
</g>
</svg>"##;

/// A made-up site photo: sky, a hill and a house.
const SITE_PHOTO_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#8fb8de"/><stop offset="1" stop-color="#dbe8f2"/></linearGradient></defs>
<rect width="300" height="300" fill="url(#sky)"/>
<circle cx="230" cy="70" r="28" fill="#f3d27a"/>
<path d="M0 210 Q150 150 300 200 V300 H0 Z" fill="#7fa36b"/>
<rect x="95" y="160" width="90" height="70" fill="#d9c7a7"/>
<path d="M85 165 L140 120 L195 165 Z" fill="#a4553f"/>
<rect x="128" y="195" width="24" height="35" fill="#6b4a33"/>
</svg>"##;

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
