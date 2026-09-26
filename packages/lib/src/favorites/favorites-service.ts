// packages/lib/src/favorites/favorites-service.ts
// Favorite-target CRUD on SidebarNode rows. Folder and move operations delegate to
// sidebar-layout so re-homing and the favorites-only fast path live in one place.

import { type Database, database as ddb, schema } from '@auxx/database'
import { generateKeyBetween, getSmartSortPositions, nextKeyAfter } from '@auxx/utils'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { onCacheEvent } from '../cache/invalidate'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import {
  compareSidebarNodes,
  countFavoriteBudget,
  isFavoriteItem,
  sidebarRef,
} from '../sidebar-layout/constants'
import type { SidebarMember } from '../sidebar-layout/draft'
import { listMemberSidebarNodes } from '../sidebar-layout/node-reads'
import {
  createSidebarFolder,
  deleteNode,
  moveNode,
  renameNode,
} from '../sidebar-layout/sidebar-mutations'
import { toSidebarNodeEntity } from '../sidebar-layout/to-sidebar-node'
import type { SidebarNodeEntity } from '../sidebar-layout/types'
import {
  FAVORITE_TARGET_TYPES,
  FAVORITES_CAP,
  type FavoriteEntity,
  type FavoriteTargetIdsMap,
  type FavoriteTargetType,
  favoriteTargetKey,
} from './client'

type MemberContext = SidebarMember

interface AddFavoriteInput<T extends FavoriteTargetType = FavoriteTargetType> {
  targetType: T
  targetIds: FavoriteTargetIdsMap[T]
}

function toFavoriteEntity(node: SidebarNodeEntity): FavoriteEntity {
  return node as FavoriteEntity
}

async function findMemberRow(
  db: Database,
  member: MemberContext,
  id: string
): Promise<SidebarNodeEntity | null> {
  const [row] = await db
    .select()
    .from(schema.SidebarNode)
    .where(
      and(
        eq(schema.SidebarNode.id, id),
        eq(schema.SidebarNode.organizationMemberId, member.organizationMemberId)
      )
    )
    .limit(1)
  return row ? toSidebarNodeEntity(row) : null
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

  const rows = await listMemberSidebarNodes(db, member.organizationMemberId)
  const wantKey = favoriteTargetKey(input.targetType, input.targetIds)
  const existing = rows.find(
    (r) =>
      isFavoriteItem(r) &&
      r.targetIds &&
      favoriteTargetKey(
        r.targetType as FavoriteTargetType,
        r.targetIds as FavoriteTargetIdsMap[FavoriteTargetType]
      ) === wantKey
  )
  if (existing) return ok(toFavoriteEntity(existing))

  if (countFavoriteBudget(rows) >= FAVORITES_CAP) {
    return err(
      new BadRequestError(`Favorites cap reached (${FAVORITES_CAP}). Remove one to add another.`)
    )
  }

  // New stars land in the Favorites group once the layout is materialized, else at the root.
  const parentId =
    rows.find((r) => r.nodeType === 'GROUP' && r.systemKey === 'favorites')?.id ?? null
  const last = rows
    .filter((r) => r.parentId === parentId)
    .sort(compareSidebarNodes)
    .at(-1)

  const [created] = await db
    .insert(schema.SidebarNode)
    .values({
      organizationId: member.organizationId,
      organizationMemberId: member.organizationMemberId,
      userId: member.userId,
      nodeType: 'ITEM',
      targetType: input.targetType,
      targetIds: input.targetIds as Record<string, string>,
      parentId,
      sortOrder: nextKeyAfter(last?.sortOrder ?? null),
    })
    .returning()

  if (!created) return err(new Error('Failed to create favorite'))

  await onCacheEvent('favorite.changed', { userId: member.userId, orgId: member.organizationId })

  return ok(toFavoriteEntity(toSidebarNodeEntity(created)))
}

/** Remove a favorite item, or a folder (whose contents are re-homed, not deleted). */
export async function removeFavorite(
  member: MemberContext,
  favoriteId: string,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const row = await findMemberRow(db, member, favoriteId)
  if (!row || !(row.nodeType === 'FOLDER' || isFavoriteItem(row))) {
    return err(new NotFoundError('Favorite not found'))
  }
  if (row.nodeType === 'FOLDER') return deleteFolder(member, favoriteId, db)

  await db.delete(schema.SidebarNode).where(eq(schema.SidebarNode.id, favoriteId))
  await onCacheEvent('favorite.changed', { userId: member.userId, orgId: member.organizationId })
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
    .select({ id: schema.SidebarNode.id })
    .from(schema.SidebarNode)
    .where(
      and(
        inArray(schema.SidebarNode.id, ids),
        eq(schema.SidebarNode.organizationMemberId, member.organizationMemberId)
      )
    )
  if (rows.length !== ids.length) {
    return err(new ForbiddenError('Some favorites do not belong to this member'))
  }

  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(schema.SidebarNode)
        .set({ sortOrder: u.sortOrder, updatedAt: new Date() })
        .where(eq(schema.SidebarNode.id, u.id))
    }
  })

  await onCacheEvent('favorite.changed', { userId: member.userId, orgId: member.organizationId })

  return ok(undefined)
}

/** Move a favorite into a folder, or back to Favorites (`null`), appended at the end. */
export async function moveToFolder(
  member: MemberContext,
  favoriteId: string,
  parentFolderId: string | null,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const result = await moveNode(db, member, {
    nodeId: favoriteId,
    parentId: parentFolderId ?? sidebarRef.group('favorites'),
  })
  return result.map(() => undefined)
}

/** Create a folder in Favorites. */
export async function createFolder(
  member: MemberContext,
  title: string,
  db: Database = ddb
): Promise<Result<FavoriteEntity, Error>> {
  const result = await createSidebarFolder(db, member, {
    parentId: sidebarRef.group('favorites'),
    title,
  })
  if (result.isErr()) return err(result.error)
  const created = result.value.nodes.find((n) => n.id === result.value.nodeId)
  return created ? ok(toFavoriteEntity(created)) : err(new Error('Failed to create folder'))
}

/** Rename a folder. */
export async function renameFolder(
  member: MemberContext,
  folderId: string,
  title: string,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const row = await findMemberRow(db, member, folderId)
  if (row?.nodeType !== 'FOLDER') return err(new NotFoundError('Folder not found'))
  const result = await renameNode(db, member, { nodeId: folderId, title })
  return result.map(() => undefined)
}

/** Delete a folder; its items move to the folder's parent instead of being deleted. */
export async function deleteFolder(
  member: MemberContext,
  folderId: string,
  db: Database = ddb
): Promise<Result<void, Error>> {
  const row = await findMemberRow(db, member, folderId)
  if (row?.nodeType !== 'FOLDER') return err(new NotFoundError('Folder not found'))
  const result = await deleteNode(db, member, { nodeId: folderId })
  return result.map(() => undefined)
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
