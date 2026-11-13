import type { ChannelHomeSettings } from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Row } from "./settings-group";

export function HomeChannelSettings() {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["channel-home"],
    queryFn: () => workspace.api<ChannelHomeSettings>("/api/channels/home"),
    refetchInterval: 5000,
  });
  const mutation = useMutation({
    mutationFn: (id: string | null) =>
      workspace.api<ChannelHomeSettings>("/api/channels/home", { id }),
    onSuccess: (data) => client.setQueryData(["channel-home"], data),
  });
  return (
    <div className="channel-settings">
      <Row
        title="Home channel"
        description="Scheduled updates go here, wherever the job was created. Use /home in a verified Discord or Telegram conversation to select it. Web chat has no /home command."
      />
      {!query.data ? (
        <p role="status" className="automation-note">
          {query.error
            ? "Could not load the home channel."
            : "Loading home channel…"}
        </p>
      ) : (
        <>
          <Row
            title="Web only"
            description="Keep scheduled results in the web workspace."
          >
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending || query.data.selected === null}
              onClick={() => mutation.mutate(null)}
            >
              {query.data.selected === null ? "Selected" : "Use web only"}
            </Button>
          </Row>
          {query.data.destinations.map((item) => (
            <Row
              key={item.id}
              title={item.platform === "telegram" ? "Telegram" : "Discord"}
              description={`${item.conversationId} · owner ${item.userId}`}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={
                  mutation.isPending || query.data?.selected === item.id
                }
                onClick={() => mutation.mutate(item.id)}
              >
                {query.data?.selected === item.id ? "Home" : "Set as home"}
              </Button>
            </Row>
          ))}
          <p className="automation-note">
            Only known conversations can be selected. A disabled, revoked or
            disconnected destination keeps new scheduled results web-only.
            Changes apply to future scheduled turns.
          </p>
        </>
      )}
      {mutation.error && (
        <p role="alert" className="channel-message">
          {mutation.error.message}
        </p>
      )}
    </div>
  );
}
