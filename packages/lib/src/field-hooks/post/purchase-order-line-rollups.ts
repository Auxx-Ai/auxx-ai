// packages/lib/src/field-hooks/post/purchase-order-line-rollups.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { extractRelationshipRecordIds } from '../../field-values/relationship-field'
import { type StoredFieldType, toFieldType } from '../../field-values/stored-field-type'
import {
  type PurchaseOrderStatusEvidence,
  recalculatePurchaseOrderStatuses,
  recalculatePurchaseOrderStatusesForLines,
} from '../../purchasing/purchase-order-status-writer'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import {
  defineParentReconciler,
  resolveParentsByRelation,
} from '../../reconcilers/parent-reconciler'
import type { EntityFieldChangeHandler, EntityTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:purchase-order-line-rollups')

/**
 * Actor for the rematch this module triggers. Empty for the same reason
 * `drift-reconciler.ts` passes an empty actor: nothing downstream reads it, and
 * this pass acts for no particular person — it is a consequence of a receipt,
 * not of somebody opening a bill.
 */
const ROLLUP_ACTOR = ''

/**
 * The two subledger roll-ups a purchase order line carries
 * (plans/purchasing/01-build-plan.md §4.2). Both are `creatable: false`,
 * `updatable: false`, `computed: true` — this module is their ONLY writer.
 *
 * They are re-SUMMED whole rather than incremented, for the same reason
 * `part_quantity_on_hand` is: the subledger is the truth and a hand-maintained
 * copy of it diverges silently.
 *
 * ✅ The ORDER-level `purchase_order_receipt_status` / `_billing_status` ride the
 * same pass (plans/purchasing/07-purchase-order-send-and-status.md §3.3): the
 * verdict is this computation one level up, so it is a call at the end of
 * `recalculatePurchaseOrderLineRollup` rather than a second trigger.
 *
 * ⚡ The SUM reads the line's CURRENT stored total in the same statement, and an
 * unchanged total short-circuits the write, the realtime publish AND the
 * order-level pass. That short-circuit is what makes a batched receipt cheap
 * (see {@link recalculatePurchaseOrderLineRollups}): the batch writes the
 * quantities first, so the per-movement lifecycle rules that follow find their
 * line already correct and do nothing. Getting there first is the whole
 * mechanism — there is no suppression flag to leak, and a batch that never runs
 * simply leaves the per-movement passes to do the work exactly as before.
 *
 * ⚠️ Both run POST-COMMIT, off the lifecycle record rules — never inside the
 * caller's transaction. Like `recalculatePartQoH`, the SUM below runs against the
 * module-level `database` connection and cannot see uncommitted rows, so a
 * writer must use `skipEvents: true` and call the recalculation explicitly after
 * `COMMIT` if it needs the roll-up to include its own write.
 */
interface RollupSpec {
  /** The child entity whose rows are summed. */
  childEntityType: string
  /** The child's numeric field that is summed. */
  quantityAttr: SystemAttribute
  /** The child's relationship field pointing at the purchase order line. */
  lineRelAttr: SystemAttribute
  /** The purchase order line field the SUM is written to. */
  targetAttr: SystemAttribute
  /**
   * What kind of evidence this roll-up carries, for the order-level pass.
   *
   * Declared rather than inferred from `targetAttr`: only RECEIPT evidence may
   * pull a `draft` order forward to `issued`, and a string comparison at the
   * call site is one careless edit away from letting a bill do it. See
   * {@link recalculatePurchaseOrderStatuses}.
   */
  evidence: PurchaseOrderStatusEvidence
}

/** Receipts: SUM(`stock_movement_quantity`) over the movements pointing at the line. */
const RECEIVED_ROLLUP: RollupSpec = {
  childEntityType: 'stock_movement',
  quantityAttr: 'stock_movement_quantity',
  lineRelAttr: 'stock_movement_purchase_order_line',
  targetAttr: 'purchase_order_line_quantity_received',
  evidence: 'receipt',
}

/** Bills: SUM(`vendor_bill_line_quantity_billed`) over the bill lines pointing at the line. */
const BILLED_ROLLUP: RollupSpec = {
  childEntityType: 'vendor_bill_line',
  quantityAttr: 'vendor_bill_line_quantity_billed',
  lineRelAttr: 'vendor_bill_line_purchase_order_line',
  targetAttr: 'purchase_order_line_quantity_billed',
  evidence: 'billing',
}

/** The three fields one roll-up needs, or `undefined` when the org lacks one. */
interface RollupFields {
  quantityFieldId: string
  lineRelFieldId: string
  targetFieldId: string
  targetFieldType: StoredFieldType
}

async function resolveRollupFields(
  organizationId: string,
  spec: RollupSpec
): Promise<RollupFields | undefined> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([spec.quantityAttr, spec.lineRelAttr, spec.targetAttr])

  const quantityField = fields[spec.quantityAttr]
  const lineRelField = fields[spec.lineRelAttr]
  const targetField = fields[spec.targetAttr]

  if (!quantityField || !lineRelField || !targetField) {
    logger.warn('Missing custom fields for purchase order line roll-up', {
      target: spec.targetAttr,
      quantityField: !!quantityField,
      lineRelField: !!lineRelField,
      targetField: !!targetField,
    })
    return undefined
  }

  return {
    quantityFieldId: quantityField.id,
    lineRelFieldId: lineRelField.id,
    targetFieldId: targetField.id,
    targetFieldType: targetField.type,
  }
}

/**
 * Re-SUM one roll-up for one purchase order line and write the result.
 *
 * Exported so a writer that needs the roll-up to reflect its own transaction can
 * call it explicitly after `COMMIT` rather than waiting for the lifecycle rule.
 *
 * ⚡ Reads the stored total in the same statement as the SUM and returns early
 * when they agree. A no-op write here is not free: it fires the whole field-hook
 * chain, a realtime publish, and the order-level status pass behind it.
 */
export async function recalculatePurchaseOrderLineRollup(
  organizationId: string,
  purchaseOrderLineInstanceId: string,
  spec: RollupSpec
): Promise<void> {
  const fields = await resolveRollupFields(organizationId, spec)
  if (!fields) return

  // Single self-join, the `recalculateQoHForPart` shape: SUM the child's quantity
  // where the child's line relationship points at this line. The line's CURRENT
  // stored total rides along as an uncorrelated scalar subquery — it costs one
  // index lookup inside a statement that was already being issued, where reading
  // it separately would cost a whole round trip.
  const [sumRow] = await database
    .select({
      total: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
      current: storedTotalSql(organizationId, purchaseOrderLineInstanceId, fields.targetFieldId),
    })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" fv_line`,
      sql`${schema.FieldValue.entityId} = fv_line."entityId"
        AND fv_line."fieldId" = ${fields.lineRelFieldId}
        AND fv_line."relatedEntityId" = ${purchaseOrderLineInstanceId}
        AND fv_line."organizationId" = ${organizationId}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, fields.quantityFieldId),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )

  const total = Number(sumRow?.total ?? 0)
  const stored = sumRow?.current

  // 🛑 Fail SAFE: only a value we actually read and that actually matches skips
  // the write. An absent or unreadable stored total falls through and writes,
  // which is what the old unconditional write did every time.
  if (stored != null && Number(stored) === total) {
    logger.debug('Purchase order line roll-up unchanged — nothing written', {
      purchaseOrderLineInstanceId,
      target: spec.targetAttr,
      total,
    })
    return
  }

  const lineDefId = await requireCachedEntityDefId(organizationId, 'purchase_order_line')
  const recordId = toRecordId(lineDefId, purchaseOrderLineInstanceId) as RecordId

  await setValueWithType(createFieldValueContext(organizationId), {
    recordId,
    fieldId: fields.targetFieldId,
    fieldType: toFieldType(fields.targetFieldType),
    value: { type: 'number', value: total },
  })

  publishRollupValues(organizationId, [{ recordId, fieldId: fields.targetFieldId, total }]).catch(
    (err) => {
      logger.error('Failed to publish purchase order line roll-up', {
        purchaseOrderLineInstanceId,
        target: spec.targetAttr,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  )

  logger.info('Purchase order line roll-up recalculated', {
    purchaseOrderLineInstanceId,
    target: spec.targetAttr,
    total,
  })

  // The order-level verdict is this same computation one level up, on the same
  // trigger and with no new query of the subledger. It runs AFTER the line write
  // above has been awaited, so its read of the lines includes the total just
  // written — the reason it is a call here rather than a second trigger.
  //
  // A failure is logged and swallowed: the quantity is the primary fact and is
  // already committed, and a derived status that could not be computed must not
  // take it down with it.
  const statuses = await recalculatePurchaseOrderStatuses({
    organizationId,
    purchaseOrderLineInstanceId,
    evidence: spec.evidence,
  })
  if (statuses.isErr()) {
    logger.error('Failed to derive purchase order statuses after line roll-up', {
      purchaseOrderLineInstanceId,
      target: spec.targetAttr,
      error: statuses.error.message,
    })
  }

  await rematchBillsAfterReceipt(organizationId, spec, [purchaseOrderLineInstanceId])
}

/**
 * The same roll-up for a SET of purchase order lines, in two queries and one
 * order-level pass per distinct order.
 *
 * 🛑 Why this exists. The per-line function above is chained off a lifecycle
 * rule that fires once per child row, so a ten-line purchase order receipt used
 * to run it ten times: ten SUMs, ten writes, and ten full order-level passes
 * over the same order. This reads all ten lines' SUMs in ONE grouped query,
 * writes only the ones that moved, and derives the order ONCE.
 *
 * ⚠️ It does not suppress anything. The per-movement rules still fire
 * afterwards; they simply find each line's total already correct and return
 * before writing (see {@link recalculatePurchaseOrderLineRollup}). That is
 * deliberate: a flag that failed to be set would be a purchase order left with a
 * stale `receipt_status`, whereas a batch that fails to run just leaves the old,
 * slower path to produce exactly the same answer.
 *
 * ⚠️ POST-COMMIT only, like everything in this module: the SUM runs on the
 * module-level `database` connection and cannot see a caller's open transaction.
 */
export async function recalculatePurchaseOrderLineRollups(
  organizationId: string,
  purchaseOrderLineInstanceIds: string[],
  spec: RollupSpec
): Promise<void> {
  const lineIds = [...new Set(purchaseOrderLineInstanceIds)].filter(Boolean)
  if (lineIds.length === 0) return
  if (lineIds.length === 1) {
    await recalculatePurchaseOrderLineRollup(organizationId, lineIds[0]!, spec)
    return
  }

  const fields = await resolveRollupFields(organizationId, spec)
  if (!fields) return

  const [totals, stored] = await Promise.all([
    readTotalsByLine(organizationId, lineIds, fields),
    readStoredTotals(organizationId, lineIds, fields.targetFieldId),
  ])

  const lineDefId = await requireCachedEntityDefId(organizationId, 'purchase_order_line')
  const ctx = createFieldValueContext(organizationId)
  const changed: string[] = []
  const published: Array<{ recordId: RecordId; fieldId: string; total: number }> = []

  for (const lineId of lineIds) {
    // A line with no child rows sums to zero, exactly as the per-line SUM does.
    const total = totals.get(lineId) ?? 0
    const current = stored.get(lineId)
    if (current != null && current === total) continue

    const recordId = toRecordId(lineDefId, lineId) as RecordId
    await setValueWithType(ctx, {
      recordId,
      fieldId: fields.targetFieldId,
      fieldType: toFieldType(fields.targetFieldType),
      value: { type: 'number', value: total },
    })
    changed.push(lineId)
    published.push({ recordId, fieldId: fields.targetFieldId, total })
  }

  if (changed.length === 0) return

  publishRollupValues(organizationId, published).catch((err) => {
    logger.error('Failed to publish batched purchase order line roll-up', {
      target: spec.targetAttr,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  logger.info('Purchase order line roll-ups recalculated in batch', {
    target: spec.targetAttr,
    lineCount: lineIds.length,
    changedCount: changed.length,
  })

  const statuses = await recalculatePurchaseOrderStatusesForLines({
    organizationId,
    purchaseOrderLineInstanceIds: changed,
    evidence: spec.evidence,
  })
  if (statuses.isErr()) {
    logger.error('Failed to derive purchase order statuses after batched line roll-up', {
      target: spec.targetAttr,
      error: statuses.error.message,
    })
  }

  await rematchBillsAfterReceipt(organizationId, spec, changed)
}

/**
 * A receipt changes the match's answer, so the bills that charge these lines are
 * re-matched.
 *
 * 🛑 **Without this the match's verdict depends on the order the paperwork
 * arrives in.** It re-runs on a bill write and a bill-line write and on nothing
 * else, so a bill entered before the goods records `billed 1 but only 0 received`
 * and nothing ever revisits it — a permanent false exception in the queue a
 * person is meant to work. The full argument, and the dev-data proof it was found
 * in, are on `rematchBillsForPurchaseOrderLines`.
 *
 * ⚠️ **Gated on `spec.evidence`, never on `targetAttr`.** That field exists for
 * exactly this reason — *"a string comparison at the call site is one careless
 * edit away"*. The BILLED roll-up must not come through here: it is driven BY
 * bill lines, whose writes already fire the match hook.
 *
 * Failure is logged and swallowed, like the status pass above it: the received
 * quantity is the primary fact and is already committed.
 */
async function rematchBillsAfterReceipt(
  organizationId: string,
  spec: RollupSpec,
  changedLineIds: string[]
): Promise<void> {
  if (spec.evidence !== 'receipt' || changedLineIds.length === 0) return
  try {
    const { rematchBillsForPurchaseOrderLines } = await import('../../purchasing/match-reconciler')
    await rematchBillsForPurchaseOrderLines(organizationId, ROLLUP_ACTOR, changedLineIds)
  } catch (error) {
    logger.error('Failed to re-match bills after a receipt roll-up', {
      target: spec.targetAttr,
      lines: changedLineIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** The line's stored roll-up total, as an uncorrelated scalar subquery. */
function storedTotalSql(
  organizationId: string,
  purchaseOrderLineInstanceId: string,
  targetFieldId: string
): SQL<number | null> {
  return sql<number | null>`(SELECT fv_target."valueNumber" FROM "FieldValue" fv_target
    WHERE fv_target."entityId" = ${purchaseOrderLineInstanceId}
      AND fv_target."fieldId" = ${targetFieldId}
      AND fv_target."organizationId" = ${organizationId}
    LIMIT 1)`
}

/**
 * SUM the child quantities for every line in the set, grouped by line. One
 * statement for the whole set — a line with no children is simply absent from
 * the result and reads as zero at the call site.
 */
async function readTotalsByLine(
  organizationId: string,
  lineIds: string[],
  fields: RollupFields
): Promise<Map<string, number>> {
  const idList = sql.join(
    lineIds.map((id) => sql`${id}`),
    sql`, `
  )

  const rows = await database
    .select({
      lineId: sql<string>`fv_line."relatedEntityId"`,
      total: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
    })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" fv_line`,
      sql`${schema.FieldValue.entityId} = fv_line."entityId"
        AND fv_line."fieldId" = ${fields.lineRelFieldId}
        AND fv_line."relatedEntityId" IN (${idList})
        AND fv_line."organizationId" = ${organizationId}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, fields.quantityFieldId),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )
    .groupBy(sql`fv_line."relatedEntityId"`)

  return new Map(rows.map((row) => [row.lineId, Number(row.total ?? 0)]))
}

/** The stored roll-up total of every line in the set, keyed by line. */
async function readStoredTotals(
  organizationId: string,
  lineIds: string[],
  targetFieldId: string
): Promise<Map<string, number>> {
  const rows = await database
    .select({
      entityId: schema.FieldValue.entityId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, lineIds),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, targetFieldId)
      )
    )

  const stored = new Map<string, number>()
  for (const row of rows) {
    if (row.valueNumber != null) stored.set(row.entityId, Number(row.valueNumber))
  }
  return stored
}

/** One realtime publish for however many roll-up values just landed. */
function publishRollupValues(
  organizationId: string,
  values: Array<{ recordId: RecordId; fieldId: string; total: number }>
): Promise<unknown> {
  const entries: FieldValueUpdateEntry[] = values.map((value) => ({
    key: buildFieldValueKey(value.recordId, value.fieldId as FieldId),
    value: { type: 'number', value: value.total },
  }))
  return publishFieldValueUpdates(getRealtimeService(), organizationId, entries)
}

/**
 * Build the create/delete trigger for one roll-up. Resolves the affected purchase
 * order line from the threaded event values first, falling back to the child's own
 * field values — the create path has the row, the delete path only has the values.
 *
 * A child with no purchase order line is the common case (a manual stock adjustment,
 * a freight-only bill line) and is a silent no-op, not a warning.
 */
function buildRollupTrigger(spec: RollupSpec): EntityTriggerHandler {
  return async (event) => {
    const { organizationId, entityInstanceId, values } = event

    let lineInstanceId = extractRelatedEntityId(values, spec.lineRelAttr)

    if (!lineInstanceId) {
      const [row] = await database
        .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
        .from(schema.FieldValue)
        .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
        .where(
          and(
            eq(schema.FieldValue.entityId, entityInstanceId),
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.CustomField.systemAttribute, spec.lineRelAttr)
          )
        )
        .limit(1)
      lineInstanceId = row?.relatedEntityId ?? undefined
    }

    if (!lineInstanceId) return

    await recalculatePurchaseOrderLineRollup(organizationId, lineInstanceId, spec)
  }
}

/** Re-SUM `purchase_order_line_quantity_received` after a stock movement create/delete. */
export const recalculatePurchaseOrderLineReceived: EntityTriggerHandler =
  buildRollupTrigger(RECEIVED_ROLLUP)

/** Re-SUM `purchase_order_line_quantity_billed` after a vendor bill line create/delete. */
export const recalculatePurchaseOrderLineBilled: EntityTriggerHandler =
  buildRollupTrigger(BILLED_ROLLUP)

/** Test/caller convenience: the two specs, so an explicit post-commit call can name one. */
export const PURCHASE_ORDER_LINE_ROLLUPS = {
  received: RECEIVED_ROLLUP,
  billed: BILLED_ROLLUP,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// The EDIT door for the billed roll-up
//
// 🛑 The create/delete triggers above are NOT complete coverage for billing, and
// this is the half that was missing (verified in a browser 2026-08-28; the
// architecture guide §12 carries the finding).
//
// `purchase-order-status-writer.ts` states the assumption the old shape rested
// on — the roll-ups "fire on exactly the two events that can move either axis (a
// `stock_movement` or a `vendor_bill_line` create/delete)". That is true of
// RECEIPTS, because a movement is append-only: correcting one means reversing
// it, which is another create. It is false of BILLING, because a bill line is
// created at its registry default of `1` and the real quantity is typed in
// AFTERWARDS. So the ordinary act of transcribing an invoice moved the child and
// never re-SUMMED the parent, and the divergence was permanent: two dev orders
// sat at a stored `1` against bill lines reading `4` and `10`.
//
// What that broke, beyond the number itself: `selectBillableLines` gates on
// `billed < ordered`, so a fully-billed line kept being offered back on the next
// bill, and `purchase_order_billing_status` is classified from the same stale
// figure.
//
// ⚠️ The receipt roll-up deliberately does NOT get an edit door. `stock_movement`
// declares every field `updatable: false` and a correction is a reversal, so
// there is no legitimate edit to catch. (That capability is advisory rather than
// enforced at the write path — but the answer to a movement being edited is to
// stop the edit, not to re-derive around it.)
// ─────────────────────────────────────────────────────────────────────────────

/** `dirty-parents` key for the billed roll-up. The marked record IS the parent. */
export const PURCHASE_ORDER_LINE_BILLED_ROLLUP = 'po-line-rollup:billed'

/**
 * Coalescing drain for the billed roll-up.
 *
 * Marked with a PURCHASE ORDER LINE id, not a bill line id — the marked record
 * is already the parent, so the spec needs no `resolve`. That is what makes a
 * repoint expressible at all: one bill line write can dirty TWO parents, and a
 * reconciler keyed on the child could only ever name the one it now points at.
 *
 * Coalescing is the other half of the point. Typing quantity and price on a
 * three-line bill is six field writes hitting the same three lines; the drain
 * re-SUMs each distinct line once.
 */
const billedRollupReconciler = defineParentReconciler<string>({
  key: PURCHASE_ORDER_LINE_BILLED_ROLLUP,
  rebuild: (organizationId, _userId, purchaseOrderLineInstanceId) =>
    recalculatePurchaseOrderLineRollup(organizationId, purchaseOrderLineInstanceId, BILLED_ROLLUP),
})

/**
 * Register the billed roll-up's drain. Called from `registerAllHooks()`.
 *
 * 🛑 Must stay paired with the hook below, which only MARKS. Without this,
 * nothing re-SUMs — which is the exact bug this pair exists to close, restored
 * by omission.
 */
export function registerPurchaseOrderLineRollupReconcilers(): void {
  billedRollupReconciler.register()
}

/** The two bill-line attributes whose EDIT can move a purchase order line's billed total. */
const BILLED_ROLLUP_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_purchase_order_line',
])

/**
 * Re-SUM the billed roll-up after a bill line is EDITED.
 *
 * Deliberately a second handler beside `rematchOnBillLineChange` rather than a
 * branch inside it. They fire on overlapping attributes and are otherwise
 * unrelated: the match writes the BILL's verdict, this writes the ORDER LINE's
 * quantity, and this module is that field's only writer. Folding one into the
 * other would put the roll-up's write behind the match's trigger set, where the
 * next person to tune that set would move it by accident.
 *
 * 🛑 **A repoint dirties the line it LEFT.** `vendor_bill_line_purchase_order_line`
 * is user-editable through `PurchaseOrderLinePicker`, so picking the wrong line
 * and correcting it is ordinary. The post-hook's `newValue` names only the new
 * line; without `oldValue` the old one keeps the phantom quantity forever, which
 * is the same defect one level down. Both are marked.
 */
export const recalculateBilledRollupOnBillLineChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !BILLED_ROLLUP_TRIGGER_ATTRS.has(attr)) return

  const lineInstanceIds = new Set<string>()

  if (attr === 'vendor_bill_line_purchase_order_line') {
    // Both sides come off the event — no read needed, and `oldValue` is the only
    // place the vacated line is still named.
    for (const value of [event.oldValue, event.newValue]) {
      for (const recordId of extractRelationshipRecordIds(value)) {
        lineInstanceIds.add(parseRecordId(recordId).entityInstanceId)
      }
    }
  } else {
    // A quantity write says nothing about which line it belongs to, so resolve
    // the bill line's current match key. One query, and the same helper the match
    // reconciler uses for its own parent lookup.
    const { entityInstanceId: billLineInstanceId } = parseRecordId(event.recordId)
    const parents = await resolveParentsByRelation(
      event.organizationId,
      'vendor_bill_line_purchase_order_line',
      [billLineInstanceId]
    )
    for (const parent of parents) lineInstanceIds.add(parent)
  }

  // A bill line with no match key is ordinary — a freight line, a one-off — and
  // contributes nothing to any order line's total.
  for (const lineInstanceId of lineInstanceIds) {
    await billedRollupReconciler.mark(event.organizationId, event.userId, lineInstanceId)
  }
}

/**
 * Extract a related entity id from threaded event values. Values may be keyed by
 * systemAttribute or by field id, and a relationship value may be a bare instance id
 * or a `defId:instanceId` RecordId.
 */
function extractRelatedEntityId(
  values: Record<string, unknown>,
  systemAttribute: string
): string | undefined {
  const value = values[systemAttribute]
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.includes(':') ? parseRecordId(value as RecordId).entityInstanceId : value
}
