import type { ModelSelection, RuntimeSettings } from "@raphie/contracts";

import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { ModelChoices } from "./model-choices";

type Props = {
  data?: RuntimeSettings;
  loading: boolean;
  error: Error | null;
  retry: () => void;
  model: ModelSelection | null;
  available: boolean;
  matching: RuntimeSettings["models"];
  filter: string;
  search: string;
  favorites: string[];
  disabled: boolean;
  onChoose: (id: string) => void;
  onFavorite: (key: string) => void;
};

export function ModelResults(props: Props) {
  return (
    <ScrollArea
      className="model-picker-results"
      viewportLabel="Available models"
    >
      <Results {...props} />
    </ScrollArea>
  );
}

function Results({
  data,
  loading,
  error,
  retry,
  model,
  available,
  matching,
  filter,
  search,
  favorites,
  disabled,
  onChoose,
  onFavorite,
}: Props) {
  if (loading)
    return (
      <p role="status" className="model-picker-message">
        Loading models…
      </p>
    );
  if (error)
    return (
      <div className="model-picker-message" role="alert">
        Could not load models.{" "}
        <Button variant="link" type="button" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  if (!data?.providerEnabled || !data.credentialSource)
    return (
      <p className="model-picker-message">
        Connect a provider in Settings to choose a model.
      </p>
    );
  return (
    <>
      {model && !available && (
        <p className="model-picker-message" role="status">
          Current model is unavailable: {model.modelId}. Choose another model to
          continue.
        </p>
      )}
      <ModelChoices
        models={matching}
        provider={data.provider}
        selected={model}
        defaultModel={data.modelId}
        favorites={favorites}
        disabled={disabled}
        onChoose={onChoose}
        onFavorite={onFavorite}
      />
      {!matching.length && (
        <p className="model-picker-message" role="status">
          {filter === "favorites" && !search
            ? "Star a model to keep it here."
            : "No matching models."}
        </p>
      )}
    </>
  );
}
