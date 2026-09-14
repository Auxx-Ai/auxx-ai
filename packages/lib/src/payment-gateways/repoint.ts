// packages/lib/src/payment-gateways/repoint.ts

/**
 * What a repoint is about to strand
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §9.1).
 *
 * ## The failure this exists to stop
 *
 * Moving a gateway's `clearingAccount` moves NEW postings only. Every sale on
 * that rail that was not settled at the switch moment is already sitting in the
 * OLD account, together with whatever residue was stuck there before. Nothing
 * in the edit path says so today, so a repoint is silent and the balance
 * becomes something nobody can source months later.
 *
 * ⚠️ **The transfer entry is deliberately NOT here.** §9.1 puts the warning
 * first and calls a manual journal entry a tolerable interim, and that is the
 * order: a number on the screen before the edit is most of the value, and an
 * automatic entry computed from "shipments not yet matched to a payout" is a
 * much larger piece of work that can land later without changing this read.
 *
 * ## 🛑 What this can and cannot know
 *
 * A `GlPostingLine` carries `glAccountId`, never a gateway id - nothing stamps
 * a gateway dimension on a fulfillment line. So the honest question is **"what
 * is posted to the account this gateway currently points at"**, which is not
 * the same as "what this gateway put there": a shared clearing account (`1200`
 * already is one for every unrouted handle) holds other rails' money too. The
 * screen must say the account's name, not the gateway's, or it invites reading
 * a shared balance as this rail's own.
 *
 * No permission checks here. The router asserts `ledgerView`
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from './guard'

/**
 * The two ledger states whose lines are real.
 *
 * `reversed` is included for the same reason `readTrialBalance` includes it: a
 * reversal is a SECOND, opposite entry (decision G4), so the original's lines
 * stay in the ledger and the pair nets to zero on their own. Excluding the
 * original would leave only the reversal and report a balance of the wrong
 * sign.
 */
const POSTED_STATUSES = ['posted', 'reversed'] as const

/** What is posted to one clearing account, as the repoint warning reads it. */
export interface ClearingAccountBalance {
  glAccountId: string
  /** Integer minor units. Everything in the postings module is minor units. */
  debitMinor: number
  creditMinor: number
  /** Debits minus credits - the asset-normal balance a clearing account carries. */
  balanceMinor: number
  /**
   * Posted lines on this account, ever.
   *
   * 🔑 **The warning is gated on this, not on {@link balanceMinor}.** An
   * account that has taken a thousand lines and nets to zero today still has
   * history, and a rail whose sales and payouts happen to be square this
   * afternoon is exactly the one somebody repoints without thinking.
   */
  lineCount: number
  /** `YYYY-MM-DD` of the most recent posted line, or null when there are none. */
  lastTxnDate: string | null
}

/**
 * Read one account's posted balance, so an editor can say what a repoint
 * leaves behind before it happens.
 *
 * Always answers: an account with no postings comes back as zeroes with
 * `lineCount: 0`, which is the "nothing to strand, go ahead" case and is the
 * normal one for a rail that has never shipped.
 */
export async function readClearingAccountBalance(
  db: Database,
  params: { organizationId: string; glAccountId: string }
): Promise<Result<ClearingAccountBalance, Error>> {
  const { organizationId, glAccountId } = params
  return guard(
    async () => {
      const [row] = await db
        .select({
          // `::bigint` on the sums and `::int` on the count: `amountMinor` is a
          // bigint column, so an unqualified `sum` answers `numeric` and the
          // driver hands numerics back as strings. Read through `Number` below
          // either way rather than trusting the driver's shape.
          debitMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'debit'), 0)`,
          creditMinor: sql<string>`coalesce(sum(${schema.GlPostingLine.amountMinor}) filter (where ${schema.GlPostingLine.direction} = 'credit'), 0)`,
          lineCount: sql<number>`count(*)::int`,
          lastTxnDate: sql<string | null>`max(${schema.GlPosting.txnDate})::text`,
        })
        .from(schema.GlPostingLine)
        .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
        .where(
          and(
            eq(schema.GlPostingLine.organizationId, organizationId),
            eq(schema.GlPostingLine.glAccountId, glAccountId),
            inArray(schema.GlPosting.status, [...POSTED_STATUSES])
          )
        )

      const debitMinor = Number(row?.debitMinor ?? 0) || 0
      const creditMinor = Number(row?.creditMinor ?? 0) || 0
      return {
        glAccountId,
        debitMinor,
        creditMinor,
        balanceMinor: debitMinor - creditMinor,
        lineCount: Number(row?.lineCount ?? 0) || 0,
        lastTxnDate: row?.lastTxnDate ?? null,
      } satisfies ClearingAccountBalance
    },
    'Failed to read the clearing account balance',
    { organizationId, glAccountId }
  )
}
