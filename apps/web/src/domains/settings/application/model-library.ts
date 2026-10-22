import type { RuntimeSettings } from "@raphie/contracts";

export type LibraryModel = RuntimeSettings["models"][number];

export function modelSource(model: LibraryModel) {
  const namespace = model.id.includes("/")
    ? model.id.split("/")[0]!.replace(/^~/, "")
    : model.provider;
  const label = model.name.includes(":")
    ? model.name.split(":")[0]!.trim()
    : ({ openai: "OpenAI", anthropic: "Anthropic", openrouter: "OpenRouter" }[
        namespace
      ] ?? namespace);
  return { id: label.toLowerCase().replace(/[^a-z0-9]/g, ""), label };
}

export function filterModels(
  models: LibraryModel[],
  search: string,
  provider: string,
  source: string,
) {
  const query = search.trim().toLowerCase();
  return models.filter(
    (model) =>
      (provider === "all" || model.provider === provider) &&
      (source === "all" || modelSource(model).id === source) &&
      `${model.name} ${model.id} ${model.provider}`
        .toLowerCase()
        .includes(query),
  );
}
