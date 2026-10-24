import { bundledLanguages, bundledLanguagesAlias, bundledThemes } from "shiki";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

/**
 * Syntax highlighting for fenced code in chat. Shiki runs on its WASM regex
 * engine, which cannot backtrack catastrophically on hostile input. Both
 * themes ship in one HTML string, and CSS picks the active one.
 */
export const LIGHT_THEME = "github-light";

export const DARK_THEME = "github-dark";

const MAX_CACHE_ENTRIES = 200;
const MAX_CODE_LENGTH = 100_000;

type LanguageLoader = (typeof bundledLanguages)[keyof typeof bundledLanguages];

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Set<string>();
const cache = new Map<string, string>();

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [bundledThemes[LIGHT_THEME], bundledThemes[DARK_THEME]],
    langs: [],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
  return highlighter;
}

/** Resolves a fence label such as "ts" or "python" to its language loader. */
function resolveLanguage(
  label: string,
): { id: string; load: LanguageLoader } | null {
  const id = label.trim().toLowerCase();
  if (!id) return null;
  const load =
    (bundledLanguages as Record<string, LanguageLoader | undefined>)[id] ??
    (bundledLanguagesAlias as Record<string, LanguageLoader | undefined>)[id];
  return load ? { id, load } : null;
}

/**
 * Highlighted HTML for a code block, or null when the language is unknown,
 * too large to highlight, or fails to load. Callers keep the plain block then.
 */
export async function highlightCode(
  code: string,
  label: string,
): Promise<string | null> {
  const language = resolveLanguage(label);
  if (!language || code.length > MAX_CODE_LENGTH) return null;
  const key = `${language.id}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const shiki = await getHighlighter();
  if (!loaded.has(language.id)) {
    await shiki.loadLanguage(language.load);
    loaded.add(language.id);
  }
  const html = shiki.codeToHtml(code, {
    lang: language.id,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  });
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, html);
  return html;
}
