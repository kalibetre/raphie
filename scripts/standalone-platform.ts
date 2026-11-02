/** Names of the standalone child programs for the host platform. */
export function standaloneChildren(platform: NodeJS.Platform): string[] {
  const suffix = platform === "win32" ? ".exe" : "";
  return [`raphie-runtime${suffix}`, `raphie-web${suffix}`];
}

/** Unix user IDs are unavailable on Windows; filesystem access is checked by the OS. */
export function isOtherOwner(owner: number, currentUser: number | undefined) {
  return currentUser !== undefined && owner !== currentUser;
}
