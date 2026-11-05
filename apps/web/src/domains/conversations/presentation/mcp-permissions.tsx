import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Shield, ShieldCheck } from "lucide-react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../shared/ui/popover";

type Mode = "ask" | "full-access";

export function McpPermissions({
  sessionId,
  draftMode = "ask",
  onDraftMode,
}: {
  sessionId?: string;
  draftMode?: Mode;
  onDraftMode?: (mode: Mode) => void;
}) {
  const { workspace } = useBackend();
  const path = `/api/sessions/${encodeURIComponent(sessionId ?? "")}`;
  const query = useQuery({
    enabled: !!sessionId,
    queryKey: ["mcp-mode", sessionId],
    queryFn: () => workspace.api<{ mode: Mode }>(`${path}/approval-mode`),
  });
  const mode = sessionId
    ? query
    : {
        data: { mode: draftMode },
        isError: false,
        isPending: false,
        refetch: query.refetch,
      };
  const update = useMutation({
    mutationFn: (value: Mode) =>
      workspace.api(`${path}/approval-mode`, { mode: value }, "PUT"),
    onSuccess: () => mode.refetch(),
  });
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="composer-model-trigger focus-visible:ring-1"
            aria-label={`Command permissions: ${mode.data?.mode === "full-access" ? "Full access" : mode.data ? "Ask" : "Loading"}`}
          />
        }
      >
        <Shield size={13} />
        <span>
          {mode.data?.mode === "full-access"
            ? "Full access"
            : mode.data
              ? "Ask"
              : "Permissions"}
        </span>
        <ChevronDown size={12} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-80 max-w-[calc(100vw-24px)] p-4 text-left"
        aria-label="Command permissions"
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck size={16} /> Command permissions
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Choose how this conversation uses commands.
        </p>
        <div
          className="grid gap-1"
          role="group"
          aria-label="Command access mode"
        >
          {(
            [
              ["ask", "Ask", "Review each command before it runs."],
              [
                "full-access",
                "Full access",
                "Allow commands without asking in this conversation.",
              ],
            ] as const
          ).map(([value, title, description]) => (
            <button
              key={value}
              type="button"
              disabled={!mode.data || mode.isError || update.isPending}
              aria-pressed={mode.data?.mode === value}
              onClick={() =>
                sessionId ? update.mutate(value) : onDraftMode?.(value)
              }
              className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-accent disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {description}
                </span>
              </span>
              {mode.data?.mode === value && (
                <Check size={15} className="mt-0.5 shrink-0" />
              )}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Sandbox restrictions and external approvals still apply.
        </p>
        {mode.isPending && (
          <p role="status" className="mt-2 text-xs">
            Loading Command permissions…
          </p>
        )}
        {mode.isError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Could not load Command permissions.{" "}
            <button
              type="button"
              onClick={() => {
                void mode.refetch();
              }}
            >
              Retry
            </button>
          </p>
        )}
        {update.isError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Could not save Command permissions. Please retry.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
