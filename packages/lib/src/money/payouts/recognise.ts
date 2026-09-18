// packages/lib/src/money/payouts/recognise.ts

/**
 * Which of a payout's items auxx holds a record for, answered per `ref.kind`
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §4 rule 1).
 *
 * Reads only. The answer is a set of `ref.id`s that `splitPayout` (`client.ts`)
 * consults; the split itself stays pure and never learns which lookup produced
 * an id. One payout comes from one source, so its ids share one keyspace and
 * the set needs no kind prefix.
 *
 * 🛑 **Not on the charge id for everything.** Until this file every payout was
 * recognised against `PaymentTransaction.stripeChargeId`, and no connector
 * writes `PaymentTransaction` (27 §1.3): a Shopify payout matched on a charge
 * id recognises NOTHING and credits the whole deposit to `2450 Unidentified
 * Receipts`. An `order` ref is answered against the synced order instead.
 *
 * A Stripe charge/refund id is recognised through
 * `FinancialSourceObject.externalId` → `MoneySourceLink`,
 * the same evidence trail a bank-feed-observed transaction is adopted into a
 * `MoneyTransaction` through (`credit-memos/reads.ts`'s "adopted legacy" check).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'
import type { PayoutItem } from './source'

/**
 * The recognised `ref.id`s among `items`, grouped and looked up by kind.
 * `none` refs are never looked up and never recognised.
 */
export async function recognise(
  db: Database,
  organizationId: string,
  items: readonly PayoutItem[]
): Promise<Set<string>> {
  const chargeIds: string[] = []
  const orderIds: string[] = []
  for (const item of items) {
    switch (item.ref.kind) {
      case 'stripe_charge':
        chargeIds.push(item.ref.id)
        break
      case 'order':
        orderIds.push(item.ref.id)
        break
      case 'none':
        break
    }
  }

  const [charges, orders] = await Promise.all([
    readRecognisedChargeIds(db, organizationId, chargeIds),
    readRecognisedOrderIds(db, organizationId, orderIds),
  ])
  return new Set([...charges, ...orders])
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

/**
 * Which of these upstream order ids a connector has synced into this org's
 * `order` def.
 *
 * ## The key
 *
 * `DataConnectorItem.externalId` is the connector's own stable id for the
 * upstream record, bound to the `EntityInstance` it minted or matched. The
 * Shopify connector writes `String(order.id)` there (the REST numeric id,
 * `shopify.connector.server.ts`), and a Shopify balance transaction names the
 * same number as `source_order_id` (gap-a §1.2), so the join is a string
 * equality and nothing is parsed. Def-keyed, not mapping-keyed: two mappings
 * may legitimately bind one upstream id to one shared instance, and either
 * proves the order is here.
 *
 * ⚠️ **Not `FieldValue.managedByConnectorId`.** That marks which connector owns a
 * CELL, and says nothing about which upstream record the row is. And not an
 * order field either: the registry's `order` def carries no external-id
 * attribute, because the binding table is where that fact already lives.
 *
 * A row with no bound instance (`entityInstanceId IS NULL`, the pre-bind state)
 * or an archived binding proves nothing and is skipped. A row flagged
 * `removedUpstreamAt` is still a live record and still counts.
 */
export async function readRecognisedOrderIds(
  db: Database,
  organizationId: string,
  externalIds: string[]
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set()

  const orderDefId = await getCachedEntityDefId(organizationId, 'order')
  if (!orderDefId) return new Set()

  const rows = await db
    .select({ externalId: schema.DataConnectorItem.externalId })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.DataConnectorItem.entityDefinitionId, orderDefId),
        inArray(schema.DataConnectorItem.externalId, externalIds),
        isNotNull(schema.DataConnectorItem.entityInstanceId),
        isNull(schema.DataConnectorItem.archivedAt)
      )
    )

  return new Set(rows.map((row) => row.externalId))
}
