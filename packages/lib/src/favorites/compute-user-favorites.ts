// packages/lib/src/favorites/compute-user-favorites.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import type { CachedFavorite } from '../cache/user-cache-keys'
import { toCachedFavorite } from './to-cached-favorite'

/**
 * Compute the favorites list for a user in a specific organization.
 * Used by the user cache provider; do not call directly from request paths.
 */
export async function computeUserFavorites(
  userId: string,
  organizationId: string,
  db: Database
): Promise<CachedFavorite[]> {
  const rows = await db
    .select()
    .from(schema.Favorite)
    .where(
      and(eq(schema.Favorite.userId, userId), eq(schema.Favorite.organizationId, organizationId))
    )
    .orderBy(asc(schema.Favorite.sortOrder))

  return rows.map(toCachedFavorite)
}
