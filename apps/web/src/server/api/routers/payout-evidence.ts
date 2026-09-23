// apps/web/src/server/api/routers/payout-evidence.ts

import { getBankTransaction } from '@auxx/lib/accounting/banking/review'
import {
  acceptMatch,
  countPayoutEvidence,
  findPayoutEvidenceIdByExternalId,
  getPayoutEvidence,
  listMatchCandidates,
  listPayoutEvidence,
  listPayoutSourceAccounts,
  listProcessorBalanceEntries,
  listRejectedProcessorEvidence,
  listSweepingPayoutPostings,
  matchEntry,
  recheckOpenPayoutMatches,
  unmatchEntry,
} from '@auxx/lib/accounting/money/payouts'
import { NotFoundError } from '@auxx/lib/errors'
import { PermissionKey } from '@auxx/lib/permissions'
import type { Result } from 'neverthrow'
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
  needsMatching: z.boolean().optional(),
})

const entryInput = z.object({ entryId: z.string().min(1) })

/** Unwrap a lib `Result`; an `AuxxError` reaches the client through `auxxErrorMiddleware`. */
function unwrap<T>(result: Result<T, Error>): T {
  if (result.isErr()) throw result.error
  return result.value
}

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
        needsMatching: input.needsMatching || undefined,
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
      const bankLine = payout.bankTransactionId
        ? unwrap(
            await getBankTransaction(ctx.db, {
              organizationId: ctx.session.organizationId,
              transactionId: payout.bankTransactionId,
            })
          )
        : null
      return {
        ...payout,
        bankDeposit: bankLine && {
          transactionId: bankLine.id,
          postedAt: bankLine.postedAt,
          amountMinor: bankLine.amountMinor,
          bankAccountName: bankLine.bankAccountName,
        },
      }
    }),

  /** The evidence id for a provider payout id — how Settlements opens this drawer. */
  idForExternalId: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ externalId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      findPayoutEvidenceIdByExternalId(ctx.db, {
        organizationId: ctx.session.organizationId,
        externalId: input.externalId,
      })
    ),

  /**
   * Both of the Payouts topbar's badges in one read, the way
   * `ledger.outboxCounts` serves the rail — the `⚠ Import issues (n)` button is
   * absent at zero, so a page fetched for its length would be a page nobody
   * opens.
   */
  counts: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) =>
    unwrap(await countPayoutEvidence(ctx.db, { organizationId: ctx.session.organizationId }))
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

  /** The receipts a person may vouch for against one item, closest amount first. */
  matchCandidates: permissionProcedure(PermissionKey.ledgerView)
    .input(
      entryInput.extend({
        query: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) =>
      unwrap(
        await listMatchCandidates(ctx.db, {
          organizationId: ctx.session.organizationId,
          entryId: input.entryId,
          query: input.query?.trim() || undefined,
          limit: input.limit,
        })
      )
    ),

  /** The payout postings that swept one order's or one invoice's receipts (§10.3). */
  sweepingPostings: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        orderInstanceId: z.string().min(1).optional(),
        invoiceInstanceId: z.string().min(1).optional(),
      })
    )
    .query(async ({ ctx, input }) =>
      unwrap(
        await listSweepingPayoutPostings(ctx.db, {
          organizationId: ctx.session.organizationId,
          orderInstanceId: input.orderInstanceId,
          invoiceInstanceId: input.invoiceInstanceId,
        })
      )
    ),

  acceptMatch: permissionProcedure(PermissionKey.ledgerPost)
    .input(entryInput)
    .mutation(async ({ ctx, input }) =>
      unwrap(
        await acceptMatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          entryId: input.entryId,
          userId: ctx.session.user.id,
        })
      )
    ),

  matchEntry: permissionProcedure(PermissionKey.ledgerPost)
    .input(entryInput.extend({ moneyTransactionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) =>
      unwrap(
        await matchEntry(ctx.db, {
          organizationId: ctx.session.organizationId,
          entryId: input.entryId,
          moneyTransactionId: input.moneyTransactionId,
          userId: ctx.session.user.id,
        })
      )
    ),

  unmatchEntry: permissionProcedure(PermissionKey.ledgerPost)
    .input(entryInput)
    .mutation(async ({ ctx, input }) =>
      unwrap(
        await unmatchEntry(ctx.db, {
          organizationId: ctx.session.organizationId,
          entryId: input.entryId,
          userId: ctx.session.user.id,
        })
      )
    ),

  /** Re-run the matcher over this org's open items, and re-post what that reverses. */
  recheckMatches: permissionProcedure(PermissionKey.ledgerPost).mutation(async ({ ctx }) =>
    unwrap(
      await recheckOpenPayoutMatches(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.user.id,
      })
    )
  ),
})
