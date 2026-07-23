// packages/lib/src/cache/providers/has-permission-grants-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Whether an org has ANY PermissionGrant rows. The composition fast path reads
 * this to skip the grant query for orgs that never customized (every org until
 * the v2 permissions page ships, and most after). See §6.1.
 */
export const hasPermissionGrantsProvider: CacheProvider<boolean> = {
  async compute(orgId, db) {
    const [row] = await db
      .select({ id: schema.PermissionGrant.id })
      .from(schema.PermissionGrant)
      .where(eq(schema.PermissionGrant.organizationId, orgId))
      .limit(1)

    return row !== undefined
  },
}
