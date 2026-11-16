// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const repository = "https://github.com/kalibetre/raphie";
/** @param {string} label @param {string} slug */
const page = (label, slug) => ({ label, slug });

/** @param {string} label @param {string} link */
const external = (label, link) => ({
  label,
  link,
  attrs: { target: "_blank", rel: "noopener" },
});

export default defineConfig({
  // Set DOCS_SITE_URL to the deployed origin for canonical URLs and the sitemap.
  site: process.env.DOCS_SITE_URL,
  integrations: [
    starlight({
      title: "Raphie",
      description:
        "Documentation for Raphie, a self-hosted assistant platform with persistent bots.",
      logo: { src: "./src/assets/raphie.svg" },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/theme.css"],
      social: [{ icon: "github", label: "GitHub", href: repository }],
      lastUpdated: false,
      sidebar: [
        {
          label: "Start here",
          items: [
            page("Run from source", "source-setup"),
            page("User installation", "user-installation"),
            page("Linux system install", "linux-installation"),
            page("Service commands", "commands"),
          ],
        },
        {
          label: "Using Raphie",
          items: [
            page("Using Raphie", "using-raphie"),
            page("Bots & personality", "bots"),
            page("Memory", "memory"),
            page("Workspaces & sandboxes", "bot-workspaces"),
            page("MCP tools & schedules", "bot-automation"),
            page("Attachments", "general-attachments"),
            page("Telegram channel", "telegram"),
            page("Desktop client", "desktop"),
            page("Clients: who can do what", "clients"),
          ],
        },
        {
          label: "Security & operations",
          items: [
            page("Authentication", "authentication"),
            page("Credential storage", "provider-credential-storage"),
            page("Observability", "observability"),
            page("Standalone builds", "standalone-build"),
          ],
        },
        {
          label: "Architecture",
          items: [
            page("Current architecture", "architecture"),
            page("HTTP interface", "headless-interface"),
            external("Architecture in diagrams", "/diagrams/overview/"),
            external("Visual architecture guide", "/diagrams/reference/"),
            {
              label: "Decisions",
              items: [
                page(
                  "ADR 0001 · Headless runtime",
                  "adr/0001-headless-runtime-and-capability-specific-adapters",
                ),
                page(
                  "ADR 0002 · Bot workspaces",
                  "adr/0002-bot-owned-workspaces-and-temporary-compute",
                ),
                page(
                  "ADR 0003 · Native sandbox",
                  "adr/0003-native-bot-sandbox",
                ),
              ],
            },
          ],
        },
        {
          label: "Project",
          collapsed: true,
          items: [
            page("Roadmap", "roadmap"),
            page("Headless runtime design", "headless-runtime"),
            page("UI scrolling", "ui-scrolling"),
            page("Learning Rust (desktop)", "learning-rust"),
            page("Bun migration", "bun-migration"),
            page("Repository cleanup", "repository-cleanup"),
            page("Cleanup record", "cleanup"),
            external("Domain language", `${repository}/blob/main/CONTEXT.md`),
            external("Contributing", `${repository}/blob/main/CONTRIBUTING.md`),
          ],
        },
      ],
    }),
  ],
});
