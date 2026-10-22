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
      aria-label={`${model.name} via ${providerName}`}
    >
      <div className="model-card-top">
        <span className="model-source-mark" aria-hidden="true">
          {source.label.slice(0, 1).toUpperCase()}
        </span>
        <span className="model-source-label">{source.label}</span>
        {isDefault && (
          <span className="catalog-badge connected">
            <Check size={12} />
            Default
          </span>
        )}
      </div>
      <h3>{name}</h3>
      <p className="model-card-id" title={model.id}>
        {model.id}
      </p>
      <div className="model-capabilities">
        {model.reasoning && (
          <span className="catalog-badge">
            <Brain size={12} />
            Reasoning
          </span>
        )}
        {model.inputModalities.includes("image") && (
          <span className="catalog-badge">
            <Image size={12} />
            Vision
          </span>
        )}
        {!model.reasoning && !model.inputModalities.includes("image") && (
          <span className="catalog-badge">Text</span>
        )}
      </div>
      <dl className="model-card-stats">
        <div>
          <dt>Context</dt>
          <dd title={`${model.contextWindow.toLocaleString()} tokens`}>
            {tokens(model.contextWindow)} <small>tokens</small>
          </dd>
        </div>
        <div>
          <dt>Max output</dt>
          <dd title={`${model.maxOutputTokens.toLocaleString()} tokens`}>
            {tokens(model.maxOutputTokens)} <small>tokens</small>
          </dd>
        </div>
        <div>
          <dt>Input / 1M</dt>
          <dd>{model.pricing ? price(model.pricing.input) : "Not listed"}</dd>
        </div>
        <div>
          <dt>Output / 1M</dt>
          <dd>{model.pricing ? price(model.pricing.output) : "Not listed"}</dd>
        </div>
      </dl>
      <footer>
        <span>
          <ArrowUpRight size={13} />
          {providerName}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={isDefault || saving}
          aria-label={
            isDefault
              ? `${model.name} is the default`
              : `Use ${model.name} as default`
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
