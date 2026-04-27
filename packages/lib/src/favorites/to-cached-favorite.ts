// packages/lib/src/favorites/to-cached-favorite.ts

import type { schema } from '@auxx/database'
import type { CachedFavorite } from '../cache/user-cache-keys'

type FavoriteRow = typeof schema.Favorite.$inferSelect

/** Convert a raw DB row to a JSON-serializable cached favorite. */
export function toCachedFavorite(row: FavoriteRow): CachedFavorite {
  return {
    id: row.id,
    organizationMemberId: row.organizationMemberId,
    organizationId: row.organizationId,
    userId: row.userId,
    nodeType: row.nodeType,
    title: row.title,
    targetType: row.targetType,
    targetIds: (row.targetIds as Record<string, string> | null) ?? null,
    parentFolderId: row.parentFolderId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}
