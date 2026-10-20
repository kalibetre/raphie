import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, type Snapshot } from "../../infrastructure/http/api-client";

// Snapshots are authoritative. Reconnecting replaces state, so no lost delta can
// duplicate a message or erase an approval made in another channel.
export function useLiveState() {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  const query = useQuery({
    queryKey: ["runtime"],
    queryFn: () => api<Snapshot>("/api/chats"),
  });
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = (event) => {
      try {
        client.setQueryData(["runtime"], JSON.parse(event.data));
      } catch {
        setConnected(false);
      }
    };
    return () => events.close();
  }, [client]);
  return { ...query, connected };
}
