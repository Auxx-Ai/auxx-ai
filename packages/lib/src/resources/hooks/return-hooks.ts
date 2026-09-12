// packages/lib/src/resources/hooks/return-hooks.ts

/**
 * System hooks for `return` and `return_line` (plans/money/tasks/54-returns.md
 * sections 3.3, 3.5 and 4.2).
 *
 * Four behaviours, in the order the plan introduces them:
 *
 * 1. `RMA-` numbering on `return_number`, the same `keepOrAllocateRecordNumber`
 *    wiring `credit_memo` uses for `CM-`.
 * 2. The PHYSICAL lifecycle graph on `return_status`.
 * 3. `contact` derived from `ticket` on create, because `computePresetValues`
 *    seeds exactly one field.
 * 4. The cross-return over-return guard on `return_line`.
 *
 * ⚠️ **This chain is coverage, not the enforcement point.** `runPreHooks` fires
 * only for writes through `UnifiedCrudHandler` - `record.create`,
 * `record.update`, the bulk record writes, the CSV importer and the SDK. The
 * drawer, the grid's inline edit and a kanban drag all write through
 * `fieldValue.set` -> `FieldValueService`, which never reads this registry.
 * Both status and the over-return guard therefore need a `field-hooks/pre/`
 * twin before they are genuinely un-typeable; that file is not in this change's
 * ownership (see `field-hooks/pre/lifecycle-status-guard.ts` for the same
 * finding recorded against `quote_status`).
 */

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import {
  checkOverReturn,
  type InvalidReturnQuantityError,
  type OverReturnError,
  type ReturnedQuantityClaim,
} from '../../returns'
import { readReturnCeiling, readReturnedQuantityClaims } from '../../returns/reads'
import { getAmbientWriteDb } from '../crud/write-session-als'
import { unwrapRelationId, unwrapStatusValue } from '../events/captured-values'
import { isRecordId, type RecordId, toRecordId } from '../resource-id'
import { keepOrAllocateRecordNumber } from './record-number-hook'
import type { SystemHook, SystemHookContext, SystemHookRegistry } from './types'

const logger = createScopedLogger('resources:return-hooks')

// ─── (a) RMA- allocation ─────────────────────────────────────────────────────

/**
 * Number the return on create: `RMA-0001` off the `return` sequence scope.
 *
 * Identical in shape to `autoGenerateCreditMemoNumber`, including the "theirs if
 * they bring one" rule, although nothing external supplies a return number -
 * returns do not arrive through the sales channel - so in practice the hook
 * always allocates ours. `return_number` is `creatable: false, updatable: false`
 * precisely so this hook is its only writer.
 */
const autoGenerateReturnNumber: SystemHook = (context) =>
  keepOrAllocateRecordNumber(context, 'return')

// ─── (b) the physical lifecycle ──────────────────────────────────────────────

/**
 * The two statuses a return may be CREATED in (plan section 3.3).
 *
 * An emailed or phoned return enters at `requested`. A dock surprise - about
 * 15% of Auxx-Lift's returns - enters at `received` with `contact` null,
 * because the pallet is on the floor before anyone knows whose it is. One line,
 * two entry points, and nothing else is a legal starting state.
 */
export const RETURN_ENTRY_STATUSES = ['requested', 'received'] as const

/**
 * The legal `return_status` edges (plan section 3.3):
 *
 * ```
 * requested -> approved -> in_transit -> received -> inspected -> closed
 *                    \-> declined          \-> cancelled
 * ```
 *
 * 🛑 **This is the PHYSICAL axis only.** There is deliberately no `resolved`
 * and no money value of any kind: the refund routinely completes before the
 * warehouse restocks, so on the day the money clears the return is neither
 * `resolved` nor merely `received`. Money is DERIVED from the linked credit
 * memos (`return_credited_amount`), and "credited but not inspected" is a
 * one-line derivation the UI surfaces as a badge rather than a state here.
 *
 * ⚠️ **Where this table is wider than the diagram, and why.** The diagram hangs
 * `declined` and `cancelled` off single nodes, but a return is declined while
 * it is still a request far more often than after approval, and a shipment can
 * be called off at any point before it is inspected. Both off-ramps are
 * therefore reachable from every state that precedes them, and the spine is
 * exactly as drawn. The three terminals accept nothing.
 *
 * A write of the value a record already holds is always allowed - an idempotent
 * re-save must not be refused - and that is handled by the guard, not by
 * listing every state as its own successor.
 */
export const RETURN_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  requested: ['approved', 'declined', 'cancelled'],
  approved: ['in_transit', 'declined', 'cancelled'],
  in_transit: ['received', 'cancelled'],
  received: ['inspected', 'cancelled'],
  inspected: ['closed'],
  closed: [],
  declined: [],
  cancelled: [],
}

/** Human-readable list of the states a record may move to next. */
function describeAllowed(allowed: readonly string[]): string {
  if (allowed.length === 0) return 'nothing - it is a final state'
  return allowed.join(', ')
}

/**
 * Refuse an illegal move on the physical lifecycle.
 *
 * On create the value must be one of {@link RETURN_ENTRY_STATUSES}; on update
 * the edge must be in {@link RETURN_STATUS_TRANSITIONS}.
 *
 * ⚠️ Fails OPEN when the current status cannot be read, or when it is a value
 * the table does not know. A transition guard that bricks every edit because a
 * read failed is worse than one that misses an edge, and an unrecognised
 * current value is a data problem for the enum validator, not for this hook.
 */
const guardReturnStatusTransition: SystemHook = async (context) => {
  const { operation, field, values, existingInstance, organizationId, userId } = context

  const next = readStatusFromValues(field, values)
  if (next === undefined) return values

  if (operation === 'create') {
    if (!(RETURN_ENTRY_STATUSES as readonly string[]).includes(next)) {
      throw new BadRequestError(
        `A return starts at ${RETURN_ENTRY_STATUSES.join(' or ')}, not at ${next}.`
      )
    }
    return values
  }

  if (!existingInstance) return values

  const current = await readCurrentReturnStatus({
    organizationId,
    userId,
    recordId: toRecordId(existingInstance.entityDefinitionId, existingInstance.id),
  })
  if (current === null || current === next) return values

  const allowed = RETURN_STATUS_TRANSITIONS[current]
  if (!allowed) return values

  if (!allowed.includes(next)) {
    throw new BadRequestError(
      `A return cannot move from ${current} to ${next}. From ${current} it can go to ` +
        `${describeAllowed(allowed)}.`
    )
  }
  return values
}

/**
 * The status being written, as a bare string, or `undefined` when this write
 * does not touch the field.
 *
 * The value may be keyed by `field.id` OR by `systemAttribute`, and may arrive
 * scalar or as a single-element array - `runPreHooks` checks both keys before
 * dispatching, so a reader that handled one would be silently bypassed by half
 * the callers.
 */
function readStatusFromValues(
  field: SystemHookContext['field'],
  values: Record<string, unknown>
): string | undefined {
  const key = field.id in values ? field.id : (field.systemAttribute ?? '')
  if (!(key in values)) return undefined
  const unwrapped = unwrapStatusValue(values[key])
  return typeof unwrapped === 'string' && unwrapped !== '' ? unwrapped : undefined
}

/** The return's stored `return_status`, or `null` when it cannot be read. */
async function readCurrentReturnStatus(params: {
  organizationId: string
  userId: string
  recordId: RecordId
}): Promise<string | null> {
  const { organizationId, userId, recordId } = params
  try {
    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['return_status'] as const)
    const statusField = fields.return_status
    if (!statusField) return null

    const stored = await new FieldValueService(organizationId, userId).getValues({
      recordId,
      fieldIds: [statusField.id],
    })
    const typed = firstValue(stored.get(statusField.id))
    return typed?.type === 'option' ? typed.optionId : null
  } catch (error) {
    logger.warn('could not read return_status - allowing the transition', {
      organizationId,
      recordId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ─── (c) contact derived from the ticket ─────────────────────────────────────

/**
 * Fill `contact` from `ticket.contact` on create (plan section 4.2).
 *
 * `computePresetValues` returns `{ [inverseFieldId]: [recordId] }` and nothing
 * more, so a return created from a ticket drawer arrives with the ticket set
 * and the customer blank even though the ticket already knows who it is. The
 * agent would then re-pick a contact the system already had.
 *
 * 🛑 **Targeted, and deliberately not a generalisation of
 * `computePresetValues`** - that runs for every relationship field in the
 * product and a broader rule would have effects nobody is looking for.
 *
 * ⚠️ **Registered under `return_ticket`, not `return_contact`.** `runPreHooks`
 * skips a hook on UPDATE unless its own registered attribute is present in
 * `values`, and on CREATE it runs every hook regardless - so keying it on the
 * ticket is what makes the create-from-ticket path fire at all.
 *
 * ✅ Create only. On update the existing `contact` is not in `values`, so
 * deciding "is it empty" would cost a second read to answer a question the
 * plan does not ask: section 4.2 is about the creation route.
 *
 * ⤵️ **The "propose the single candidate order" half is NOT implemented.**
 * It needs a query for the contact's orders plus a definition of "candidate"
 * (open? recent? containing the returned part?) that the plan does not give,
 * and guessing an order onto a money document from a hook is the wrong place
 * to be wrong. The plan marks it optional; `return_order` stays blank.
 */
const deriveContactFromTicket: SystemHook = async (context) => {
  const { operation, field, values, organizationId, userId, allFields } = context
  if (operation !== 'create') return values

  const contactField = allFields.find((f) => f.systemAttribute === 'return_contact')
  if (!contactField) return values

  // An explicit contact in the same write wins - it is the human's answer.
  if (isPresent(values[contactField.id]) || isPresent(values.return_contact)) return values

  const ticketKey = field.id in values ? field.id : (field.systemAttribute ?? '')
  if (!(ticketKey in values)) return values

  const ticketRecordId = readRecordId(values[ticketKey])
  if (!ticketRecordId) return values

  const contact = await resolveTicketContact({ organizationId, userId, ticketRecordId })
  if (!contact) return values

  return { ...values, [contactField.id]: contact }
}

/**
 * Read `ticket_contact` off a ticket, or `null` when there is none and when the
 * read fails.
 *
 * A convenience derivation must never block the create it rides on, which is
 * why a failure is a warning and an unset contact rather than a throw.
 */
async function resolveTicketContact(params: {
  organizationId: string
  userId: string
  ticketRecordId: RecordId
}): Promise<RecordId | null> {
  const { organizationId, userId, ticketRecordId } = params
  try {
    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['ticket_contact'] as const)
    const contactField = fields.ticket_contact
    if (!contactField) return null

    const stored = await new FieldValueService(organizationId, userId).getValues({
      recordId: ticketRecordId,
      fieldIds: [contactField.id],
    })
    const typed = firstValue(stored.get(contactField.id))
    if (typed?.type === 'relationship' && typed.recordId) return typed.recordId
    return null
  } catch (error) {
    logger.warn('could not resolve ticket_contact - leaving return_contact unset', {
      organizationId,
      ticketRecordId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ─── (d) the over-return guard ───────────────────────────────────────────────

/** What {@link checkReturnLineAgainstSoldLine} is asked to decide. */
export interface ReturnLineCeilingCheckInput {
  organizationId: string
  /** The `line_item` entity-instance id the return line points at. */
  lineItemInstanceId: string
  /** The `return_line` being edited, so its own prior row is not double-counted. */
  returnLineInstanceId?: string | null
  /** Units this write wants on the row. */
  quantity: number
}

/**
 * Refuse a `return_line` that would bring back more than the sold line let out
 * (plan section 3.5).
 *
 * The arithmetic is `checkOverReturn`; this function is only the read in front
 * of it - the ceiling and the sum of every OTHER `return_line` pointing at the
 * same sold line, across every return. Several return lines legitimately point
 * at one sold line (the grain is one row per sold line PER CONDITION), which is
 * what makes a per-row check useless and the cross-return sum necessary.
 *
 * ⚠️ **The ceiling is the SOLD quantity today.** Plan section 3.5 wants it
 * bounded on what the line SHIPPED, which needs per-dispatch shipped quantities
 * from task 55; that work is in flight elsewhere. `checkOverReturn` takes the
 * ceiling as a parameter for exactly this reason, so swapping the number later
 * touches this function and nothing else. Sold quantity is never LOOSER than
 * the old rule and stays the documented fallback for any line with no dispatch
 * records at all.
 *
 * ✅ Returns `ok` when NOTHING records a ceiling for the line. An unknown
 * ceiling is not a violation, and refusing a write because a bound could not be
 * established would block legitimate returns on incomplete data.
 *
 * 🛑 Unknown is null, not zero. `readReturnCeiling` answers `null` when neither
 * the dispatches nor `line_item_qty` say anything; a ceiling of `0` is a real
 * bound and does refuse. Collapsing the two turns this guard into a wall
 * against every line whose quantity was never recorded.
 *
 * @param db - Connection or open transaction. Pass the ambient write db so the
 *   read sees rows the write in flight has not committed yet.
 */
export async function checkReturnLineAgainstSoldLine(
  db: Database | Transaction,
  input: ReturnLineCeilingCheckInput
): Promise<Result<void, OverReturnError | InvalidReturnQuantityError>> {
  const { organizationId, lineItemInstanceId, returnLineInstanceId, quantity } = input

  // 🔑 Both reads come from `returns/reads.ts`, which owns them. This hook
  // carried its own copy of each, bounded on SOLD quantity. `readReturnCeiling`
  // bounds on SHIPPED - Sigma `fulfillment_line_quantity`, cancelled dispatches
  // excluded - and falls back to sold only when the line has no fulfillment
  // lines at all. Shipped is the correct ceiling: a line ordered 5 and shipped 2
  // can have at most 2 come back (plans/money/tasks/54-returns.md section 3.5).
  const { ceiling } = await readReturnCeiling(db, organizationId, lineItemInstanceId)
  // 🛑 Fails OPEN on an unknown ceiling, and null is not zero. A line nobody
  // recorded a quantity for has no ceiling to breach; refusing there would be a
  // wall built out of missing data. Zero, by contrast, is a real ceiling and
  // does refuse.
  if (ceiling === null) return ok(undefined)
  const existing = await readReturnedQuantityClaims(db, organizationId, lineItemInstanceId)

  return checkOverReturn({
    lineItemId: lineItemInstanceId,
    ceiling,
    existing,
    candidate: { returnLineId: returnLineInstanceId, quantity },
  })
}

/**
 * The pre-write half of the over-return guard.
 *
 * ⚠️ **Registered under BOTH `return_line_quantity` and
 * `return_line_line_item`.** `runPreHooks` skips a hook on UPDATE unless its own
 * registered attribute is in `values`, and either field changing can breach the
 * ceiling: raising the quantity, or re-pointing the row at a different sold
 * line. When a write touches both, the hook simply runs twice - it is a
 * read-only check and the second pass reaches the same verdict.
 *
 * A row with no `line_item` is not bounded by anything: the guard is defined
 * per sold line, and a manually keyed return with no order has none.
 */
const guardOverReturn: SystemHook = async (context) => {
  const { operation, values, existingInstance, organizationId, userId, allFields } = context

  const quantityField = allFields.find((f) => f.systemAttribute === 'return_line_quantity')
  const lineItemField = allFields.find((f) => f.systemAttribute === 'return_line_line_item')
  if (!quantityField || !lineItemField) return values

  const quantityKey = keyIn(values, quantityField.id, 'return_line_quantity')
  const lineItemKey = keyIn(values, lineItemField.id, 'return_line_line_item')

  let quantity = quantityKey === null ? null : readNumber(values[quantityKey])
  let lineItemInstanceId =
    lineItemKey === null ? null : (unwrapRelationId(values[lineItemKey]) ?? null)

  // An update may change only one of the two; the other comes off the stored row.
  if (
    operation === 'update' &&
    existingInstance &&
    (quantityKey === null || lineItemKey === null)
  ) {
    const stored = await readStoredReturnLine({
      organizationId,
      userId,
      recordId: toRecordId(existingInstance.entityDefinitionId, existingInstance.id),
      quantityFieldId: quantityField.id,
      lineItemFieldId: lineItemField.id,
    })
    if (quantityKey === null) quantity = stored.quantity
    if (lineItemKey === null) lineItemInstanceId = stored.lineItemInstanceId
  }

  if (quantity === null || lineItemInstanceId === null) return values

  const db = getAmbientWriteDb() ?? database
  const verdict = await checkReturnLineAgainstSoldLine(db, {
    organizationId,
    lineItemInstanceId,
    returnLineInstanceId: existingInstance?.id ?? null,
    quantity,
  })
  if (verdict.isErr()) throw verdict.error

  return values
}

/** The stored `quantity` and `lineItem` of a return line being updated. */
async function readStoredReturnLine(params: {
  organizationId: string
  userId: string
  recordId: RecordId
  quantityFieldId: string
  lineItemFieldId: string
}): Promise<{ quantity: number | null; lineItemInstanceId: string | null }> {
  const { organizationId, userId, recordId, quantityFieldId, lineItemFieldId } = params
  const stored = await new FieldValueService(organizationId, userId).getValues({
    recordId,
    fieldIds: [quantityFieldId, lineItemFieldId],
  })

  const quantityValue = firstValue(stored.get(quantityFieldId))
  const lineItemValue = firstValue(stored.get(lineItemFieldId))

  return {
    quantity: quantityValue?.type === 'number' ? quantityValue.value : null,
    lineItemInstanceId:
      lineItemValue?.type === 'relationship'
        ? (unwrapRelationId(lineItemValue.recordId) ?? null)
        : null,
  }
}

// ─── shared readers ──────────────────────────────────────────────────────────

/** Which of the two accepted keys carries this field, or `null` for neither. */
function keyIn(
  values: Record<string, unknown>,
  fieldId: string,
  systemAttribute: string
): string | null {
  if (fieldId in values) return fieldId
  if (systemAttribute in values) return systemAttribute
  return null
}

/** `getValues` hands back a scalar or an array depending on the field. */
function firstValue(entry: TypedFieldValue | TypedFieldValue[] | undefined) {
  return Array.isArray(entry) ? entry[0] : entry
}

/** A write-time number, accepting the numeric string the CSV importer sends. */
function readNumber(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Read a full `RecordId` out of a write-time relationship value.
 *
 * A bare entity-instance id is deliberately NOT accepted: the caller needs a
 * `RecordId` to read the related record's own fields, and there is no way back
 * to the definition half from an instance id alone.
 */
function readRecordId(raw: unknown): RecordId | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string') return isRecordId(value) ? value : null
  if (value && typeof value === 'object' && 'recordId' in value) {
    const inner = (value as { recordId?: unknown }).recordId
    return typeof inner === 'string' && isRecordId(inner) ? inner : null
  }
  return null
}

/** Present means "the caller actually set something", not merely "key exists". */
function isPresent(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false
  if (Array.isArray(raw)) return raw.some((entry) => isPresent(entry))
  if (typeof raw === 'string') return raw.trim() !== ''
  return true
}

// ─── registries ──────────────────────────────────────────────────────────────

/**
 * System hooks for `return`.
 *
 * ⚠️ Registering the file is not enough - `HOOKS_BY_ENTITY_TYPE` in
 * `system-hooks.ts` returns `{}` for an unregistered entity type rather than
 * failing, which is how `order_number` stayed NULL for three PRs.
 */
export const RETURN_HOOKS: SystemHookRegistry = {
  return_number: [autoGenerateReturnNumber],
  return_status: [guardReturnStatusTransition],
  return_ticket: [deriveContactFromTicket],
}

/**
 * System hooks for `return_line`.
 *
 * A SEPARATE registry keyed on its own entity type, the way
 * `PURCHASE_ORDER_HOOKS` / `VENDOR_BILL_HOOKS` are - `credit_memo_line` has no
 * hooks at all, so `credit-memo-hooks.ts` exports only the parent's.
 */
export const RETURN_LINE_HOOKS: SystemHookRegistry = {
  return_line_quantity: [guardOverReturn],
  return_line_line_item: [guardOverReturn],
}
