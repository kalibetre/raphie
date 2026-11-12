import { LogOut, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { signOut } from "../../../infrastructure/http/session";
import { Button } from "../../../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../shared/ui/dropdown-menu";

export function AccountMenu({ onManage }: { onManage: () => void }) {
  const [account, setAccount] = useState<{ email: string; name: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{
          account?: { email: string; name: string };
        }>;
      })
      .then((status) => setAccount(status.account))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function leave() {
    setBusy(true);
    setError("");
    try {
      await signOut();
    } catch {
      setError("Could not sign out. Please retry.");
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label="Account menu"
          title="Account"
          disabled={busy}
        >
          <UserRound size={15} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className="w-64 max-w-[calc(100vw-2rem)]"
        >
          <div className="flex min-w-0 items-center gap-3 px-2 py-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground"
            >
              {account ? (
                (account.name || account.email).slice(0, 1).toUpperCase()
              ) : (
                <UserRound size={18} />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {account?.name || "Administrator"}
              </p>
              <p
                className="truncate text-xs text-muted-foreground"
                title={account?.email}
              >
                {account?.email || "Account details unavailable"}
              </p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onManage}>
            <UserRound />
            Manage account
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void leave()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p
          role="alert"
          className="absolute bottom-full right-0 mb-2 w-52 rounded-md border bg-popover p-3 text-sm text-destructive shadow-md"
        >
          {error}
        </p>
      )}
    </div>
  );
}
