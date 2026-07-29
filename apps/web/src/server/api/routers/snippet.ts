// apps/web/src/server/api/routers/snippet.ts

import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import {
  createSnippet,
  createSnippetFolder,
  deleteSnippet,
  deleteSnippetFolderWithCascade,
  getSnippetWithShares,
  incrementSnippetUsage,
  listSnippetFoldersWithCounts,
  listSnippetsForUser,
  updateSnippet,
  updateSnippetFolder,
} from '@auxx/lib/snippets'
import { z } from 'zod'
import { assertSnippetAccess, snippetListScope } from '~/server/lib/snippet-instance-access'
import { capabilityProcedure, createTRPCRouter } from '../trpc'

/**
 * TRPC router for snippets.
 *
 * Thin glue: validate input (zod) → assert access → call a `@auxx/lib/snippets`
 * helper → return. All business logic, queries, and transactions live in
 * `@auxx/lib/snippets`; helpers return neverthrow `Result<T, AuxxError>` and
 * thrown `AuxxError`s are mapped to the right tRPC code by `auxxErrorMiddleware`.
 *
 * **Access authority is `~/server/lib/snippet-instance-access.ts`** (plan 36 §6).
 * Every procedure below used to be a bare `protectedProcedure` reading zero
 * capabilities; snippets are now an `INSTANCE_ACCESS_RESOURCES` entry with
 * `baselineAtCreate: true`, so:
 *  - id-bearing procedures assert per instance (`view` / `edit` / `admin`);
 *  - `all` / `getFolders` FILTER rather than 403, on a scope computed before the
 *    query (the five `*.list` precedents — a server-warmed page call must not
 *    403);
 *  - `create` and the folder mutations have no instance to key on, so they gate
 *    on the area's Full rung, `PermissionKey.snippetsManage`.
 *
 * **Sharing is deliberately absent.** The old `share` procedure +
 * `setSnippetSharing` are gone; snippets share through
 * `resourceAccess.grantInstance` like every other shareable resource, which
 * authorizes on `assertAdminInstance('snippet', id)` and carries the share
 * notification/audit behavior a bespoke writer would have to re-implement.
 */
export const snippetsRouter = createTRPCRouter({
  // Read — every snippet the caller may view. No coarse assert: the scope is the
  // gate, and it is applied in SQL before the rows are read.
  all: capabilityProcedure
    .input(
      z.object({
        folderId: z.string().optional(),
        searchQuery: z.string().optional(),
        includeShared: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await listSnippetsForUser(
        ctx.db,
        organizationId,
        userId,
        snippetListScope(ctx.capabilities),
        input
      )
      if (result.isErr()) throw result.error
      return { snippets: result.value }
    }),

  // Read — one snippet plus its grants. `canEdit` drives the client's read-only
  // affordances and is the SAME predicate `update` asserts on.
  byId: capabilityProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    assertSnippetAccess(ctx.capabilities, input.id, 'view')
    const result = await getSnippetWithShares(
      ctx.db,
      ctx.session.organizationId,
      ctx.session.userId,
      input.id
    )
    if (result.isErr()) throw result.error
    return {
      ...result.value,
      canEdit: ctx.capabilities.canEditInstance('snippet', input.id),
    }
  }),

  // Full — creating a snippet (no instance exists yet to key on).
  create: capabilityProcedure
    .input(
      z.object({
        title: z.string().min(1, 'Title is required'),
        content: z.string().min(1, 'Content is required'),
        contentHtml: z.string().optional(),
        description: z.string().optional(),
        folderId: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assert(PermissionKey.snippetsManage)
      const { organizationId, userId } = ctx.session
      const result = await createSnippet(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return { success: true, snippet: result.value }
    }),

  // Edit — the whole patch is snippet CONTENT (title/body/description/folder).
  // Sharing is not reachable from here any more, and neither is favouriting:
  // that was `Snippet.isFavorite`, one boolean on the shared row, so it was
  // `edit`-gated and org-global. It now lives in the per-user `Favorite` table
  // like every other favouritable resource.
  update: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1, 'Title is required').optional(),
        content: z.string().min(1, 'Content is required').optional(),
        contentHtml: z.string().optional(),
        description: z.string().optional(),
        folderId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input
      assertSnippetAccess(ctx.capabilities, id, 'edit')
      const result = await updateSnippet(ctx.db, ctx.session.organizationId, id, updates)
      if (result.isErr()) throw result.error
      return { success: true, snippet: result.value }
    }),

  // Full — destroying the snippet. No admin override (plan 36 decision 0.6):
  // only its owner, an explicit `admin` grantee, or the org OWNER.
  delete: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertSnippetAccess(ctx.capabilities, input.id, 'admin')
      const result = await deleteSnippet(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) throw result.error
      return { success: true }
    }),

  // Read — usage tracking follows insertion, so it is gated like a read.
  // Best-effort: never fail the caller on a usage-tracking error, but DO fail
  // them on the access check (a 403 here is a real answer, not a tracking blip).
  incrementUsage: capabilityProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertSnippetAccess(ctx.capabilities, input.id, 'view')
      const result = await incrementSnippetUsage(ctx.db, ctx.session.organizationId, input.id)
      return { success: result.isOk() }
    }),

  // Read — folders are flat LABELS with no per-folder grants (decision 0.4), so
  // the rows are unfiltered; the per-folder COUNTS are scoped to the snippets the
  // caller may view, or they leak the volume of other members' private snippets.
  getFolders: capabilityProcedure.query(async ({ ctx }) => {
    const result = await listSnippetFoldersWithCounts(
      ctx.db,
      ctx.session.organizationId,
      snippetListScope(ctx.capabilities)
    )
    if (result.isErr()) throw result.error
    return { folders: result.value }
  }),

  // Full — folder mutations are org-wide by construction (a folder is shared by
  // everyone who files a snippet in it) and there is no per-folder grant to key
  // on. Before plan 36 these were bare `protectedProcedure`s: ANY member could
  // rename or cascade-delete any folder in the org.
  createFolder: capabilityProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Folder name is required'),
        description: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assert(PermissionKey.snippetsManage)
      const { organizationId, userId } = ctx.session
      const result = await createSnippetFolder(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return { success: true, folder: result.value }
    }),

  updateFolder: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, 'Folder name is required').optional(),
        description: z.string().optional(),
        parentId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assert(PermissionKey.snippetsManage)
      const { id, ...updates } = input
      const result = await updateSnippetFolder(ctx.db, ctx.session.organizationId, id, updates)
      if (result.isErr()) throw result.error
      return { success: true, folder: result.value }
    }),

  deleteFolder: capabilityProcedure
    .input(
      z.object({
        id: z.string(),
        moveSnippetsTo: z.string().optional(), // Target folder for snippets if they should be moved
      })
    )
    .mutation(async ({ ctx, input }) => {
      ctx.capabilities.assert(PermissionKey.snippetsManage)
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
