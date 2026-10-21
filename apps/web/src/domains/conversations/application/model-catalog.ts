import type { RuntimeSettings } from "@raphie/contracts";

export function modelCatalog(
  data: RuntimeSettings | undefined,
  search: string,
  filter: string,
  favorites: string[],
) {
  const familyOf = (id: string) =>
    id.includes("/") ? id.split("/")[0]! : (data?.provider ?? "");
  const families = [
    ...new Set(data?.models.map((model) => familyOf(model.id)) ?? []),
  ].sort();
  const query = search.trim().toLowerCase();
  const matching =
    data?.models.filter(
      (model) =>
        (filter === "all" ||
          (filter === "favorites"
            ? favorites.includes(`${data.provider}:${model.id}`)
            : familyOf(model.id) === filter)) &&
        `${model.name} ${model.id}`.toLowerCase().includes(query),
    ) ?? [];
  return { families, matching };
}
