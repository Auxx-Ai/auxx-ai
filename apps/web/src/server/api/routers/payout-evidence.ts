// apps/web/src/server/api/routers/payout-evidence.ts

import {
  getPayoutEvidence,
  listPayoutEvidence,
  listPayoutEvidenceHistory,
  listPayoutSourceAccounts,
  listProcessorBalanceEntries,
  listRejectedProcessorEvidence,
} from '@auxx/lib/accounting/money/payouts'
import { NotFoundError } from '@auxx/lib/errors'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const pagination = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).nullish(),
})

/**
 * The evidence list's filters. Each one narrows in SQL, never after the read —
 * the list pages, so a post-read filter would answer about one page rather than
 * about the org.
 *
 * ⚠️ No amount range, unlike the bank review queue. That queue is pinned to a
 * single display currency; `MoneyTransfer` carries a per-row `sourceCurrency`,
 * so one min/max here would compare 100 JPY against 100 USD.
 */
const listInput = pagination.extend({
  search: z.string().max(200).optional(),
  sourceAccountId: z.string().min(1).optional(),
  status: z.string().min(1).max(64).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})

/** Read persisted processor evidence without triggering source sync or accounting. */
export const payoutEvidenceRouter = createTRPCRouter({
  list: permissionProcedure(PermissionKey.ledgerView)
    .input(listInput)
    .query(({ ctx, input }) =>
      listPayoutEvidence(ctx.db, {
        organizationId: ctx.session.organizationId,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
        // `|| undefined` rather than `??`: a cleared toolbar field arrives as
        // `''`, and an empty string is a filter that matches nothing useful
        // (`status = ''`) rather than the absence of a filter.
        search: input.search?.trim() || undefined,
        sourceAccountId: input.sourceAccountId || undefined,
        status: input.status || undefined,
        from: input.from || undefined,
        to: input.to || undefined,
      })
    ),

  /** The source accounts the filter picker may offer — only ones with payouts. */
  sourceAccounts: permissionProcedure(PermissionKey.ledgerView).query(({ ctx }) =>
    listPayoutSourceAccounts(ctx.db, { organizationId: ctx.session.organizationId })
  ),

  detail: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const payout = await getPayoutEvidence(ctx.db, {
        organizationId: ctx.session.organizationId,
        id: input.id,
      })
      if (!payout) throw new NotFoundError('Payout not found')
      return payout
    }),

  history: permissionProcedure(PermissionKey.ledgerView)
    .input(pagination.extend({ transferId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      listPayoutEvidenceHistory(ctx.db, {
        organizationId: ctx.session.organizationId,
        transferId: input.transferId,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
      })
    ),

  rejected: permissionProcedure(PermissionKey.ledgerView)
    .input(pagination)
    .query(({ ctx, input }) =>
      listRejectedProcessorEvidence(ctx.db, {
        organizationId: ctx.session.organizationId,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
      })
    ),

  entries: permissionProcedure(PermissionKey.ledgerView)
    .input(
      pagination.extend({
        unassignedOnly: z.boolean().optional(),
        transferId: z.string().min(1).optional(),
      })
    )
    .query(({ ctx, input }) =>
      listProcessorBalanceEntries(ctx.db, {
        organizationId: ctx.session.organizationId,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
        unassignedOnly: input.unassignedOnly,
        transferId: input.transferId,
      })
    ),
})
