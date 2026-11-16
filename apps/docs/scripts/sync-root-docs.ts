// Renders CONTRIBUTING.md and CONTEXT.md from the repository root as site
// pages. Those files stay at the root because GitHub and coding agents read
// them there; this keeps the site from drifting.
//
// Links to site pages (`apps/docs/src/content/docs/guides/bots.mdx#limits`)
// become page URLs (`/guides/bots/#limits`); other repository paths link to
// the file on GitHub.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(appRoot, "../..");
const contentPrefix = "apps/docs/src/content/docs/";
const repository = "https://github.com/kalibetre/raphie";

const pages = [
  {
    source: "CONTRIBUTING.md",
    target: "contribute/contributing.md",
    title: "Contributing",
    description:
      "How to set up, organize, verify and document a change to Raphie.",
    order: 1,
  },
  {
    source: "CONTEXT.md",
    target: "contribute/glossary.md",
    title: "Glossary",
    description:
      "The domain language Raphie uses in code, docs and conversation.",
    order: 2,
  },
  {
    source: "apps/docs/WRITING.md",
    target: "contribute/writing-docs.md",
    title: "Writing docs",
    description: "How pages on this site are structured, written and checked.",
    order: 3,
  },
];

/** Rewrites one link target found in a root document. */
export function rewriteTarget(target: string) {
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;
  const [path = "", hash] = target.split("#", 2);
  const anchor = hash === undefined ? "" : `#${hash}`;
  const resolved = posix.normalize(path);
  if (resolved.startsWith(contentPrefix)) {
    const slug = resolved
      .slice(contentPrefix.length)
      .replace(/(\/index)?\.mdx?$/, "");
    return `/${slug}/${anchor}`.replace(/^\/\//, "/");
  }
  if (resolved === "CONTEXT.md") return `/contribute/glossary/${anchor}`;
  if (resolved === "apps/docs/WRITING.md")
    return `/contribute/writing-docs/${anchor}`;
  if (resolved === "CONTRIBUTING.md")
    return `/contribute/contributing/${anchor}`;
  return `${repository}/blob/main/${resolved}${anchor}`;
}

/** Rewrites Markdown links outside fenced code blocks. */
export function rewriteLinks(body: string) {
  return body
    .split(/(^```[\s\S]*?^```)/m)
    .map((part) =>
      part.startsWith("```")
        ? part
        : part.replace(
            /\]\(([^)\s]+)\)/g,
            (_, target: string) => `](${rewriteTarget(target)})`,
          ),
    )
    .join("");
}

export function toPage(source: string, page: (typeof pages)[number]) {
  // The root file's own `# ` heading is replaced by the page title.
  const body = source.replace(/^# .+\n+/, "");
  const frontmatter = [
    `title: ${JSON.stringify(page.title)}`,
    `description: ${JSON.stringify(page.description)}`,
    `editUrl: ${JSON.stringify(`${repository}/edit/main/${page.source}`)}`,
    `sidebar:\n  order: ${page.order}`,
  ].join("\n");
  return `---\n${frontmatter}\n---\n\n${rewriteLinks(body)}`;
}

async function sync() {
  for (const page of pages) {
    const target = join(appRoot, "src/content/docs", page.target);
    await mkdir(resolve(target, ".."), { recursive: true });
    const source = await readFile(join(repositoryRoot, page.source), "utf8");
    await writeFile(target, toPage(source, page));
  }
}

if (import.meta.main) await sync();
