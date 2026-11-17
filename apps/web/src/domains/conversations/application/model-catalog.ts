import type { RuntimeSettings } from "@raphie/contracts";

/** A model's name without its provider prefix ("Anthropic: Claude Fable"
 * reads "Claude Fable"), unless another model would then read the same. */
export function shortModelName(name: string, models: { name: string }[] = []) {
  const short = name.replace(/^[^:]{1,40}:\s+/, "");
  if (short === name) return name;
  const clash = models.some(
    (m) => m.name !== name && m.name.replace(/^[^:]{1,40}:\s+/, "") === short,
  );
  return clash ? name : short;
}

export function modelCatalog(
  data: RuntimeSettings | undefined,
  search: string,
  filter: string,
  favorites: string[],
) {
  const familyOf = (model: RuntimeSettings["models"][number]) =>
    model.id.includes("/")
      ? model.id.split("/")[0]!.replace(/^~/, "")
      : model.provider;
  const families = [...new Set(data?.models.map(familyOf) ?? [])].sort();
  const query = search.trim().toLowerCase();
  const matching =
    data?.models.filter(
      (model) =>
        (filter === "all" ||
          (filter === "favorites"
            ? favorites.includes(`${model.connectionId}:${model.id}`)
            : familyOf(model) === filter)) &&
        `${model.name} ${model.id} ${model.connectionName}`
          .toLowerCase()
          .includes(query),
    ) ?? [];
  return { families, matching };
}
