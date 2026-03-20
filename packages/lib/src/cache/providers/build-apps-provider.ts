// packages/lib/src/cache/providers/build-apps-provider.ts

import { createScopedLogger } from '../../logger'
import type { BuildCachedApp } from '../build-user-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('build-apps-provider')

/** Computes apps the user has access to across all their developer accounts */
export const buildAppsProvider: CacheProvider<BuildCachedApp[]> = {
  async compute(userId, db) {
    // Get all developer account IDs for this user
    const memberships = await db.query.DeveloperAccountMember.findMany({
      where: (members, { eq }) => eq(members.userId, userId),
      columns: { developerAccountId: true },
    })

    const accountIds = memberships.map((m) => m.developerAccountId)
    if (accountIds.length === 0) return []

    // Fetch all apps for these accounts
    const apps = await db.query.App.findMany({
      where: (apps, { inArray }) => inArray(apps.developerAccountId, accountIds),
    })
    return apps as BuildCachedApp[]
  },
}
