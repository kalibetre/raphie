import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/ui/tooltip";
import { formatCost, formatTokens } from "../application/run-projection";

// A pie: a stroke as wide as its circle's diameter fills a wedge.
const RADIUS = 3.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How full the model's context is, as a small pie beside Send. Its tooltip
 * gives the numbers, and what the conversation has used and cost so far.
 */
export function ContextRing({
  used,
  window,
  usage,
}: {
  /** Tokens in the conversation's latest model call; none before the first. */
  used?: number;
  /** The model's context window, once the model list has loaded. */
  window?: number;
  /** Provider-reported totals for the whole conversation. */
  usage?: { tokens: number; cost: number };
}) {
  if (!window) return null;
  const share = Math.min(1, (used ?? 0) / window);
  const percent = Math.round(share * 100);
  const context = `Context: ${formatTokens(used ?? 0)} of ${formatTokens(window)} tokens (${percent}%)`;
  const spent = usage
    ? `This conversation: ${usage.tokens.toLocaleString()} tokens, ${formatCost(usage.cost)}`
    : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="context-ring"
            role="img"
            tabIndex={0}
            data-nearly-full={share >= 0.8 || undefined}
            aria-label={spent ? `${context}. ${spent}.` : `${context}.`}
          />
        }
      >
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <circle className="context-ring-track" cx="9" cy="9" r="7.5" />
          <circle
            className="context-ring-fill"
            cx="9"
            cy="9"
            r={RADIUS}
            strokeDasharray={`${share * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent>
        {context}
        {spent && (
          <>
            <br />
            {spent}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
