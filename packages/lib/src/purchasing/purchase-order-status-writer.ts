// packages/lib/src/purchasing/purchase-order-status-writer.ts

import { database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { AuxxError } from '../errors'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { setValueWithType } from '../field-values/field-value-mutations'
import { toFieldType } from '../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'
import { PurchaseOrderStatus } from '../resources/registry/enum-values'
import {
  derivePurchaseOrderStatuses,
  type PurchaseOrderBillingStatusValue,
  type PurchaseOrderLineQuantities,
  type PurchaseOrderReceiptStatusValue,
} from './purchase-order-status'

const logger = createScopedLogger('purchasing:purchase-order-status')

/**
 * The database half of the derived purchase order statuses
 * (plans/purchasing/07-purchase-order-send-and-status.md §3.3, §6.1).
 *
 * `purchase-order-status.ts` holds the rule; this file reads the lines, applies
 * it, and writes the diff. It rides the roll-up that already runs — every call
 * site is `recalculatePurchaseOrderLineRollup`, which fires on exactly the two
 * events that can move either axis (a `stock_movement` or a `vendor_bill_line`
 * create/delete). There is no new trigger and no new fan-out.
 */

/** What moved the roll-up, and therefore what this pass is allowed to conclude. */
export type PurchaseOrderStatusEvidence = 'receipt' | 'billing'

/**
 * The fields this pass actually wrote. Empty when nothing changed, which is the
 * common case — see {@link recalculatePurchaseOrderStatuses} on why the diff is
 * computed rather than written blind.
 */
export interface PurchaseOrderStatusWrite {
  receiptStatus?: PurchaseOrderReceiptStatusValue
  billingStatus?: PurchaseOrderBillingStatusValue
  /** Only ever `issued`, and only ever from `draft`. */
  status?: typeof PurchaseOrderStatus.ISSUED
}

const STATUS_ATTRS = [
  'purchase_order_line_purchase_order',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_status',
  'purchase_order_receipt_status',
  'purchase_order_billing_status',
] as const

/** The seven fields this pass needs, resolved from the org cache. */
interface StatusFields {
  orderRelField: CustomFieldEntity
  orderedField: CustomFieldEntity
  receivedField: CustomFieldEntity
  billedField: CustomFieldEntity
  /** Optional: the ACTION field. Absent means no pull-forward, never a failure. */
  statusField: CustomFieldEntity | undefined
  receiptStatusField: CustomFieldEntity
  billingStatusField: CustomFieldEntity
}

/**
 * Which purchase order this pass is about, and how it was named.
 *
 * A `line` anchor resolves the order inside the one read (a scalar subquery),
 * which is what collapsed the old resolve-then-read-lines-then-read-statuses
 * sequence into a single round trip. An `order` anchor is the batched caller's
 * door: it already knows the order, so it skips the subquery entirely.
 */
type StatusAnchor =
  | { kind: 'line'; purchaseOrderLineInstanceId: string }
  | { kind: 'order'; purchaseOrderInstanceId: string }

/**
 * Re-derive a purchase order's receipt and billing statuses from its lines, and
 * pull a `draft` order forward to `issued` when the evidence is a receipt.
 *
 * ## The pull-forward contract
 *
 * 🛑 This function is the ONE derived writer permitted to touch the ACTION field
 * `purchase_order_status`, which §3.3 otherwise reserves for the human and for
 * the sanctioned Send action. The permission is exactly one transition and
 * nothing else, and every clause below is load-bearing:
 *
 * - **Only `draft` -> `issued`.** The current value is read first and the write
 *   happens only when it is *exactly* `draft`.
 * - **Never from `closed` or `canceled`.** Somebody deliberately ended those
 *   orders. A straggler receipt arriving weeks later must not silently reopen
 *   an order that was written off, and a rule that reopened it would be
 *   invisible — the status would simply be wrong with nothing thrown.
 * - **Never backwards, and never a write of `draft`.** `issued` is the only
 *   value this function can produce.
 * - **Only on RECEIPT evidence.** A `vendor_bill_line` never pulls the status
 *   forward. This business prepays (02 §0k): a bill arriving before the goods
 *   is normal and is not evidence that the order was ever sent to the vendor.
 * - **A null status is NOT `draft`.** An order with no recorded status is not a
 *   fact this pass is willing to overwrite; `defaultValue: 'draft'` means a
 *   normally created order has the value, and an absent one is left alone.
 * - **Something must actually have arrived.** The derived `receipt_status` has
 *   to be off `not_received` as well. The roll-up fires on a movement DELETE
 *   too, and a delete that takes the last receipt away is the opposite of
 *   evidence that the order was sent.
 *
 * The reason this is safe to do at all is §3.3's split. Under the old single
 * enum, a first receipt against a draft order forced a choice between recording
 * `issued` and recording `partially_received` and one fact had to be discarded.
 * With three fields both are recorded, so the pull-forward destroys nothing.
 *
 * ## Writes are diffed, never blind
 *
 * ⚠️ Each of the three fields is compared against its stored value and written
 * only when it differs. A no-op field write still fires the field-hook chain and
 * a realtime publish, and this pass runs once per line per movement — writing
 * blind would broadcast three unchanged values on every receipt on a
 * ten-line order.
 *
 * ## One read, not three
 *
 * ⚡ The parent order, its lines' quantities and the order's own SELECT values
 * used to be three sequential round trips. They are one statement now — see
 * {@link readOrderStatusInputs}. The diff above is unaffected: it was never an
 * optimisation, it is what stops a derived no-op from broadcasting.
 *
 * ## Failure
 *
 * Returns `err` rather than throwing: the caller is the line roll-up, whose own
 * write is the primary fact and has already committed by the time this runs. A
 * derived verdict that could not be computed must not take the quantity with it.
 */
export async function recalculatePurchaseOrderStatuses(params: {
  organizationId: string
  purchaseOrderLineInstanceId: string
  evidence: PurchaseOrderStatusEvidence
}): Promise<Result<PurchaseOrderStatusWrite, AuxxError>> {
  const { organizationId, purchaseOrderLineInstanceId, evidence } = params
  return runStatusPass(
    organizationId,
    { kind: 'line', purchaseOrderLineInstanceId },
    evidence,
    purchaseOrderLineInstanceId
  )
}

/**
 * The same pass, run ONCE per distinct purchase order behind a set of lines.
 *
 * 🛑 The reason this exists: the per-line entry point above is chained off a
 * line roll-up, so receiving a ten-line purchase order used to run it ten times
 * against the same order — ten identical reads and, after the first, ten
 * identical no-op diffs. A batched caller that already knows the whole line set
 * resolves the distinct orders in one query and derives each of them once.
 *
 * ⚠️ This is an ADDITION, not a replacement. The per-line pass still runs off
 * the lifecycle rule for every single-line write (a direct `receiveStock`, an
 * adjustment, a reversal, a bill line) and for anything this batch missed. A
 * batched caller does not suppress it with a flag; it simply gets there first,
 * and the per-line pass then finds nothing to do. Forgetting to call this costs
 * an extra pass, never a skipped one.
 */
export async function recalculatePurchaseOrderStatusesForLines(params: {
  organizationId: string
  purchaseOrderLineInstanceIds: string[]
  evidence: PurchaseOrderStatusEvidence
}): Promise<Result<PurchaseOrderStatusWrite[], AuxxError>> {
  const { organizationId, purchaseOrderLineInstanceIds, evidence } = params
  const lineIds = [...new Set(purchaseOrderLineInstanceIds)].filter(Boolean)
  if (lineIds.length === 0) return ok([])

  let orderIds: string[]
  try {
    const fields = await resolveStatusFields(organizationId)
    if (!fields) return ok([])
    orderIds = await readOrdersForLines(organizationId, lineIds, fields.orderRelField.id)
  } catch (error) {
    return err(toStatusError(error, organizationId, lineIds.join(','), evidence))
  }

  const written: PurchaseOrderStatusWrite[] = []
  for (const purchaseOrderInstanceId of orderIds) {
    const result = await runStatusPass(
      organizationId,
      { kind: 'order', purchaseOrderInstanceId },
      evidence,
      purchaseOrderInstanceId
    )
    if (result.isErr()) return err(result.error)
    written.push(result.value)
  }
  return ok(written)
}

/** Derive and write one purchase order's statuses. Both entry points land here. */
async function runStatusPass(
  organizationId: string,
  anchor: StatusAnchor,
  evidence: PurchaseOrderStatusEvidence,
  logRef: string
): Promise<Result<PurchaseOrderStatusWrite, AuxxError>> {
  try {
    const fields = await resolveStatusFields(organizationId)
    if (!fields) return ok({})

    const inputs = await readOrderStatusInputs(organizationId, anchor, fields)
    // An orphaned line — created before its parent was picked — is ordinary and
    // is a silent no-op, the same way a movement with no PO line is.
    if (!inputs) return ok({})

    const { purchaseOrderInstanceId, lines, current } = inputs
    const derived = derivePurchaseOrderStatuses(lines)

    const { statusField, receiptStatusField, billingStatusField } = fields
    const orderDefId = await requireCachedEntityDefId(organizationId, 'purchase_order')
    const recordId = toRecordId(orderDefId, purchaseOrderInstanceId) as RecordId

    const written: PurchaseOrderStatusWrite = {}
    const pending: Array<{ field: CustomFieldEntity; value: string }> = []

    if (current.get(receiptStatusField.id) !== derived.receiptStatus) {
      pending.push({ field: receiptStatusField, value: derived.receiptStatus })
      written.receiptStatus = derived.receiptStatus
    }
    if (current.get(billingStatusField.id) !== derived.billingStatus) {
      pending.push({ field: billingStatusField, value: derived.billingStatus })
      written.billingStatus = derived.billingStatus
    }

    // The pull-forward. Every guard in the contract above is this one condition.
    if (
      statusField &&
      evidence === 'receipt' &&
      current.get(statusField.id) === PurchaseOrderStatus.DRAFT &&
      derived.receiptStatus !== 'not_received'
    ) {
      pending.push({ field: statusField, value: PurchaseOrderStatus.ISSUED })
      written.status = PurchaseOrderStatus.ISSUED
    }

    if (pending.length === 0) return ok({})

    // `bypassFieldGuards` names `purchase_order_status` and nothing else: this
    // pass IS the sanctioned writer of the `draft -> issued` transition, so the
    // guard that rejects a MANUAL `issued` must not reject it. The two derived
    // fields are deliberately left subject to whatever guards they carry.
    const ctx = createFieldValueContext(organizationId, undefined, database, undefined, {
      bypassFieldGuards: new Set<SystemAttribute>(['purchase_order_status']),
    })

    const entries: FieldValueUpdateEntry[] = []
    for (const write of pending) {
      await setValueWithType(ctx, {
        recordId,
        fieldId: write.field.id,
        fieldType: toFieldType(write.field.type),
        value: { type: 'option', optionId: write.value },
      })
      entries.push({
        key: buildFieldValueKey(recordId, write.field.id as FieldId),
        value: { type: 'option', optionId: write.value },
      })
    }

    publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch((error) => {
      logger.error('Failed to publish purchase order status update', {
        purchaseOrderInstanceId,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    logger.info('Purchase order statuses derived', {
      purchaseOrderInstanceId,
      evidence,
      lineCount: lines.length,
      ...written,
    })

    return ok(written)
  } catch (error) {
    return err(toStatusError(error, organizationId, logRef, evidence))
  }
}

/** Log-and-wrap, so both entry points fail the same way. */
function toStatusError(
  error: unknown,
  organizationId: string,
  logRef: string,
  evidence: PurchaseOrderStatusEvidence
): AuxxError {
  if (error instanceof AuxxError) return error
  logger.error('Failed to derive purchase order statuses', {
    organizationId,
    purchaseOrderLineInstanceId: logRef,
    evidence,
    error: error instanceof Error ? error.message : String(error),
  })
  return new AuxxError('Failed to derive purchase order statuses')
}

/**
 * The seven fields, or `undefined` when the org has not provisioned the ones
 * this pass cannot work without. `purchase_order_status` is deliberately
 * optional: without it the two derived axes still work, only the pull-forward
 * is unavailable.
 */
async function resolveStatusFields(organizationId: string): Promise<StatusFields | undefined> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([...STATUS_ATTRS])

  const orderRelField = fields.purchase_order_line_purchase_order
  const orderedField = fields.purchase_order_line_quantity_ordered
  const receivedField = fields.purchase_order_line_quantity_received
  const billedField = fields.purchase_order_line_quantity_billed
  const statusField = fields.purchase_order_status
  const receiptStatusField = fields.purchase_order_receipt_status
  const billingStatusField = fields.purchase_order_billing_status

  if (
    !orderRelField ||
    !orderedField ||
    !receivedField ||
    !billedField ||
    !receiptStatusField ||
    !billingStatusField
  ) {
    logger.warn('Missing custom fields for purchase order status derivation', {
      organizationId,
      orderRelField: !!orderRelField,
      orderedField: !!orderedField,
      receivedField: !!receivedField,
      billedField: !!billedField,
      receiptStatusField: !!receiptStatusField,
      billingStatusField: !!billingStatusField,
    })
    return undefined
  }

  return {
    orderRelField,
    orderedField,
    receivedField,
    billedField,
    statusField: statusField ?? undefined,
    receiptStatusField,
    billingStatusField,
  }
}

/** Everything one status pass reads, in one round trip. */
interface OrderStatusInputs {
  purchaseOrderInstanceId: string
  lines: PurchaseOrderLineQuantities[]
  /** Stored option ids keyed by field id — absent when the field has no value. */
  current: Map<string, string>
}

/**
 * Read the parent order, every line's `{ ordered, received, billed }`, and the
 * order's own current SELECT values — as ONE statement.
 *
 * ⚠️ The driving rows are the RELATIONSHIP values, with the three quantities
 * LEFT JOINed on. Driving off the quantities instead would drop a line that
 * carries none — and a line with no `quantity_ordered` typed yet is exactly the
 * line that must hold the order open, not the one to ignore.
 *
 * ⚠️ The order's three SELECT values are scalar SUBQUERIES, not three more
 * joins. A join would be cheaper to read, but `FieldValue` is unique on
 * `(entityId, fieldId, sortKey)` — a second row for the same field is legal by
 * construction — and a join that matched two of them would DUPLICATE every line
 * row and silently double-count the order. A subquery cannot change the row
 * count no matter what it finds. `optionId IS NOT NULL` reproduces the old
 * `readCurrentOptions` behaviour of ignoring a row that carries no option.
 *
 * Returns `undefined` for an orphaned line: no relationship row means no order,
 * and no order means no rows at all.
 */
async function readOrderStatusInputs(
  organizationId: string,
  anchor: StatusAnchor,
  fields: StatusFields
): Promise<OrderStatusInputs | undefined> {
  const orderRelFieldId = fields.orderRelField.id

  // The order id, as SQL: a literal when the caller named it, and the line's
  // own relationship row when it did not. Uncorrelated either way, so the
  // planner resolves it once for the whole statement.
  const orderIdSql: SQL =
    anchor.kind === 'order'
      ? sql`${anchor.purchaseOrderInstanceId}`
      : sql`(SELECT fv_anchor."relatedEntityId" FROM "FieldValue" fv_anchor
          WHERE fv_anchor."entityId" = ${anchor.purchaseOrderLineInstanceId}
            AND fv_anchor."fieldId" = ${orderRelFieldId}
            AND fv_anchor."organizationId" = ${organizationId}
          LIMIT 1)`

  const currentOption = (fieldId: string | undefined): SQL<string | null> =>
    sql<string | null>`(SELECT fv_opt."optionId" FROM "FieldValue" fv_opt
      WHERE fv_opt."entityId" = ${schema.FieldValue.relatedEntityId}
        AND fv_opt."fieldId" = ${fieldId ?? ''}
        AND fv_opt."organizationId" = ${organizationId}
        AND fv_opt."optionId" IS NOT NULL
      LIMIT 1)`

  const rows = await database
    .select({
      orderId: schema.FieldValue.relatedEntityId,
      ordered: sql<number | null>`fv_ordered."valueNumber"`,
      received: sql<number | null>`fv_received."valueNumber"`,
      billed: sql<number | null>`fv_billed."valueNumber"`,
      statusOption: currentOption(fields.statusField?.id),
      receiptStatusOption: currentOption(fields.receiptStatusField.id),
      billingStatusOption: currentOption(fields.billingStatusField.id),
    })
    .from(schema.FieldValue)
    .leftJoin(
      sql`"FieldValue" fv_ordered`,
      sql`${schema.FieldValue.entityId} = fv_ordered."entityId"
        AND fv_ordered."fieldId" = ${fields.orderedField.id}
        AND fv_ordered."organizationId" = ${organizationId}`
    )
    .leftJoin(
      sql`"FieldValue" fv_received`,
      sql`${schema.FieldValue.entityId} = fv_received."entityId"
        AND fv_received."fieldId" = ${fields.receivedField.id}
        AND fv_received."organizationId" = ${organizationId}`
    )
    .leftJoin(
      sql`"FieldValue" fv_billed`,
      sql`${schema.FieldValue.entityId} = fv_billed."entityId"
        AND fv_billed."fieldId" = ${fields.billedField.id}
        AND fv_billed."organizationId" = ${organizationId}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, orderRelFieldId),
        eq(schema.FieldValue.organizationId, organizationId),
        sql`${schema.FieldValue.relatedEntityId} = ${orderIdSql}`
      )
    )

  const first = rows[0]
  if (!first) return undefined

  const purchaseOrderInstanceId =
    anchor.kind === 'order' ? anchor.purchaseOrderInstanceId : (first.orderId ?? undefined)
  if (!purchaseOrderInstanceId) return undefined

  const current = new Map<string, string>()
  if (fields.statusField?.id && first.statusOption) {
    current.set(fields.statusField.id, first.statusOption)
  }
  if (first.receiptStatusOption) {
    current.set(fields.receiptStatusField.id, first.receiptStatusOption)
  }
  if (first.billingStatusOption) {
    current.set(fields.billingStatusField.id, first.billingStatusOption)
  }

  return {
    purchaseOrderInstanceId,
    lines: rows.map((row) => ({
      quantityOrdered: Number(row.ordered ?? 0),
      quantityReceived: Number(row.received ?? 0),
      quantityBilled: Number(row.billed ?? 0),
    })),
    current,
  }
}

/**
 * The DISTINCT purchase orders a set of lines belongs to, in one query.
 *
 * Orphaned lines simply do not come back — the same silent no-op the per-line
 * pass applies, applied once for the whole set.
 */
async function readOrdersForLines(
  organizationId: string,
  purchaseOrderLineInstanceIds: string[],
  orderRelFieldId: string
): Promise<string[]> {
  const rows = await database
    .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, purchaseOrderLineInstanceIds),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, orderRelFieldId)
      )
    )

  const orderIds = new Set<string>()
  for (const row of rows) {
    if (row.relatedEntityId) orderIds.add(row.relatedEntityId)
  }
  return [...orderIds]
}
