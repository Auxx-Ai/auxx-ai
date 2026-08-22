// packages/lib/src/files/attachments/attachment-mutations.ts

/**
 * `Attachment` writes.
 *
 * Reads live in `attachments/attachment-queries.ts` —
 * `docs/lib-module-guide.md` §5.
 *
 * ## Scope comes from `ctx`, never from the payload
 *
 * The legacy `processCreateData` read `data.organizationId` first and only fell
 * back to the service's own scope, so a caller could write a row into an
 * organization it was not acting for. Following `assets/asset-mutations.ts` and
 * `storage/locations.ts`, {@link CreateAttachmentInput} carries no
 * `organizationId` at all.
 *
 * ## No authorization here
 *
 * `AttachmentService` took an optional `Authorizer` callback and awaited it at
 * the top of eleven methods. No production site ever passed one, so every one of
 * those awaits was a no-op — and a permission hook below the router is exactly
 * what `docs/lib-module-guide.md` §6 forbids. The callback is gone; the router
 * asserts (`attachmentRouter` already runs `assertFieldValueHostsWritable`).
 *
 * ## `Attachment` has no `updatedAt` and no `deletedAt`
 *
 * So no write here takes a `now` (nothing to stamp) and `deleteAttachment` is a
 * real `DELETE`, not a soft delete.
 */

import { schema } from '@auxx/database'
import type { AttachmentEntity } from '@auxx/database/types'
import { and, desc, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { BadRequestError, NotFoundError } from '../../errors'
import type { AttachmentRole, EntityType } from '../core/types'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import { requireAttachment } from './attachment-queries'

/**
 * Everything needed to persist one `Attachment` row.
 *
 * Exactly one of the file pair (`fileId`, optionally `fileVersionId`) or the
 * asset pair (`assetId`, optionally `assetVersionId`) must be supplied — see
 * {@link assertExactlyOneTarget}.
 */
export interface CreateAttachmentInput {
  /** Caller-supplied id, for deterministic inbound-mail attachment creation. */
  id?: string
  entityType: EntityType
  entityId: string
  /** Defaults to `'ATTACHMENT'`, matching the column default. */
  role?: AttachmentRole
  title?: string
  caption?: string
  /** Explicit display position. Defaults to one past the host's current highest. */
  sort?: number
  /** MIME content id, for `cid:` inline resolution in mail bodies. */
  contentId?: string | null
  /** The actor to attribute the row to. Optional: several production writers have no actor. */
  createdById?: string
  fileId?: string
  fileVersionId?: string
  assetId?: string
  assetVersionId?: string
}

/**
 * The mutable fields of an `Attachment`.
 *
 * Deliberately a closed set rather than the legacy `.set({ ...(data as any) })`,
 * which accepted any object and would happily have moved a row to a different
 * `organizationId`, `entityId` or target file. Re-targeting an attachment is a
 * delete plus a create, not an update.
 *
 * `caption: null` clears the caption; omitting it leaves the caption alone.
 */
export interface UpdateAttachmentInput {
  role?: AttachmentRole
  title?: string | null
  caption?: string | null
  sort?: number
  fileVersionId?: string | null
  assetVersionId?: string | null
}

/**
 * Create one `Attachment` row.
 *
 * A single `INSERT` (plus one `SELECT` for the default sort position), so it
 * takes `ctx` rather than a `Transaction`. A caller already inside one passes
 * `{ ...ctx, db: tx }` — which is what `comments/comment-service.ts` and the
 * upload processors do today via the facade's `withTx`.
 *
 * @param ctx Scope and database. `ctx.organizationId` owns the row.
 * @param input The row to write. See {@link CreateAttachmentInput}.
 */
export async function createAttachment(
  ctx: FilesCtx,
  input: CreateAttachmentInput
): Promise<Result<AttachmentEntity, AuxxError>> {
  return guard(
    async () => {
      assertExactlyOneTarget(input)

      const sort = input.sort ?? (await nextSort(ctx, input.entityType, input.entityId))

      const [created] = await ctx.db
        .insert(schema.Attachment)
        .values({
          ...(input.id ? { id: input.id } : {}),
          organizationId: ctx.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          role: input.role ?? 'ATTACHMENT',
          title: input.title,
          caption: input.caption,
          sort,
          contentId: input.contentId ?? null,
          fileId: input.fileId,
          fileVersionId: input.fileVersionId,
          assetId: input.assetId,
          assetVersionId: input.assetVersionId,
          createdById: input.createdById ?? null,
        })
        .returning()

      if (!created) {
        // `RETURNING` on a successful single-row insert cannot be empty, so
        // reaching here means the statement was rejected — in practice a foreign
        // key violation on the target. Name the target: the legacy message did,
        // and it is the difference between a five-minute and a one-hour debug.
        const target = input.fileId
          ? `FolderFile '${input.fileId}'`
          : `MediaAsset '${input.assetId}'`
        throw new BadRequestError(
          `Failed to create attachment: no row returned. Verify that ${target} exists and belongs to organization '${ctx.organizationId}'.`
        )
      }

      return created as AttachmentEntity
    },
    'Failed to create attachment',
    {
      entityType: input.entityType,
      entityId: input.entityId,
      organizationId: ctx.organizationId,
    }
  )
}

/**
 * Update the mutable fields of one attachment.
 *
 * Org-scoped on both the existence check and the `UPDATE` itself. Returns
 * `err(NotFoundError)` for a row that does not exist or belongs to another
 * organization, and `err(BadRequestError)` when the input names no field —
 * `UPDATE … SET` with nothing to set is a Drizzle runtime error, so it is
 * refused up front instead.
 */
export async function updateAttachment(
  ctx: FilesCtx,
  attachmentId: string,
  input: UpdateAttachmentInput
): Promise<Result<AttachmentEntity, AuxxError>> {
  return guard(
    async () => {
      await requireAttachment(ctx, attachmentId)

      const values: Record<string, unknown> = {}
      if (input.role !== undefined) values.role = input.role
      if (input.title !== undefined) values.title = input.title
      if (input.caption !== undefined) values.caption = input.caption
      if (input.sort !== undefined) values.sort = input.sort
      if (input.fileVersionId !== undefined) values.fileVersionId = input.fileVersionId
      if (input.assetVersionId !== undefined) values.assetVersionId = input.assetVersionId

      if (Object.keys(values).length === 0) {
        throw new BadRequestError('No attachment fields to update')
      }

      const [updated] = await ctx.db
        .update(schema.Attachment)
        .set(values)
        .where(
          and(
            eq(schema.Attachment.id, attachmentId),
            eq(schema.Attachment.organizationId, ctx.organizationId)
          )
        )
        .returning()

      if (!updated) throw new NotFoundError(`Attachment ${attachmentId} not found`)
      return updated as AttachmentEntity
    },
    'Failed to update attachment',
    { attachmentId, organizationId: ctx.organizationId }
  )
}

/**
 * Delete one attachment.
 *
 * A hard delete — `Attachment` has no `deletedAt`. The row is the *link*, not
 * the file: removing it detaches the file from its host and leaves both the
 * `FolderFile`/`MediaAsset` and its stored bytes intact.
 *
 * Returns `err(NotFoundError)` when the row does not exist or belongs to another
 * organization, so a caller cannot use this to probe for ids outside its tenant.
 */
export async function deleteAttachment(
  ctx: FilesCtx,
  attachmentId: string
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      await requireAttachment(ctx, attachmentId)
      await ctx.db
        .delete(schema.Attachment)
        .where(
          and(
            eq(schema.Attachment.id, attachmentId),
            eq(schema.Attachment.organizationId, ctx.organizationId)
          )
        )
    },
    'Failed to delete attachment',
    { attachmentId, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * Enforce the file/asset XOR the `Attachment` table encodes but cannot check.
 *
 * Four nullable columns can express "both" and "neither"; only "exactly one
 * side, and a version id only alongside its own parent id" is meaningful. The
 * legacy `validateTarget` threw bare `Error`s here, which
 * `auxxErrorMiddleware` mapped to 500; these are caller mistakes, so they are
 * `BadRequestError` (400).
 */
export function assertExactlyOneTarget(input: CreateAttachmentInput): void {
  const fileSide = !!(input.fileId || input.fileVersionId)
  const assetSide = !!(input.assetId || input.assetVersionId)
  if (fileSide === assetSide) {
    throw new BadRequestError(
      'Provide exactly one of fileId/fileVersionId or assetId/assetVersionId'
    )
  }
  if (input.fileVersionId && !input.fileId) {
    throw new BadRequestError('fileVersionId requires fileId')
  }
  if (input.assetVersionId && !input.assetId) {
    throw new BadRequestError('assetVersionId requires assetId')
  }
}

/**
 * One past the highest `sort` currently on the host entity.
 *
 * Read-then-write, so two concurrent creates on the same host can pick the same
 * position. That is the behaviour `AttachmentService.nextSort` has always had
 * and it is benign: `sort` only orders a display list, ties break on
 * `createdAt`, and there is no unique constraint to violate. Documented rather
 * than fixed, because fixing it means a sequence or a lock, which is a
 * behaviour decision this refactor is not the place to make.
 */
async function nextSort(ctx: FilesCtx, entityType: EntityType, entityId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ sort: schema.Attachment.sort })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.organizationId, ctx.organizationId),
        eq(schema.Attachment.entityType, entityType),
        eq(schema.Attachment.entityId, entityId)
      )
    )
    .orderBy(desc(schema.Attachment.sort))
    .limit(1)
  return (row?.sort ?? 0) + 1
}
