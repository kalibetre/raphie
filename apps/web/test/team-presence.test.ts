import { expect, test } from "bun:test";

import type { SessionSummary } from "@raphie/contracts";

import {
  presence,
  runtimePlace,
} from "../src/domains/settings/application/team-presence";

const session = (over: Partial<SessionSummary> = {}) =>
  ({ waiting: false, working: false, ...over }) as SessionSummary;
const none = () => 0;

test("a teammate waiting on the owner needs them before anything else", () => {
  const sessions = [session({ working: true }), session({ asking: true })];
  expect(presence(sessions, none)).toEqual({
    state: "needs-you",
    label: "Needs you",
  });
  expect(presence([session({ waiting: true })], none).state).toBe("needs-you");
});

test("a teammate with no model needs setup, unless it already waits on you", () => {
  expect(presence([session({ working: true })], none, true)).toEqual({
    state: "setup",
    label: "Needs setup",
  });
  expect(presence([session({ waiting: true })], none, true).state).toBe(
    "needs-you",
  );
});

test("working outranks unread replies, which outrank being available", () => {
  const read = session();
  const unread = session();
  const count = (s: SessionSummary) => (s === unread ? 2 : 0);
  expect(presence([session({ working: true }), unread], count).label).toBe(
    "Working",
  );
  expect(presence([read, unread], count).label).toBe("1 new message");
  expect(presence([unread, unread], count).label).toBe("2 new messages");
  expect(presence([read], none)).toEqual({
    state: "available",
    label: "Available",
  });
});

test("a local workspace is this computer; a remote one is its host", () => {
  expect(runtimePlace("http://127.0.0.1:4320/")).toBe("This computer");
  expect(runtimePlace("http://localhost:4320/sessions/1")).toBe(
    "This computer",
  );
  expect(runtimePlace("https://raphie.example.ts.net/")).toBe(
    "raphie.example.ts.net",
  );
  expect(runtimePlace("not a url")).toBe("This computer");
});
