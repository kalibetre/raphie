import { useEffect, useState } from "react";

/** Compare the loaded client with the local web host, not the selected gateway. */
export function UpdateNotice() {
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch("/_raphie/version", { cache: "no-store" });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          return;
        const value: unknown = await response.json();
        if (
          active &&
          typeof value === "object" &&
          value !== null &&
          "id" in value &&
          typeof value.id === "string" &&
          value.id !== __RAPHIE_BUILD_ID__
        )
          setUpdated(true);
      } catch {
        // The server may be restarting. The next check will retry.
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const timer = window.setInterval(visible, 30_000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  if (!updated) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border bg-background p-3 text-sm shadow-lg"
    >
      <span>A new version is ready. Reload to use it.</span>
      <button
        type="button"
        className="rounded-md border px-3 py-1 font-medium hover:bg-muted focus-visible:outline-2"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
