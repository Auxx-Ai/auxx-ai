// packages/lib/src/files/lifecycle/attachment-maintenance.ts

/**
 * Whole-organization `Attachment` sweeps.
 *
 * These two moved off `AttachmentService` because they are not part of the
 * attachment read/write API: neither is reachable from a router, both scan every
 * attachment row in an organization, and both exist for an operator running
 * maintenance rather than for a request. `plans/attachments/05-core-services.md`
 * §5.3 puts them here for exactly that reason.
 *
 * **Both are unbounded**, inherited from the legacy bodies: no `LIMIT`, no
 * cursor, one round trip that materialises every matching row. That is fine at
 * current data volumes and is called out here so a future scheduled job adds
 * paging deliberately rather than discovering the scan in production.
 */

import { schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'

/** What {@link validateAttachmentIntegrity} found. */
export interface AttachmentIntegrityReport {
  validAttachments: number
  invalidAttachments: number
  /** One human-readable line per violation, prefixed with the attachment id. */
  errors: string[]
}

/**
 * Delete attachments whose target row no longer exists.
 *
 * Two anti-join scans — one for `fileId` rows with no `FolderFile`, one for
 * `assetId` rows with no `MediaAsset` — then a single `DELETE … WHERE id IN (…)`.
 * Three statements total regardless of how many orphans there are.
 *
 * Note this only catches a *hard*-deleted target. `FolderFile` and `MediaAsset`
 * are soft-deleted, and the joins here do not filter `deletedAt`, so an
 * attachment pointing at a soft-deleted file is deliberately left alone — its
 * target can still be restored. Parity with the legacy body.
 *
 * @param ctx Scope and database.
 * @returns The number of attachment rows deleted.
 */
export async function cleanupOrphanedAttachments(
  ctx: FilesCtx
): Promise<Result<number, AuxxError>> {
  return guard(
    async () => {
      const orphanedFileAttachments = await ctx.db
        .select({ id: schema.Attachment.id })
        .from(schema.Attachment)
        .leftJoin(schema.FolderFile, eq(schema.Attachment.fileId, schema.FolderFile.id))
        .where(
          and(
            eq(schema.Attachment.organizationId, ctx.organizationId),
            isNotNull(schema.Attachment.fileId),
            isNull(schema.FolderFile.id)
          )
        )

      const orphanedAssetAttachments = await ctx.db
        .select({ id: schema.Attachment.id })
        .from(schema.Attachment)
        .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
        .where(
          and(
            eq(schema.Attachment.organizationId, ctx.organizationId),
            isNotNull(schema.Attachment.assetId),
            isNull(schema.MediaAsset.id)
          )
        )

      const orphanedIds = [
        ...orphanedFileAttachments.map((row) => row.id),
        ...orphanedAssetAttachments.map((row) => row.id),
      ]
      if (orphanedIds.length === 0) return 0

      // Org-scoped as well as id-scoped. The legacy body deleted on the id list
      // alone; the ids came from org-scoped selects so it was never a live hole,
      // but a sweep is the last place to rely on that.
      await ctx.db
        .delete(schema.Attachment)
        .where(
          and(
            eq(schema.Attachment.organizationId, ctx.organizationId),
            inArray(schema.Attachment.id, orphanedIds)
          )
        )

      return orphanedIds.length
    },
    'Failed to clean up orphaned attachments',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Report every attachment in the organization that violates its own invariants.
 *
 * Read-only — it never repairs anything. One `SELECT` with four `LEFT JOIN`s
 * establishes whether each referenced row exists; the rules checked in memory
 * afterwards are the same three the write path enforces
 * (`assertExactlyOneTarget`) plus "the thing it points at is still there".
 *
 * @param ctx Scope and database.
 */
export async function validateAttachmentIntegrity(
  ctx: FilesCtx
): Promise<Result<AttachmentIntegrityReport, AuxxError>> {
  return guard(
    async () => {
      const rows = await ctx.db
        .select({
          id: schema.Attachment.id,
          fileId: schema.Attachment.fileId,
          fileVersionId: schema.Attachment.fileVersionId,
          assetId: schema.Attachment.assetId,
          assetVersionId: schema.Attachment.assetVersionId,
          fileExists: schema.FolderFile.id,
          assetExists: schema.MediaAsset.id,
          fileVersionExists: schema.FileVersion.id,
          assetVersionExists: schema.MediaAssetVersion.id,
        })
        .from(schema.Attachment)
        .leftJoin(schema.FolderFile, eq(schema.Attachment.fileId, schema.FolderFile.id))
        .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
        .leftJoin(schema.FileVersion, eq(schema.Attachment.fileVersionId, schema.FileVersion.id))
        .leftJoin(
          schema.MediaAssetVersion,
          eq(schema.Attachment.assetVersionId, schema.MediaAssetVersion.id)
        )
        .where(eq(schema.Attachment.organizationId, ctx.organizationId))

      const errors: string[] = []
      let validAttachments = 0
      let invalidAttachments = 0

      for (const row of rows) {
        const before = errors.length

        const hasFile = !!(row.fileId || row.fileVersionId)
        const hasAsset = !!(row.assetId || row.assetVersionId)
        if (hasFile === hasAsset) {
          errors.push(`Attachment ${row.id}: Must have exactly one of file or asset reference`)
        }
        if (row.fileVersionId && !row.fileId) {
          errors.push(`Attachment ${row.id}: fileVersionId requires fileId`)
        }
        if (row.assetVersionId && !row.assetId) {
          errors.push(`Attachment ${row.id}: assetVersionId requires assetId`)
        }
        if (row.fileId && !row.fileExists) {
          errors.push(`Attachment ${row.id}: Referenced file ${row.fileId} not found`)
        }
        if (row.assetId && !row.assetExists) {
          errors.push(`Attachment ${row.id}: Referenced asset ${row.assetId} not found`)
        }
        if (row.fileVersionId && !row.fileVersionExists) {
          errors.push(
            `Attachment ${row.id}: Referenced file version ${row.fileVersionId} not found`
          )
        }
        if (row.assetVersionId && !row.assetVersionExists) {
          errors.push(
            `Attachment ${row.id}: Referenced asset version ${row.assetVersionId} not found`
          )
        }

        if (errors.length === before) validAttachments += 1
        else invalidAttachments += 1
      }

      return { validAttachments, invalidAttachments, errors }
    },
    'Failed to validate attachment integrity',
    { organizationId: ctx.organizationId }
  )
}
