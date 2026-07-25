// packages/lib/src/cache/providers/has-permission-grants-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Whether an org has ANY PermissionGrant rows. The composition fast path reads
 * this to skip the grant query for orgs that never customized (every org until
 * the v2 permissions page ships, and most after). See §6.1.
 *
 * **The absence of a `granteeType` filter is load-bearing** (doc 19 §8.1): the
 * count MUST include `granteeType:'profile'` rows, because a profile grant is the
 * human capability BASE. Narrowing this query to specific grantee kinds would make
 * `computeUserCapabilities` skip every profile in an org whose only grants are
 * profile rows — silently disabling the whole feature with no error.
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
