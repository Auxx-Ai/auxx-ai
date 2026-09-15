// apps/web/src/server/api/routers/payout-evidence.ts

import { NotFoundError } from '@auxx/lib/errors'
import {
  getPayoutEvidence,
  listPayoutEvidence,
  listPayoutEvidenceHistory,
  listProcessorBalanceEntries,
  listRejectedProcessorEvidence,
} from '@auxx/lib/money/payouts'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const pagination = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).nullish(),
})

/** Read persisted processor evidence without triggering source sync or accounting. */
export const payoutEvidenceRouter = createTRPCRouter({
  list: permissionProcedure(PermissionKey.ledgerView)
    .input(pagination)
    .query(({ ctx, input }) =>
      listPayoutEvidence(ctx.db, {
        organizationId: ctx.session.organizationId,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
      })
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
