// packages/lib/src/accounting/rails/rail-fee-status.ts

/**
 * What the close console can honestly say about each payment rail's processor
 * fees (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §6).
 *
 * ## 🛑 A fact, never an alarm, and never a refusal
 *
 * §6 is explicit and §14's R4 is the reason: a rail that bills quarterly would
 * nag through two closes out of every three, and everybody would learn to
 * ignore the block. So this read produces no status, no severity and no
 * verdict - it produces a DATE, and the person reading it draws the conclusion.
 * `never` and `three months ago` are both legible on their own, which is also
 * why there is no dismissal state anywhere in this module. `prepareClose` does
 * not call this and must not: a fee that has not been billed yet is not an
 * unclosed month.
 *
 * ## What is actually knowable
 *
 * There is no statement to read, so the AMOUNT of an unbilled tail is
 * unknowable and §6 rules out accruing it. Knowable exactly:
 *
 * 1. this rail is `billed` rather than `netted` - the record says so;
 * 2. it traded in the month being closed;
 * 3. whether anything has been posted to ITS OWN fee account with a txn date
 *    in that month, and when the last such posting was, ever.
 *
 * ## 🔑 Why (3) only works for a rail with its own fee account
 *
 * §5's asymmetry: a `netted` rail books to the shared `payment_processing_fees`
 * fallback on purpose, because the fee rides inside every payout entry and
 * cannot be forgotten. A `billed` rail mints its own account precisely so
 * *"has this rail billed us this month"* is a one-line query. A billed rail
 * whose fees land in that same shared account, alongside every netted rail's
 * fallback, makes the question **unanswerable** - and the honest answer is to
 * SAY SO ({@link RailFeeAccount} `kind: 'shared'`) rather than to report the
 * shared account's last posting as though it were this rail's. A misleading
 * date is worse than no date.
 *
 * ## ⚠️ Derived, not stamped
 *
 * §6 asks for a `lastFeeBookedAt` stamp on the record beside `lastSettlementAt`,
 * and the field exists (`payment_gateway_last_fee_booked_at`, entity migration
 * 156). This module DERIVES the value and writes nothing, for one reason: the
 * only caller is a `ledgerView` read that the close console runs on page load,
 * and a read procedure that mutates entity records - attributed to whoever
 * happened to open the screen, including a read-only accountant - is the wrong
 * shape. The derived answer is also strictly fresher than a stamp. When a write
 * moment for the stamp appears (a job, or the post path itself), it can call
 * {@link readRailFeeStatus} and write the `own` rows back in ONE bulk CRUD call;
 * never a per-row loop, which opens a write session per gateway.
 *
 * No permission checks here. The router asserts `ledgerView`
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { monthBounds } from '../ledger/periods/periods'
import { standingLineFilter } from '../ledger/reads/standing-lines'
import { readRoleAssignments } from '../ledger/roles/role-assignments'
import type { PaymentGatewayFeeTreatmentValue, PaymentGatewayRow } from './client'
// 🛑 The LEAF, never `../payment-gateways` - the barrel re-exports `writes.ts`,
// which imports `postings/chart-accounts`, and `postings/index.ts` re-exports
// this file. `reads.ts` itself reaches nothing in `postings/`, so importing it
// directly keeps the two modules acyclic. Same call `mint-rail-accounts.ts`
// makes when it takes an account NAME rather than a gateway handle.
import { listPaymentGateways } from './reads'

const logger = createScopedLogger('postings:rail-fee-status')

/**
 * Where one rail's processor fees land, and therefore whether the question
 * *"has this rail billed us"* can be answered at all.
 *
 * A discriminated union rather than a nullable account id, because the two
 * cases call for different SENTENCES and not for a missing value: `shared` is a
 * complete answer ("auxx cannot tell this rail's fees apart"), not an absent
 * one. See this file's header on why a date read off the shared account would
 * be a lie.
 */
export type RailFeeAccount =
  | {
      kind: 'own'
      /** The `gl_account` id nothing but this rail books fees into. */
      glAccountId: string
      /** Anything posted to it with a txn date inside the month asked about. */
      bookedInMonth: boolean
      /**
       * `YYYY-MM-DD` of the latest posted line on it, EVER - not bounded by the
       * month. The whole message of §6's block is how long ago the last fee
       * was, which a month-bounded answer could never say.
       */
      lastBookedAt: string | null
    }
  | {
      /**
       * The rail names no fee account of its own, or names one that something
       * else books into as well - the `payment_processing_fees` fallback
       * account, or another rail. 🔑 §5: the question is unanswerable here.
       */
      kind: 'shared'
    }

/** One active rail, as the close console's Processor fees block reads it. */
export interface RailFeeStatus {
  paymentGatewayId: string
  /** The record's own name - `'Authorize.net'`. What the block labels the row. */
  name: string
  /** `billed` is the only treatment the fee date means anything for. */
  feeTreatment: PaymentGatewayFeeTreatmentValue
  /**
   * The rail's CLEARING account was moved by a posted line in the month asked
   * about - which is what "it traded" means in a ledger that has no other
   * record of a rail being used.
   *
   * ⚠️ Two rails sharing one clearing account (legal, and what `1200` already
   * is) makes this true for both when either traded. That over-count is the
   * safe direction: it withholds a softening remark, never adds a claim.
   */
  tradedInMonth: boolean
  fees: RailFeeAccount
}

export interface ReadRailFeeStatusOptions {
  organizationId: string
  /** `YYYY-MM` - the month being closed. Required: (2) and (3) are about it. */
  month: string
}

/** One grouped row of the posting aggregate. */
interface AccountActivity {
  lastAt: string | null
  lastInMonthAt: string | null
}

/**
 * Every ACTIVE rail and what the ledger says about its fees, for one month.
 *
 * Three reads and no loop: the gateways, the account that holds
 * `payment_processing_fees`, and one grouped aggregate over the posted lines on
 * every clearing and fee account the gateways name.
 *
 * ⚠️ Closed rails are excluded from the ANSWER but counted when deciding
 * whether a fee account is shared. A closed rail's fees were booked into that
 * account too, so its history is exactly what makes a date read off a shared
 * account misleading.
 */
export async function readRailFeeStatus(
  db: Database,
  options: ReadRailFeeStatusOptions
): Promise<Result<RailFeeStatus[], Error>> {
  const { organizationId, month } = options

  try {
    const bounds = monthBounds(month)

    const gateways = await listPaymentGateways(db, organizationId)
    if (gateways.isErr()) return err(gateways.error)
    // An org with no `payment_gateway` records has no rails to report on, and
    // the block renders nothing rather than an empty heading.
    if (gateways.value.length === 0) return ok([])

    const fallbackFeeAccountId = await readFallbackFeeAccountId(db, organizationId)
    const shared = sharedFeeAccountIds(gateways.value, fallbackFeeAccountId)

    const active = gateways.value.filter((gateway) => gateway.status === 'active')
    if (active.length === 0) return ok([])

    const wanted = new Set<string>()
    for (const gateway of active) {
      if (gateway.clearingGlAccountId) wanted.add(gateway.clearingGlAccountId)
      const feeAccountId = ownFeeAccountId(gateway, shared)
      if (feeAccountId) wanted.add(feeAccountId)
    }

    const activity = await readAccountActivity(db, organizationId, [...wanted], bounds)

    return ok(
      active.map((gateway) => {
        const feeAccountId = ownFeeAccountId(gateway, shared)
        const feeActivity = feeAccountId ? activity.get(feeAccountId) : undefined

        return {
          paymentGatewayId: gateway.id,
          name: gateway.name,
          feeTreatment: gateway.feeTreatment,
          tradedInMonth: !!activity.get(gateway.clearingGlAccountId)?.lastInMonthAt,
          fees: feeAccountId
            ? {
                kind: 'own',
                glAccountId: feeAccountId,
                bookedInMonth: !!feeActivity?.lastInMonthAt,
                lastBookedAt: feeActivity?.lastAt ?? null,
              }
            : { kind: 'shared' },
        } satisfies RailFeeStatus
      })
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read rail fee status', { error, organizationId, month })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * The fee account this rail alone books into, or `null` when the answer is
 * shared.
 *
 * A rail with no `feeGlAccountId` books to the `payment_processing_fees`
 * fallback by construction (`buildPayoutEntry`), which is shared with every
 * other such rail - so it is the `shared` case without needing to know which
 * account holds the role.
 */
function ownFeeAccountId(gateway: PaymentGatewayRow, shared: ReadonlySet<string>): string | null {
  const feeAccountId = gateway.feeGlAccountId?.trim()
  if (!feeAccountId) return null
  return shared.has(feeAccountId) ? null : feeAccountId
}

/**
 * Every fee account that more than one thing books into: the account holding
 * `payment_processing_fees`, plus any account two or more gateway records name.
 *
 * 🔑 The role account is in here even when exactly one gateway names it, and
 * that is the §5 case this whole module is careful about: every netted rail
 * with no account of its own already books there, so a billed rail pointed at
 * the same account cannot be told apart from them.
 */
function sharedFeeAccountIds(
  gateways: readonly PaymentGatewayRow[],
  fallbackFeeAccountId: string | null
): Set<string> {
  const counts = new Map<string, number>()
  for (const gateway of gateways) {
    const feeAccountId = gateway.feeGlAccountId?.trim()
    if (!feeAccountId) continue
    counts.set(feeAccountId, (counts.get(feeAccountId) ?? 0) + 1)
  }

  const shared = new Set<string>()
  for (const [feeAccountId, count] of counts) {
    if (count > 1) shared.add(feeAccountId)
  }
  if (fallbackFeeAccountId) shared.add(fallbackFeeAccountId)
  return shared
}

/**
 * The `gl_account` id mapped to `payment_processing_fees`, or `null`.
 *
 * ⚠️ Deliberately NOT `resolveRoles`, which refuses an unmapped or unused role
 * naming all five ways it can fail. An org that never mapped the role is an
 * ordinary state here - it just means nothing is known to share a fee account -
 * and a refusal would take the whole Processor fees block off the screen over
 * a mapping the block never needed.
 */
async function readFallbackFeeAccountId(
  db: Database,
  organizationId: string
): Promise<string | null> {
  const rows = await readRoleAssignments(db, organizationId)
  // 🛑 The ORG DEFAULT only (task 47, and task 58's rail rows - which also
  // carry no `sourceAccountId`). "Which account does a rail with no fee
  // account of its own book into" has exactly one answer per org; a
  // per-source or per-rail override is a different row, and picking between
  // them would be the arbitrary choice `resolveRoles` itself refuses to make.
  const fallback = rows.find(
    (row) =>
      row.role === ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES &&
      row.sourceAccountId == null &&
      row.paymentGatewayId == null
  )

  return fallback?.glAccountId ?? null
}

/**
 * The latest posted txn date on each account, and the latest inside the month,
 * in one grouped query.
 *
 * `status = 'posted'` is what excludes a reversed original, exactly as it does
 * in `duplicate-movements.ts`: a reversal flips the entry it backs out to
 * `reversed` in the same transaction, so at most one of a pair is ever posted.
 *
 * ⚠️ **`::text` on both aggregates, and it is not decoration.** `txnDate` is a
 * Drizzle `date()` column, and its string mapping applies to a selected COLUMN,
 * never to a raw `sql` expression wrapped around one - a bare `max(txn_date)`
 * comes back as whatever the pg driver's DATE parser hands over, which is a
 * `Date` object. Casting in SQL pins the `YYYY-MM-DD` these fields are declared
 * as, rather than leaving it to a driver setting nothing in this file controls.
 */
async function readAccountActivity(
  db: Database,
  organizationId: string,
  accountIds: string[],
  bounds: { first: string; next: string }
): Promise<Map<string, AccountActivity>> {
  const byAccount = new Map<string, AccountActivity>()
  if (accountIds.length === 0) return byAccount

  const inMonth = and(
    gte(schema.GlPosting.txnDate, bounds.first),
    lt(schema.GlPosting.txnDate, bounds.next)
  )

  const rows = await db
    .select({
      glAccountId: schema.GlPostingLine.glAccountId,
      lastAt: sql<string | null>`(max(${schema.GlPosting.txnDate}))::text`,
      lastInMonthAt: sql<
        string | null
      >`(max(${schema.GlPosting.txnDate}) filter (where ${inMonth}))::text`,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    // POSTED_STATUSES, not `posted` alone: a reversed original is activity on
    // the account too, and the two copies of this question must agree.
    .where(standingLineFilter(organizationId, { glAccountIds: accountIds }))
    .groupBy(schema.GlPostingLine.glAccountId)

  for (const row of rows) {
    byAccount.set(row.glAccountId, {
      lastAt: row.lastAt ?? null,
      lastInMonthAt: row.lastInMonthAt ?? null,
    })
  }
  return byAccount
}
