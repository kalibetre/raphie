import type { ModelSelection } from "@raphie/contracts";
import {
  Check,
  ChevronDown,
  Layers,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../../../shared/ui/popover";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../shared/ui/select";
import { useRuntimeSettings } from "../../settings/infrastructure/use-runtime-settings";
import { modelCatalog } from "../application/model-catalog";
import { useModelFavorites } from "../infrastructure/use-model-favorites";
import { ModelResults } from "./model-results";

type Props = {
  model: ModelSelection | null;
  disabled: boolean;
  onChoose: (model: ModelSelection) => Promise<void>;
  onSettings: () => void;
};

export function ModelPicker({ model, disabled, onChoose, onSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const settings = useRuntimeSettings();
  const { favorites, toggle } = useModelFavorites();
  const data = settings.data;
  const current = data?.models.find(
    (m) => m.id === model?.modelId && m.connectionId === model?.provider,
  );
  const name =
    current?.name ?? model?.modelId.split("/").at(-1) ?? "Choose model";
  const { families, matching } = modelCatalog(data, search, filter, favorites);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  async function choose(selection: ModelSelection) {
    if (!data || disabled || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onChoose(selection);
      setOpen(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not change the model.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch("");
          setError(undefined);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="composer-model-trigger focus-visible:ring-1"
          disabled={disabled || saving}
          aria-label={`Choose model: ${name}`}
        >
          <Sparkles size={13} />
          <span>{name}</span>
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="model-picker-content p-0"
        side="top"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        aria-label="Model for this session"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const choices = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-model-choice]:not(:disabled)",
            ),
          ];
          const index = choices.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (
            !choices.length ||
            (index < 0 && document.activeElement !== input.current)
          )
            return;
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          if (index < 0) {
            choices[direction === 1 ? 0 : choices.length - 1]?.focus();
            return;
          }
          const nextIndex =
            (index + direction + choices.length) % choices.length;
          choices[nextIndex]?.focus();
        }}
      >
        <nav className="model-picker-rail" aria-label="Model filters">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Favorite models"
            aria-pressed={filter === "favorites"}
            onClick={() => setFilter("favorites")}
          >
            <Star size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label="All models"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            <Layers size={16} />
          </Button>
        </nav>
        <div className="model-picker-main">
          <label className="model-picker-search">
            <Search size={15} />
            <Input
              className="h-auto rounded-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
              ref={input}
              type="search"
              aria-label="Find a model"
              placeholder="Find a model…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {families.length > 1 && (
            <Select
              value={
                filter === "favorites" || filter === "all" ? "all" : filter
              }
              onValueChange={setFilter}
            >
              <SelectTrigger
                aria-label="Model family"
                className="model-picker-family"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All model families</SelectItem>
                {families.map((family) => (
                  <SelectItem key={family} value={family}>
                    {family}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="model-picker-heading">
            {filter === "favorites" ? "Favorites" : "Your models"}
            <span>{matching.length}</span>
          </div>
          <ModelResults
            data={data}
            loading={settings.isPending}
            error={settings.error}
            retry={() => void settings.refetch()}
            model={model}
            available={!!current}
            matching={matching}
            filter={filter}
            search={search}
            favorites={favorites}
            disabled={saving || disabled}
            onChoose={(selection) => void choose(selection)}
            onFavorite={toggle}
          />
          {error && (
            <p className="model-picker-message" role="alert">
              {error}
            </p>
          )}
          <div className="model-picker-footer">
            <span>
              {saving ? (
                <>
                  <Check size={12} /> Saving…
                </>
              ) : (
                `Via ${current?.connectionName ?? "your connections"}`
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              Manage connection ↗
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
