import type { MemoryStatus } from "@raphie/contracts";
import { Database, Eraser, Network } from "lucide-react";

import { Group, Row } from "./settings-group";

/** What the active memory backend can do for this bot. */
export function MemoryCapabilities({ status }: { status: MemoryStatus }) {
  const provider = status.capabilities.reflect === "provider";
  const revise = status.capabilities.revise;
  return (
    <Group title="Available on this backend">
      <Row
        icon={<Database size={16} />}
        title="Retain and recall"
        description="Explicit memory tools, source references and a bounded search result."
      />
      <Row
        icon={<Network size={16} />}
        title={provider ? "Provider reflection" : "Model-assisted reflection"}
        description={
          provider
            ? "Hindsight reasons over memories and manages consolidation. Use a dedicated bank; scope tags are retrieval filters, not tenant isolation."
            : "The agent reasons from local evidence and cites its IDs. Derived reflections are not stored as facts."
        }
      />
      <Row
        icon={<Eraser size={16} />}
        title="Correct and forget"
        description={
          revise
            ? "Edit or remove built-in evidence from Browse memory, or ask the agent. Chat transcripts and backups are separate."
            : "Manage corrections and deletions directly in Hindsight. These actions are not available through Raphie yet."
        }
      >
        <span className="settings-value">
          {revise ? "Available" : "External"}
        </span>
      </Row>
    </Group>
  );
}
