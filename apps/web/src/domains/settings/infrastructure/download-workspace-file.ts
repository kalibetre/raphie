import type { WorkspaceEntry } from "@raphie/contracts";

import type { BackendWorkspace } from "../../../infrastructure/http/backend-workspace";

/** Fetch through the active bot scope before offering any bytes to the browser. */
export async function downloadWorkspaceFile(
  workspace: BackendWorkspace,
  file: WorkspaceEntry,
  revision: number,
) {
  const blob = await workspace.download(
    `/api/workspace/download?path=${encodeURIComponent(file.path)}&revision=${revision}`,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
