// packages/lib/src/cache/providers/record-rules-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { dehydrateRecordRule } from '../../record-rules/store'
import type { CachedRecordRule } from '../../record-rules/types'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Caches an organization's DB-backed record rules — and ONLY those.
 *
 * The code-declared system rules (`declareSystemRules`) are NOT cached here.
 * They are unioned in at read time by `getCachedRecordRules`, via
 * `resolveOrgSystemRules`, precisely so a cached entry can never outlive the
 * declaration that produced it. See `cache/org-system-rules.ts` for what that
 * bought and what it cost when the union was cached.
 *
 * The dispatch hot paths (field-change hook + lifecycle bus consumer) filter the
 * unioned array in memory.
 */
export const recordRulesProvider: CacheProvider<CachedRecordRule[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select()
      .from(schema.RecordRule)
      .where(eq(schema.RecordRule.organizationId, orgId))
    return rows.map(dehydrateRecordRule)
  },
}
