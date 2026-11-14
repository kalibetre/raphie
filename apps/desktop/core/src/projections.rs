//! What a run did, worked out from the session's activity journal: its tool
//! steps, its token use, and a label for what it is doing now.
//!
//! In sync with `packages/contracts/src/sessions/projections.ts`, which the
//! web workspace uses for the same screens. The functions keep that file's
//! names (in snake_case) and its rules; the tests pin its output.
//!
//! Everything here is a pure function of its arguments: no clock, no I/O.

use serde_json::Value;

use crate::contracts::{
    ApprovalStatus, Execution, LiveConversation, SessionActivity, SessionApproval, SessionTurn,
};

/// One tool call inside a run.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolStep {
    /// The tool call's id (or the event's, when the journal has none).
    pub id: String,
    /// The MCP server the tool belongs to, if it is an MCP tool.
    pub server: Option<String>,
    pub tool: String,
    pub started_at: i64,
    pub done_at: Option<i64>,
    /// The arguments as JSON text.
    pub args: Option<String>,
    /// What an approved action returned.
    pub result: Option<String>,
    pub failed: bool,
    /// The owner decision this call needed, if any.
    pub approval: Option<SessionApproval>,
}

/// The tool calls of run `run_id` (a turn id), in order.
///
/// The journal is the only record of tool calls inside a run. Approval events
/// carry the approval id as `operation_id`; execution events after a decision
/// have no `run_id`, so they are matched through that approval id.
pub fn tool_steps(
    run_id: &str,
    activity: &[SessionActivity],
    approvals: &[SessionApproval],
) -> Vec<ToolStep> {
    let mut steps: Vec<ToolStep> = Vec::new();
    for event in activity {
        let in_run = event.run_id.as_deref() == Some(run_id);
        // `match` on a tuple reads like a table: which run, which event.
        match (in_run, event.kind.as_str()) {
            (true, "tool.started") => {
                let name = event
                    .summary
                    .strip_suffix(" started")
                    .unwrap_or(&event.summary);
                let (server, tool) = split_mcp_name(name);
                steps.push(ToolStep {
                    id: event
                        .operation_id
                        .clone()
                        .unwrap_or_else(|| event.id.to_string()),
                    server: server.map(str::to_owned),
                    tool: tool.to_owned(),
                    started_at: event.at,
                    done_at: None,
                    args: (event.details_json != "{}").then(|| event.details_json.clone()),
                    result: None,
                    failed: false,
                    approval: None,
                });
            }
            (true, "tool.completed") => {
                // `iter_mut` hands out mutable references, so the step found
                // can be changed in place.
                if let Some(step) = steps
                    .iter_mut()
                    .find(|step| Some(&step.id) == event.operation_id.as_ref())
                {
                    step.done_at = Some(event.at);
                }
            }
            (true, "approval.requested") => {
                let approval = approvals
                    .iter()
                    .find(|approval| Some(&approval.id) == event.operation_id.as_ref());
                if let (Some(step), Some(approval)) = (steps.last_mut(), approval) {
                    step.approval = Some(approval.clone());
                }
            }
            (_, kind) if kind.starts_with("action.") => {
                let Some(operation_id) = &event.operation_id else {
                    continue;
                };
                let Some(step) = steps.iter_mut().find(|step| {
                    step.approval
                        .as_ref()
                        .is_some_and(|approval| &approval.id == operation_id)
                }) else {
                    continue;
                };
                if kind == "action.completed" {
                    let text = details(event)
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    step.result = Some(text.unwrap_or_else(|| event.details_json.clone()));
                } else if kind.contains("failed") || kind.contains("uncertain") {
                    step.failed = true;
                }
            }
            _ => {}
        }
    }
    steps
}

/// `mcp_<server>_<tool>` is an MCP tool; anything else is a built-in tool.
fn split_mcp_name(name: &str) -> (Option<&str>, &str) {
    let parts = name
        .strip_prefix("mcp_")
        .and_then(|rest| rest.split_once('_'))
        .filter(|(server, tool)| !server.is_empty() && !tool.is_empty());
    match parts {
        Some((server, tool)) => (Some(server), tool),
        None => (None, name),
    }
}

/// An event's `details_json`, or an empty object if it is not JSON.
fn details(event: &SessionActivity) -> Value {
    serde_json::from_str(&event.details_json).unwrap_or(Value::Null)
}

/// Every turn's tool steps, in the turns' order.
///
/// The journal is capped, so an approval whose events rolled off still shows:
/// it joins the turn that was the newest when it was requested.
pub fn steps_by_turn<'a>(
    turns: &[&'a SessionTurn],
    activity: &[SessionActivity],
    approvals: &[SessionApproval],
) -> Vec<(&'a SessionTurn, Vec<ToolStep>)> {
    let mut by_turn: Vec<(&SessionTurn, Vec<ToolStep>)> = turns
        .iter()
        .map(|turn| (*turn, tool_steps(&turn.id, activity, approvals)))
        .collect();
    for approval in approvals {
        let shown = by_turn.iter().any(|(_, steps)| {
            steps
                .iter()
                .any(|step| step.approval.as_ref().is_some_and(|a| a.id == approval.id))
        });
        if shown {
            continue;
        }
        let owner = by_turn
            .iter_mut()
            .rev()
            .find(|(turn, _)| turn.created_at <= approval.created_at);
        if let Some((_, steps)) = owner {
            steps.push(ToolStep {
                id: approval.id.clone(),
                server: Some(approval.server.clone()),
                tool: approval.tool.clone(),
                started_at: approval.created_at,
                done_at: None,
                args: None,
                result: None,
                failed: false,
                approval: Some(approval.clone()),
            });
        }
    }
    by_turn
}

/// Where an approval stands for the owner at time `now`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalState {
    Pending,
    Approved,
    Rejected,
    Expired,
    /// The action may have run; the runtime could not tell.
    Uncertain,
}

/// The web's `approvalState`: a pending approval past its deadline reads as
/// expired even before the runtime says so.
pub fn approval_state(approval: &SessionApproval, now: i64) -> ApprovalState {
    if approval.execution == Execution::Uncertain {
        return ApprovalState::Uncertain;
    }
    match approval.status {
        ApprovalStatus::Pending if approval.expires_at <= now => ApprovalState::Expired,
        ApprovalStatus::Pending => ApprovalState::Pending,
        ApprovalStatus::Approved => ApprovalState::Approved,
        ApprovalStatus::Rejected => ApprovalState::Rejected,
        ApprovalStatus::Expired | ApprovalStatus::Unknown => ApprovalState::Expired,
    }
}

/// How a step looks in the list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepState {
    /// Waiting for the owner's decision.
    Pending,
    Running,
    Done,
    /// Rejected, or its approval expired.
    Rejected,
    /// Failed, or may have run.
    Uncertain,
}

/// The web's `stepState`.
pub fn step_state(step: &ToolStep, now: i64) -> StepState {
    let approval = step.approval.as_ref().map(|a| approval_state(a, now));
    match approval {
        Some(ApprovalState::Pending) => StepState::Pending,
        _ if step.failed => StepState::Uncertain,
        Some(ApprovalState::Uncertain) => StepState::Uncertain,
        Some(ApprovalState::Rejected | ApprovalState::Expired) => StepState::Rejected,
        _ if step.done_at.is_some() => StepState::Done,
        _ => StepState::Running,
    }
}

/// What a run's model calls cost.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RunUsage {
    pub tokens: u64,
    /// In US dollars, as the provider reported it.
    pub cost: f64,
    /// How many model calls the run made.
    pub calls: u32,
}

/// The usage of run `run_id`, or `None` if no model call finished yet.
pub fn run_usage(run_id: &str, activity: &[SessionActivity]) -> Option<RunUsage> {
    let mut usage = RunUsage {
        tokens: 0,
        cost: 0.0,
        calls: 0,
    };
    for event in model_completions(run_id, activity) {
        let details = details(event);
        let reported = &details["usage"];
        usage.tokens += reported["totalTokens"].as_u64().unwrap_or(0);
        usage.cost += reported["cost"]["total"].as_f64().unwrap_or(0.0);
        usage.calls += 1;
    }
    (usage.calls > 0).then_some(usage)
}

/// When run `run_id` last heard from the model: the time shown under a reply.
pub fn completed_at(run_id: &str, activity: &[SessionActivity]) -> Option<i64> {
    model_completions(run_id, activity)
        .last()
        .map(|event| event.at)
}

/// `impl Iterator` returns "some iterator" without naming its type; the
/// `'a` says its items borrow from `activity`.
fn model_completions<'a>(
    run_id: &'a str,
    activity: &'a [SessionActivity],
) -> impl Iterator<Item = &'a SessionActivity> {
    activity.iter().filter(move |event| {
        event.run_id.as_deref() == Some(run_id) && event.kind == "model.completed"
    })
}

/// What a run in progress is doing, from its own `activity` (the events of
/// that run only) and the reply text so far.
pub fn active_run_label(
    live: Option<&LiveConversation>,
    steps: &[ToolStep],
    activity: &[SessionActivity],
) -> String {
    let latest = activity.iter().rev().find(|event| {
        matches!(
            event.kind.as_str(),
            "model.started" | "model.completed" | "model.retry" | "tool.started" | "tool.completed"
        )
    });
    let kind = latest.map(|event| event.kind.as_str());
    if kind == Some("model.retry") {
        return "Retrying model…".into();
    }
    if let (Some("tool.started"), Some(event)) = (kind, latest) {
        let step = steps
            .iter()
            .find(|step| Some(&step.id) == event.operation_id.as_ref());
        return match step {
            Some(ToolStep {
                server: Some(server),
                tool,
                ..
            }) => format!("Running {server} · {tool}…"),
            Some(step) => format!("Running {}…", step.tool),
            None => "Running tool…".into(),
        };
    }
    if live.is_some_and(|live| live.generating && !live.text.is_empty()) {
        return "Writing reply…".into();
    }
    let wants_tool = latest.is_some_and(|event| {
        event.kind == "model.completed" && details(event)["stopReason"] == "toolUse"
    });
    if wants_tool {
        "Preparing tool call…".into()
    } else {
        "Waiting for model…".into()
    }
}

/// Tool arguments laid out for reading (the web's `pretty` in
/// `tool-steps.tsx`): indented JSON, or `key:` blocks when a value is a
/// multi-line string, since code reads better unescaped. Text that is not
/// JSON comes back unchanged, so the owner always sees what will run.
pub fn pretty(json: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(json) else {
        return json.to_owned();
    };
    let indented = |value: &Value| serde_json::to_string_pretty(value).unwrap_or_default();
    if let Value::Object(fields) = &value {
        let multiline = fields
            .values()
            .any(|field| field.as_str().is_some_and(|text| text.contains('\n')));
        if multiline {
            let blocks: Vec<String> = fields
                .iter()
                .map(|(key, field)| match field {
                    Value::String(text) => format!("{key}:\n{text}"),
                    other => format!("{key}:\n{}", indented(other)),
                })
                .collect();
            return blocks.join("\n\n");
        }
    }
    indented(&value)
}

/// "88", "1.3k", "12k".
pub fn format_tokens(value: u64) -> String {
    if value < 1000 {
        return value.to_string();
    }
    let thousands = value as f64 / 1000.0;
    let digits = if value < 10_000 { 1 } else { 0 };
    format!("{}k", to_fixed(thousands, digits))
}

/// "$0.0004" below a cent, "$0.13" from a cent up.
pub fn format_cost(value: f64) -> String {
    let digits = if value < 0.01 { 4 } else { 2 };
    format!("${}", to_fixed(value, digits))
}

/// "42s", "2m 5s".
pub fn format_duration(ms: i64) -> String {
    // Rounded to the nearest second, halves up, never negative.
    let seconds = ((ms + 500).div_euclid(1000)).max(0);
    if seconds < 60 {
        format!("{seconds}s")
    } else {
        format!("{}m {}s", seconds / 60, seconds % 60)
    }
}

/// JavaScript's `Number.prototype.toFixed` for a number that is not
/// negative: `value` with exactly `digits` decimals, a tie rounding up.
///
/// Rust's `{:.2}` rounds ties to the even digit ("0.12" for 0.125), where
/// JavaScript gives "0.13", so the last digit is rounded by hand here.
pub(crate) fn to_fixed(value: f64, digits: usize) -> String {
    // 30 decimals is far more than a token count or a price needs to be
    // written exactly, so a 5 in the next place means "half or more".
    let exact = format!("{value:.30}");
    let (whole, fraction) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut number: Vec<u8> = whole.bytes().chain(fraction.bytes().take(digits)).collect();
    let round_up = fraction.as_bytes().get(digits).is_some_and(|d| *d >= b'5');
    if round_up {
        // Add one to the last digit, carrying left through any nines.
        let mut index = number.len();
        loop {
            if index == 0 {
                number.insert(0, b'1');
                break;
            }
            index -= 1;
            if number[index] == b'9' {
                number[index] = b'0';
            } else {
                number[index] += 1;
                break;
            }
        }
    }
    let split = number.len() - digits;
    let text = String::from_utf8(number).unwrap_or_default();
    if digits == 0 {
        text
    } else {
        format!("{}.{}", &text[..split], &text[split..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(
        id: i64,
        at: i64,
        run_id: Option<&str>,
        operation_id: Option<&str>,
        kind: &str,
        summary: &str,
        details: Value,
    ) -> SessionActivity {
        SessionActivity {
            id,
            at,
            run_id: run_id.map(str::to_owned),
            operation_id: operation_id.map(str::to_owned),
            kind: kind.into(),
            summary: summary.into(),
            details_json: details.to_string(),
        }
    }

    fn approval(id: &str) -> SessionApproval {
        SessionApproval {
            id: id.into(),
            server: "calendar".into(),
            tool: "execute".into(),
            arguments_json: "{\"code\":\"x\"}".into(),
            created_at: 1500,
            expires_at: 9000,
            status: ApprovalStatus::Approved,
            decided_via: None,
            execution: Execution::Done,
            connection_identity: None,
        }
    }

    /// The journal the expected values below were computed from, by running
    /// projections.ts on the same events.
    fn journal() -> Vec<SessionActivity> {
        use serde_json::json;
        let none = || json!({});
        vec![
            event(
                1,
                1000,
                Some("t1"),
                None,
                "model.started",
                "model started",
                none(),
            ),
            event(
                2,
                1200,
                Some("t1"),
                None,
                "model.completed",
                "model completed",
                json!({"stopReason": "toolUse", "usage": {"totalTokens": 1250, "cost": {"total": 0.125}}}),
            ),
            event(
                3,
                1300,
                Some("t1"),
                Some("op-1"),
                "tool.started",
                "mcp_calendar_list_events started",
                json!({"date": "2026-10-21"}),
            ),
            event(
                4,
                2400,
                Some("t1"),
                Some("op-1"),
                "tool.completed",
                "mcp_calendar_list_events completed",
                none(),
            ),
            event(
                5,
                2500,
                Some("t1"),
                Some("op-2"),
                "tool.started",
                "bash started",
                none(),
            ),
            event(
                6,
                2600,
                Some("t1"),
                Some("ap-1"),
                "approval.requested",
                "approval requested",
                none(),
            ),
            event(
                7,
                4000,
                None,
                Some("ap-1"),
                "action.completed",
                "action completed",
                json!({"text": "3 events"}),
            ),
            event(
                8,
                4100,
                Some("t1"),
                Some("op-2"),
                "tool.completed",
                "bash completed",
                none(),
            ),
            event(
                9,
                4200,
                Some("t1"),
                None,
                "model.completed",
                "model completed",
                json!({"stopReason": "stop", "usage": {"totalTokens": 88, "cost": {"total": 0.00004}}}),
            ),
            event(
                10,
                5000,
                Some("t2"),
                Some("op-3"),
                "tool.started",
                "mcp_fixture_execute started",
                none(),
            ),
            event(
                11,
                5100,
                None,
                Some("ap-9"),
                "action.failed",
                "failed",
                none(),
            ),
        ]
    }

    #[test]
    fn tool_steps_match_the_web_projection() {
        let steps = tool_steps("t1", &journal(), &[approval("ap-1")]);
        assert_eq!(steps.len(), 2);
        let first = &steps[0];
        assert_eq!(
            (
                first.id.as_str(),
                first.server.as_deref(),
                first.tool.as_str()
            ),
            ("op-1", Some("calendar"), "list_events")
        );
        assert_eq!((first.started_at, first.done_at), (1300, Some(2400)));
        assert_eq!(first.args.as_deref(), Some("{\"date\":\"2026-10-21\"}"));
        assert!(first.approval.is_none() && first.result.is_none());

        let second = &steps[1];
        assert_eq!(
            (
                second.id.as_str(),
                second.server.as_deref(),
                second.tool.as_str()
            ),
            ("op-2", None, "bash")
        );
        assert_eq!(second.args, None, "empty details are no arguments");
        assert_eq!(
            second.approval.as_ref().map(|a| a.id.as_str()),
            Some("ap-1")
        );
        assert_eq!(second.result.as_deref(), Some("3 events"));
        assert_eq!(second.done_at, Some(4100));
        assert!(!second.failed);

        let other = tool_steps("t2", &journal(), &[approval("ap-1")]);
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].server.as_deref(), Some("fixture"));
        assert_eq!(other[0].done_at, None);
    }

    #[test]
    fn usage_adds_up_the_runs_model_calls() {
        let usage = run_usage("t1", &journal()).unwrap();
        assert_eq!((usage.tokens, usage.calls), (1338, 2));
        assert!((usage.cost - 0.12504).abs() < 1e-12);
        assert_eq!(run_usage("t9", &journal()), None);
        assert_eq!(completed_at("t1", &journal()), Some(4200));
    }

    #[test]
    fn the_run_label_follows_the_latest_event() {
        let journal = journal();
        let of_run = |run: &str| -> Vec<SessionActivity> {
            journal
                .iter()
                .filter(|e| e.run_id.as_deref() == Some(run))
                .cloned()
                .collect()
        };
        let writing = LiveConversation {
            text: "Hi".into(),
            generating: true,
        };
        let started = [event(
            1,
            1,
            Some("t"),
            Some("zz"),
            "tool.started",
            "bash started",
            Value::Null,
        )];
        let retry = [event(
            1,
            1,
            Some("t"),
            None,
            "model.retry",
            "retry",
            Value::Null,
        )];
        let t2_steps = tool_steps("t2", &journal, &[]);
        assert_eq!(
            active_run_label(None, &t2_steps, &of_run("t2")),
            "Running fixture · execute…"
        );
        assert_eq!(active_run_label(Some(&writing), &[], &[]), "Writing reply…");
        assert_eq!(
            active_run_label(None, &[], &journal[..2]),
            "Preparing tool call…"
        );
        assert_eq!(
            active_run_label(None, &[], &journal[..1]),
            "Waiting for model…"
        );
        assert_eq!(active_run_label(None, &[], &retry), "Retrying model…");
        assert_eq!(active_run_label(None, &[], &started), "Running tool…");
        assert_eq!(
            active_run_label(None, &tool_steps("t", &started, &[]), &started),
            "Running bash…"
        );
    }

    #[test]
    fn numbers_are_written_as_the_web_writes_them() {
        let tokens = [
            0, 88, 999, 1000, 1150, 1250, 1349, 9949, 9999, 10000, 10499, 10500, 123_456,
        ];
        let expected = [
            "0", "88", "999", "1.0k", "1.1k", "1.3k", "1.3k", "9.9k", "10.0k", "10k", "10k", "11k",
            "123k",
        ];
        assert_eq!(tokens.map(format_tokens), expected);

        let costs = [
            0.0, 0.00004, 0.00005, 0.0099, 0.00995, 0.01, 0.125, 0.375, 1.005, 12.3,
        ];
        let expected = [
            "$0.0000", "$0.0000", "$0.0001", "$0.0099", "$0.0100", "$0.01", "$0.13", "$0.38",
            "$1.00", "$12.30",
        ];
        assert_eq!(costs.map(format_cost), expected);

        let durations = [-5, 0, 499, 500, 1100, 59_499, 59_500, 60_000, 125_000];
        let expected = [
            "0s", "0s", "0s", "1s", "1s", "59s", "1m 0s", "1m 0s", "2m 5s",
        ];
        assert_eq!(durations.map(format_duration), expected);
    }

    #[test]
    fn an_approval_without_journal_events_joins_the_turn_of_its_time() {
        let turn = |id: &str, at: i64| -> SessionTurn {
            serde_json::from_value(serde_json::json!({
                "id": id, "source": "web", "text": "q", "createdAt": at,
                "status": "done", "answer": "a"
            }))
            .unwrap()
        };
        let (t1, t2) = (turn("t1", 1000), turn("t2", 2000));
        let orphan = approval("ap-7");
        let by_turn = steps_by_turn(&[&t1, &t2], &[], &[orphan]);
        assert!(by_turn[1].1.is_empty(), "requested before t2 began");
        assert_eq!(by_turn[0].1[0].approval.as_ref().unwrap().id, "ap-7");
        assert_eq!(by_turn[0].1[0].server.as_deref(), Some("calendar"));
    }

    #[test]
    fn arguments_are_laid_out_for_reading() {
        assert_eq!(
            pretty("{\"zeta\":1,\"alpha\":[true]}"),
            "{\n  \"zeta\": 1,\n  \"alpha\": [\n    true\n  ]\n}",
            "indented, keys in the order sent"
        );
        assert_eq!(
            pretty("{\"code\":\"a\\nb\",\"timeout\":5}"),
            "code:\na\nb\n\ntimeout:\n5",
            "multi-line strings are shown unescaped"
        );
        assert_eq!(pretty("not json"), "not json");
    }

    #[test]
    fn step_states_put_the_owners_decision_first() {
        let mut step = tool_steps("t2", &journal(), &[]).remove(0);
        assert_eq!(step_state(&step, 0), StepState::Running);
        step.done_at = Some(1);
        assert_eq!(step_state(&step, 0), StepState::Done);

        let mut pending = approval("ap");
        pending.status = ApprovalStatus::Pending;
        pending.execution = Execution::Waiting;
        step.approval = Some(pending.clone());
        assert_eq!(step_state(&step, 8999), StepState::Pending);
        assert_eq!(
            step_state(&step, 9000),
            StepState::Rejected,
            "past its deadline"
        );

        pending.execution = Execution::Uncertain;
        step.approval = Some(pending);
        assert_eq!(step_state(&step, 0), StepState::Uncertain);
    }
}
