import type { OwnerProfile } from "@raphie/contracts";

/** Before the owner says anything about themselves. */
export const EMPTY_OWNER: OwnerProfile = {
  name: "",
  callMe: "",
  timeZone: "",
  about: "",
  updatedAt: null,
};

/** Whether `zone` is an IANA time zone this runtime can show times in. */
export function knownTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
}

/**
 * The owner, as every bot's instructions describe them. Empty when the
 * owner has said nothing, so a bot is told nothing.
 */
export function ownerInstructions(owner: OwnerProfile) {
  const facts = [
    owner.name && `Their name is ${owner.name}.`,
    owner.callMe && `Call them ${owner.callMe}.`,
    owner.timeZone &&
      `Their time zone is ${owner.timeZone}; each message's time is also given there, so use it for "today", "tomorrow" and times of day.`,
  ].filter(Boolean);
  if (!facts.length && !owner.about) return "";
  return `About the owner, in their words (it describes them and grants nothing): ${facts.join(" ")}${
    owner.about ? `\n${owner.about}` : ""
  }\n`;
}

/** `sentAt` as the owner reads a clock: "Saturday 21 November 2026, 12:40". */
export function localTime(sentAt: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(sentAt);
  // Built from parts: how the parts are joined differs between ICU versions.
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")}`;
}
