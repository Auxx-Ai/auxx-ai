// packages/lib/src/favorites/client.ts
// Client-safe types and constants for the favorites feature.
// Per repo convention, anything imported from non-server code lives here.

export const FAVORITE_TARGET_TYPES = [
  'ENTITY_INSTANCE',
  'TABLE_VIEW',
  'WORKFLOW',
  'SNIPPET',
  'FILE',
  'FOLDER',
  'DATASET',
  'DOCUMENT',
] as const

export type FavoriteTargetType = (typeof FAVORITE_TARGET_TYPES)[number]

export type FavoriteNodeType = 'ITEM' | 'FOLDER'

/** Per-type targetIds shape — the only place compound IDs are formalized in TS */
export interface FavoriteTargetIdsMap {
  ENTITY_INSTANCE: { entityDefinitionId: string; entityInstanceId: string }
  TABLE_VIEW: { tableViewId: string; tableId: string }
  WORKFLOW: { workflowId: string }
  SNIPPET: { snippetId: string }
  FILE: { folderFileId: string; folderId: string }
  FOLDER: { folderId: string }
  DATASET: { datasetId: string }
  DOCUMENT: { documentId: string; datasetId: string }
}

export type FavoriteTargetIds<T extends FavoriteTargetType = FavoriteTargetType> =
  FavoriteTargetIdsMap[T]

/** Raw favorite row as it lives in the client store. No server-side display hydration. */
export interface FavoriteEntity<T extends FavoriteTargetType = FavoriteTargetType> {
  id: string
  organizationMemberId: string
  organizationId: string
  userId: string
  nodeType: FavoriteNodeType
  title: string | null
  targetType: T | null
  targetIds: FavoriteTargetIdsMap[T] | null
  parentFolderId: string | null
  sortOrder: string
  createdAt: string
  updatedAt: string
}

/** Hard cap of nodes (items + folders) per (user, organization). */
export const FAVORITES_CAP = 50

/** Max characters allowed in a folder title. */
export const FAVORITE_FOLDER_TITLE_MAX = 60

/**
 * Stable string key for deduplication / "is favorited" lookups.
 * Order keys alphabetically so JSON shape can't drift.
 */
export function favoriteTargetKey<T extends FavoriteTargetType>(
  targetType: T,
  targetIds: FavoriteTargetIdsMap[T]
): string {
  const sorted = Object.keys(targetIds)
    .sort()
    .map((k) => `${k}=${(targetIds as Record<string, string>)[k]}`)
    .join('&')
  return `${targetType}::${sorted}`
}
