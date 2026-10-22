import type { ModelSelection, RuntimeSettings } from "@raphie/contracts";
import { Check, Star } from "lucide-react";

import { Button } from "../../../shared/ui/button";

export function ModelChoices({
  models,
  provider,
  selected,
  defaultModel,
  favorites,
  disabled,
  onChoose,
  onFavorite,
}: {
  models: RuntimeSettings["models"];
  provider: string;
  selected: ModelSelection | null;
  defaultModel: string;
  favorites: string[];
  disabled: boolean;
  onChoose: (model: ModelSelection) => void;
  onFavorite: (key: string) => void;
}) {
  return (
    <ul className="model-picker-list">
      {models.map((model) => {
        const current =
          selected?.provider === model.connectionId &&
          selected.modelId === model.id;
        const key = `${model.connectionId}:${model.id}`;
        const favorite = favorites.includes(key);
        return (
          <li key={key} className={current ? "is-current" : undefined}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="model-picker-choice h-auto justify-start whitespace-normal focus-visible:ring-1"
              data-model-choice
              aria-pressed={current}
              disabled={disabled}
              onClick={() =>
                onChoose({ provider: model.connectionId, modelId: model.id })
              }
            >
              <span className="model-picker-check">
                {current && <Check size={13} />}
              </span>
              <span className="model-picker-name">
                <span>{model.name}</span>
                <small>
                  {model.connectionName} · {model.id}
                  {model.pricing && (
                    <span
                      title={`Pi catalog price, USD per million tokens: $${model.pricing.input} input, $${model.pricing.output} output`}
                    >
                      {" "}
                      · {price(model.pricing.input)} /{" "}
                      {price(model.pricing.output)} per M
                    </span>
                  )}
                  {model.id === defaultModel &&
                    model.connectionId === provider && (
                      <span className="model-default-label">
                        {" "}
                        · New-session default
                      </span>
                    )}
                </small>
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="model-picker-star focus-visible:ring-1"
              aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${model.name}`}
              aria-pressed={favorite}
              onClick={() => onFavorite(key)}
            >
              <Star size={14} fill={favorite ? "currentColor" : "none"} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

const price = (usd: number) => `$${Number(usd.toPrecision(2))}`;
