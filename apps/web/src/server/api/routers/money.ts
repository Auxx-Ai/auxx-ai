// apps/web/src/server/api/routers/money.ts

import { database, schema } from '@auxx/database'
import { renderPreviewQuotePdf } from '@auxx/lib/documents'
import {
  approveQuote,
  convertQuoteToWorkOrder,
  createInvoiceFromWorkOrder,
  createQuoteFromRequest,
  declineQuote,
  deleteInvoice,
  deleteInvoiceLine,
  deleteManualPayment,
  ensureQuoteDocumentPdf,
  listUninvoicedLines,
  markInvoiceSent,
  markQuoteSent,
  prepareDocumentEmail,
  recomputeTotals,
  recordManualPayment,
  reorderLines,
  voidInvoice,
} from '@auxx/lib/money'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, recordIdSchema } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

/** protectedProcedure + the `dispatch` feature gate — money gates on dispatch (README). */
const moneyProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.dispatch
  )
  return next()
})

/**
 * adminProcedure + the same `dispatch` feature gate as {@link moneyProcedure} — for the one
 * money mutation that's a destructive correction, not desk work (money MI1 build spec §I.1,
 * decision 8): `deletePayment`.
 */
const moneyAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.dispatch
  )
  return next()
})

export const moneyRouter = createTRPCRouter({
  createQuoteFromRequest: moneyProcedure
    .input(z.object({ requestRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.requestRecordId)
      return createQuoteFromRequest({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        requestInstanceId: entityInstanceId,
      })
    }),

  markQuoteSent: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return markQuoteSent({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  approveQuote: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return approveQuote({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  declineQuote: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return declineQuote({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  convertQuoteToWorkOrder: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.quoteRecordId)
      return convertQuoteToWorkOrder({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteInstanceId: entityInstanceId,
      })
    }),

  reorderLines: moneyProcedure
    .input(
      z.object({
        documentRecordId: recordIdSchema.optional(),
        orderedLineRecordIds: z.array(recordIdSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return reorderLines({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        documentRecordId: input.documentRecordId,
        orderedLineInstanceIds: input.orderedLineRecordIds.map(
          (recordId) => parseRecordId(recordId).entityInstanceId
        ),
      })
    }),

  recomputeTotals: moneyProcedure
    .input(
      z
        .object({
          /** @deprecated legacy shape — pass `recordId` instead (quote or invoice). */
          quoteRecordId: recordIdSchema.optional(),
          /** Quote or invoice RecordId (money MI1 build spec §I.2) — `documentType` is derived
           * from the def component, no separate flag needed. */
          recordId: recordIdSchema.optional(),
        })
        .refine((val) => Boolean(val.quoteRecordId) !== Boolean(val.recordId), {
          message: 'Provide exactly one of quoteRecordId or recordId',
        })
    )
    .mutation(async ({ ctx, input }) => {
      const targetRecordId = (input.recordId ?? input.quoteRecordId)!
      const { entityDefinitionId, entityInstanceId } = parseRecordId(targetRecordId)
      const documentType = entityDefinitionId === 'invoice' ? 'invoice' : 'quote'
      return recomputeTotals({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        documentType,
        documentInstanceId: entityInstanceId,
      })
    }),

  // ─── Invoicing (money MI1 build spec §I.2) ──────────────────────────────

  listUninvoicedLines: moneyProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      return listUninvoicedLines({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: entityInstanceId,
      })
    }),

  createInvoiceFromWorkOrder: moneyProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        lineRecordIds: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId: workOrderInstanceId } = parseRecordId(input.workOrderRecordId)
      return createInvoiceFromWorkOrder({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId,
        lineInstanceIds: input.lineRecordIds.map(
          (lineRecordId) => parseRecordId(lineRecordId as RecordId).entityInstanceId
        ),
      })
    }),

  markInvoiceSent: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return markInvoiceSent({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
      })
    }),

  voidInvoice: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return voidInvoice({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
      })
    }),

  deleteInvoice: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return deleteInvoice({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
      })
    }),

  deleteInvoiceLine: moneyProcedure
    .input(z.object({ lineRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.lineRecordId)
      return deleteInvoiceLine({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        lineInstanceId: entityInstanceId,
      })
    }),

  recordPayment: moneyProcedure
    .input(
      z.object({
        invoiceRecordId: recordIdSchema,
        /** Integer cents (the MQ1 convention) — the dialog converts at the edge. */
        amount: z.number().int().positive(),
        /** ISO date string (`yyyy-MM-dd`) — the date the payment was made (may be backdated). */
        date: z.string(),
        method: z.enum(['cash', 'check', 'card', 'bank', 'other']),
        reference: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      return recordManualPayment({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        invoiceInstanceId: entityInstanceId,
        amount: input.amount,
        date: input.date,
        method: input.method,
        reference: input.reference,
        note: input.note,
      })
    }),

  deletePayment: moneyAdminProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deleteManualPayment({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        transactionId: input.transactionId,
      })
    }),

  listPayments: moneyProcedure
    .input(z.object({ invoiceRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.invoiceRecordId)
      const rows = await database.query.PaymentTransaction.findMany({
        where: and(
          eq(schema.PaymentTransaction.organizationId, ctx.session.organizationId),
          eq(schema.PaymentTransaction.invoiceInstanceId, entityInstanceId)
        ),
        orderBy: asc(schema.PaymentTransaction.createdAt),
      })

      return rows.map((row) => ({
        id: row.id,
        amount: row.amount,
        kind: row.kind,
        status: row.status,
        date: (row.metadata as { date?: string } | null)?.date ?? row.createdAt.toISOString(),
        method: row.method,
        reference: row.reference,
        note: row.note,
        provider: row.provider,
        createdByUserId: row.createdByUserId,
      }))
    }),

  // ─── Send flow (money MQ2 build spec §E.5) ──────────────────────────────

  prepareDocumentEmail: moneyProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return prepareDocumentEmail({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        quoteRecordId: input.recordId,
      })
    }),

  ensureDocumentPdf: moneyProcedure
    .input(z.object({ quoteRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return ensureQuoteDocumentPdf({
        organizationId: ctx.session.organizationId,
        actorId: ctx.session.user.id,
        quoteRecordId: input.quoteRecordId,
      })
    }),

  previewDocumentPdf: moneyProcedure.mutation(async ({ ctx }) => {
    return renderPreviewQuotePdf({
      organizationId: ctx.session.organizationId,
      actorId: ctx.session.user.id,
    })
  }),
})
