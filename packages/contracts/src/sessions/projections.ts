import type {
  SessionActivity as ActivityEvent,
  SessionApproval as Approval,
} from "./views.ts";

export type ToolStep = {
  id: string;
  /** The saved MCP connection the tool came from, by its id. */
  connection?: string;
  /** The namespace of a connection set in the environment. */
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
  /** What a running step is doing, in words; by default its tool. */
  doing?: (step: ToolStep) => string,
) {
  const latest = activity.findLast(
    (e) =>
      /^(model\.(started|completed|retry)|tool\.(started|completed))$/.test(
        e.type,
      ) ||
      // A summary the reply waits for; one in the background doesn't hold it up.
      (e.type.startsWith("compaction.") && details(e).blocking === true),
  );
  if (latest?.type === "compaction.started")
    return "Summarizing earlier messages…";
  if (latest?.type === "model.retry") return "Retrying model…";
  if (latest?.type === "tool.started") {
    const step = steps.find((s) => s.id === latest.operationId);
    if (step && doing) return `${doing(step)}…`;
    return step
      ? `Running ${step.server ? `${step.server} · ` : ""}${step.tool}…`
      : "Running tool…";
  }
  if (live?.generating && live.text) return "Writing…";
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
      // A saved connection's tools are named for its id: mcp_c_<id>_<tool>.
      const saved = /^mcp_c_([0-9a-f]{32})_(.+)$/.exec(name);
      const mcp = saved ? undefined : /^mcp_([^_]+)_(.+)$/.exec(name);
      steps.push({
        id: event.operationId ?? String(event.id),
        connection: saved ? connectionId(saved[1]) : undefined,
        server: mcp?.[1],
        tool: saved?.[2] ?? mcp?.[2] ?? name,
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

/** A connection's id as saved, from the hyphenless form in a tool name. */
function connectionId(hex: string) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function runUsage(runId: string, activity: ActivityEvent[]) {
  let tokens = 0;
  let cost = 0;
  let calls = 0;
  for (const event of activity) {
    if (event.runId !== runId || event.type !== "model.completed") continue;
    const usage = details(event).usage as
      { totalTokens?: number; cost?: { total?: number } } | undefined;
    tokens += usage?.totalTokens ?? 0;
    cost += usage?.cost?.total ?? 0;
    calls++;
  }
  return calls ? { tokens, cost, calls } : undefined;
}

/** How full the model's context is: the tokens of the conversation's latest
 * model call (its input, cached input and reply), or undefined before one. */
export function contextTokens(runIds: string[], activity: ActivityEvent[]) {
  const runs = new Set(runIds);
  let latest: { at: number; tokens: number } | undefined;
  for (const event of activity) {
    if (event.type !== "model.completed" || !runs.has(event.runId ?? ""))
      continue;
    const tokens = (
      details(event).usage as { totalTokens?: number } | undefined
    )?.totalTokens;
    if (tokens && (!latest || event.at >= latest.at))
      latest = { at: event.at, tokens };
  }
  return latest?.tokens;
}

export function formatTokens(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000)
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
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
