import { createFileRoute } from "@tanstack/react-router";

import { DeviceApproval } from "../../presentation/auth/device-approval";

export const Route = createFileRoute("/device")({
  validateSearch: (search: Record<string, unknown>) => ({
    user_code:
      typeof search.user_code === "string"
        ? search.user_code.slice(0, 32)
        : undefined,
  }),
  component: DevicePage,
});

function DevicePage() {
  const { user_code } = Route.useSearch();
  return <DeviceApproval initialCode={user_code} />;
}
