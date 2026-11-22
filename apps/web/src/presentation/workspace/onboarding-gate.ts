/**
 * Onboarding shows on a fresh install only: the workspace has loaded, its
 * one bot has no model to reply with, nothing has been said yet, no
 * settings page is open, and the owner has not skipped it.
 */
export function showsOnboarding(state: {
  loaded: boolean;
  needsSetup: boolean;
  bots: number;
  conversations: number;
  settingsOpen: boolean;
  skipped: boolean;
}) {
  return (
    state.loaded &&
    state.needsSetup &&
    state.bots === 1 &&
    state.conversations === 0 &&
    !state.settingsOpen &&
    !state.skipped
  );
}
