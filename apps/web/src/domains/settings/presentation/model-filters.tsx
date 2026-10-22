import type { RuntimeSettings } from "@raphie/contracts";
import { Search } from "lucide-react";

import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../shared/ui/select";

export function ModelFilters({
  search,
  provider,
  source,
  providers,
  sources,
  onSearch,
  onProvider,
  onSource,
  connections,
  connection,
  onConnection,
}: {
  search: string;
  provider: string;
  source: string;
  providers: RuntimeSettings["providers"];
  sources: { id: string; label: string }[];
  onSearch: (value: string) => void;
  onProvider: (value: string) => void;
  onSource: (value: string) => void;
  connections: RuntimeSettings["connections"];
  connection: string;
  onConnection: (value: string) => void;
}) {
  return (
    <div className="model-library-controls">
      <div className="model-search">
        <label htmlFor="model-search">Search models</label>
        <div>
          <Search size={16} aria-hidden="true" />
          <Input
            id="model-search"
            type="search"
            placeholder="Search by name or model ID…"
            value={search}
            onChange={(event) => {
              onSearch(event.target.value);
            }}
          />
        </div>
      </div>
      <div className="model-filter">
        <label htmlFor="model-provider-filter">Provider</label>
        <Select
          value={provider}
          onValueChange={(value) => {
            onProvider(value);
          }}
        >
          <SelectTrigger id="model-provider-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="model-filter">
        <label htmlFor="model-source-filter">Model source</label>
        <Select
          value={source}
          onValueChange={(value) => {
            onSource(value);
          }}
        >
          <SelectTrigger id="model-source-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {connections.length > 1 && (
        <div className="model-filter model-connection-filter">
          <label htmlFor="model-connection-filter">Connection</label>
          <Select value={connection} onValueChange={onConnection}>
            <SelectTrigger id="model-connection-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All connections</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
