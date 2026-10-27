import { installationHealthy } from "./health-check.ts";

const config = Object.fromEntries(
  (await Bun.file("/etc/raphie/raphie.conf").text())
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
if (!(await installationHealthy(config))) process.exitCode = 1;
