// packages/lib/src/favorites/favorites-service.ts
// Functional service methods for favorites. Returns neverthrow Result; mutations
// fire onCacheEvent after successful DB write so the user cache stays warm.

import { type Database, database as ddb, schema } from '@auxx/database'
import { generateKeyBetween, getSmartSortPositions, nextKeyAfter } from '@auxx/utils'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { onCacheEvent } from '../cache/invalidate'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import {
  FAVORITE_TARGET_TYPES,
  FAVORITES_CAP,
  type FavoriteEntity,
  type FavoriteTargetIdsMap,
  type FavoriteTargetType,
  favoriteTargetKey,
} from './client'
import { toCachedFavorite } from './to-cached-favorite'

interface MemberContext {
  organizationMemberId: string
  organizationId: string
  userId: string
}

interface AddFavoriteInput<T extends FavoriteTargetType = FavoriteTargetType> {
  targetType: T
  targetIds: FavoriteTargetIdsMap[T]
}

function rowToEntity(row: typeof schema.Favorite.$inferSelect): FavoriteEntity {
  const cached = toCachedFavorite(row)
  return cached as FavoriteEntity
}

/** Compute the next sort key for a new sibling at the end of a list. */
async function nextSortOrderForParent(
  db: Database,
  memberId: string,
  parentFolderId: string | null
): Promise<string> {
  const rows = await db
    .select({
      sortOrder: schema.Favorite.sortOrder,
      parentFolderId: schema.Favorite.parentFolderId,
    })
    .from(schema.Favorite)
    .where(eq(schema.Favorite.organizationMemberId, memberId))

  const siblings = rows
    .filter((r) => (r.parentFolderId ?? null) === parentFolderId)
    .map((r) => r.sortOrder)
    .sort()

  const last = siblings[siblings.length - 1] ?? null
  return nextKeyAfter(last)
}

async function countNodes(db: Database, memberId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.Favorite.id })
    .from(schema.Favorite)
    .where(eq(schema.Favorite.organizationMemberId, memberId))
  return rows.length
}

async function findExistingItem<T extends FavoriteTargetType>(
  db: Database,
  memberId: string,
  targetType: T,
  targetIds: FavoriteTargetIdsMap[T]
): Promise<typeof schema.Favorite.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.Favorite)
    .where(
      and(
        eq(schema.Favorite.organizationMemberId, memberId),
        eq(schema.Favorite.nodeType, 'ITEM'),
        eq(schema.Favorite.targetType, targetType)
      )
    )
  const wantKey = favoriteTargetKey(targetType, targetIds)
  return (
    rows.find((r) => {
      if (!r.targetType || !r.targetIds) return false
      return (
        favoriteTargetKey(
          r.targetType as FavoriteTargetType,
          r.targetIds as FavoriteTargetIdsMap[FavoriteTargetType]
        ) === wantKey
      )
    }) ?? null
  )
}

/** Add a favorite item. Idempotent: returns the existing row if already favorited. */
export async function addFavorite<T extends FavoriteTargetType>(
  member: MemberContext,
  input: AddFavoriteInput<T>,
  db: Database = ddb
): Promise<Result<FavoriteEntity, Error>> {
  if (!FAVORITE_TARGET_TYPES.includes(input.targetType)) {
    return err(new BadRequestError(`Unsupported favorite target type: ${input.targetType}`))
  }

  const existing = await findExistingItem(
    db,
    member.organizationMemberId,
    input.targetType,
    input.targetIds
  )
  if (existing) {
    return ok(rowToEntity(existing))
  }

  const total = await countNodes(db, member.organizationMemberId)
  if (total >= FAVORITES_CAP) {
    return err(
      new BadRequestError(`Favorites cap reached (${FAVORITES_CAP}). Remove one to add another.`)
    )
  }

  const sortOrder = await nextSortOrderForParent(db, member.organizationMemberId, null)

  const [created] = await db
    .insert(schema.Favorite)
    .values({
      organizationId: member.organizationId,
      organizationMemberId: member.organizationMemberId,
      userId: member.userId,
      nodeType: 'ITEM',
      title: null,
      targetType: input.targetType,
      targetIds: input.targetIds as Record<string, string>,
      parentFolderId: null,
      sortOrder,
    })
    .returning()

  if (!created) return err(new Error('Failed to create favorite'))

  await onCacheEvent('favorite.changed', {
    userId: member.userId,
    orgId: member.organizationId,
  })

  return ok(rowToEntity(created))
}

/** Remove a favorite by id. Verifies ownership. */
export async function removeFavorite(
  member: MemberContext,
  favoriteId: string,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const [row] = await db
    .select()
    .from(schema.Favorite)
    .where(
      and(
        eq(schema.Favorite.id, favoriteId),
        eq(schema.Favorite.organizationMemberId, member.organizationMemberId)
      )
    )
    .limit(1)
  if (!row) return err(new NotFoundError('Favorite not found'))

  await db.delete(schema.Favorite).where(eq(schema.Favorite.id, favoriteId))

  await onCacheEvent(row.nodeType === 'FOLDER' ? 'favorite-folder.changed' : 'favorite.changed', {
    userId: member.userId,
    orgId: member.organizationId,
  })

  return ok(undefined)
}

/** Reorder a set of favorites. Rows must belong to the member. */
export async function reorderFavorites(
  member: MemberContext,
  updates: { id: string; sortOrder: string }[],
  db: Database = ddb
): Promise<Result<void, Error>> {
  if (updates.length === 0) return ok(undefined)

  const ids = updates.map((u) => u.id)
  const rows = await db
    .select({ id: schema.Favorite.id })
    .from(schema.Favorite)
    .where(
      and(
        inArray(schema.Favorite.id, ids),
        eq(schema.Favorite.organizationMemberId, member.organizationMemberId)
      )
    )
  if (rows.length !== ids.length) {
    return err(new ForbiddenError('Some favorites do not belong to this member'))
  }

  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(schema.Favorite)
        .set({ sortOrder: u.sortOrder, updatedAt: new Date() })
        .where(eq(schema.Favorite.id, u.id))
    }
  })

  await onCacheEvent('favorite.changed', {
    userId: member.userId,
    orgId: member.organizationId,
  })

  return ok(undefined)
}

/** Move a favorite into a folder (or to root). Recomputes sortOrder for new sibling group. */
export async function moveToFolder(
  member: MemberContext,
  favoriteId: string,
  parentFolderId: string | null,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const [row] = await db
    .select()
    .from(schema.Favorite)
    .where(
      and(
        eq(schema.Favorite.id, favoriteId),
        eq(schema.Favorite.organizationMemberId, member.organizationMemberId)
      )
    )
    .limit(1)
  if (!row) return err(new NotFoundError('Favorite not found'))

  // Folders are root-only — cannot nest folders.
  if (row.nodeType === 'FOLDER' && parentFolderId !== null) {
    return err(new BadRequestError('Folders cannot be nested'))
  }

  if (parentFolderId) {
    const [folder] = await db
      .select()
      .from(schema.Favorite)
      .where(
        and(
          eq(schema.Favorite.id, parentFolderId),
          eq(schema.Favorite.organizationMemberId, member.organizationMemberId),
          eq(schema.Favorite.nodeType, 'FOLDER')
        )
      )
      .limit(1)
    if (!folder) return err(new NotFoundError('Target folder not found'))
  }

  const sortOrder = await nextSortOrderForParent(db, member.organizationMemberId, parentFolderId)

  await db
    .update(schema.Favorite)
    .set({ parentFolderId, sortOrder, updatedAt: new Date() })
    .where(eq(schema.Favorite.id, favoriteId))

  await onCacheEvent('favorite.changed', {
    userId: member.userId,
    orgId: member.organizationId,
  })

  return ok(undefined)
}

/** Create a folder at root. */
export async function createFolder(
  member: MemberContext,
  title: string,
  db: Database = ddb
): Promise<Result<FavoriteEntity, Error>> {
  const trimmed = title.trim()
  if (!trimmed) return err(new BadRequestError('Folder title is required'))

  const total = await countNodes(db, member.organizationMemberId)
  if (total >= FAVORITES_CAP) {
    return err(new BadRequestError(`Favorites cap reached (${FAVORITES_CAP})`))
  }

  const sortOrder = await nextSortOrderForParent(db, member.organizationMemberId, null)

  const [created] = await db
    .insert(schema.Favorite)
    .values({
      organizationId: member.organizationId,
      organizationMemberId: member.organizationMemberId,
      userId: member.userId,
      nodeType: 'FOLDER',
      title: trimmed,
      targetType: null,
      targetIds: null,
      parentFolderId: null,
      sortOrder,
    })
    .returning()
  if (!created) return err(new Error('Failed to create folder'))

  await onCacheEvent('favorite-folder.changed', {
    userId: member.userId,
    orgId: member.organizationId,
  })

  return ok(rowToEntity(created))
}

/** Rename a folder. */
export async function renameFolder(
  member: MemberContext,
  folderId: string,
  title: string,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const trimmed = title.trim()
  if (!trimmed) return err(new BadRequestError('Folder title is required'))

  const [row] = await db
    .select()
    .from(schema.Favorite)
    .where(
      and(
        eq(schema.Favorite.id, folderId),
        eq(schema.Favorite.organizationMemberId, member.organizationMemberId),
        eq(schema.Favorite.nodeType, 'FOLDER')
      )
    )
    .limit(1)
  if (!row) return err(new NotFoundError('Folder not found'))

  await db
    .update(schema.Favorite)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(schema.Favorite.id, folderId))

  await onCacheEvent('favorite-folder.changed', {
    userId: member.userId,
    orgId: member.organizationId,
  })

  return ok(undefined)
}

/** Delete a folder; child rows cascade via FK. */
export async function deleteFolder(
  member: MemberContext,
  folderId: string,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const [row] = await db
    .select()
    .from(schema.Favorite)
    .where(
      and(
        eq(schema.Favorite.id, folderId),
        eq(schema.Favorite.organizationMemberId, member.organizationMemberId),
        eq(schema.Favorite.nodeType, 'FOLDER')
      )
    )
    .limit(1)
  if (!row) return err(new NotFoundError('Folder not found'))

  await db.delete(schema.Favorite).where(eq(schema.Favorite.id, folderId))

  await onCacheEvent('favorite-folder.changed', {
    userId: member.userId,
    orgId: member.organizationId,
  })

  return ok(undefined)
}

/** Cleanup hook called when an org member is removed. DB cascade handles the row deletion;
 *  this is here to flush any in-memory caches keyed on (userId, orgId). */
export async function deleteFavoritesForMember(
  userId: string,
  organizationId: string
): Promise<void> {
  await onCacheEvent('favorite-folder.changed', { userId, orgId: organizationId })
}

export { getSmartSortPositions, generateKeyBetween }
export type { MemberContext, AddFavoriteInput }
