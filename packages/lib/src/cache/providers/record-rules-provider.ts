// packages/lib/src/cache/providers/record-rules-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { dehydrateRecordRule } from '../../record-rules/store'
import type { CachedRecordRule } from '../../record-rules/types'
import { ArrayAccessor } from '../accessors'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes all record rules for an organization. The dispatch hot paths
 * (field-change hook + lifecycle bus consumer) filter this array in memory.
 */
export const recordRulesProvider: CacheProvider<CachedRecordRule[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select()
      .from(schema.RecordRule)
      .where(eq(schema.RecordRule.organizationId, orgId))
    return rows.map(dehydrateRecordRule)
  },

  createAccessor(dataFn: () => Promise<CachedRecordRule[]>) {
    return new ArrayAccessor(dataFn)
  },
}
