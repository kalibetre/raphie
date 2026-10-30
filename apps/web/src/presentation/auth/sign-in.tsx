import { useEffect, useState } from "react";

import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
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
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_srgb,#b5c99b_12%,transparent),transparent_70%)]"
      />
      <header className="relative flex items-center gap-2.5 px-6 py-6 sm:px-10">
        <BotAvatar id="default" />
        <span className="text-lg font-semibold tracking-tight">raphie</span>
      </header>
      <div className="relative flex flex-1 items-center justify-center px-5 pb-20 pt-6 sm:px-8">
        <section className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_60px_-30px_rgba(0,0,0,0.35)]">
          <div className="relative overflow-hidden border-b border-border bg-[linear-gradient(125deg,color-mix(in_srgb,#b5c99b_17%,var(--card)),var(--card)_75%)] px-7 py-8 sm:px-9">
            <div
              aria-hidden="true"
              className="absolute -right-12 -top-16 size-40 rounded-full bg-[#b5c99b]/10"
            />
            <div className="relative">
              <div className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl bg-[#b5c99b]/15 ring-1 ring-[#b5c99b]/25">
                <BotAvatar id="default" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Welcome to Raphie
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your personal workspace, ready when you are.
              </p>
            </div>
          </div>
          <div className="px-7 py-7 sm:px-9 sm:py-8">
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
                  Raphie is locked until an administrator is created. On the
                  machine running Raphie, run:
                </p>
                <code className="mt-3 block rounded-md bg-muted px-3 py-2 text-sm">
                  raphie auth setup
                </code>
              </>
            ) : (
              <form
                className="grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(event.currentTarget);
                }}
              >
                <div>
                  <h2 className="text-base font-semibold">Sign in</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Enter your account details to continue.
                  </p>
                </div>
                <label className="grid gap-1.5 text-sm font-medium">
                  Email
                  <Input
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    autoFocus
                    disabled={busy}
                    className="h-11 rounded-lg bg-background/50"
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
                    className="h-11 rounded-lg bg-background/50"
                  />
                </label>
                {message && (
                  <p role="alert" className="text-sm text-destructive">
                    {message}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={busy}
                  className="h-11 rounded-lg"
                >
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  Forgot your password? Contact your administrator for help.
                </p>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
