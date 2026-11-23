import type { CardInput, EventInput, FieldInput, RowInput } from "./card.ts";

/**
 * How long each kind of text may be. Text that wraps (a title, a warning)
 * gets room; text drawn inline beside other things (a badge, a tag) stays
 * short. Longer text is cut, never refused: a bot cannot count characters,
 * and a card lost to one long warning is worse than a warning cut short.
 */
const WRAPPING = 300;

const LABEL = 120;

const INLINE = 24;

const SHORT = 16;

const NAME = 40;

/** A board's columns and a task's steps, past which nothing more is kept. */
const MAX_COLUMNS = 12;

const MAX_STEPS = 200;

/** `text` cut to `most` characters with an ellipsis; a pair is never split. */
export function shortened(text: string, most: number) {
  const characters = Array.from(text.trim());
  return characters.length > most
    ? `${characters
        .slice(0, most - 1)
        .join("")
        .trimEnd()}…`
    : characters.join("");
}

const cut = (text: string | undefined, most: number) =>
  text === undefined ? undefined : shortened(text, most);

/** `values` without the absent ones, so a card never stores `undefined`. */
function present<T extends object>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as T;
}

const badge = (input: RowInput["badge"]) =>
  input ? { ...input, label: shortened(input.label, INLINE) } : undefined;

const names = (values: string[] | undefined, most: number) =>
  values?.map((value) => shortened(value, most));

function item<T extends RowInput | EventInput>(input: T): T {
  return present({
    ...input,
    title: shortened(input.title, WRAPPING),
    detail: cut(input.detail, WRAPPING),
    badge: badge(input.badge),
    link: input.link
      ? { ...input.link, label: shortened(input.link.label, SHORT) }
      : undefined,
    source: cut(input.source, LABEL),
  });
}

function row(input: RowInput): RowInput {
  return present({
    ...item(input),
    key: cut(input.key, INLINE),
    trailing: cut(input.trailing, SHORT),
    people: names(input.people, NAME),
    tags: names(input.tags, INLINE),
  });
}

function field(input: FieldInput): FieldInput {
  return present({
    ...input,
    label: shortened(input.label, INLINE),
    value: cut(input.value, WRAPPING),
    badge: badge(input.badge),
    people: names(input.people, NAME),
    tags: names(input.tags, INLINE),
  });
}

/** What a bot passed, with every text cut to the room its place has. */
export function fitted(input: CardInput): CardInput {
  return present({
    ...input,
    title: shortened(input.title, WRAPPING),
    source: cut(input.source, LABEL),
    warning: cut(input.warning, WRAPPING),
    stats: input.stats?.slice(0, 4).map((stat) => ({
      label: shortened(stat.label, INLINE),
      value: shortened(stat.value, SHORT),
    })),
    more: input.more
      ? { ...input.more, label: shortened(input.more.label, WRAPPING) }
      : undefined,
    groups: input.groups?.map((group) =>
      present({
        ...group,
        label: cut(group.label, LABEL),
        rows: group.rows.map(row),
      }),
    ),
    events: input.events?.map(item),
    columns: input.columns?.slice(0, MAX_COLUMNS).map((column) =>
      present({
        ...column,
        label: cut(column.label, LABEL),
        rows: column.rows.map(row),
      }),
    ),
    item: input.item
      ? present({
          ...input.item,
          key: cut(input.item.key, INLINE),
          fields: input.item.fields?.map(field),
          steps: input.item.steps?.slice(0, MAX_STEPS).map((step) => ({
            ...step,
            label: shortened(step.label, WRAPPING),
          })),
        })
      : undefined,
  });
}
