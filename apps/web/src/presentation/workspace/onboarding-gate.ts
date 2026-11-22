/**
 * The teammate flow shows for a bot that cannot start yet: the workspace
 * has loaded, the bot has no model to reply with, nothing has been said to
 * it, no settings page is open, and the owner has not skipped it. On a
 * fresh install that is the one bot; later, a teammate just added.
 */
export function showsOnboarding(state: {
  loaded: boolean;
  needsSetup: boolean;
  conversations: number;
  settingsOpen: boolean;
  skipped: boolean;
}) {
  return (
    state.loaded &&
    state.needsSetup &&
    state.conversations === 0 &&
    !state.settingsOpen &&
    !state.skipped
  );
}
