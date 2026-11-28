// Disclosure of observed tool work inside one reply. Settled work is one quiet
// line in the bot's words; opening it lists what the bot did, and the tools,
// arguments and timings wait behind "Technical details". A pending approval
// forces it open because it needs the owner.
import {
  Check,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  ShieldQuestion,
  X,
} from "lucide-react";
import { useState } from "react";

import { type Approval } from "../../../infrastructure/http/api-client";
import { CodeBlock } from "../../../shared/ui/code-block";
import {
  formatDuration,
  type ToolStep,
} from "../../conversations/application/run-projection";
import {
  isPlumbing,
  serviceName,
  stepsSummary,
  toolPhrase,
  toolWords,
} from "../../conversations/application/tool-phrases";
import { useConnectionNames } from "../../settings/infrastructure/use-bot-automation";
import { ToolDecision } from "./tool-decision";

function approvalState(approval: Approval) {
  if (approval.execution === "uncertain") return "uncertain";
  if (approval.status === "pending")
    return approval.expiresAt <= Date.now() ? "expired" : "pending";
  return approval.status;
}

export function stepState(step: ToolStep, working: boolean) {
  const approval = step.approval && approvalState(step.approval);
  if (approval === "pending") return "pending";
  if (step.failed || approval === "uncertain") return "uncertain";
  if (approval === "rejected" || approval === "expired") return "rejected";
  // Once the reply is finished nothing is still running, even a call whose
  // end the journal missed.
  return step.doneAt || !working ? "done" : "running";
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
  decide = true,
}: {
  steps: ToolStep[];
  working: boolean;
  activeLabel?: string;
  elapsed?: string;
  /**
   * Whether a pending approval is decided here. In a chat, the dock on the
   * composer decides it, and the steps only mark that it waits.
   */
  decide?: boolean;
}) {
  const names = useConnectionNames();
  const service = (step: ToolStep) =>
    step.connection ? names.get(step.connection) : undefined;
  const needsYou = steps.some((s) => stepState(s, working) === "pending");
  const [open, setOpen] = useState(false);
  const [technical, setTechnical] = useState(false);
  // How the bot works shows only in the details, unless it went wrong.
  const did = steps.filter(
    (s) => !isPlumbing(s) || stepState(s, working) !== "done",
  );
  if (!working && !needsYou && !did.length) return null;
  const first = steps[0]?.startedAt;
  const last = Math.max(...steps.map((s) => s.doneAt ?? s.startedAt));
  const label = needsYou
    ? decide
      ? "Waiting for your approval"
      : "Needs your approval"
    : working
      ? (activeLabel ?? "Working on it…")
      : stepsSummary(did, service);
  const expanded = open || (needsYou && decide);
  return (
    <section
      className={`steps ${needsYou ? "steps-attention" : ""}`}
      aria-label="Tool activity"
    >
      <button
        className="steps-header"
        title={
          !working && first
            ? `${steps.length} ${steps.length === 1 ? "tool" : "tools"} · ${formatDuration(last - first)}`
            : undefined
        }
        aria-expanded={expanded}
        disabled={!steps.length || (needsYou && decide)}
        onClick={() => setOpen(!open)}
      >
        {working && !needsYou ? (
          <LoaderCircle size={14} className="spin" />
        ) : needsYou ? (
          <ShieldQuestion size={14} />
        ) : (
          <span className="steps-dot" aria-hidden="true" />
        )}
        <span className={working && !needsYou ? "shimmer" : ""}>{label}</span>
        {working && elapsed && (
          <span className="run-elapsed" aria-hidden="true">
            {elapsed} elapsed
          </span>
        )}
        {steps.length > 0 && !(needsYou && decide) && (
          <ChevronRight size={14} className="steps-chevron" />
        )}
      </button>
      {expanded &&
        (needsYou && decide ? (
          <TechnicalSteps
            steps={steps}
            working={working}
            decide={decide}
            service={service}
          />
        ) : (
          <div className="steps-detail">
            {did.length > 0 && (
              <ul className="steps-did">
                {did.map((step) => (
                  <li
                    key={step.id}
                    className={`did did-${stepState(step, working)}`}
                  >
                    {/* One thing done is already the header's line. */}
                    {did.length > 1 && (
                      <span className="did-what">
                        {toolPhrase(step, service(step))}
                      </span>
                    )}
                    <DidNote
                      step={step}
                      working={working}
                      service={service(step)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <button
              className="steps-technical"
              aria-expanded={technical}
              onClick={() => setTechnical(!technical)}
            >
              {technical ? "Hide technical details" : "Technical details"}
            </button>
            {technical && (
              <TechnicalSteps
                steps={steps}
                working={working}
                decide={decide}
                service={service}
              />
            )}
          </div>
        ))}
    </section>
  );
}

/**
 * What the owner may want to know about one thing the bot did: the service
 * and tool it used, and anything about it that was not routine.
 */
function DidNote({
  step,
  working,
  service,
}: {
  step: ToolStep;
  working: boolean;
  service?: string;
}) {
  const state = stepState(step, working);
  const approval = step.approval;
  const notes = [
    step.server || step.connection
      ? `${serviceName(step, service)} · ${toolWords(step)}`
      : undefined,
    state === "pending"
      ? "needs your approval"
      : state === "uncertain"
        ? "outcome unknown"
        : state === "rejected"
          ? approval && approvalState(approval) === "expired"
            ? "approval expired"
            : "you declined"
          : state === "running"
            ? "in progress"
            : // Only a decision the owner made is worth repeating to them.
              approval?.decidedVia || approval?.decidedApp
              ? "you approved"
              : undefined,
  ].filter(Boolean);
  return notes.length ? (
    <span className="did-note">{notes.join(" · ")}</span>
  ) : null;
}

function TechnicalSteps({
  steps,
  working,
  decide,
  service,
}: {
  steps: ToolStep[];
  working: boolean;
  decide: boolean;
  service: (step: ToolStep) => string | undefined;
}) {
  return (
    <ol className="steps-list">
      {steps.map((step) => (
        <Step
          key={step.id}
          step={step}
          working={working}
          decide={decide}
          service={service(step)}
        />
      ))}
    </ol>
  );
}

function Step({
  step,
  working,
  decide,
  service,
}: {
  step: ToolStep;
  working: boolean;
  decide: boolean;
  service?: string;
}) {
  const state = stepState(step, working);
  const approval = step.approval;
  const args = approval?.argumentsJson ?? step.args;
  return (
    <li className={`step step-${state}`}>
      <span className="step-icon">{icons[state]}</span>
      <details className="step-body" open={state === "pending" && decide}>
        <summary>
          <span className="step-name">
            {(step.server || step.connection) && (
              <span>{serviceName(step, service)}</span>
            )}
            <code>{step.tool}</code>
          </span>
          <span className="step-status">
            {state === "pending"
              ? "needs approval"
              : state === "uncertain"
                ? "outcome unknown"
                : approval
                  ? `${approvalState(approval)}${approval.decidedApp === "desktop" ? " via desktop app" : approval.decidedVia ? ` via ${approval.decidedVia}` : ""}`
                  : state === "running"
                    ? "running"
                    : step.doneAt
                      ? formatDuration(step.doneAt - step.startedAt)
                      : "finished"}
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
      {state === "pending" && approval && decide && (
        <ToolDecision approval={approval} />
      )}
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
