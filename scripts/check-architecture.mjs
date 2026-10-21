import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalized = (path) => path.split(sep).join("/");

export function dependencyViolation(source, target) {
  const from = normalized(source);
  const to = normalized(target);
  if (
    from.startsWith("apps/web/") &&
    (to.startsWith("packages/runtime/") ||
      to === "@raphie/runtime" ||
      to.startsWith("@raphie/runtime/"))
  )
    return "The browser must depend on contracts, never runtime internals.";
  if (
    !from.includes("/bootstrap/") &&
    !/\/src\/(main\.ts|router\.tsx)$/.test(from) &&
    to.includes("/bootstrap/")
  )
    return "Only composition roots may depend on bootstrap modules.";
  if (from.includes("/domain/") || from.includes("/application/")) {
    if (/\/(infrastructure|presentation|bootstrap)\//.test(to))
      return "Domain and application layers cannot depend on outer adapters.";
    if (from.includes("/domain/") && to.includes("/application/"))
      return "Domain policies cannot depend on application orchestration.";
    if (
      !to.startsWith(".") &&
      !to.includes("/src/") &&
      to !== "@raphie/contracts" &&
      !to.startsWith("@raphie/contracts/")
    )
      return "Core layers must be independent of platform and framework packages.";
  }
  if (
    from.includes("/shared/") &&
    /\/(domains|bootstrap|presentation)\//.test(to)
  )
    return "Shared modules cannot depend on product domains or composition.";
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? files(path)
          : /\.tsx?$/.test(path)
            ? [path]
            : [];
      }),
    )
  ).flat();
}

export async function checkArchitecture(root = projectRoot) {
  const failures = [];
  for (const area of ["apps/web", "packages/runtime", "packages/contracts"]) {
    const sourceRoot = join(root, area, "src");
    for (const file of await files(sourceRoot)) {
      const source = normalized(relative(root, file));
      if (
        dirname(file) === sourceRoot &&
        !["router.tsx", "main.ts", "index.ts"].includes(file.split(sep).at(-1))
      )
        failures.push(`${source}: source roots contain entrypoints only.`);
      const text = await readFile(file, "utf8");
      // Static imports/re-exports and literal dynamic imports; no compiler API dependency.
      const imports = text.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g,
      );
      for (const [, specifier] of imports) {
        const target = specifier.startsWith(".")
          ? normalized(relative(root, resolve(dirname(file), specifier)))
          : specifier.startsWith("@/")
            ? `${area}/src/${specifier.slice(2)}`
            : specifier;
        const violation = dependencyViolation(source, target);
        if (violation) failures.push(`${source} → ${specifier}: ${violation}`);
      }
    }
  }
  return failures;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = await checkArchitecture();
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log("Domain dependency boundaries passed.");
}
