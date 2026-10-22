import { createContext, useContext } from "react";

import type { BackendWorkspace } from "./backend-workspace";

type BackendConnection = {
  workspace: BackendWorkspace;
  connect: (url: string) => Promise<void>;
};

export const BackendContext = createContext<BackendConnection | undefined>(
  undefined,
);

export function useBackend() {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error("A backend workspace is required.");
  return backend;
}
