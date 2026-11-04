import { expect, test } from "bun:test";

import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useComposerAttachments } from "../src/domains/conversations/presentation/use-composer-attachments";
import { BackendContext } from "../src/infrastructure/http/backend-context";
import { BackendWorkspace } from "../src/infrastructure/http/backend-workspace";

const originalAct = Object.getOwnPropertyDescriptor(
  globalThis,
  "IS_REACT_ACT_ENVIRONMENT",
);
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

test("uploads survive composer unmount and cannot overlap after returning to a draft", async () => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const workspace = new BackendWorkspace("http://test", "research");
  let finish!: (result: unknown) => void;
  let calls = 0;
  Object.defineProperty(workspace, "api", {
    value: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const context = { workspace, backend: workspace, selectBot: async () => {} };
  let current!: ReturnType<typeof useComposerAttachments>;

  function Composer({ draftKey }: { draftKey: string }) {
    const draft = useComposerAttachments(draftKey, () => {});
    useEffect(() => {
      current = draft;
    });
    return (
      <span>
        {draft.uploading
          ? "uploading"
          : draft.files.map((file) => file.name).join(",")}
      </span>
    );
  }

  let root!: ReactTestRenderer;
  const view = (draftKey: string) => (
    <BackendContext.Provider value={context}>
      <Composer key={draftKey} draftKey={draftKey} />
    </BackendContext.Provider>
  );
  try {
    await act(async () => {
      root = create(view("A"));
    });
    const selected = [new File(["a"], "first.txt")] as unknown as FileList;
    await act(async () => {
      void current.upload(selected);
    });
    await act(async () => {
      root.update(view("B"));
    });
    await act(async () => {
      root.update(view("A"));
    });
    expect(current.uploading).toBe(true);
    await act(async () => {
      void current.upload([
        new File(["b"], "second.txt"),
      ] as unknown as FileList);
    });
    expect(calls).toBe(1);
    await act(async () => {
      finish({ id: "a".repeat(64), name: "first.txt", size: 1 });
    });
    expect(current.uploading).toBe(false);
    expect(current.files.map((file) => file.name)).toEqual(["first.txt"]);
    expect(root.toJSON()).toMatchObject({ children: ["first.txt"] });
    const sentFiles = current.files;
    await act(async () => {
      void current.upload([
        new File(["b"], "second.txt"),
      ] as unknown as FileList);
    });
    await act(async () => {
      finish({ id: "b".repeat(64), name: "second.txt", size: 1 });
    });
    await act(async () => {
      current.removeSent(sentFiles, "A");
    });
    expect(current.files.map((file) => file.name)).toEqual(["second.txt"]);
  } finally {
    await act(async () => {
      root?.unmount();
    });
    workspace.dispose();
    if (originalAct)
      Object.defineProperty(
        globalThis,
        "IS_REACT_ACT_ENVIRONMENT",
        originalAct,
      );
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (originalStorage)
      Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
