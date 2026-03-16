// packages/lib/src/cache/providers/org-profile-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { DehydratedOrgProfile } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/** Computes the dehydrated org profile */
export const orgProfileProvider: CacheProvider<DehydratedOrgProfile> = {
  async compute(orgId, db) {
    const [org] = await db
      .select()
      .from(schema.Organization)
      .where(eq(schema.Organization.id, orgId))
      .limit(1)

    if (!org) {
      throw new Error(`Organization not found: ${orgId}`)
    }

    return {
      id: org.id,
      name: org.name,
      website: org.website,
      emailDomain: org.emailDomain,
      handle: org.handle,
      about: org.about,
      createdAt: org.createdAt.toISOString(),
      completedOnboarding: org.completedOnboarding ?? false,
    }
  },
}
