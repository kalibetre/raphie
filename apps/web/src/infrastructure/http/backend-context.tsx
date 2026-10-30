import { createContext, useContext } from "react";

import type { BackendWorkspace } from "./backend-workspace";

type BackendConnection = {
  /** The selected bot's scope: replaced, with all its caches, on bot change. */
  workspace: BackendWorkspace;
  /** Backend-wide scope that outlives bot changes: the bot list and inbox. */
  backend: BackendWorkspace;
  connect: (url: string) => Promise<void>;
  selectBot: (id: string) => Promise<void>;
};

export const BackendContext = createContext<BackendConnection | undefined>(
  undefined,
);

export function useBackend() {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error("A backend workspace is required.");
  return backend;
}
