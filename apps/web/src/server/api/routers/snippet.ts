// server/api/routers/snippets.ts

import { SnippetSharingType } from '@auxx/database/enums'
import {
  createSnippet,
  createSnippetFolder,
  deleteSnippet,
  deleteSnippetFolderWithCascade,
  getSnippetWithAccess,
  incrementSnippetUsage,
  listSnippetFoldersWithCounts,
  listSnippetsForUser,
  setSnippetSharing,
  updateSnippet,
  updateSnippetFolder,
} from '@auxx/lib/snippets'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * TRPC router for snippets management operations.
 *
 * Thin glue: validate input (zod) → call a `@auxx/lib/snippets` helper → return.
 * All business logic, queries, and transactions live in `@auxx/lib/snippets`.
 * Helpers return neverthrow `Result<T, AuxxError>`; thrown `AuxxError`s are
 * mapped to the right tRPC code by `auxxErrorMiddleware`.
 */
export const snippetsRouter = createTRPCRouter({
  // Get all snippets for the organization
  all: protectedProcedure
    .input(
      z.object({
        folderId: z.string().optional(),
        searchQuery: z.string().optional(),
        includeShared: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await listSnippetsForUser(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return { snippets: result.value }
    }),

  // Get a snippet by ID
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    const result = await getSnippetWithAccess(ctx.db, organizationId, userId, input.id)
    if (result.isErr()) throw result.error
    return result.value
  }),

  // Create a new snippet
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1, 'Title is required'),
        content: z.string().min(1, 'Content is required'),
        contentHtml: z.string().optional(),
        description: z.string().optional(),
        folderId: z.string().optional().nullable(),
        sharingType: z.enum(SnippetSharingType).default(SnippetSharingType.PRIVATE),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await createSnippet(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return { success: true, snippet: result.value }
    }),

  // Update an existing snippet
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1, 'Title is required').optional(),
        content: z.string().min(1, 'Content is required').optional(),
        contentHtml: z.string().optional(),
        description: z.string().optional(),
        folderId: z.string().nullable().optional(),
        sharingType: z.enum(SnippetSharingType).optional(),
        isFavorite: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { id, ...updates } = input
      const result = await updateSnippet(ctx.db, organizationId, userId, id, updates)
      if (result.isErr()) throw result.error
      return { success: true, snippet: result.value }
    }),

  // Delete a snippet (soft delete)
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await deleteSnippet(ctx.db, organizationId, userId, input.id)
      if (result.isErr()) throw result.error
      return { success: true }
    }),

  // Share a snippet with groups or members via ResourceAccess
  share: protectedProcedure
    .input(
      z.object({
        snippetId: z.string(),
        sharingType: z.enum(SnippetSharingType),
        // For CUSTOM sharing type - supports both groups and users
        shares: z
          .array(
            z.object({
              granteeType: z.enum(['group', 'user']),
              granteeId: z.string(),
              permission: z.enum(['VIEW', 'EDIT']).default('VIEW'),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await setSnippetSharing(
        ctx.db,
        organizationId,
        userId,
        input.snippetId,
        input.sharingType,
        input.shares
      )
      if (result.isErr()) throw result.error
      return { success: true }
    }),

  // Increment usage count
  incrementUsage: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Best-effort: never fail the caller on usage-tracking errors
      const result = await incrementSnippetUsage(ctx.db, organizationId, input.id)
      return { success: result.isOk() }
    }),

  // Get all snippet folders
  getFolders: protectedProcedure.query(async ({ ctx }) => {
    const result = await listSnippetFoldersWithCounts(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return { folders: result.value }
  }),

  // Create a new folder
  createFolder: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Folder name is required'),
        description: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await createSnippetFolder(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return { success: true, folder: result.value }
    }),

  // Update a folder
  updateFolder: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, 'Folder name is required').optional(),
        description: z.string().optional(),
        parentId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input
      const result = await updateSnippetFolder(ctx.db, ctx.session.organizationId, id, updates)
      if (result.isErr()) throw result.error
      return { success: true, folder: result.value }
    }),

  // Delete a folder
  deleteFolder: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        moveSnippetsTo: z.string().optional(), // Target folder for snippets if they should be moved
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await deleteSnippetFolderWithCascade(
        ctx.db,
        ctx.session.organizationId,
        input.id,
        input.moveSnippetsTo
      )
      if (result.isErr()) throw result.error
      return { success: true }
    }),
})
