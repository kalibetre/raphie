import type { ProviderConnection } from "@raphie/contracts";
import { ArrowUpRight, Check, KeyRound, Pencil, Trash2 } from "lucide-react";

import { Button } from "../../../shared/ui/button";

export function ProviderCard({
  connection,
  providerName,
  modelCount,
  busy,
  onEdit,
  onRemove,
}: {
  connection: ProviderConnection;
  providerName: string;
  modelCount: number;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <article
      className="provider-card"
      aria-label={`${connection.name} connection`}
    >
      <div className="provider-card-heading">
        <span className="provider-mark">
          <ArrowUpRight size={22} />
        </span>
        <div>
          <h3>{connection.name}</h3>
          <p>{providerName}</p>
        </div>
        <span className="catalog-badge connected">
          <Check size={12} />
          Connected
        </span>
      </div>
      <div className="provider-card-details">
        <span>
          <KeyRound size={14} />
          {connection.credentialSource === "environment"
            ? "Backend environment key"
            : "Saved API key"}
        </span>
        <span>{modelCount} models</span>
      </div>
      <footer>
        <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
          <Pencil />
          Edit connection
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
          <Trash2 />
          Remove connection
        </Button>
      </footer>
      {connection.credentialSource === "environment" && (
        <p className="provider-environment-note">
          Removing disconnects this connection. The environment key remains on
          your backend.
        </p>
      )}
    </article>
  );
}
