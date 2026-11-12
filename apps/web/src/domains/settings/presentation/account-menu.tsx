import { LogOut, UserRound } from "lucide-react";
import { useState } from "react";

import { signOut } from "../../../infrastructure/http/session";
import { Button } from "../../../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui/dropdown-menu";

export function AccountMenu({ onManage }: { onManage: () => void }) {
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
        <DropdownMenuContent side="top" align="end" className="min-w-44">
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
