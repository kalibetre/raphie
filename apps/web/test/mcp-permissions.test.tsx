import { expect, test } from "bun:test";

import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { ToolDecision } from "../src/domains/approvals/presentation/tool-decision";
import { McpPermissions } from "../src/domains/conversations/presentation/mcp-permissions";
import type { Approval } from "../src/infrastructure/http/api-client";
import { BackendContext } from "../src/infrastructure/http/backend-context";
import { BackendWorkspace } from "../src/infrastructure/http/backend-workspace";

function render(workspace: BackendWorkspace, content: React.ReactNode) {
  return renderToStaticMarkup(
    <BackendContext.Provider
      value={{ workspace, backend: workspace, selectBot: async () => {} }}
    >
      <QueryClientProvider client={workspace.queries}>
        {content}
      </QueryClientProvider>
    </BackendContext.Provider>,
  );
}

test("approval offers separate once, session and reject controls with truthful scope", () => {
  const workspace = new BackendWorkspace("http://127.0.0.1:4317");
  try {
    const html = render(
      workspace,
      <ToolDecision
        approval={{ id: "approval", expiresAt: Date.now() + 60000 } as Approval}
      />,
    );
    expect(html).toContain("Approve once");
    expect(html).toContain("Approve for session");
    expect(html).toContain("Reject");
    expect(html).toContain("any arguments for this conversation");
  } finally {
    workspace.dispose();
  }
});

test("permission controls use only the selected session and bot cache", () => {
  const a = new BackendWorkspace("http://127.0.0.1:4317", "a");
  const b = new BackendWorkspace("http://127.0.0.1:4317", "b");
  try {
    a.queries.setQueryData(["mcp-mode", "first"], { mode: "full-access" });
    a.queries.setQueryData(["mcp-grants", "first"], {
      grants: [{ id: "secret", tool: "execute-first" }],
    });
    a.queries.setQueryData(["mcp-mode", "second"], { mode: "ask" });
    a.queries.setQueryData(["mcp-grants", "second"], { grants: [] });
    const first = render(a, <McpPermissions sessionId="first" />);
    expect(first).toContain('value="full-access" selected=""');
    expect(first).toContain('aria-label="Revoke execute-first"');
    const second = render(a, <McpPermissions sessionId="second" />);
    expect(second).toContain('value="ask" selected=""');
    expect(second).toContain("No session grants.");
    expect(second).not.toContain("execute-first");
    const otherBot = render(b, <McpPermissions sessionId="first" />);
    expect(otherBot).toContain("Loading MCP permissions");
    expect(otherBot).toContain("disabled");
    expect(otherBot).not.toContain("execute-first");
  } finally {
    a.dispose();
    b.dispose();
  }
});
