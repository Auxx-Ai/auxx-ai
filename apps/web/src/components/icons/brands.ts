// apps/web/src/components/icons/brands.ts

/**
 * Manifest of brand marks shipped in `apps/web/public/icons/brands/`, referenced via the
 * `brand:<slug>` visual-ref grammar (rendered by VisualIcon/AppIcon). `hasDark` means a
 * `<slug>-dark.svg` twin exists for dark theme. Kept in sync with the files on disk and the
 * MCP template catalog by `__tests__/brands.test.ts`.
 */
export const BRAND_ICONS = {
  context7: { hasDark: true },
  deepwiki: { hasDark: false },
  exa: { hasDark: false },
  github: { hasDark: true },
  google: { hasDark: false },
  huggingface: { hasDark: false },
  linear: { hasDark: false },
  microsoft: { hasDark: false },
  notion: { hasDark: true },
  paypal: { hasDark: false },
  sentry: { hasDark: true },
  shopify: { hasDark: false },
  stripe: { hasDark: false },
  zapier: { hasDark: false },
} as const satisfies Record<string, { hasDark: boolean }>

export type BrandSlug = keyof typeof BRAND_ICONS
