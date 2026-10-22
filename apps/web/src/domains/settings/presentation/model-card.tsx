import { ArrowUpRight, Brain, Check, Image } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import { modelSource, type LibraryModel } from "../application/model-library";

const tokens = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const price = (value: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);

export function ModelCard({
  model,
  providerName,
  isDefault,
  saving,
  onSelect,
}: {
  model: LibraryModel;
  providerName: string;
  isDefault: boolean;
  saving: boolean;
  onSelect: () => void;
}) {
  const source = modelSource(model);
  const name = model.name.startsWith(`${source.label}:`)
    ? model.name.slice(source.label.length + 1).trim()
    : model.name;
  return (
    <article
      className={`model-library-card ${isDefault ? "is-default" : ""}`}
      aria-label={`${model.name} via ${model.connectionName}`}
    >
      <div className="model-card-top">
        <div>
          <span className="model-source-label">{source.label}</span>
          <h3>{name}</h3>
        </div>
        {isDefault && (
          <span className="catalog-badge connected">
            <Check size={12} />
            Default
          </span>
        )}
      </div>
      <p className="model-card-id" title={model.id}>
        {model.id}
      </p>
      <div className="model-compact-meta">
        <span title={`${model.contextWindow.toLocaleString()} context tokens`}>
          {tokens(model.contextWindow)} context
        </span>
        <span
          title={`${model.maxOutputTokens.toLocaleString()} maximum output tokens`}
        >
          {tokens(model.maxOutputTokens)} output
        </span>
        {model.reasoning && (
          <span title="Supports reasoning">
            <Brain size={12} />
            Reasoning
          </span>
        )}
        {model.inputModalities.includes("image") && (
          <span title="Supports image input">
            <Image size={12} />
            Vision
          </span>
        )}
      </div>
      <dl className="model-card-pricing">
        <div>
          <dt>Input / 1M</dt>
          <dd>{model.pricing ? price(model.pricing.input) : "—"}</dd>
        </div>
        <div>
          <dt>Output / 1M</dt>
          <dd>{model.pricing ? price(model.pricing.output) : "—"}</dd>
        </div>
      </dl>
      <footer>
        <span title={providerName}>
          <ArrowUpRight size={12} />
          {model.connectionName}
        </span>
        <Button
          variant="outline"
          size="xs"
          disabled={isDefault || saving}
          aria-label={
            isDefault
              ? `${model.name} via ${model.connectionName} is the default`
              : `Use ${model.name} via ${model.connectionName} as default`
          }
          onClick={onSelect}
        >
          {isDefault ? (
            <>
              <Check />
              Default
            </>
          ) : (
            "Set as default"
          )}
        </Button>
      </footer>
    </article>
  );
}
