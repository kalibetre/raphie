// Disclosure of observed tool work inside one reply. Settled work stays collapsed; a
// pending approval forces it open because it needs the owner.
import {
  Check,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  ShieldQuestion,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";

import { type Approval } from "../../../infrastructure/http/api-client";
import { CodeBlock } from "../../../shared/ui/code-block";
import {
  formatDuration,
  type ToolStep,
} from "../../conversations/application/run-projection";
import { ToolDecision } from "./tool-decision";

function approvalState(approval: Approval) {
  if (approval.execution === "uncertain") return "uncertain";
  if (approval.status === "pending")
    return approval.expiresAt <= Date.now() ? "expired" : "pending";
  return approval.status;
}

function stepState(step: ToolStep) {
  const approval = step.approval && approvalState(step.approval);
  if (approval === "pending") return "pending";
  if (step.failed || approval === "uncertain") return "uncertain";
  if (approval === "rejected" || approval === "expired") return "rejected";
  return step.doneAt ? "done" : "running";
}

const icons = {
  pending: <ShieldQuestion size={13} />,
  running: <LoaderCircle size={13} className="spin" />,
  done: <Check size={13} />,
  rejected: <X size={13} />,
  uncertain: <CircleAlert size={13} />,
};

export function ToolSteps({
  steps,
  working,
  activeLabel,
  elapsed,
}: {
  steps: ToolStep[];
  working: boolean;
  activeLabel?: string;
  elapsed?: string;
}) {
  const needsYou = steps.some((s) => stepState(s) === "pending");
  const [open, setOpen] = useState(false);
  const first = steps[0]?.startedAt;
  const last = Math.max(...steps.map((s) => s.doneAt ?? s.startedAt));
  const label = needsYou
    ? "Waiting for your approval"
    : working
      ? (activeLabel ??
        (steps.length
          ? `Working · ${steps.length} ${steps.length === 1 ? "step" : "steps"}`
          : "Waiting for model…"))
      : `Used ${steps.length} ${steps.length === 1 ? "tool" : "tools"}${first ? ` · ${formatDuration(last - first)}` : ""}`;
  const expanded = open || needsYou;
  return (
    <section
      className={`steps ${needsYou ? "steps-attention" : ""}`}
      aria-label="Tool activity"
    >
      <button
        className="steps-header"
        aria-expanded={expanded}
        disabled={!steps.length || needsYou}
        onClick={() => setOpen(!open)}
      >
        {working && !needsYou ? (
          <LoaderCircle size={14} className="spin" />
        ) : needsYou ? (
          <ShieldQuestion size={14} />
        ) : (
          <Wrench size={14} />
        )}
        <span className={working && !needsYou ? "shimmer" : ""}>{label}</span>
        {working && elapsed && (
          <span className="run-elapsed" aria-hidden="true">
            {elapsed} elapsed
          </span>
        )}
        {steps.length > 0 && !needsYou && (
          <ChevronRight size={14} className="steps-chevron" />
        )}
      </button>
      {expanded && (
        <ol className="steps-list">
          {steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Step({ step }: { step: ToolStep }) {
  const state = stepState(step);
  const approval = step.approval;
  const args = approval?.argumentsJson ?? step.args;
  return (
    <li className={`step step-${state}`}>
      <span className="step-icon">{icons[state]}</span>
      <details className="step-body" open={state === "pending"}>
        <summary>
          <span className="step-name">
            {step.server && <span>{step.server}</span>}
            <code>{step.tool}</code>
          </span>
          <span className="step-status">
            {state === "pending"
              ? "needs approval"
              : state === "uncertain"
                ? "outcome unknown"
                : approval
                  ? `${approvalState(approval)}${approval.decidedVia ? ` via ${approval.decidedVia}` : ""}`
                  : state === "done"
                    ? formatDuration((step.doneAt ?? 0) - step.startedAt)
                    : "running"}
          </span>
        </summary>
        {args && (
          <>
            <span className="step-label">Arguments</span>
            <CodeBlock>{pretty(args)}</CodeBlock>
          </>
        )}
        {step.result && (
          <>
            <span className="step-label">Result</span>
            <CodeBlock>{step.result}</CodeBlock>
          </>
        )}
        {state === "uncertain" && (
          <p role="alert" className="step-warning">
            This action may have executed. Check the external service before
            asking again.
          </p>
        )}
      </details>
      {state === "pending" && approval && <ToolDecision approval={approval} />}
    </li>
  );
}

function pretty(json: string) {
  try {
    const value = JSON.parse(json);
    // Code arguments read better unescaped than as one long JSON string.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (entries.some(([, v]) => typeof v === "string" && v.includes("\n")))
        return entries
          .map(
            ([k, v]) =>
              `${k}:\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`,
          )
          .join("\n\n");
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return json;
  }
}
