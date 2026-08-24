// apps/web/src/server/api/routers/attachment.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { AttachmentRole } from '@auxx/lib/files/server'
import {
  createAttachment,
  deleteAttachment,
  getAsset,
  getAttachment,
  getFolderFile,
} from '@auxx/lib/files/server'
// Type-only, so it is erased at runtime and never pulls the (vitest-hostile)
// permissions barrel into this module's import graph.
import type { CapabilityView } from '@auxx/lib/permissions'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { assertFieldValueHostsWritable } from '~/server/lib/field-value-host-access'
import { toFilesCtx } from '~/server/lib/files-ctx'

/**
 * Unwrap a `files/` `Result` into this router's throw-based flow.
 *
 * The error is always an `AuxxError` subclass, and no procedure here wraps its
 * call in a `catch`, so `auxxErrorMiddleware` maps it directly: a missing
 * attachment is 404, "provide exactly one of fileId/assetId" is 400.
 */
function unwrap<V>(result: Result<V, Error>): V {
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * **This is deliberately NOT gated on `PermissionKey.inboxesView`** (plan 40
 * §5.3), even though it sits next to the mail routers and mail attachments are
 * its most visible consumer.
 *
 * `Attachment` is a polymorphic join table: `entityType` is `'MESSAGE'` for mail
 * attachments and `'FIELD_VALUE'` for a file/image value on **any** custom field
 * of **any** entity definition — contact, ticket, company, a custom def. Both
 * `createForCustomField` and `removeFromCustomField` hard-code
 * `entityType: 'FIELD_VALUE'`, so they are the generic field-attachment path,
 * not a mail path. A mail key here would over-deny: a member with
 * `records: Full` and `inboxes: None` would lose the ability to attach a file to
 * a contact's file field, which has nothing to do with mail.
 *
 * The correct authority is the one `fieldValue.set` already uses — plan 40
 * §5.5's per-host gate, `assertFieldValueHostsWritable`, reused rather than
 * re-implemented. Attaching a file to a field value *is* a field-value write, so
 * it resolves to the same three branches: the def-aware records edit gate for
 * record hosts, `inboxes.view` + `full` lens for `thread` hosts, and
 * `assertAdminInstance` for `inbox` / `personal_inbox` hosts. Nothing here needs
 * to know which of those a given call is.
 *
 * `getByIds` stays on `protectedProcedure` — see its own note.
 */

/**
 * Resolves a `FieldValue` id to its host record (org-scoped) and runs the
 * plan 40 §5.5 host gate on it.
 *
 * The scoping read is the same one the gate needs anyway: `FieldValue` carries
 * `entityDefinitionId` + `entityId` denormalized, which is exactly the
 * `{ entityDefinitionId, entityInstanceId }` pair `assertFieldValueHostsWritable`
 * accepts, so no `RecordId` round-trip is involved.
 */
const assertCustomFieldHostWritable = async (params: {
  db: Database
  capabilities: CapabilityView
  organizationId: string
  userId: string
  fieldValueId: string
}): Promise<void> => {
  const [host] = await params.db
    .select({
      entityDefinitionId: schema.FieldValue.entityDefinitionId,
      entityInstanceId: schema.FieldValue.entityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.id, params.fieldValueId),
        eq(schema.FieldValue.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (!host) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Field value not found.' })
  }

  await assertFieldValueHostsWritable({
    db: params.db,
    capabilities: params.capabilities,
    organizationId: params.organizationId,
    userId: params.userId,
    hosts: [host],
  })
}

/**
 * Attachment router for managing file attachments to entities
 */
export const attachmentRouter = createTRPCRouter({
  /**
   * Get attachments by their IDs
   * Returns attachment with either asset (MediaAsset) or file (FolderFile) data
   *
   * **Left on `protectedProcedure` deliberately.** Unlike the two write
   * procedures below, this one is host-agnostic: an id may resolve to a
   * `'MESSAGE'` attachment (mail) or a `'FIELD_VALUE'` one (any record), and
   * there is no read-side counterpart to `assertFieldValueHostsWritable` — a
   * correct read gate would need a mail-lens branch for `MESSAGE` hosts, i.e. a
   * new authorization surface rather than a reuse of an existing one. It is
   * org-scoped (`AttachmentService` filters on `organizationId` on every path)
   * and returns metadata only — name, mime type, size — never content, and it
   * requires already knowing an attachment CUID. Recorded as an open read-path
   * gap rather than closed with a guess. It has no callers today.
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.ids.length === 0) return []

      const filesCtx = toFilesCtx(ctx)

      // Still one statement per id, then one per resolved target — `attachments/`
      // has no by-id batch loader (`fetchAttachmentsForEntities` keys by HOST,
      // not by attachment id). Left as it was rather than grown a new batch read
      // for a procedure with no callers; noted so it is not mistaken for a
      // considered read shape.
      const attachments = await Promise.all(
        input.ids.map(async (id) => unwrap(await getAttachment(filesCtx, id)))
      )
      // Type predicate, not `filter(Boolean)` — the latter keeps `| null` in the
      // element type, so every field read below was `possibly null`.
      const validAttachments = attachments.filter((a): a is NonNullable<typeof a> => a !== null)

      // Enrich with asset or file data
      const enriched = await Promise.all(
        validAttachments.map(async (attachment) => {
          // Handle MediaAsset attachments
          if (attachment.assetId) {
            const asset = unwrap(await getAsset(filesCtx, attachment.assetId))
            return { ...attachment, asset }
          }

          // Handle FolderFile attachments
          if (attachment.fileId) {
            const file = unwrap(await getFolderFile(filesCtx, attachment.fileId))
            // Map file data to asset-like structure for consistent UI rendering
            return {
              ...attachment,
              asset: file
                ? {
                    id: file.id,
                    name: file.name,
                    mimeType: file.mimeType,
                    size: file.size,
                  }
                : null,
            }
          }

          return null
        })
      )

      return enriched.filter(Boolean)
    }),

  /**
   * Create attachment for field value
   * Supports either fileId (for FolderFile) or assetId (for MediaAsset)
   *
   * Authorized per HOST, not by a mail key — see the module docblock.
   */
  createForCustomField: capabilityProcedure
    .input(
      z
        .object({
          fieldValueId: z.string(),
          fileId: z.string().optional(),
          assetId: z.string().optional(),
          role: z.string().default('ATTACHMENT'),
        })
        .refine((data) => !!data.fileId !== !!data.assetId, {
          message: 'Provide exactly one of fileId or assetId',
        })
    )
    .mutation(async ({ ctx, input }) => {
      await assertCustomFieldHostWritable({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        fieldValueId: input.fieldValueId,
      })

      // `organizationId` is no longer part of the input: it comes from `ctx`,
      // closing the legacy path where `data.organizationId` could name an
      // organization the caller was not acting for.
      return unwrap(
        await createAttachment(toFilesCtx(ctx), {
          entityType: 'FIELD_VALUE',
          entityId: input.fieldValueId,
          role: input.role as AttachmentRole,
          fileId: input.fileId,
          assetId: input.assetId,
          createdById: ctx.session.user.id,
        })
      )
    }),

  /**
   * Remove attachment from custom field
   *
   * Authorized per HOST, not by a mail key — see the module docblock. The
   * attachment row is resolved first (org-scoped) so the host it hangs off can
   * be gated; a non-`FIELD_VALUE` attachment is refused here rather than
   * silently deleted, because this procedure's contract is the custom-field
   * path and a `MESSAGE` attachment answers to the mail lens instead.
   */
  removeFromCustomField: capabilityProcedure
    .input(
      z.object({
        attachmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [attachment] = await ctx.db
        .select({
          entityType: schema.Attachment.entityType,
          entityId: schema.Attachment.entityId,
        })
        .from(schema.Attachment)
        .where(
          and(
            eq(schema.Attachment.id, input.attachmentId),
            eq(schema.Attachment.organizationId, ctx.session.organizationId)
          )
        )
        .limit(1)

      if (!attachment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attachment not found.' })
      }

      if (attachment.entityType !== 'FIELD_VALUE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Attachment is not attached to a custom field.',
        })
      }

      await assertCustomFieldHostWritable({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        fieldValueId: attachment.entityId,
      })

      unwrap(await deleteAttachment(toFilesCtx(ctx), input.attachmentId))
    }),
})
