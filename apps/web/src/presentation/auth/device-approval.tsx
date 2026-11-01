import { useEffect, useState } from "react";

import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { Button } from "../../shared/ui/button";

type RequestState = {
  code: string;
  status: "checking" | "ready" | "invalid";
  message?: string;
};

const validCode = (code: string) => /^[A-Za-z0-9-]{6,32}$/.test(code);
const missingCode = "Open the approval link from your device to continue.";

/** Owner-only approval of the code supplied by the device link. */
export function DeviceApproval({ initialCode = "" }: { initialCode?: string }) {
  const code = initialCode;
  const [request, setRequest] = useState<RequestState>(() => ({
    code,
    status: validCode(code) ? "checking" : "invalid",
    message: validCode(code) ? undefined : missingCode,
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ code: string; text: string }>();
  const [done, setDone] = useState<{
    code: string;
    decision: "approved" | "denied";
  }>();

  useEffect(() => {
    const controller = new AbortController();
    if (!validCode(code)) {
      setRequest({ code, status: "invalid", message: missingCode });
      return () => controller.abort();
    }
    setRequest({ code, status: "checking" });
    void (async () => {
      try {
        const response = await fetch(
          `/api/auth/device?user_code=${encodeURIComponent(code)}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            "This request is invalid or expired. Start again from your device.",
          );
        const result = (await response.json()) as {
          status?: string;
          client_id?: string;
        };
        if (result.status !== "pending" || result.client_id !== "raphie-native")
          throw new Error(
            "This request is no longer available. Start again from your device.",
          );
        if (!controller.signal.aborted) setRequest({ code, status: "ready" });
      } catch (error) {
        if (!controller.signal.aborted)
          setRequest({
            code,
            status: "invalid",
            message:
              error instanceof Error
                ? error.message
                : "Could not check the request. Start again from your device.",
          });
      }
    })();
    return () => controller.abort();
  }, [code]);

  async function decide(action: "approve" | "deny") {
    if (request.code !== code || request.status !== "ready") return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/auth/device/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: code }),
      });
      if (!response.ok)
        throw new Error(
          "This request expired or could not be completed. Start again from your device.",
        );
      setDone({ code, decision: action === "approve" ? "approved" : "denied" });
    } catch (error) {
      setMessage({
        code,
        text:
          error instanceof Error
            ? error.message
            : "Could not complete the request.",
      });
    } finally {
      setBusy(false);
    }
  }

  const status = request.code === code ? request.status : "checking";
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
          {done?.code === code ? (
            <div className="mt-5 space-y-4" role="status">
              <p>
                {done.decision === "approved"
                  ? "Device approved. You can return to your device."
                  : "Request denied. The device will not be connected."}
              </p>
              <a className="text-sm underline underline-offset-4" href="/">
                Back to Raphie
              </a>
            </div>
          ) : status === "checking" ? (
            <p className="mt-5 text-sm text-muted-foreground" role="status">
              Checking device request…
            </p>
          ) : status === "ready" ? (
            <div className="mt-5 space-y-5">
              <p className="text-sm leading-6 text-muted-foreground">
                Confirm this code matches the one shown on a device in your
                possession:
              </p>
              <p className="rounded-lg border bg-muted px-4 py-3 text-center font-mono text-xl font-semibold tracking-widest">
                {code.toUpperCase()}
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
            </div>
          ) : (
            <p
              className="mt-5 text-sm leading-6 text-muted-foreground"
              role="alert"
            >
              {request.message ?? missingCode}
            </p>
          )}
          {message?.code === code && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {message.text}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
