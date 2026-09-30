// apps/web/src/server/api/routers/lines.ts

import {
  createLines,
  deleteLines,
  readDocumentLines,
  reorderLines,
  updateLine,
  updateLines,
} from '@auxx/lib/accounting/documents/lines'
import {
  createLineInputSchema,
  LINE_DOCUMENT_TYPES,
  linePatchSchema,
} from '@auxx/lib/accounting/documents/lines/client'
import { TRPCError } from '@trpc/server'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, isAuxxError } from '~/server/api/trpc'
import { assertMayEditDocument, assertMayViewDocument } from '~/server/lib/document-authority'

const documentRef = {
  documentType: z.enum(LINE_DOCUMENT_TYPES),
  /** The header's `EntityInstance` id. */
  documentId: z.string().min(1),
}

function socketIdOf(ctx: { headers: Headers }): string | undefined {
  return ctx.headers.get('x-realtime-socket-id') ?? undefined
}

function unwrap<T>(result: Result<T, Error>): T {
  if (result.isOk()) return result.value
  if (isAuxxError(result.error)) throw result.error
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: result.error.message,
    cause: result.error,
  })
}

/** Document lines, for every line kind. Authority is the parent document's (decision 10). */
export const linesRouter = createTRPCRouter({
  /** The document's own lines, by `sortOrder, id`. */
  list: capabilityProcedure
    .input(z.object({ ...documentRef, visitId: z.string().min(1).nullish() }))
    .query(async ({ ctx, input }) => {
      await assertMayViewDocument(ctx, input.documentType, input.documentId)
      return readDocumentLines(ctx.db, ctx.session.organizationId, {
        documentType: input.documentType,
        documentId: input.documentId,
        visitId: input.visitId,
      })
    }),

  /** Append lines, or splice them in after `afterLineId`. Returns the created lines in order. */
  create: capabilityProcedure
    .input(
      z.object({
        ...documentRef,
        lines: z.array(createLineInputSchema).min(1).max(50),
        afterLineId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMayEditDocument(ctx, input.documentType, input.documentId)
      return unwrap(
        await createLines(ctx.db, ctx.session.organizationId, ctx.session.userId, input, {
          socketId: socketIdOf(ctx),
          enforceRecordLimit: true,
        })
      )
    }),

  update: capabilityProcedure
    .input(z.object({ ...documentRef, lineId: z.string().min(1), patch: linePatchSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertMayEditDocument(ctx, input.documentType, input.documentId)
      return unwrap(
        await updateLine(ctx.db, ctx.session.organizationId, ctx.session.userId, input, {
          socketId: socketIdOf(ctx),
        })
      )
    }),

  updateMany: capabilityProcedure
    .input(
      z.object({
        ...documentRef,
        updates: z
          .array(z.object({ lineId: z.string().min(1), patch: linePatchSchema }))
          .min(1)
          .max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertMayEditDocument(ctx, input.documentType, input.documentId)
      return unwrap(
        await updateLines(ctx.db, ctx.session.organizationId, ctx.session.userId, input, {
          socketId: socketIdOf(ctx),
        })
      )
    }),

  /** Persist a drag result; returns the lines in the new order. */
  reorder: capabilityProcedure
    .input(z.object({ ...documentRef, orderedIds: z.array(z.string().min(1)).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await assertMayEditDocument(ctx, input.documentType, input.documentId)
      return unwrap(
        await reorderLines(ctx.db, ctx.session.organizationId, ctx.session.userId, input, {
          socketId: socketIdOf(ctx),
        })
      )
    }),

  /** Delete lines; the server recomputes the document's totals. */
  delete: capabilityProcedure
    .input(z.object({ ...documentRef, ids: z.array(z.string().min(1)).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertMayEditDocument(ctx, input.documentType, input.documentId)
      const deleted = unwrap(
        await deleteLines(ctx.db, ctx.session.organizationId, ctx.session.userId, input, {
          socketId: socketIdOf(ctx),
        })
      )
      return { deleted }
    }),
})
