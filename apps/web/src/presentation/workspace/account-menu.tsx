import { LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../shared/ui/dropdown-menu";

export function useServerMode() {
  const [serverMode, setServerMode] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/status", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((status) => setServerMode(status?.enabled === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return serverMode;
}

export function AccountMenu() {
  const form = useRef<HTMLFormElement>(null);
  return (
    <>
      <form ref={form} method="post" action="/auth/logout" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Account menu"
              title="Account"
            />
          }
        >
          <UserRound size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="min-w-44">
          <DropdownMenuItem render={<a href="/auth/account" />}>
            <UserRound /> Account
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => form.current?.requestSubmit()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
