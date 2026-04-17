// packages/lib/src/ingest/domain/excluded-tlds.ts

/**
 * Public suffixes / TLDs we never auto-create companies for.
 * Universities, government, military — not CRM targets for a Shopify support product.
 */
export const EXCLUDED_TLDS: ReadonlySet<string> = new Set([
  'edu',
  'gov',
  'mil',
  'ac.uk',
  'ac.jp',
  'ac.nz',
  'edu.au',
  'edu.sg',
  'gov.uk',
  'gov.au',
])
