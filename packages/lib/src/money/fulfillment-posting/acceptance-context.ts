// packages/lib/src/money/fulfillment-posting/acceptance-context.ts

/** Everything a fulfillment acceptance resolves ONCE, instead of once per shipment. */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import type { FulfillmentGatewayRoute } from '../../postings/build-fulfillment-batch-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import { getOrganizationSetting } from '../../settings/settings-service'
import { financialFields } from '../fulfillments/field-context'
import type { FulfillmentFieldContext } from '../fulfillments/reads'
import { requireFulfillmentFieldContext } from '../fulfillments/reads'
import type { OrderFieldContext } from '../orders/reads'
import { requireOrderFieldContext } from '../orders/reads'
import { loadGatewayRoutesForPlan } from './plan'
import type { FulfillmentPostingSettings } from './reads'
import { readFulfillmentPostingSettings, readUnpostedShipments, toCalendarDay } from './reads'
import type { UnpostedShipment } from './types'
import type { FulfillmentAccountingSource } from './work'

/**
 * The org-level metadata and accounting configuration every shipment in a group
 * reads, resolved once for the whole transaction.
 *
 * Before this existed, `readFulfillmentAccountingSourceInTx` re-derived all of
 * it per shipment - and it runs more than once per shipment - so a 17-shipment
 * day group spent most of its time re-reading the same ~12 rows. A measured
 * January run (480 shipments, 28 day groups) took 220s at ~7.9s a group with
 * every individual query under a millisecond: the cost was the number of
 * sequential round trips, not any one of them.
 *
 * The two halves come from deliberately different places, and the split is the
 * whole point of the file:
 *
 * - **{@link fields}, {@link orderFields}, {@link ownershipFieldId}** are
 *   entity/custom-field metadata, read from the ORG CACHE. Nothing that writes
 *   `CustomField` or `EntityDefinition` takes the accounting commit lock, so
 *   reading them through `tx` never bought stability - at `read committed` each
 *   statement takes a fresh snapshot anyway. The cache is exactly as correct
 *   here and does not touch the database at all.
 *
 * - **{@link settings}, {@link setupState}, {@link gatewayRoutes}** are
 *   accounting configuration, read through `tx`. `updateOrganizationSetting`
 *   DOES take the accounting commit lock for `accounting.*`, `ledger.*` and
 *   `quickbooks.postJournalEntries` (`settings-service.ts`), and so does the
 *   role map. These are NOT cached, for that reason. They are read once because
 *   the caller already holds that lock, which is what makes one read and 200
 *   reads provably identical - not because a stale value would be acceptable.
 */
export interface FulfillmentAcceptanceContext {
  organizationId: string
  /** `fulfillment` / `fulfillment_line` defs and fields. From the org cache. */
  fields: FulfillmentFieldContext
  /** `order` / `line_item` defs and fields. From the org cache. */
  orderFields: OrderFieldContext
  /** `line_item_order`, the field an order line's ownership check reads. From the org cache. */
  ownershipFieldId: string
  /** Cutoff, period lock, book time zone, ledger currency. Read under the lock. */
  settings: FulfillmentPostingSettings
  /** `accounting.setupState`, for {@link resolveRefusal}. Read under the lock. */
  setupState: unknown
  /** The payment-gateway clearing routes a debit resolves through. Read under the lock. */
  gatewayRoutes: readonly FulfillmentGatewayRoute[]
  /**
   * Per-transaction memo of {@link readFulfillmentAccountingSourceInTx}, keyed
   * by fulfillment instance id.
   *
   * 🛑 Sound ONLY because a context belongs to ONE transaction, and every path
   * that mutates a fulfillment source takes the same accounting commit lock the
   * holder of this context is holding (`source-write-guard.ts` ->
   * `UnifiedCrudHandler`, `update-entity-instance.ts`, `delete-entity-instance.ts`).
   * The source provably cannot change underneath an entry of this map. Never
   * hoist a context across transactions - that is precisely when it stops being
   * true.
   *
   * ⚠️ The acceptance guard in `acceptEntryInTx` deliberately reads AROUND this
   * (`revalidateFulfillmentMemberInTx` passes `fresh`), because a guard served
   * from the memo it is supposed to be checking is not a guard.
   */
  readonly sources: Map<string, FulfillmentAccountingSource>
  /**
   * The group's netting read, done ONCE for every shipment in it.
   *
   * `readUnpostedShipments` is 14 of the ~21 round trips a single source read
   * costs, and almost all of that is per-ORDER work - order facts, line facts,
   * tax lines, money coverage - that it already batches internally. Called once
   * per shipment it re-does the whole batch for a set of one, so a 17-shipment
   * day group ran the same order reads 17 times over.
   *
   * Empty and {@link prefetched} empty when nobody prefetched: the single-source
   * doors (`fulfillOrder`, the source-write guard) capture one shipment and have
   * nothing to batch, so they read exactly as they always did.
   */
  readonly shipments: Map<string, UnpostedShipment>
  /** Ship days resolved alongside {@link shipments}, so the per-shipment date read goes too. */
  readonly shipDays: Map<string, string>
  /**
   * The ids {@link prefetchGroupSources} covered.
   *
   * 🛑 Distinguishes "prefetched, and this shipment is not a candidate" - which
   * is a refusal - from "never prefetched", which must fall back to a single
   * read. Without it an absent key means both, and the second reading turns a
   * cancelled or already-accepted shipment into a silent database re-read.
   */
  readonly prefetched: Set<string>
}

/**
 * Resolve the context for one acceptance transaction.
 *
 * 🛑 Call this ONCE, at the top of the transaction that holds the accounting
 * commit lock, and thread the result down. Calling it per shipment restores
 * exactly the cost it exists to remove.
 *
 * @param tx the transaction holding the accounting commit lock. Only the
 *   configuration half reads through it; the metadata half deliberately does
 *   not, so that it can be served from the org cache.
 */
export async function resolveFulfillmentAcceptanceContext(
  tx: Database | Transaction,
  organizationId: string
): Promise<FulfillmentAcceptanceContext> {
  // 🛑 No `tx` argument on these three. That is what routes them through the
  // org cache rather than the connection - see the interface's note on why
  // that is not a correctness trade here.
  const [fields, orderFields, ownership] = await Promise.all([
    requireFulfillmentFieldContext(organizationId),
    requireOrderFieldContext(organizationId),
    financialFields(organizationId, ['line_item_order'] as const),
  ])
  if (!ownership.line_item_order)
    throw new UnprocessableEntityError('Order line ownership field is missing')

  const [settingsResult, setupState, gatewayRoutes] = await Promise.all([
    readFulfillmentPostingSettings(tx, organizationId),
    getOrganizationSetting({
      organizationId,
      key: OPENING_BASELINE_SETTING_KEYS.setupState,
      db: tx,
    }),
    loadGatewayRoutesForPlan(tx, organizationId),
  ])
  if (settingsResult.isErr()) throw settingsResult.error

  return {
    organizationId,
    fields,
    orderFields,
    ownershipFieldId: ownership.line_item_order.id,
    settings: settingsResult.value,
    setupState,
    gatewayRoutes,
    sources: new Map(),
    shipments: new Map(),
    shipDays: new Map(),
    prefetched: new Set(),
  }
}

/**
 * Read every shipment in a group in ONE netting pass, onto {@link context}.
 *
 * 🛑 Must run inside the transaction that owns `context`, holding the accounting
 * commit lock - the same requirement the source memo carries and for the same
 * reason. The prefetch is a snapshot, and only the lock makes the snapshot
 * indistinguishable from reading each shipment on its own.
 *
 * The range is derived from the shipments' own ship days rather than taken from
 * the caller: `acceptFulfillmentWorkGroup` is reached from the dialog, the
 * automatic sweep and the native door, and only two of those have a day to hand.
 * One `FieldValue` read answers it for the whole group and doubles as the
 * per-shipment date the source read would otherwise fetch one row at a time.
 */
export async function prefetchGroupSources(
  tx: Database | Transaction,
  context: FulfillmentAcceptanceContext,
  fulfillmentInstanceIds: readonly string[],
  options: { refresh?: boolean } = {}
): Promise<void> {
  // 🛑 `refresh` is how the acceptance guard stays a guard. `acceptEntryInTx`
  // re-reads every member's live source and compares its hash against what
  // preparation froze; served from preparation's own snapshot it would compare
  // a value to itself. So the group takes a SECOND netting pass before
  // acceptance and drops everything derived from the first - which keeps the
  // re-read genuinely independent while doing it once for the group instead of
  // once per shipment.
  if (options.refresh) {
    context.sources.clear()
    context.shipments.clear()
    context.shipDays.clear()
    context.prefetched.clear()
  }
  const ids = [...new Set(fulfillmentInstanceIds)]
  // One shipment is not a batch; the single-source doors land here and should
  // pay nothing for a prefetch that saves them nothing.
  if (ids.length < 2) return
  const shippedAtFieldId = context.fields.fulfillment.fulfillment_shipped_at?.id
  if (!shippedAtFieldId) return

  const dates = await tx
    .select({ entityId: schema.FieldValue.entityId, valueDate: schema.FieldValue.valueDate })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, context.organizationId),
        eq(schema.FieldValue.fieldId, shippedAtFieldId),
        inArray(schema.FieldValue.entityId, ids)
      )
    )

  const days: string[] = []
  for (const row of dates) {
    const day = toCalendarDay(row.valueDate, context.settings.timeZone ?? 'UTC')
    if (!day) continue
    context.shipDays.set(row.entityId, day)
    days.push(day)
  }
  // A group where no shipment has a readable ship date has nothing to net; each
  // one refuses on its own with the message that names the missing date.
  if (!days.length) return

  days.sort()
  const to = new Date(`${days.at(-1)!}T00:00:00.000Z`)
  to.setUTCDate(to.getUTCDate() + 1)

  const read = await readUnpostedShipments(tx, {
    organizationId: context.organizationId,
    range: { from: days[0]!, to: to.toISOString().slice(0, 10) },
    fulfillmentIds: ids,
    context,
  })
  if (read.isErr()) throw read.error
  for (const shipment of read.value) context.shipments.set(shipment.fulfillmentInstanceId, shipment)
  for (const id of ids) context.prefetched.add(id)
}
