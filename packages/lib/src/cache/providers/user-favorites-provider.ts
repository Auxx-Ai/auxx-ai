// packages/lib/src/cache/providers/user-favorites-provider.ts

import { computeUserFavorites } from '../../favorites/compute-user-favorites'
import type { CacheProvider } from '../org-cache-provider'
import type { CachedFavorite } from '../user-cache-keys'

/** Computes favorites for a user in a specific org. Receives "userId:orgId" as the compute ID. */
export const userFavoritesProvider: CacheProvider<CachedFavorite[]> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userFavorites: ${compositeId}`)
    }

    return computeUserFavorites(userId, organizationId, db)
  },
}
