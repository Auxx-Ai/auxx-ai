// packages/lib/src/money/fulfillments/writes.ts

/**
 * Creating, stamping and deleting `fulfillment` / `fulfillment_line` records.
 *
 * Writes only; the reads live in `reads.ts` (`docs/lib-module-guide.md` §5).
 * No permission checks - the router asserts and hands the narrowed input down
 * (§6). Every function here is imperative and THROWS an `AuxxError` on
 * refusal, rather than returning a `neverthrow` `Result`: every caller today
 * runs these deep inside its OWN transaction and its OWN `guard()`
 * (`money/orders/fulfill.ts`'s `fulfillOrder`), the same posture
 * `stock-movements/write-movements.ts` takes for the same reason - a second
 * Result wrapper here would just get unwrapped one line later.
 *
 * 🛑 **None of these open a transaction.** {@link createFulfillment} is meant
 * to run INSIDE the caller's existing transaction (brief §6.1): a fulfillment
 * and its lines are two ordinary inserts with no lost-update hazard between
 * them, unlike the JSON cell this replaces, so the caller's own transaction
 * boundary is all the atomicity this needs.
 */

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import type { CreatedFulfillment, CreateFulfillmentInput, FulfillmentPostingStamp } from './types'

/**
 * Create one `fulfillment` record and its `fulfillment_line` children.
 *
 * The parent is created first so its `RecordId` can be handed to every line as
 * the owning side of `fulfillment_line_fulfillment` - the same order
 * `createCreditMemo` (`money/credit-memos/writes.ts`) creates a memo before
 * its lines. `fulfillment_lines` (the has_many INVERSE on `fulfillment`) is
 * never written directly: the belongs_to side is the one that carries a
 * `FieldValue` row, and the has_many side resolves from it.
 *
 * @throws `UnprocessableEntityError` naming the failed line when a line
 *   refuses to create. The caller's own transaction rolls back the parent
 *   with it - there is no partial fulfillment left behind.
 */
export async function createFulfillment(
  db: Database,
  input: CreateFulfillmentInput
): Promise<CreatedFulfillment> {
  const { organizationId, actorUserId } = input
  const handler = new UnifiedCrudHandler(organizationId, actorUserId, db)

  const header: Record<string, unknown> = {
    fulfillment_order: toRecordId('order', input.orderInstanceId),
    fulfillment_sequence: input.sequence,
    fulfillment_shipped_at: input.shippedAt,
    fulfillment_status: input.status,
    fulfillment_name: input.name,
    fulfillment_subtotal: input.subtotalMinor,
    fulfillment_total: input.totalMinor,
    fulfillment_shipping_recognised: input.shippingRecognised,
    fulfillment_recorded_at: input.recordedAt,
  }
  if (input.cancelledAt) header.fulfillment_cancelled_at = input.cancelledAt
  if (input.trackingNumber) header.fulfillment_tracking_number = input.trackingNumber
  if (input.trackingCompany) header.fulfillment_tracking_company = input.trackingCompany
  if (input.trackingUrl) header.fulfillment_tracking_url = input.trackingUrl

  const created = await handler.create('fulfillment', header)
  const fulfillmentInstanceId = created.instance.id
  const recordId = toRecordId('fulfillment', fulfillmentInstanceId)

  const lineItems = input.lines.map((line) => ({
    fulfillment_line_fulfillment: recordId,
    fulfillment_line_line_item: toRecordId('line_item', line.lineItemInstanceId),
    fulfillment_line_quantity: line.quantity,
  }))
  const { created: createdLines, errors } = await handler.bulkCreate('fulfillment_line', lineItems)
  if (errors.length > 0) {
    const first = errors[0]!
    throw new UnprocessableEntityError(
      `Fulfillment line ${first.index + 1} could not be created: ${first.error}`,
      { fulfillmentInstanceId }
    )
  }

  return {
    fulfillmentInstanceId,
    recordId,
    lineInstanceIds: createdLines.map((line) => line.id),
  }
}

/**
 * Write a posting's identity - and, when the poster recomputed them, its
 * amounts - onto one fulfillment record.
 *
 * 🛑 An ORDINARY scalar field write, not a JSON cell: no lock, no envelope, no
 * read-modify-write. Entity migration 153's whole point was to make this
 * true - see `credit-memo-posting/run.ts`'s `creditMemoStampWriter`, which
 * made the identical move for `credit_memo_gl_posting` and is the precedent
 * this copies.
 */
export async function stampFulfillmentPosting(
  db: Database,
  params: {
    organizationId: string
    /** Who the write is attributed to. The `systemUser` for an unattended run. */
    actorUserId: string
    fulfillmentInstanceId: string
    patch: FulfillmentPostingStamp
  }
): Promise<void> {
  const { organizationId, actorUserId, fulfillmentInstanceId, patch } = params
  const handler = new UnifiedCrudHandler(organizationId, actorUserId, db)
  const recordId = toRecordId('fulfillment', fulfillmentInstanceId)

  const values: Record<string, unknown> = {
    fulfillment_gl_posting: patch.glPosting,
    fulfillment_doc_number: patch.docNumber,
  }
  if (patch.totalMinor !== undefined) values.fulfillment_total = patch.totalMinor
  if (patch.subtotalMinor !== undefined) values.fulfillment_subtotal = patch.subtotalMinor

  await handler.update(recordId, values)
}

/**
 * Delete a fulfillment record outright, taking its lines with it.
 *
 * `fulfillment_lines` declares `onDelete: 'cascade'`
 * (`resources/registry/resources/fulfillment-fields.ts`), so the delete
 * engine removes every `fulfillment_line` row itself - this never touches
 * them by hand.
 *
 * The rollback path for a shipment whose posting the ledger refused
 * (`money/orders/fulfill.ts`'s `rollbackFulfillment`, brief §6.1): the record
 * was already committed by the time `postEntry`'s network round trip returns,
 * so undoing it is a second, compensating write - not something the original
 * transaction can roll back for free.
 */
export async function deleteFulfillment(
  db: Database,
  params: { organizationId: string; actorUserId: string; fulfillmentInstanceId: string }
): Promise<void> {
  const { organizationId, actorUserId, fulfillmentInstanceId } = params
  const handler = new UnifiedCrudHandler(organizationId, actorUserId, db)
  const { count, errors } = await handler.bulkDelete([
    toRecordId('fulfillment', fulfillmentInstanceId),
  ])
  // 🛑 Checked rather than trusted silent, per this whole brief's lesson about
  // a write that reports success over nothing actually written: a rollback
  // that silently failed to remove the shipment would leave it recognised in
  // revenue with no posting behind it, and nothing downstream would notice.
  if (count === 0 || errors.length > 0) {
    throw new UnprocessableEntityError(
      `Failed to roll back fulfillment ${fulfillmentInstanceId}: ` +
        (errors[0]?.message ?? 'nothing was deleted'),
      { fulfillmentInstanceId }
    )
  }
}
