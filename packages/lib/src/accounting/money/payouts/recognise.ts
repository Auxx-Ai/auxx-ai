// packages/lib/src/accounting/money/payouts/recognise.ts

/**
 * Which of a payout's items auxx holds a record for, for the ONE feed that has
 * no `ProcessorBalanceEntry` rows to read the answer off: Stripe Connect
 * (`plans/accounting/payout-links.md` §11.3, §12 T4).
 *
 * Reads only. The answer is a set of `ref.id`s that `splitPayout` (`client.ts`)
 * consults; the split itself stays pure. Every feed the evidence lane observes
 * takes `splitStoredEntries` instead and never reaches this file.
 *
 * A Stripe charge/refund id is recognised through
 * `FinancialSourceObject.externalId` → `MoneySourceLink`,
 * the same evidence trail a bank-feed-observed transaction is adopted into a
 * `MoneyTransaction` through (`credit-memos/reads.ts`'s "adopted legacy" check).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { PayoutItem } from './source'

/** The recognised `ref.id`s among `items`. A `none` ref is never recognised. */
export async function recognise(
  db: Database,
  organizationId: string,
  items: readonly PayoutItem[]
): Promise<Set<string>> {
  const chargeIds: string[] = []
  for (const item of items) {
    if (item.ref.kind === 'stripe_charge') chargeIds.push(item.ref.id)
  }
  return readRecognisedChargeIds(db, organizationId, chargeIds)
}

/**
 * Which of these Stripe ids auxx holds a `MoneyTransaction` for, via the
 * `FinancialSourceObject` evidence trail (`externalId` is the raw Stripe id;
 * `MoneySourceLink` is what proves a `MoneyTransaction` was adopted from it).
 *
 * ⚠️ **Refund rows are included deliberately.** A refund inside a payout is a
 * negative item that belongs on the same side as its charge; leaving it
 * unrecognised would credit `unidentified_receipts` with a negative and relieve
 * clearing of more than was ever debited to it. Charge and refund ids share one
 * `externalId` keyspace here, same as the legacy two-column check did.
 */
export async function readRecognisedChargeIds(
  db: Database,
  organizationId: string,
  gatewayIds: string[]
): Promise<Set<string>> {
  if (gatewayIds.length === 0) return new Set()

  const rows = await db
    .select({ externalId: schema.FinancialSourceObject.externalId })
    .from(schema.FinancialSourceObject)
    .innerJoin(
      schema.MoneySourceLink,
      and(
        eq(schema.MoneySourceLink.organizationId, schema.FinancialSourceObject.organizationId),
        eq(schema.MoneySourceLink.sourceObjectId, schema.FinancialSourceObject.id)
      )
    )
    .where(
      and(
        eq(schema.FinancialSourceObject.organizationId, organizationId),
        inArray(schema.FinancialSourceObject.externalId, gatewayIds)
      )
    )

  return new Set(rows.map((row) => row.externalId))
}
