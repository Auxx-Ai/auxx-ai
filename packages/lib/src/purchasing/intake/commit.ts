// packages/lib/src/purchasing/intake/commit.ts

/**
 * Step 4 (plans/money/tasks/38 §6.3): the draft becomes records.
 *
 * 🛑 **Through the generic create path, never a bespoke insert.** Nothing in the
 * purchasing router creates a purchase order today; POs are created through the
 * entity dialog, and `purchase_order_number` is `creatable: false`, minted by the
 * RecordSequence hook. `UnifiedCrudHandler.create` is where that hook fires, so
 * an insert of our own would produce an order with no number.
 *
 * 🛑 **`create` in a loop for the lines, never `bulkCreate`.** `bulkCreate` drops
 * `absorbInto`, and without it every line announces itself as its own `created`
 * event beside the parent that already announced them.
 *
 * 🛑 **A relationship value is a `RecordId` string**, never a bare instance id: a
 * bare id is silently swallowed on create, so the line would come back missing
 * the part it was created with.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseFileRef } from '@auxx/types/file-ref'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { convertTempAssetToPermanent } from '../../files/assets/asset-mutations'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { findVendorPartForLine } from '../vendor-part-lookup'
import type { IntakeCommitInput, IntakeDraftPayload, IntakeLine, IntakeWriteBack } from './client'
import { orderableLines, unresolvedLines } from './client'
import { markIntakeDraftCommitted } from './draft-mutations'
import { readStoredIntakeDraft } from './draft-queries'
import { guard } from './guard'

const logger = createScopedLogger('purchasing:intake:commit')

/** What the commit produced. `number` is the RecordSequence-minted `PO-…`. */
export interface IntakeCommitResult {
  purchaseOrderInstanceId: string
  recordId: RecordId
  number: string | null
  /**
   * What the accepted write-backs actually did, counted separately.
   *
   * 🛑 The two are different acts and the log must be able to tell them apart
   * afterwards. `updated` sets one field on a `vendor_part` that already existed;
   * `created` mints a NEW catalogue entry that then feeds price prefills,
   * preferred-vendor reads and part-cost recalculation. `failed` is the third
   * outcome and is deliberately not fatal — see the loop.
   *
   * The commit dialog predicts this split before anything is written; this is
   * what happened, and the two disagreeing is worth knowing about.
   */
  writeBacks: WriteBackTally
}

/** @see IntakeCommitResult.writeBacks */
export interface WriteBackTally {
  created: number
  updated: number
  failed: number
}

/** Which branch {@link applyWriteBack} took. */
type WriteBackOutcome = 'created' | 'updated'

/** Drop the keys the create path should never see as an explicit `null`. */
function defined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined)
  )
}

/**
 * Header values for the purchase order.
 *
 * ✅ **Folds are already in `shippingCents` / `taxCents`.** A line marked
 * `foldedInto` never becomes a purchase order line — its amount moved to the
 * header on the review screen (§5.4), which is why freight has somewhere to go
 * at all: there is no part to satisfy `purchase_order_line`'s natural key with,
 * and minting a `part` called "Freight" would put a fiction in the catalogue
 * where it then values movements and re-SUMs into QoH forever.
 */
function headerValues(payload: IntakeDraftPayload, assetRef: string): Record<string, unknown> {
  return defined({
    purchase_order_vendor: payload.vendorRecordId,
    purchase_order_currency: payload.currency,
    purchase_order_reference: payload.quoteNumber,
    purchase_order_expected_at: payload.expectedDeliveryDate,
    purchase_order_shipping_total: payload.shippingCents,
    purchase_order_tax_total: payload.taxCents,
    // INTERNAL by default: nothing here enters the PO's outbound payload unless
    // it is explicitly chosen, which is what we want — the vendor's own quote
    // must not go back to that vendor stapled to our order.
    purchase_order_attachments: [{ ref: assetRef }],
  })
}

function lineValues(
  line: IntakeLine,
  purchaseOrderRecordId: RecordId,
  index: number
): Record<string, unknown> {
  return defined({
    purchase_order_line_purchase_order: purchaseOrderRecordId,
    purchase_order_line_part: line.partRecordId,
    purchase_order_line_vendor_part: line.vendorPartRecordId,
    purchase_order_line_description: line.description,
    purchase_order_line_quantity_ordered: line.quantity,
    purchase_order_line_expected_unit_price: line.unitPriceCents,
    purchase_order_line_sort_order: index,
  })
}

/**
 * Teach the vendor's own code for a part, so the next quote matches on tier 1.
 *
 * 🛑 Per line and unchecked by default upstream (§5.3). A vendor's printed line
 * code is sometimes their order number rather than their part number, and
 * writing that as a `vendorSku` poisons every future tier-1 match. This function
 * applies what a person accepted; it never decides.
 *
 * Creates the `(part, supplier)` row when the pair has none — which is the
 * common case, since the supplier-price importer that created 206 of the 215
 * live `vendor_part` rows did not carry the vendor's part number with it.
 */
async function applyWriteBack(
  db: Database,
  handler: UnifiedCrudHandler,
  organizationId: string,
  vendorRecordId: RecordId,
  writeBack: IntakeWriteBack
): Promise<WriteBackOutcome> {
  const partInstanceId = parseRecordId(writeBack.partRecordId).entityInstanceId
  const vendorInstanceId = parseRecordId(vendorRecordId).entityInstanceId

  const existing = await findVendorPartForLine(db, organizationId, {
    partInstanceId,
    vendorInstanceId,
  })
  if (existing.isErr()) throw existing.error

  if (existing.value) {
    await handler.update(existing.value.vendorPartRecordId, {
      vendor_part_vendor_sku: writeBack.vendorSku,
    })
    return 'updated'
  }

  await handler.create('vendor_part', {
    vendor_part_part: writeBack.partRecordId,
    vendor_part_contact: vendorRecordId,
    vendor_part_vendor_sku: writeBack.vendorSku,
  })
  return 'created'
}

/**
 * Turn a ready draft into a purchase order, its lines, and its attachment.
 *
 * 🛑 **The gate is hard.** `purchase_order_line.part` is `required: true` and leg
 * 2 of the natural key `(purchaseOrder, part)`, so a part-less line is rejected
 * at create. Refusing here — naming the count — beats letting the create path
 * reject it after the header is already written and the transcription is spent.
 * The three legal endings for an unresolved row are pick a part, create one, or
 * fold the amount into the header.
 */
export async function commitIntakeDraft(
  db: Database,
  organizationId: string,
  userId: string,
  input: IntakeCommitInput
): Promise<Result<IntakeCommitResult, Error>> {
  return guard(
    async () => {
      // 🛑 Keyed by the CALLER's organizationId. That key prefix is the whole
      // org scope — there is no row predicate behind it — so a draft id from
      // another org resolves to nothing rather than to somebody else's quote.
      const draft = await readStoredIntakeDraft(organizationId, input.draftId)
      if (!draft) throw new NotFoundError('Quote draft not found')
      // 🛑 The idempotency guard. Somebody double-clicking the button, or a
      // retried request, must be told which order already exists — never handed
      // a second one. Sending a vendor two copies of the same order is the worst
      // outcome this feature has.
      if (draft.status === 'committed') {
        throw new ConflictError(
          `This quote is already purchase order ${draft.purchaseOrderInstanceId ?? 'that was created earlier'}`,
          { purchaseOrderInstanceId: draft.purchaseOrderInstanceId ?? undefined }
        )
      }

      const payload = draft.payload
      if (!payload) throw new UnprocessableEntityError('This quote has not been read yet')
      if (!payload.vendorRecordId) {
        throw new UnprocessableEntityError('Pick the vendor before creating the purchase order')
      }

      const blocking = unresolvedLines(payload.lines)
      if (blocking.length > 0) {
        throw new UnprocessableEntityError(
          `${blocking.length} ${blocking.length === 1 ? 'line still needs' : 'lines still need'} a part`
        )
      }

      const lines = orderableLines(payload.lines)
      const handler = new UnifiedCrudHandler(organizationId, userId, db)

      const order = await handler.create('purchase_order', headerValues(payload, draft.assetRef))
      const purchaseOrderRecordId = order.recordId

      // `absorbInto` on every line: the parent's own `record:created` announces
      // them, so no separate create door opens per line.
      for (const [index, line] of lines.entries()) {
        await handler.create(
          'purchase_order_line',
          lineValues(line, purchaseOrderRecordId, index),
          { absorbInto: purchaseOrderRecordId }
        )
      }

      // ⚠️ THE ORDERING HERE IS THE OPPOSITE OF THE OBVIOUS ONE. Do not "tidy"
      // it. The draft is marked committed AFTER the order and its lines exist
      // and BEFORE anything else, because that is the only point where neither
      // failure mode hurts:
      //
      //   - Marking BEFORE the create would strand a draft whose create failed
      //     in a state that can never be committed and can only be discarded.
      //   - Marking AFTER the write-backs (or not at all, relying on a delete)
      //     leaves a window where the records exist and the draft still reads
      //     `ready` — so a retry mints a SECOND purchase order and the vendor
      //     gets two copies of the same order.
      //
      // 🛑 The key is never deleted here. The 24-hour TTL reaps it, which is the
      // whole reason the draft lives in Redis; a delete that failed would put us
      // straight back in the second case above.
      const marked = await markIntakeDraftCommitted(organizationId, draft.id, order.instance.id)
      if (marked.isErr()) throw marked.error

      // ⚠️ EVERYTHING FROM HERE DOWN IS BEST-EFFORT, AND THE CATCHES BELOW MUST
      // NOT BE "FIXED" INTO RETHROWS. The order is the thing the user asked for
      // and it is already real, with a real number. Reporting failure for work
      // that succeeded is not a smaller bug than the one being reported: the
      // person retries, is told "this quote is already PO-1042", reads that as
      // broken, and creates the order by hand — which is exactly the duplicate
      // order the ordering constraint above exists to prevent, arriving through
      // the front door instead.

      // 🛑 The custom-field upload door leaves every asset `kind: 'TEMP_UPLOAD'`
      // with a 24-hour `expiresAt`, and nothing on that path ever clears it.
      // Without this the committed order's attachment is on a fuse.
      //
      // ⚠️ That fuse is a PRE-EXISTING, PRODUCT-WIDE defect, not something intake
      // introduced: `convertTempAssetToPermanent` is never called on the
      // custom-field upload path at all, so every field upload in the product is
      // already in this state (`docs/files-upload-architecture-guide.md` §12).
      // Intake calling it is intake being better-behaved than the rest of the
      // app — so a failure here returns us to the status quo, not to a broken
      // state, and the recovery is the user re-uploading a PDF they still have.
      const { sourceType, id: assetId } = parseFileRef(draft.assetRef as never)
      if (sourceType === 'asset' && assetId) {
        try {
          const converted = await convertTempAssetToPermanent(
            { db, organizationId },
            assetId,
            'DOCUMENT'
          )
          if (converted.isErr()) throw converted.error
        } catch (error) {
          logger.error('Committed a quote but could not make its attachment permanent', {
            error,
            organizationId,
            draftId: draft.id,
            assetId,
            purchaseOrderInstanceId: order.instance.id,
          })
        }
      }

      // A failed write-back is a lost optimisation for the NEXT quote from this
      // vendor — tier 1 stays as thin as it was — never a reason to fail an
      // order that exists. Caught per write-back so one bad pair does not cost
      // the others either.
      const writeBacks: WriteBackTally = { created: 0, updated: 0, failed: 0 }
      for (const writeBack of input.writeBacks) {
        try {
          const outcome = await applyWriteBack(
            db,
            handler,
            organizationId,
            payload.vendorRecordId,
            writeBack
          )
          writeBacks[outcome] += 1
          // 🛑 A create is logged on its own line, at info. Ticking a code is a
          // decision about matching; minting a `vendor_part` is a decision about
          // the CATALOGUE, and when somebody later asks where an entry came from,
          // "a quote intake on this date" has to be answerable.
          if (outcome === 'created') {
            logger.info('Created a vendor catalogue entry from a quote write-back', {
              organizationId,
              draftId: draft.id,
              purchaseOrderInstanceId: order.instance.id,
              vendorRecordId: payload.vendorRecordId,
              partRecordId: writeBack.partRecordId,
              vendorSku: writeBack.vendorSku,
            })
          }
        } catch (error) {
          writeBacks.failed += 1
          logger.error('Committed a quote but could not write back a vendor SKU', {
            error,
            organizationId,
            draftId: draft.id,
            purchaseOrderInstanceId: order.instance.id,
            partRecordId: writeBack.partRecordId,
          })
        }
      }

      const number = order.values?.purchase_order_number
      logger.info('Committed a quote into a purchase order', {
        organizationId,
        draftId: draft.id,
        lines: lines.length,
        writeBacksAccepted: input.writeBacks.length,
        writeBacksCreated: writeBacks.created,
        writeBacksUpdated: writeBacks.updated,
        writeBacksFailed: writeBacks.failed,
      })

      return {
        purchaseOrderInstanceId: order.instance.id,
        recordId: purchaseOrderRecordId,
        number: typeof number === 'string' ? number : null,
        writeBacks,
      }
    },
    'Failed to commit a purchase intake draft',
    { organizationId, draftId: input.draftId }
  )
}
