/** Only same-origin paths may follow a sign-in; never `//host`, `/\host` or `/login`. */
export function safeNext(value: string | null | undefined) {
  return value &&
    /^\/(?![/\\])[^\s]*$/.test(value) &&
    !/^\/login(?:[/?#]|$)/.test(value)
    ? value
    : "/";
}

/** Sends the browser to the sign-in page, returning here afterwards. */
export function redirectToSignIn() {
  if (typeof window === "undefined" || window.location.pathname === "/login")
    return;
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}

/** Ends this browser's session on the server, then returns to the sign-in page. */
export async function signOut() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Could not sign out. Please retry.");
  window.location.assign("/login");
}

/** True only when the server positively says this browser is signed out. */
export async function sessionEnded() {
  try {
    const status = await (await fetch("/auth/status")).json();
    return status.authenticated === false;
  } catch {
    return false;
  }
}
