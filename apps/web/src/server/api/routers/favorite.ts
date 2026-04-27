// apps/web/src/server/api/routers/favorite.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { getUserCache } from '@auxx/lib/cache'
import {
  addFavorite,
  createFolder,
  deleteFolder,
  type MemberContext,
  moveToFolder,
  removeFavorite,
  renameFolder,
  reorderFavorites,
} from '@auxx/lib/favorites'
import { FAVORITE_FOLDER_TITLE_MAX, type FavoriteTargetIdsMap } from '@auxx/lib/favorites/client'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const targetIdsByType: {
  [K in keyof FavoriteTargetIdsMap]: z.ZodType<FavoriteTargetIdsMap[K]>
} = {
  ENTITY_INSTANCE: z.object({
    entityDefinitionId: z.string(),
    entityInstanceId: z.string(),
  }),
  TABLE_VIEW: z.object({ tableViewId: z.string(), tableId: z.string() }),
  WORKFLOW: z.object({ workflowId: z.string() }),
  SNIPPET: z.object({ snippetId: z.string() }),
  FILE: z.object({ folderFileId: z.string(), folderId: z.string() }),
  FOLDER: z.object({ folderId: z.string() }),
  DATASET: z.object({ datasetId: z.string() }),
  DOCUMENT: z.object({ documentId: z.string(), datasetId: z.string() }),
}

const addInput = z.discriminatedUnion('targetType', [
  z.object({
    targetType: z.literal('ENTITY_INSTANCE'),
    targetIds: targetIdsByType.ENTITY_INSTANCE,
  }),
  z.object({ targetType: z.literal('TABLE_VIEW'), targetIds: targetIdsByType.TABLE_VIEW }),
  z.object({ targetType: z.literal('WORKFLOW'), targetIds: targetIdsByType.WORKFLOW }),
  z.object({ targetType: z.literal('SNIPPET'), targetIds: targetIdsByType.SNIPPET }),
  z.object({ targetType: z.literal('FILE'), targetIds: targetIdsByType.FILE }),
  z.object({ targetType: z.literal('FOLDER'), targetIds: targetIdsByType.FOLDER }),
  z.object({ targetType: z.literal('DATASET'), targetIds: targetIdsByType.DATASET }),
  z.object({ targetType: z.literal('DOCUMENT'), targetIds: targetIdsByType.DOCUMENT }),
])

const reorderInput = z.object({
  updates: z
    .array(z.object({ id: z.string(), sortOrder: z.string() }))
    .min(1)
    .max(60),
})

const moveInput = z.object({
  favoriteId: z.string(),
  parentFolderId: z.string().nullable(),
})

const folderIdInput = z.object({ folderId: z.string() })
const renameFolderInput = z.object({
  folderId: z.string(),
  title: z.string().min(1).max(FAVORITE_FOLDER_TITLE_MAX),
})
const createFolderInput = z.object({
  title: z.string().min(1).max(FAVORITE_FOLDER_TITLE_MAX),
})

async function loadMemberContext(
  db: Database,
  userId: string,
  organizationId: string
): Promise<MemberContext> {
  const [member] = await db
    .select({
      id: schema.OrganizationMember.id,
      userId: schema.OrganizationMember.userId,
      organizationId: schema.OrganizationMember.organizationId,
    })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.userId, userId),
        eq(schema.OrganizationMember.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Membership not found' })
  }
  return {
    organizationMemberId: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
  }
}

/** Unwrap a neverthrow Result, throwing the underlying AuxxError so the
 *  auxxErrorMiddleware can map it to the right TRPCError code. */
function unwrap<T>(result: Result<T, Error>): T {
  if (result.isErr()) {
    throw result.error
  }
  return result.value
}

export const favoriteRouter = createTRPCRouter({
  /** List the user's favorites for the active organization. Served from cache. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const cache = getUserCache()
    return cache.get(ctx.session.userId, 'userFavorites', ctx.session.organizationId)
  }),

  add: protectedProcedure.input(addInput).mutation(async ({ ctx, input }) => {
    const member = await loadMemberContext(ctx.db, ctx.session.userId, ctx.session.organizationId)
    return unwrap(await addFavorite(member, input as Parameters<typeof addFavorite>[1], ctx.db))
  }),

  remove: protectedProcedure
    .input(z.object({ favoriteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const member = await loadMemberContext(ctx.db, ctx.session.userId, ctx.session.organizationId)
      unwrap(await removeFavorite(member, input.favoriteId, ctx.db))
      return { ok: true }
    }),

  reorder: protectedProcedure.input(reorderInput).mutation(async ({ ctx, input }) => {
    const member = await loadMemberContext(ctx.db, ctx.session.userId, ctx.session.organizationId)
    unwrap(await reorderFavorites(member, input.updates, ctx.db))
    return { ok: true }
  }),

  move: protectedProcedure.input(moveInput).mutation(async ({ ctx, input }) => {
    const member = await loadMemberContext(ctx.db, ctx.session.userId, ctx.session.organizationId)
    unwrap(await moveToFolder(member, input.favoriteId, input.parentFolderId, ctx.db))
    return { ok: true }
  }),

  createFolder: protectedProcedure.input(createFolderInput).mutation(async ({ ctx, input }) => {
    const member = await loadMemberContext(ctx.db, ctx.session.userId, ctx.session.organizationId)
    return unwrap(await createFolder(member, input.title, ctx.db))
  }),

  renameFolder: protectedProcedure.input(renameFolderInput).mutation(async ({ ctx, input }) => {
    const member = await loadMemberContext(ctx.db, ctx.session.userId, ctx.session.organizationId)
    unwrap(await renameFolder(member, input.folderId, input.title, ctx.db))
    return { ok: true }
  }),

  deleteFolder: protectedProcedure.input(folderIdInput).mutation(async ({ ctx, input }) => {
    const member = await loadMemberContext(ctx.db, ctx.session.userId, ctx.session.organizationId)
    unwrap(await deleteFolder(member, input.folderId, ctx.db))
    return { ok: true }
  }),
})
