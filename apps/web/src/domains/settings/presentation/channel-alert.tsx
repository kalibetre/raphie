import { TriangleAlert } from "lucide-react";

export function ChannelAlert({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div role="alert" className="channel-alert">
      <span className="channel-alert-icon" aria-hidden="true">
        <TriangleAlert size={18} />
      </span>
      <div className="channel-alert-copy">
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
