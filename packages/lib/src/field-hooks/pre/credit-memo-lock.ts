// packages/lib/src/field-hooks/pre/credit-memo-lock.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { readEditStamp } from '../../entity-instances/edit-snapshot'
import { ConflictError } from '../../errors'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type { EntityPreCreateHandler, EntityPreDeleteHandler, FieldPreHookHandler } from '../types'

/**
 * The `credit_memo` fields an issued memo freezes: whose credit it is, when it
 * takes effect, and what it credits.
 *
 * ⚠️ The header AMOUNTS are absent on purpose. `subtotal`, `tax_total` and
 * `total` are the totals hook's projection of the lines (74 D6) and are
 * `updatable: false` in the registry, so nobody can type them; freezing them
 * here would freeze the hook itself.
 */
export const CREDIT_MEMO_LOCKED_ATTRS = [
  'credit_memo_issued_at',
  'credit_memo_contact',
  'credit_memo_invoice',
  'credit_memo_order',
] as const satisfies readonly SystemAttribute[]

/** The `credit_memo_line` fields an issued memo's lines freeze. */
export const CREDIT_MEMO_LINE_LOCKED_ATTRS = [
  'credit_memo_line_qty',
  'credit_memo_line_unit_price',
  'credit_memo_line_subtotal',
  'credit_memo_line_tax_total',
  'credit_memo_line_line_item',
] as const satisfies readonly SystemAttribute[]

/** The line's link to its parent, resolved on every path this file guards. */
const LINE_PARENT_ATTR: SystemAttribute = 'credit_memo_line_credit_memo'

/**
 * An issued credit memo is READ-ONLY until somebody presses Edit (74 §1.3), in
 * `vendor-bill-lock.ts`'s shape.
 *
 * ```
 * draft ──[Issue]──▶ issued/settled ──[Edit]──▶ editing ──[Save]──▶ issued
 *  editable            locked                   editable           reverse + repost if changed
 *                      └──[Void]──▶ void
 * ```
 *
 * 🛑 The predicate is "not `draft`" AND no edit-snapshot row, on the MEMO —
 * never the line's own state. A `void` memo stays frozen whatever the row says:
 * Edit refuses a void memo, and a memo voided while an edit was open must not be
 * left writable by the row it could not clear.
 *
 * ⚠️ **What is deliberately NOT locked.** `credit_memo_status` (Void and the
 * settlement writer write it), the settlement mirrors (`amount_applied`,
 * `amount_refunded`, `balance` — applying a credit against an issued memo is the
 * ordinary case), and the annotations a bookkeeper may still fix: `reason`,
 * `note`, the line `description`, `disposition` and `sort_order`. None of them
 * changes what the entry says.
 */
export const guardIssuedCreditMemoFields: FieldPreHookHandler = async (event) => {
  const memoInstanceId = parseRecordId(event.recordId).entityInstanceId
  await refuseWhenLocked(
    event.organizationId,
    memoInstanceId,
    describeMemoField(event.systemAttribute)
  )
  return event.newValue
}

/** The same lock, reached through a line's parent. */
export const guardIssuedCreditMemoLineFields: FieldPreHookHandler = async (event) => {
  const lineInstanceId = parseRecordId(event.recordId).entityInstanceId
  const memoInstanceId = await readLineParent(event.organizationId, lineInstanceId)
  // A line with no parent yet is a draft row the builder has not attached.
  if (!memoInstanceId) return event.newValue
  await refuseWhenLocked(
    event.organizationId,
    memoInstanceId,
    describeLineField(event.systemAttribute)
  )
  return event.newValue
}

/** An issued memo gains no lines. */
export const guardIssuedCreditMemoLineCreate: EntityPreCreateHandler = async (event) => {
  const memoInstanceId = unwrapRelationId(
    event.values[LINE_PARENT_ATTR] ?? event.values.credit_memo_line_credit_memo
  )
  if (!memoInstanceId) return
  await refuseWhenLocked(event.organizationId, memoInstanceId, 'add a line')
}

/** And loses none. */
export const guardIssuedCreditMemoLineDelete: EntityPreDeleteHandler = async (event) => {
  const memoInstanceId = unwrapRelationId(event.values[LINE_PARENT_ATTR])
  if (!memoInstanceId) return
  await refuseWhenLocked(event.organizationId, memoInstanceId, 'remove a line')
}

/** The one refusal, named for the memo it is protecting. */
async function refuseWhenLocked(
  organizationId: string,
  memoInstanceId: string,
  what: string
): Promise<void> {
  const memo = await readMemoLockState(organizationId, memoInstanceId)
  if (!memo || memo.status === 'draft') return
  if (memo.status !== 'void' && (await readEditStamp(database, organizationId, memoInstanceId))) {
    return
  }

  throw new ConflictError(
    memo.status === 'void'
      ? `Credit memo ${memo.label} is void, so you cannot ${what}. Raise a new one instead.`
      : `Credit memo ${memo.label} is issued and in the books, so you cannot ${what}. Press Edit ` +
          'to unlock it, then Save to bring its entry up to date — or void it and raise a new one.',
    { creditMemoInstanceId: memoInstanceId, status: memo.status }
  )
}

/** The memo's stored lifecycle value and the number a refusal names it by. */
async function readMemoLockState(
  organizationId: string,
  memoInstanceId: string
): Promise<{ status: string; label: string } | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>(['credit_memo_status', 'credit_memo_number'])

  const statusField = fields.credit_memo_status
  if (!statusField) return null

  const fieldIds = [statusField.id, fields.credit_memo_number?.id].filter(
    (id): id is string => !!id
  )

  const rows = await database
    .select({
      fieldId: schema.FieldValue.fieldId,
      optionId: schema.FieldValue.optionId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, memoInstanceId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byField = new Map(rows.map((row) => [row.fieldId, row]))
  const status = byField.get(statusField.id)?.optionId
  if (!status) return null

  const label =
    (fields.credit_memo_number && byField.get(fields.credit_memo_number.id)?.valueText) ||
    'this memo'

  return { status, label }
}

/** The memo one line belongs to, or `undefined` while it belongs to none. */
async function readLineParent(
  organizationId: string,
  lineInstanceId: string
): Promise<string | undefined> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([LINE_PARENT_ATTR])
  const parentField = fields[LINE_PARENT_ATTR]
  if (!parentField) return undefined

  const [row] = await database
    .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, lineInstanceId),
        eq(schema.FieldValue.fieldId, parentField.id)
      )
    )
    .limit(1)
  return row?.relatedEntityId ?? undefined
}

/** What the person was trying to change, in the words on the screen. */
function describeMemoField(attribute: SystemAttribute): string {
  switch (attribute) {
    case 'credit_memo_issued_at':
      return 'change its date'
    case 'credit_memo_contact':
      return 'change its customer'
    case 'credit_memo_invoice':
      return 'change the invoice it credits'
    default:
      return 'change the order it credits'
  }
}

function describeLineField(attribute: SystemAttribute): string {
  switch (attribute) {
    case 'credit_memo_line_qty':
      return "change a line's quantity"
    case 'credit_memo_line_unit_price':
      return "change a line's unit price"
    case 'credit_memo_line_subtotal':
      return "change a line's amount"
    case 'credit_memo_line_tax_total':
      return "change a line's tax"
    default:
      return "change a line's invoice line"
  }
}
