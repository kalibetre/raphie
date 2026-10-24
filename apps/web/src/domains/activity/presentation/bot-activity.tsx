import { useBotActivity } from "../infrastructure/use-bot-activity";
import { Activity } from "./activity";

/** Settings → Activity: every step this bot took, across conversations. */
export function BotActivity() {
  const activity = useBotActivity();
  if (activity.isPending)
    return (
      <p className="activity-status" role="status">
        Loading activity…
      </p>
    );
  if (activity.error)
    return (
      <p className="activity-status" role="status">
        Couldn’t load activity. It will retry automatically.
      </p>
    );
  return <Activity events={activity.data?.items ?? []} />;
}
