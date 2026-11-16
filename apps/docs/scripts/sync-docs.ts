// Copies the repository's `docs/` guides into Starlight's content collection.
//
// `docs/` stays the single source of truth: guides there are plain Markdown
// that read well on GitHub. This script adds the frontmatter Starlight needs
// (the title comes from the first `# ` heading) and rewrites relative links
// so `bots.md#limits` becomes the page URL `/bots/#limits`.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const sourceRoot = resolve(appRoot, "../../docs");
const contentRoot = join(appRoot, "src/content/docs");
const publicRoot = join(appRoot, "public");
const repositoryBlob = "https://github.com/kalibetre/raphie/blob/main";

// Docsify-only files and the link index the sidebar replaces.
const skipped = new Set(["README.md", "_sidebar.md"]);

// Standalone HTML guides get their own directory URLs, because Starlight
// strips `.html` from links and `/architecture/` is already a guide.
export const htmlGuides: Record<string, string> = {
  "architecture.html": "/diagrams/reference/",
  "architecture-overview.html": "/diagrams/overview/",
};

function rewriteHtmlGuide(source: string) {
  return source.replace(
    /(href|src)="([^"#:]+\.(?:html|svg))(#[^"]*)?"/g,
    (match, attribute: string, path: string, anchor = "") => {
      if (path === "index.html") return `${attribute}="/${anchor}"`;
      if (path === "favicon.svg") return `${attribute}="/favicon.svg"`;
      const url = htmlGuides[path];
      return url ? `${attribute}="${url}${anchor}"` : match;
    },
  );
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return nested.flat();
}

function splitFrontmatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) return { data: "", body: source };
  return { data: match[1] ?? "", body: source.slice(match[0].length) };
}

function pageUrl(docPath: string) {
  const withoutExtension = docPath.replace(/\.md$/, "");
  if (withoutExtension === "README") return "/";
  return `/${withoutExtension}/`;
}

/** Rewrites one link target found in the guide at `fromPath` (docs-relative). */
export function rewriteTarget(target: string, fromPath: string) {
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;
  const [path = "", hash] = target.split("#", 2);
  const anchor = hash === undefined ? "" : `#${hash}`;
  const resolved = posix.normalize(posix.join(posix.dirname(fromPath), path));
  if (resolved.startsWith("../"))
    return `${repositoryBlob}/${resolved.replace(/^(\.\.\/)+/, "")}${anchor}`;
  if (resolved.endsWith(".md")) return `${pageUrl(resolved)}${anchor}`;
  const htmlGuide = htmlGuides[resolved];
  if (htmlGuide) return `${htmlGuide}${anchor}`;
  return `/${resolved}${anchor}`;
}

/** Rewrites Markdown links outside fenced code blocks. */
export function rewriteLinks(body: string, fromPath: string) {
  const parts = body.split(/(^```[\s\S]*?^```)/m);
  return parts
    .map((part) =>
      part.startsWith("```")
        ? part
        : part.replace(
            /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
            (_, target: string) => `](${rewriteTarget(target, fromPath)})`,
          ),
    )
    .join("");
}

export function toStarlightPage(source: string, docPath: string) {
  const { data, body } = splitFrontmatter(source);
  const heading = /^# (.+)$/m.exec(body);
  if (!heading) throw new Error(`${docPath} has no "# " title heading`);
  const title = heading[1]!.trim();
  const content = body.replace(heading[0], "").replace(/^\s+/, "");
  const frontmatter = [
    data,
    `title: ${JSON.stringify(title)}`,
    `editUrl: ${JSON.stringify(`${repositoryBlob.replace("/blob/", "/edit/")}/docs/${docPath}`)}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${rewriteLinks(content, docPath)}`;
}

async function sync() {
  // The home page is hand-written; everything else here is generated.
  for (const entry of await readdir(contentRoot))
    if (entry !== "index.mdx")
      await rm(join(contentRoot, entry), { recursive: true, force: true });

  const files = await markdownFiles(sourceRoot);
  for (const file of files) {
    const docPath = relative(sourceRoot, file).split("\\").join("/");
    if (skipped.has(docPath)) continue;
    const target = join(contentRoot, docPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      toStarlightPage(await readFile(file, "utf8"), docPath),
    );
  }

  await rm(publicRoot, { recursive: true, force: true });
  await mkdir(publicRoot, { recursive: true });
  await cp(join(sourceRoot, "favicon.svg"), join(publicRoot, "favicon.svg"));
  for (const [file, url] of Object.entries(htmlGuides)) {
    const target = join(publicRoot, url, "index.html");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      rewriteHtmlGuide(await readFile(join(sourceRoot, file), "utf8")),
    );
  }
  console.log(`Synced ${files.length - skipped.size} guides from docs/`);
}

if (import.meta.main) await sync();
