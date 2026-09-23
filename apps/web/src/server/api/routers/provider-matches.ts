// apps/web/src/server/api/routers/provider-matches.ts

import type { Database } from '@auxx/database'
import {
  acceptProviderMatch,
  countProviderMatches,
  dismissProviderMatch,
  listProviderMatches,
  listProviderMatchesForInvoice,
  listProviderMatchesForVendorBill,
  MATCH_STATES,
  PROVIDER_MATCH_REASONS,
  readPayoutProviderSide,
} from '@auxx/lib/accounting/provider-matches'
import { readActiveBookConnection, resolveAccountingProvider } from '@auxx/lib/accounting/providers'
import { PermissionKey } from '@auxx/lib/permissions'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const entryInput = z.object({ entryId: z.string().min(1) })

/** Unwrap a lib `Result`; an `AuxxError` reaches the client through `auxxErrorMiddleware`. */
function unwrap<T>(result: Result<T, Error>): T {
  if (result.isErr()) throw result.error
  return result.value
}

type ObjectLinker = (ref: {
  bookId: string
  objectType: string
  externalId: string
}) => string | null

/** Deep links into the provider, only for objects in the book that is connected now. */
async function providerObjectLinker(
  db: Database,
  organizationId: string
): Promise<{ link: ObjectLinker; connected: boolean }> {
  const [connection, provider] = await Promise.all([
    readActiveBookConnection(db, organizationId),
    resolveAccountingProvider(organizationId),
  ])
  const activeBookId = connection?.bookId ?? null
  const link = ({ bookId, objectType, externalId }: Parameters<ObjectLinker>[0]) =>
    bookId === activeBookId ? (provider.objectUrl?.({ objectType, externalId }) ?? null) : null
  return { link, connected: activeBookId !== null }
}

function withUrl<T extends { bookId: string; providerTxnType: string; providerTxnId: string }>(
  link: ObjectLinker,
  row: T
): T & { providerObjectUrl: string | null } {
  return {
    ...row,
    providerObjectUrl: link({
      bookId: row.bookId,
      objectType: row.providerTxnType,
      externalId: row.providerTxnId,
    }),
  }
}

/** The provider's own transactions matched against ours (brief 102 M5). */
export const providerMatchRouter = createTRPCRouter({
  list: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        states: z.array(z.enum(MATCH_STATES)).optional(),
        reasons: z.array(z.enum(PROVIDER_MATCH_REASONS)).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().min(1).nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const page = unwrap(
        await listProviderMatches(ctx.db, organizationId, {
          states: input.states,
          reasons: input.reasons,
          limit: input.limit,
          cursor: input.cursor ?? undefined,
        })
      )
      const { link } = await providerObjectLinker(ctx.db, organizationId)
      return { rows: page.rows.map((row) => withUrl(link, row)), nextCursor: page.nextCursor }
    }),

  counts: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) =>
    unwrap(await countProviderMatches(ctx.db, ctx.session.organizationId))
  ),

  forInvoice: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ invoiceInstanceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const rows = unwrap(
        await listProviderMatchesForInvoice(ctx.db, organizationId, input.invoiceInstanceId)
      )
      const { link } = await providerObjectLinker(ctx.db, organizationId)
      return rows.map((row) => withUrl(link, row))
    }),

  forVendorBill: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ vendorBillInstanceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const rows = unwrap(
        await listProviderMatchesForVendorBill(ctx.db, organizationId, input.vendorBillInstanceId)
      )
      const { link } = await providerObjectLinker(ctx.db, organizationId)
      return rows.map((row) => withUrl(link, row))
    }),

  /** `payoutId` is the `payout` record id — `payoutEvidence.detail`'s `payoutInstanceId`. */
  forPayout: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ payoutId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const side = unwrap(await readPayoutProviderSide(ctx.db, organizationId, input.payoutId))
      const { link, connected } = await providerObjectLinker(ctx.db, organizationId)
      const deposit = side.deposit
      return {
        /** A book is connected now; without one the drawer keeps the bank route's copy. */
        connected,
        deposit: deposit && {
          ...deposit,
          providerObjectUrl:
            deposit.batchState === 'sent' && deposit.providerObjectId
              ? link({
                  bookId: deposit.bookId,
                  objectType: deposit.objectType,
                  externalId: deposit.providerObjectId,
                })
              : null,
        },
        duplicates: side.duplicates.map((row) => withUrl(link, row)),
      }
    }),

  accept: permissionProcedure(PermissionKey.ledgerPost)
    .input(entryInput)
    .mutation(async ({ ctx, input }) =>
      unwrap(
        await acceptProviderMatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          entryId: input.entryId,
          actorUserId: ctx.session.user.id,
        })
      )
    ),

  dismiss: permissionProcedure(PermissionKey.ledgerPost)
    .input(entryInput)
    .mutation(async ({ ctx, input }) =>
      unwrap(
        await dismissProviderMatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          entryId: input.entryId,
          actorUserId: ctx.session.user.id,
        })
      )
    ),
})
