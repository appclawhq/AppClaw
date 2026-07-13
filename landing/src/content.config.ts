import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Blog posts live as markdown files in src/content/blog/.
// Drop a new .md file with the frontmatter below and it shows up on /blog.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    author: z.string().default('AppClaw'),
    // one of: product, engineering, field-notes
    category: z.enum(['product', 'engineering', 'field-notes']).default('product'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // optional cover image (path under /public), shown at the top of the post
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
  }),
});

export const collections = { blog };
