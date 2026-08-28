// packages/lib/src/field-hooks/pre/purchase-order-line-evidence-lock.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { ConflictError } from '../../errors'
import type { FieldPreHookHandler } from '../types'

/**
 * The two `purchase_order_line` fields this lock protects. Both are the agreed terms of the
 * order, and both are read by machinery that has already acted on them.
 */
export const EVIDENCE_LOCKED_LINE_ATTRS = [
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_expected_unit_price',
] as const

/** The two links that constitute evidence something has happened against a line. */
const EVIDENCE_ATTRS = [
  'stock_movement_purchase_order_line',
  'vendor_bill_line_purchase_order_line',
] as const

/** Unwrap a pre-hook value to its scalar — arrays and typed envelopes both flatten. */
function scalarOf(value: unknown): unknown {
  if (Array.isArray(value)) return scalarOf(value[0])
  if (value && typeof value === 'object') {
    if ('value' in value) return (value as { value: unknown }).value
    if ('recordId' in value) return (value as { recordId: unknown }).recordId
  }
  return value
}

/** What has already happened against a line, in one query. */
async function readEvidence(
  organizationId: string,
  lineInstanceId: string
): Promise<{ hasReceipt: boolean; hasBillLine: boolean }> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...EVIDENCE_ATTRS])

  const movementRelField = cf.stock_movement_purchase_order_line
  const billLineRelField = cf.vendor_bill_line_purchase_order_line
  const fieldIds = [movementRelField?.id, billLineRelField?.id].filter((id): id is string => !!id)
  if (fieldIds.length === 0) return { hasReceipt: false, hasBillLine: false }

  const rows = await database
    .selectDistinct({ fieldId: schema.FieldValue.fieldId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, fieldIds),
        eq(schema.FieldValue.relatedEntityId, lineInstanceId)
      )
    )

  const seen = new Set(rows.map((row) => row.fieldId))
  return {
    hasReceipt: !!movementRelField && seen.has(movementRelField.id),
    hasBillLine: !!billLineRelField && seen.has(billLineRelField.id),
  }
}

/** The line's currently stored number for this field, or `null` when it has none. */
async function readStoredNumber(
  organizationId: string,
  lineInstanceId: string,
  fieldId: string
): Promise<number | null> {
  const [row] = await database
    .select({ valueNumber: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, lineInstanceId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .limit(1)
  return row?.valueNumber ?? null
}

/** Name what is blocking the edit, so the message says what to do about it. */
function describeEvidence(evidence: { hasReceipt: boolean; hasBillLine: boolean }): string {
  if (evidence.hasReceipt && evidence.hasBillLine) return 'a receipt and a vendor bill'
  if (evidence.hasReceipt) return 'a receipt'
  return 'a vendor bill'
}

/**
 * Lock a purchase order line's `quantity_ordered` and `expected_unit_price` once something
 * has happened against it (plans/purchasing/07-purchase-order-send-and-status.md §6.5).
 *
 * 🛑 **The predicate is EVIDENCE, not status.** The obvious rule — read-only once the order
 * is `issued` — is wrong in both directions. It is too strict, because real orders get
 * amended when a vendor discontinues a part, and if the only way to change an issued order
 * is delete-and-recreate then the receipts and the audit trail go with it. And it is too
 * loose, because §6.1 lets a `draft` order carry receipts (a vendor ships against a phone
 * call and the paperwork is keyed afterwards) and that order is genuinely unsafe to edit,
 * while an `issued` order nobody has shipped against is perfectly safe. So the lock keys off
 * `purchase_order_line_stock_movements` and `purchase_order_line_vendor_bill_lines` instead.
 * Adding new lines, and editing lines nothing has happened to, stays open at any status.
 *
 * The two concrete corruptions this prevents:
 *
 * 1. 🛑 **Editing `expected_unit_price` after a bill exists silently re-points the three-way
 *    match at a number the vendor never agreed to.** `match-hook.ts` compares the arriving
 *    bill line against exactly this field, so moving it moves the authority the control is
 *    checking against — the control then passes by definition. Same class as the defect where
 *    a receipt was written at a price nobody agreed to: the match reading the wrong authority,
 *    with nothing thrown.
 * 2. **Editing `quantity_ordered` after receipts exist makes the derived receipt status
 *    jump**, possibly backwards from `received` to `partially_received`, because that status
 *    is `quantity_received` measured against this number.
 *
 * ⚠️ **The proper answer to "the PDF the vendor holds no longer matches" is REVISIONS** —
 * amend, re-send, increment a revision number. `DocumentActionsCluster` already renders
 * Send/Resend, so re-sending costs nothing; version tracking is a real feature and is out of
 * scope. This lock is the interim, not the destination.
 *
 * ✅ **A write that does not change the value is allowed through.** A re-import of the same
 * row, or any surface that submits a whole line rather than a patch, restates these fields
 * unchanged — refusing that would block edits to the line's description or weight, which the
 * lock has no opinion about, and would make an idempotent import fail on its second run.
 *
 * ✅ **Sanctioned writers use `bypassFieldGuards`.** `fireFieldPreHooks` short-circuits on
 * `ctx.bypassFieldGuards.has(systemAttribute)` before this handler is reached, so a future
 * server-side writer of these fields opts out by naming the attribute there. As of today
 * there is none: an audit of every reference to both attributes found only readers
 * (`match-hook.ts`, `receive-purchase-order.ts`, `documents/payload.ts`, `totals-hooks.ts` —
 * which writes `line_total`, not these two). Both fields are purely human input, so nothing
 * legitimate is blocked by this guard.
 */
export const guardEvidenceLockedLineFields: FieldPreHookHandler = async (event) => {
  const lineInstanceId = parseRecordId(event.recordId).entityInstanceId

  // Evidence first: most lines have none, and that answers the whole question in one query.
  const evidence = await readEvidence(event.organizationId, lineInstanceId)
  if (!evidence.hasReceipt && !evidence.hasBillLine) return event.newValue

  const next = scalarOf(event.newValue)
  const nextNumber = next === null || next === undefined || next === '' ? null : Number(next)
  const stored = await readStoredNumber(event.organizationId, lineInstanceId, event.fieldId)
  if (nextNumber === stored) return event.newValue

  const label =
    event.systemAttribute === 'purchase_order_line_expected_unit_price'
      ? 'expected unit price'
      : 'ordered quantity'
  throw new ConflictError(
    `Cannot change the ${label} — ${describeEvidence(evidence)} has already been booked ` +
      'against this line. Add a new line, or reverse what was booked, and re-send the order.'
  )
}
