// packages/lib/src/cache/providers/kb-catalog-provider.ts

import { computeKbCatalog, type KbCatalogEntry } from '../../kb/catalog/kb-catalog'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes the org's KB catalog — every KB with its published, AI-enabled
 * articles in tree order. Rendered into agent prompts as the browse-first
 * knowledge table of contents (see kb/catalog/render-kb-catalog.ts).
 */
export const kbCatalogProvider: CacheProvider<KbCatalogEntry[]> = {
  async compute(orgId, db) {
    return computeKbCatalog(orgId, db)
  },
}
