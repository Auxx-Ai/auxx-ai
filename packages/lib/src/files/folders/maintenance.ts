// packages/lib/src/files/folders/maintenance.ts

/**
 * Whole-organization folder repair sweeps: admin and job entry points, not
 * request-path API.
 *
 * ## These have no caller today, and are ported anyway
 *
 * `rebuildPaths`, `fixDepths` and `cleanupEmpty` are the only three methods on
 * the legacy `FolderService` that were kept rather than deleted despite having
 * zero call sites — everything else zero-caller was dropped (see the facade's
 * header). Three reasons:
 *
 * - They are `05-core-services.md` §5.5's named deliverable for this module.
 * - They are the *repair* tool for the drift every other read here now tolerates
 *   — `createFolder` inherits a stale parent path deliberately, on the
 *   assumption that something can fix it later. Deleting the fixer while relying
 *   on it is not a trade.
 * - They are what the pure core is for. `rebuildPaths` used to issue **two
 *   queries per folder** (one for the parent row, one for the parent's depth)
 *   inside a loop over every folder in the organization, then one `UPDATE` per
 *   drifted row: 2N + drift statements. It is now one `SELECT`, one pure pass,
 *   and one `UPDATE` per genuinely drifted row.
 *
 * They stay unexported from any barrel until something calls them; the honest
 * state is "written, tested, not yet wired", not "deleted" and not "shipped".
 */

import { schema } from '@auxx/database'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import { folderScope, loadFolderNodes } from './folder-queries'
import type { FolderWriteDeps } from './ports'
import { computeTreeShape, driftedShapes } from './tree'

/** What a repair sweep reports. */
export interface RepairReport {
  /** How many folders the sweep inspected. */
  scanned: number
  /** How many rows it actually wrote. */
  repaired: number
}

/**
 * Recompute every folder's `path` and `depth` from its `parentId` chain and
 * write back the rows that disagree.
 *
 * The authoritative edge is `parentId`; `path` and `depth` are denormalised
 * caches of it, and this is what reconciles them. Runs on `ctx`, not a
 * transaction: each row's repair is independent and a partial sweep leaves the
 * hierarchy no worse than it found it, so a long sweep should not hold one
 * transaction open across the whole organization.
 *
 * Folders in a `parentId` cycle get a path derived from the partial walk
 * `ancestorsOf` returns before it detects the loop. That is bounded and
 * deterministic, but it is not *correct* — a cycle has no root, so no path is.
 * Breaking the cycle is a decision for a human, not for a sweep.
 */
export async function rebuildFolderPaths(
  ctx: FilesCtx,
  deps: FolderWriteDeps
): Promise<Result<RepairReport, AuxxError>> {
  return guard(
    async () => {
      const nodes = await loadFolderNodes(ctx)
      const drifted = driftedShapes(nodes)
      const now = deps.now()

      for (const shape of drifted) {
        await ctx.db
          .update(schema.Folder)
          .set({ path: shape.path, depth: shape.depth, updatedAt: now })
          .where(folderScope(ctx, [eq(schema.Folder.id, shape.id)]))
      }

      return { scanned: nodes.length, repaired: drifted.length }
    },
    'Failed to rebuild folder paths',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Correct `depth` alone, leaving `path` untouched.
 *
 * Kept separate from {@link rebuildFolderPaths} because it is the safe half: a
 * wrong `depth` only affects ordering and indentation, while rewriting `path`
 * touches the column the file library's breadcrumbs render. An operator
 * inspecting a suspect hierarchy can run this first.
 */
export async function fixFolderDepths(
  ctx: FilesCtx,
  deps: FolderWriteDeps
): Promise<Result<RepairReport, AuxxError>> {
  return guard(
    async () => {
      const nodes = await loadFolderNodes(ctx)
      const byId = new Map(nodes.map((node) => [node.id, node]))
      const wrong = computeTreeShape(nodes).filter(
        (shape) => byId.get(shape.id)?.depth !== shape.depth
      )
      const now = deps.now()

      for (const shape of wrong) {
        await ctx.db
          .update(schema.Folder)
          .set({ depth: shape.depth, updatedAt: now })
          .where(folderScope(ctx, [eq(schema.Folder.id, shape.id)]))
      }

      return { scanned: nodes.length, repaired: wrong.length }
    },
    'Failed to fix folder depths',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Soft-delete folders that hold no live files and no live subfolders.
 *
 * One pass only, matching the legacy `cleanupEmpty`: a folder whose only child
 * this sweep deletes does not itself become empty until the next run. That is
 * deliberate — a transitive sweep would collapse a freshly-created empty
 * hierarchy in one go, and "I made the folders, then went to upload" is a normal
 * sequence.
 *
 * The two `NOT EXISTS` sub-queries are carried over verbatim; they are the one
 * piece of raw SQL in this module and they are correct.
 */
export async function cleanupEmptyFolders(
  ctx: FilesCtx,
  deps: FolderWriteDeps
): Promise<Result<RepairReport, AuxxError>> {
  return guard(
    async () => {
      const empty = await ctx.db
        .select({ id: schema.Folder.id })
        .from(schema.Folder)
        .where(
          and(
            folderScope(ctx),
            sql`NOT EXISTS (
              SELECT 1 FROM ${schema.FolderFile}
              WHERE ${schema.FolderFile.folderId} = ${schema.Folder.id}
              AND ${schema.FolderFile.deletedAt} IS NULL
            )`,
            sql`NOT EXISTS (
              SELECT 1 FROM ${schema.Folder} children
              WHERE children.parent_id = ${schema.Folder.id}
              AND children.deleted_at IS NULL
            )`
          )
        )

      if (empty.length === 0) return { scanned: 0, repaired: 0 }

      const now = deps.now()
      await ctx.db
        .update(schema.Folder)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.Folder.organizationId, ctx.organizationId),
            inArray(
              schema.Folder.id,
              empty.map((row) => row.id)
            ),
            isNull(schema.Folder.deletedAt)
          )
        )

      return { scanned: empty.length, repaired: empty.length }
    },
    'Failed to clean up empty folders',
    { organizationId: ctx.organizationId }
  )
}
