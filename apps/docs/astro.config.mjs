// @ts-check
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { defineConfig } from "astro/config";

/** @param {string} label @param {string} directory @param {boolean} [collapsed] */
const section = (label, directory, collapsed = false) => ({
  label,
  collapsed,
  items: [{ autogenerate: { directory } }],
});

export default defineConfig({
  // Set DOCS_SITE_URL to the deployed origin for canonical URLs and the sitemap.
  site: process.env.DOCS_SITE_URL,
  integrations: [
    // Must come before Starlight. Diagrams render with Mermaid's neutral base
    // theme; src/styles/theme.css recolours them for light and dark.
    mermaid({
      theme: "base",
      autoTheme: false,
      mermaidConfig: {
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        flowchart: {
          curve: "basis",
          padding: 14,
          nodeSpacing: 40,
          rankSpacing: 48,
        },
        sequence: { useMaxWidth: false },
      },
    }),
    starlight({
      title: "Raphie",
      description:
        "Documentation for Raphie, a self-hosted assistant platform with persistent bots.",
      logo: { src: "./src/assets/raphie.svg" },
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/kalibetre/raphie",
        },
      ],
      customCss: ["./src/styles/theme.css"],
      components: {
        Hero: "./src/components/Hero.astro",
        PageTitle: "./src/components/PageTitle.astro",
      },
      expressiveCode: {
        themes: ["vitesse-dark", "vitesse-light"],
        styleOverrides: {
          borderRadius: "0.75rem",
          borderColor: "var(--sl-color-hairline)",
          codeBackground: "var(--raphie-card)",
          codeFontFamily: "var(--sl-font-mono)",
          frames: {
            editorTabBarBackground: "var(--sl-color-bg-sidebar)",
            terminalTitlebarBackground: "var(--sl-color-bg-sidebar)",
            terminalTitlebarBorderBottomColor: "var(--sl-color-hairline)",
            editorActiveTabIndicatorTopColor: "var(--sl-color-accent)",
            frameBoxShadowCssValue: "none",
          },
        },
      },
      lastUpdated: false,
      editLink: {
        baseUrl: "https://github.com/kalibetre/raphie/edit/main/apps/docs/",
      },
      sidebar: [
        section("Get started", "start"),
        section("Guides", "guides"),
        section("Operate", "operate"),
        section("Architecture", "architecture"),
        section("Decisions", "decisions", true),
        section("Contribute", "contribute", true),
      ],
    }),
  ],
});
