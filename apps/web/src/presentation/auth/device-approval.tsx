import { useState } from "react";

import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";

/** Owner-only device approval. A prefilled code still requires explicit review. */
export function DeviceApproval({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [reviewedCode, setReviewedCode] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<"approved" | "denied">();

  async function review() {
    setBusy(true);
    setMessage("");
    const submitted = code.trim();
    try {
      const response = await fetch(
        `/api/auth/device?user_code=${encodeURIComponent(submitted)}`,
      );
      if (!response.ok)
        throw new Error(
          "That code is invalid or expired. Check the code on your device and try again.",
        );
      const result = (await response.json()) as {
        status?: string;
        client_id?: string;
      };
      if (result.status !== "pending" || result.client_id !== "raphie-native")
        throw new Error("This request is no longer available.");
      setReviewedCode(submitted);
      setReviewing(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not check the code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "deny") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/auth/device/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: reviewedCode }),
      });
      if (!response.ok)
        throw new Error(
          "This request expired or could not be completed. Start again from your device.",
        );
      setDone(action === "approve" ? "approved" : "denied");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not complete the request.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2.5 px-6 py-6 sm:px-10">
        <BotAvatar id="default" />
        <span className="text-lg font-semibold tracking-tight">raphie</span>
      </header>
      <div className="flex flex-1 items-center justify-center px-5 pb-20 pt-6">
        <section
          className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm sm:p-9"
          aria-labelledby="device-title"
        >
          <h1
            id="device-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Connect a device
          </h1>
          {done ? (
            <div className="mt-5 space-y-4" role="status">
              <p>
                {done === "approved"
                  ? "Device approved. You can return to your device."
                  : "Request denied. The device will not be connected."}
              </p>
              <a className="text-sm underline underline-offset-4" href="/">
                Back to Raphie
              </a>
            </div>
          ) : reviewing ? (
            <div className="mt-5 space-y-5">
              <p className="text-sm leading-6 text-muted-foreground">
                Confirm this code matches the one shown on a device in your
                possession:
              </p>
              <p className="rounded-lg border bg-muted px-4 py-3 text-center font-mono text-xl font-semibold tracking-widest">
                {reviewedCode.toUpperCase()}
              </p>
              <p className="text-sm leading-6">
                A client identifying itself as Raphie is requesting full access
                to your workspace. Its identity cannot be verified. Only approve
                a device you trust; never approve a code sent unexpectedly.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy} onClick={() => void decide("approve")}>
                  Approve device
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void decide("deny")}
                >
                  Deny
                </Button>
              </div>
              <button
                className="text-sm underline underline-offset-4"
                disabled={busy}
                onClick={() => setReviewing(false)}
              >
                Use a different code
              </button>
            </div>
          ) : (
            <form
              className="mt-5 space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void review();
              }}
            >
              <p className="text-sm leading-6 text-muted-foreground">
                Enter the code shown on your device. You’ll review the request
                before allowing access.
              </p>
              <label
                htmlFor="device-code"
                className="block text-sm font-medium"
              >
                Device code
              </label>
              <Input
                id="device-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                disabled={busy}
                required
              />
              <Button type="submit" disabled={busy || !code.trim()}>
                {busy ? "Checking…" : "Continue"}
              </Button>
            </form>
          )}
          {message && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
