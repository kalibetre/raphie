/** When a session's earlier messages are summarized, for a model's window. */
export type CompactionPolicy = {
  /** Room kept for the reply: the turn waits for a summary above `window - reserveTokens`. */
  reserveTokens: number;
  /** About how much recent conversation stays word for word. */
  keepRecentTokens: number;
  /** A summary starts in the background this far below the waiting threshold. */
  backgroundTokens: number;
};

/**
 * Thresholds as fractions of the window, capped at the library's defaults, so
 * a large window keeps them and a small one is not summarized on every turn.
 * A 200k window waits above ~184k and starts in the background at ~154k; a
 * 32k window at ~29k and ~24k, keeping ~8k word for word.
 */
export function compactionPolicy(contextWindow: number): CompactionPolicy {
  return {
    reserveTokens: Math.min(16_384, Math.round(contextWindow * 0.1)),
    keepRecentTokens: Math.min(20_000, Math.round(contextWindow * 0.25)),
    backgroundTokens: Math.min(32_768, Math.round(contextWindow * 0.15)),
  };
}

const SUMMARY =
  /^The conversation history before this point was compacted into the following summary:\s*<summary>\s*([\s\S]*?)\s*<\/summary>\s*$/;

/** The summary text inside the harness's summary message. */
export function summaryText(message: string) {
  return SUMMARY.exec(message)?.[1] ?? message;
}
