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

test("MCP approval offers only exact once and reject controls", () => {
  const workspace = new BackendWorkspace("http://127.0.0.1:4317");
  try {
    const html = render(
      workspace,
      <ToolDecision
        approval={{ id: "approval", expiresAt: Date.now() + 60000 } as Approval}
      />,
    );
    expect(html).toContain("Approve once");
    expect(html).not.toContain("Approve for session");
    expect(html).toContain("Reject");
    expect(html).not.toContain("any arguments for this conversation");
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
    expect(first).toContain('aria-label="Command permissions: Full access"');
    const second = render(a, <McpPermissions sessionId="second" />);
    expect(second).toContain('aria-label="Command permissions: Ask"');
    expect(second).not.toContain("execute-first");
    const otherBot = render(b, <McpPermissions sessionId="first" />);
    expect(otherBot).toContain('aria-label="Command permissions: Loading"');
    expect(otherBot).not.toContain("execute-first");
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("command approval exposes only once and reject actions", () => {
  const workspace = new BackendWorkspace("http://127.0.0.1:4317");
  try {
    const html = render(
      workspace,
      <ToolDecision
        approval={
          {
            id: "command",
            connectionIdentity: "raphie.workspace.command",
            expiresAt: Date.now() + 60000,
          } as Approval
        }
      />,
    );
    expect(html).toContain("Approve once");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Approve for session");
    expect(html).not.toContain("MCP");
  } finally {
    workspace.dispose();
  }
});

test("command buttons submit once decisions and disable after success", async () => {
  const { act, create } = await import("react-test-renderer");
  for (const decision of ["approved", "rejected"] as const) {
    const workspace = new BackendWorkspace("http://test");
    const calls: unknown[][] = [];
    Object.defineProperty(workspace, "api", {
      value: async (...args: unknown[]) => {
        calls.push(args);
        return { status: decision };
      },
    });
    let root!: ReturnType<typeof create>;
    try {
      await act(async () => {
        root = create(
          <BackendContext.Provider
            value={{ workspace, backend: workspace, selectBot: async () => {} }}
          >
            <QueryClientProvider client={workspace.queries}>
              <ToolDecision
                approval={
                  {
                    id: "cmd",
                    connectionIdentity: "raphie.workspace.command",
                    expiresAt: Date.now() + 60000,
                  } as Approval
                }
              />
            </QueryClientProvider>
          </BackendContext.Provider>,
        );
      });
      await act(async () => {
        root.root
          .findAllByType("button")
          [decision === "approved" ? 1 : 0].props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(calls).toEqual([
        ["/api/tool-approvals/cmd", { decision, scope: "once" }],
      ]);
      expect(
        root.root
          .findAllByType("button")
          .every((button) => button.props.disabled),
      ).toBe(true);
    } finally {
      await act(async () => root?.unmount());
      workspace.dispose();
    }
  }
});

test("permission selector saves the selected conversation mode and refetches it", async () => {
  const { act, create } = await import("react-test-renderer");
  const { PopoverContent } = await import("../src/shared/ui/popover");
  const workspace = new BackendWorkspace("http://test", "selector-bot");
  const calls: unknown[][] = [];
  let mode = "ask";
  workspace.queries.setQueryData(["mcp-mode", "selected/session"], { mode });
  Object.defineProperty(workspace, "api", {
    value: async (...args: unknown[]) => {
      calls.push(args);
      if (args[2] === "PUT") mode = (args[1] as { mode: string }).mode;
      return { mode };
    },
  });
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => {
      root = create(
        <BackendContext.Provider
          value={{ workspace, backend: workspace, selectBot: async () => {} }}
        >
          <QueryClientProvider client={workspace.queries}>
            <McpPermissions sessionId="selected/session" />
          </QueryClientProvider>
        </BackendContext.Provider>,
      );
    });
    const buttons = () => {
      const found: React.ReactElement<{
        "aria-pressed"?: boolean;
        onClick: () => void;
        children?: React.ReactNode;
      }>[] = [];
      const visit = (value: React.ReactNode) => {
        const node = value as React.ReactElement<{
          "aria-pressed"?: boolean;
          onClick: () => void;
          children?: React.ReactNode;
        }> | null;
        if (Array.isArray(node)) node.forEach(visit);
        else if (typeof node === "object" && node !== null && "props" in node) {
          if (
            node.type === "button" &&
            node.props["aria-pressed"] !== undefined
          )
            found.push(node);
          visit(node.props.children);
        }
      };
      visit(root.root.findByType(PopoverContent).props.children);
      return found;
    };
    for (const [index, value] of [
      [1, "full-access"],
      [0, "ask"],
    ] as const) {
      await act(async () => {
        buttons()[index]!.props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(calls).toContainEqual([
        "/api/sessions/selected%2Fsession/approval-mode",
        { mode: value },
        "PUT",
      ]);
      expect(
        workspace.queries.getQueryData(["mcp-mode", "selected/session"]),
      ).toEqual({ mode: value });
    }
  } finally {
    await act(async () => root?.unmount());
    workspace.dispose();
  }
});

test("Permissions interactions scope command updates and preserve MCP grants", async () => {
  const { act, create } = await import("react-test-renderer");
  const { PopoverContent } = await import("../src/shared/ui/popover");
  const a = new BackendWorkspace("http://test", "a");
  const b = new BackendWorkspace("http://test", "b");
  const calls: unknown[][] = [];
  let fail = false;
  let current = "ask";
  for (const workspace of [a, b]) {
    workspace.queries.setDefaultOptions({
      queries: { retry: false, staleTime: Infinity },
    });
    workspace.queries.setQueryData(["mcp-mode", "first/one"], { mode: "ask" });
    workspace.queries.setQueryData(["mcp-mode", "second"], { mode: "ask" });
    workspace.queries.setQueryData(["mcp-grants", "first/one"], {
      grants: [{ id: "mcp-only" }],
    });
    Object.defineProperty(workspace, "api", {
      value: async (path: string, body?: { mode: string }, method?: string) => {
        calls.push([workspace === a ? "a" : "b", path, body, method]);
        if (body) {
          if (fail) throw new Error("save failed");
          current = body.mode;
        }
        return { mode: current };
      },
    });
  }
  let root!: ReturnType<typeof create>;
  let content!: ReturnType<typeof create>;
  const tree = (workspace: BackendWorkspace, sessionId: string) => (
    <BackendContext.Provider
      value={{ workspace, backend: workspace, selectBot: async () => {} }}
    >
      <QueryClientProvider client={workspace.queries}>
        <McpPermissions
          key={`${workspace === a ? "a" : "b"}:${sessionId}`}
          sessionId={sessionId}
        />
      </QueryClientProvider>
    </BackendContext.Provider>
  );
  const refreshContent = async () => {
    await act(async () => {
      content?.unmount();
      content = create(
        <>{root.root.findByType(PopoverContent).props.children}</>,
      );
    });
  };
  try {
    await act(async () => {
      root = create(tree(a, "first/one"));
    });
    for (const [index, mode] of [
      [1, "full-access"],
      [0, "ask"],
    ] as const) {
      await refreshContent();
      await act(async () => {
        content.root.findAllByType("button")[index]!.props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(calls.at(-2)).toEqual([
        "a",
        "/api/sessions/first%2Fone/approval-mode",
        { mode },
        "PUT",
      ]);
      expect(a.queries.getQueryData(["mcp-mode", "first/one"])).toEqual({
        mode,
      });
    }
    fail = true;
    await refreshContent();
    await act(async () => {
      content.root.findAllByType("button")[1]!.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await refreshContent();
    expect(
      content.root
        .findByProps({ role: "alert" })
        .children.filter((child) => typeof child === "string")
        .join(""),
    ).toContain("Could not save");
    expect(a.queries.getQueryData(["mcp-mode", "first/one"])).toEqual({
      mode: "ask",
    });
    for (const [workspace, session] of [
      [a, "second"],
      [b, "first/one"],
    ] as const) {
      await act(async () => {
        root.update(tree(workspace, session));
      });
      await refreshContent();
      expect(content.root.findAllByProps({ role: "alert" })).toHaveLength(0);
      expect(
        content.root.findAllByType("button")[0]!.props["aria-pressed"],
      ).toBe(true);
    }
    expect(b.queries.getQueryData(["mcp-mode", "first/one"])).toEqual({
      mode: "ask",
    });
    expect(a.queries.getQueryData(["mcp-grants", "first/one"])).toEqual({
      grants: [{ id: "mcp-only" }],
    });
    expect(
      calls.every((call) => String(call[1]).endsWith("/approval-mode")),
    ).toBe(true);
  } finally {
    await act(async () => {
      content?.unmount();
      root?.unmount();
    });
    a.dispose();
    b.dispose();
  }
});

test("exact command session button displays scope and submits session approval", async () => {
  const { act, create } = await import("react-test-renderer");
  const calls: unknown[] = [];
  const workspace = new BackendWorkspace("http://127.0.0.1:4399", "scope-bot");
  Object.defineProperty(workspace, "api", { value: async (_path: string, body: unknown) => { calls.push(body); return { status: "approved" }; } });
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => {
      root = create(<BackendContext.Provider value={{ workspace, backend: workspace, selectBot: async () => {} }}><QueryClientProvider client={workspace.queries}><ToolDecision approval={{ id: "exact", server: "workspace", connectionIdentity: "raphie.workspace.command", tool: "workspace_exec", argumentsJson: '{"command":"pwd"}', expiresAt: Date.now() + 60000 } as Approval} /></QueryClientProvider></BackendContext.Provider>);
    });
    const button = root.root.findAllByType("button").find(b => b.props.title?.includes("exact arguments"))!;
    expect(button.props.title).toContain("this bot conversation");
    expect(button.props.title).toContain('{"command":"pwd"}');
    await act(async () => { button.props.onClick(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(calls).toEqual([{ decision: "approved", scope: "session" }]);
    expect(button.props.disabled).toBe(true);
  } finally {
    await act(async () => root?.unmount());
    workspace.dispose();
  }
});

test("new conversations expose Ask by default and the selected draft mode", () => {
  const workspace = new BackendWorkspace("http://127.0.0.1:4317");
  try {
    expect(render(workspace, <McpPermissions />)).toContain('aria-label="Command permissions: Ask"');
    expect(render(workspace, <McpPermissions draftMode="full-access" />)).toContain('aria-label="Command permissions: Full access"');
  } finally {
    workspace.dispose();
  }
});

test("draft selector switches both modes locally without submitting a session update", async () => {
  const { act, create } = await import("react-test-renderer");
  const { PopoverContent } = await import("../src/shared/ui/popover");
  const workspace = new BackendWorkspace("http://test");
  const selected: string[] = [];
  Object.defineProperty(workspace, "api", { value: async () => { throw new Error("draft must not call API"); } });
  let root!: ReturnType<typeof create>;
  let content!: ReturnType<typeof create>;
  try {
    await act(async () => {
      root = create(<BackendContext.Provider value={{ workspace, backend: workspace, selectBot: async () => {} }}><QueryClientProvider client={workspace.queries}><McpPermissions onDraftMode={mode => selected.push(mode)} /></QueryClientProvider></BackendContext.Provider>);
      });
    await act(async () => { content = create(<>{root.root.findByType(PopoverContent).props.children}</>); });
    for (const index of [1, 0]) {
      await act(async () => { content.root.findAllByType("button")[index]!.props.onClick(); });
    }
    expect(selected).toEqual(["full-access", "ask"]);
  } finally {
    await act(async () => { content?.unmount(); root?.unmount(); });
    workspace.dispose();
  }
});
