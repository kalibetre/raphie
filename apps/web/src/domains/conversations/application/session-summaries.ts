import type { SessionSummary } from "@raphie/contracts";

export type { SessionSummary };

export function sessionPreview(text: string) {
  return text
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
