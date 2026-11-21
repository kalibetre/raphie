import type { OwnerProfile, SaveOwnerProfile } from "@raphie/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

/** The owner's profile: one for the whole backend, read by every bot. */
export function useOwner() {
  const { backend } = useBackend();
  const client = backend.queries;
  const query = useQuery(
    {
      queryKey: ["owner"],
      queryFn: () => backend.api<OwnerProfile>("/api/owner"),
      retry: false,
    },
    client,
  );
  const save = useMutation(
    {
      mutationFn: (input: SaveOwnerProfile) =>
        backend.api<OwnerProfile>("/api/owner", input, "PUT"),
      onSuccess: (owner) => client.setQueryData(["owner"], owner),
    },
    client,
  );
  return { ...query, save };
}
