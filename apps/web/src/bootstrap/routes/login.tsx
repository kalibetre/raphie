import { createFileRoute } from "@tanstack/react-router";

import { SignIn } from "../../presentation/auth/sign-in";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  return <SignIn next={Route.useSearch().next} />;
}
