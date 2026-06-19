// apps/web/src/components/icons/brands.ts

/**
 * Manifest of brand marks shipped in `apps/web/public/icons/brands/`, referenced via the
 * `brand:<slug>` visual-ref grammar (rendered by VisualIcon/AppIcon). `hasDark` means a
 * `<slug>-dark.svg` twin exists for dark theme. Kept in sync with the files on disk and the
 * MCP template catalog by `__tests__/brands.test.ts`.
 */
export const BRAND_ICONS = {
  airtable: { hasDark: false },
  anthropic: { hasDark: true },
  aws: { hasDark: true },
  box: { hasDark: false },
  context7: { hasDark: true },
  cratedb: { hasDark: false },
  deepseek: { hasDark: false },
  deepwiki: { hasDark: false },
  dropbox: { hasDark: false },
  exa: { hasDark: false },
  facebook: { hasDark: false },
  gemini: { hasDark: false },
  github: { hasDark: true },
  google: { hasDark: false },
  'google-drive': { hasDark: false },
  groq: { hasDark: false },
  huggingface: { hasDark: false },
  instagram: { hasDark: false },
  linear: { hasDark: false },
  microsoft: { hasDark: false },
  notion: { hasDark: true },
  onedrive: { hasDark: false },
  openai: { hasDark: true },
  outlook: { hasDark: false },
  paypal: { hasDark: false },
  postgresql: { hasDark: false },
  sentry: { hasDark: true },
  shopify: { hasDark: false },
  stripe: { hasDark: false },
  zapier: { hasDark: false },
} as const satisfies Record<string, { hasDark: boolean }>

export type BrandSlug = keyof typeof BRAND_ICONS
