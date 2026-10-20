import type {
  ActivityEvent,
  ToolApprovalView as Approval,
} from "@raphie/contracts";

export type ToolStep = {
  id: string;
  server?: string;
  tool: string;
  startedAt: number;
  doneAt?: number;
  args?: string;
  result?: string;
  failed?: boolean;
  approval?: Approval;
};

export function activeRunLabel(
  live: { generating: boolean; text: string } | undefined,
  steps: ToolStep[],
  activity: ActivityEvent[],
) {
  const latest = activity.findLast((e) =>
    /^(model\.(started|completed|retry)|tool\.(started|completed))$/.test(
      e.type,
    ),
  );
  if (latest?.type === "model.retry") return "Retrying model…";
  if (latest?.type === "tool.started") {
    const step = steps.find((s) => s.id === latest.operationId);
    return step
      ? `Running ${step.server ? `${step.server} · ` : ""}${step.tool}…`
      : "Running tool…";
  }
  if (live?.generating && live.text) return "Writing reply…";
  if (
    latest?.type === "model.completed" &&
    details(latest).stopReason === "toolUse"
  )
    return "Preparing tool call…";
  return "Waiting for model…";
}

function details(event: ActivityEvent): Record<string, unknown> {
  try {
    return JSON.parse(event.detailsJson);
  } catch {
    return {};
  }
}

// The journal is the only record of tool calls inside a run. Approval events
// carry the approval id as operationId; execution events after a decision have
// no runId, so they are matched through that approval id.
export function toolSteps(
  runId: string,
  activity: ActivityEvent[],
  approvals: Approval[],
): ToolStep[] {
  const steps: ToolStep[] = [];
  for (const event of activity) {
    if (event.runId === runId && event.type === "tool.started") {
      const name = event.summary.replace(/ started$/, "");
      const mcp = /^mcp_([^_]+)_(.+)$/.exec(name);
      steps.push({
        id: event.operationId ?? String(event.id),
        server: mcp?.[1],
        tool: mcp?.[2] ?? name,
        startedAt: event.at,
        args: event.detailsJson === "{}" ? undefined : event.detailsJson,
      });
    } else if (event.runId === runId && event.type === "tool.completed") {
      const step = steps.find((s) => s.id === event.operationId);
      if (step) step.doneAt = event.at;
    } else if (event.runId === runId && event.type === "approval.requested") {
      const step = steps.at(-1);
      const approval = approvals.find((a) => a.id === event.operationId);
      if (step && approval) step.approval = approval;
    } else if (event.type.startsWith("action.") && event.operationId) {
      const step = steps.find((s) => s.approval?.id === event.operationId);
      if (!step) continue;
      if (event.type === "action.completed") {
        const text = details(event).text;
        step.result = typeof text === "string" ? text : event.detailsJson;
      } else if (/failed|uncertain/.test(event.type)) step.failed = true;
    }
  }
  return steps;
}

export function runUsage(runId: string, activity: ActivityEvent[]) {
  let tokens = 0;
  let cost = 0;
  let calls = 0;
  for (const event of activity) {
    if (event.runId !== runId || event.type !== "model.completed") continue;
    const usage = details(event).usage as
      | { totalTokens?: number; cost?: { total?: number } }
      | undefined;
    tokens += usage?.totalTokens ?? 0;
    cost += usage?.cost?.total ?? 0;
    calls++;
  }
  return calls ? { tokens, cost, calls } : undefined;
}

export function formatTokens(value: number) {
  return value < 1000
    ? String(value)
    : `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

export function formatCost(value: number) {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function relativeTime(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
