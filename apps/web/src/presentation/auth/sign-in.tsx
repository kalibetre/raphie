import { useEffect, useState } from "react";

import { safeNext } from "../../infrastructure/http/session";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";

type Status = { configured: boolean; authenticated: boolean };

/** The only public page: signs the administrator in, or explains the locked state. */
export function SignIn({ next }: { next?: string }) {
  const [status, setStatus] = useState<Status | "error">();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const destination = safeNext(next);

  useEffect(() => {
    void fetch("/auth/status")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((result: Status) =>
        result.authenticated
          ? window.location.replace(destination)
          : setStatus(result),
      )
      .catch(() => setStatus("error"));
  }, [destination]);

  async function submit(form: HTMLFormElement) {
    const { email, password } = Object.fromEntries(new FormData(form)) as {
      email: string;
      password: string;
    };
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) return window.location.assign(destination);
      setMessage(
        response.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : response.status === 401
            ? "That email or password is not right."
            : "Could not sign in. Please retry.",
      );
    } catch {
      setMessage("Could not reach Raphie. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
      <section className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Raphie</h1>
        {status === undefined ? (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            Checking…
          </p>
        ) : status === "error" ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Could not reach Raphie. Reload to retry.
          </p>
        ) : !status.configured ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Raphie is locked until an administrator is created. On the machine
              running Raphie, run:
            </p>
            <code className="mt-3 block rounded-md bg-muted px-3 py-2 text-sm">
              raphie auth setup
            </code>
          </>
        ) : (
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(event.currentTarget);
            }}
          >
            <p className="text-sm text-muted-foreground">
              Sign in to continue.
            </p>
            <label className="grid gap-1.5 text-sm font-medium">
              Email
              <Input
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                disabled={busy}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Password
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </label>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Forgot your password? Run <code>raphie auth recover</code> on the
              Raphie machine.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
