import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";
import { defineCollection } from "astro:content";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // ADRs carry a `status` in their frontmatter.
    schema: docsSchema({
      extend: z.object({ status: z.string().optional() }),
    }),
  }),
};
