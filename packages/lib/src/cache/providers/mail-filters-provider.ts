// packages/lib/src/cache/providers/mail-filters-provider.ts

import { schema } from '@auxx/database'
import { asc, eq } from 'drizzle-orm'
import { dehydrateMailFilter } from '../../mail-filters/cache'
import type { CachedMailFilter } from '../../mail-filters/types'
import { ArrayAccessor } from '../accessors'
import type { CacheProvider } from '../org-cache-provider'

/**
 * All mail filters for an organization — ENABLED AND DISABLED alike.
 *
 * Dispatch filters this array in memory (`getEnabledMailFiltersForInbox`), the
 * same way `recordRules` does. Caching only the enabled rows would mean a
 * second read (or a second key) for the settings list, and would make
 * enable/disable a cache-shape change rather than a field flip.
 *
 * Loaded in `(inboxId, order)` order so the per-inbox slices come out in
 * evaluation order without a re-sort in the common case.
 */
export const mailFiltersProvider: CacheProvider<CachedMailFilter[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select()
      .from(schema.MailFilter)
      .where(eq(schema.MailFilter.organizationId, orgId))
      .orderBy(asc(schema.MailFilter.inboxId), asc(schema.MailFilter.order))

    return rows.map(dehydrateMailFilter)
  },

  createAccessor(dataFn: () => Promise<CachedMailFilter[]>) {
    return new ArrayAccessor(dataFn)
  },
}
