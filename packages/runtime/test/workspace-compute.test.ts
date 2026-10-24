import { expect, test } from "bun:test";

import { computeWorkspace } from "../src/domains/workspaces/infrastructure/workspace-compute.ts";

test("just-bash worker produces a binary-safe checkpoint without host files, env or native capabilities", async () => {
  const first = await computeWorkspace({
    checkpoint: [],
    command:
      "mkdir notes; printf 'hello' > notes/a; echo AP8= | base64 -d > binary; ln -s notes/a link",
  });
  expect(first.result.committed).toBe(true);
  expect(
    first.checkpoint.find((e) => e.path === "/workspace/binary")!.content,
  ).toBe("AP8=");
  const next = await computeWorkspace({
    checkpoint: first.checkpoint,
    command:
      "cat link; test ! -e /etc/passwd; test ! -e /Users; test ! -e /workspace/settings.sqlite",
  });
  expect(next.result.stdout).toBe("hello");
  expect(next.result.exitCode).toBe(0);
  const denied = await computeWorkspace({
    checkpoint: [],
    command: "curl https://example.com; node -e '1'; python3 -c '1'",
  });
  expect(denied.result.exitCode).not.toBe(0);
  expect(denied.result.committed).toBe(false);
});
