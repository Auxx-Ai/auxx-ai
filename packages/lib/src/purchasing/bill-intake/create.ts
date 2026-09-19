// packages/lib/src/purchasing/bill-intake/create.ts

/**
 * Step 3 (plans/money/tasks/58-vendor-bill-from-the-invoice.md §4.4, §4.5): the
 * run becomes a vendor bill, its lines and the document, through the generic
 * create path. Copies `intake/commit.ts`'s three rules and its ordering
 * exactly:
 *
 * 1. `UnifiedCrudHandler.create`, never a bespoke insert, so the numbering hook
 *    mints `BILL-...` and the field-change hooks (the match, the roll-ups) fire
 *    the way any other bill create does.
 * 2. `create` in a loop for the lines, never `bulkCreate`: `bulkCreate` drops
 *    `absorbInto`, and without it every line would announce itself as its own
 *    `created` event beside the bill that already announced them.
 * 3. A relationship value is a `RecordId` string, never a bare instance id.
 *
 * The bill IS the draft (§1.3): there is no separate review step before this
 * write, which is why the three refusals that matter (no transcription, no
 * vendor, a duplicate invoice) all happen upstream, in the job, before this is
 * ever called.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseFileRef } from '@auxx/types/file-ref'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineRollups,
} from '../../field-hooks/post/purchase-order-line-rollups'
import { getOrgCurrencyCode } from '../../field-values/org-currency'
import { convertTempAssetToPermanent } from '../../files/assets/asset-mutations'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { parseIntakeTotal, resolveIntakeUnitPrice } from '../intake/client'
import { rematchBill } from '../match-hook'
import type { BillIntakeWarning } from './client'
import { guard } from './guard'
import { resolveGrniAccountId } from './link'
import { markBillIntakeRunCreated, type StoredBillIntakeRun } from './run-store'

const logger = createScopedLogger('purchasing:bill-intake:create')

/** What one create produced. */
export interface CreateBillFromIntakeResult {
  vendorBillInstanceId: string
  vendorBillRecordId: RecordId
  vendorBillLineRecordIds: RecordId[]
  warnings: BillIntakeWarning[]
}

/** Drop the keys the create path should never see as an explicit `null`. */
function defined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined)
  )
}

/** A printed quantity worth writing: a finite, positive number. */
function isReadableQuantity(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** ISO, only when the printed string actually parses as a date. */
function parseIntakeDate(text: string | null): string | null {
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

/**
 * The order's own `purchase_order_currency`, for the currency confrontation
 * (§4.2). Read straight off `FieldValue`, the same trade `load-order-lines.ts`
 * and `duplicate.ts` make: no actor, no write, so no `UnifiedCrudHandler`.
 */
export async function loadPurchaseOrderCurrency(
  db: Database,
  organizationId: string,
  purchaseOrderRecordId: RecordId
): Promise<string | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['purchase_order_currency'] as const)
  const fieldId = fields.purchase_order_currency?.id
  if (!fieldId) return null

  const { entityInstanceId } = parseRecordId(purchaseOrderRecordId)
  const [row] = await db
    .select({ valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .limit(1)
  return row?.valueText ?? null
}

/**
 * Turn a bill-intake run into a vendor bill, its lines and its document.
 *
 * Preconditions the run must already satisfy - a defect in the job if they do
 * not, so each one throws {@link UnprocessableEntityError} rather than
 * degrading quietly: a transcription, a vendor, proposals index-aligned with
 * the transcription's lines, and a printed invoice number.
 *
 * Idempotent the same way `commitIntakeDraft` is: a run already `created`
 * refuses with {@link ConflictError} naming the bill that already exists,
 * rather than minting a second one.
 */
export async function createBillFromIntake(
  db: Database,
  organizationId: string,
  userId: string,
  run: StoredBillIntakeRun
): Promise<Result<CreateBillFromIntakeResult, Error>> {
  return guard(
    async () => {
      if (run.status === 'created') {
        throw new ConflictError(
          `This invoice is already vendor bill ${run.vendorBillRecordId ?? 'that was created earlier'}`,
          { vendorBillInstanceId: run.vendorBillInstanceId ?? undefined }
        )
      }

      const transcription = run.transcription
      if (!transcription) throw new UnprocessableEntityError('This invoice has not been read yet')
      if (!run.vendorRecordId) {
        throw new UnprocessableEntityError('Pick the vendor before creating the bill')
      }
      if (!run.proposals || run.proposals.length !== transcription.lines.length) {
        throw new UnprocessableEntityError('This invoice has not been matched yet')
      }
      if (!transcription.invoiceNumber || !transcription.invoiceNumber.trim()) {
        throw new UnprocessableEntityError('The invoice prints no number')
      }

      const warnings: BillIntakeWarning[] = [...run.warnings]

      // ── Currency (§4.2) ──────────────────────────────────────────────────
      const orderCurrency = run.purchaseOrderRecordId
        ? await loadPurchaseOrderCurrency(db, organizationId, run.purchaseOrderRecordId)
        : null
      let currency: string
      if (transcription.currency) {
        currency = transcription.currency
        if (orderCurrency && orderCurrency !== transcription.currency) {
          warnings.push({
            code: 'currency_mismatch',
            message: `The invoice prints ${transcription.currency}, which differs from the order's ${orderCurrency}. Using ${transcription.currency}.`,
          })
        }
      } else {
        currency = orderCurrency ?? (await getOrgCurrencyCode(organizationId))
      }

      if (transcription.lines.length === 0) {
        warnings.push({ code: 'no_lines', message: 'The invoice printed no lines' })
      }

      // GRNI is resolved once for the whole run, never per line (§4.5).
      const hasLinkedLine = run.proposals.some(
        (proposal) => proposal.linkedOrderLineRecordId !== null
      )
      const grniAccountId = hasLinkedLine ? await resolveGrniAccountId(db, organizationId) : null
      if (hasLinkedLine && grniAccountId === null) {
        warnings.push({
          code: 'grni_unresolved',
          message: 'GRNI account not set; linked lines were left uncoded',
        })
      }

      const handler = new UnifiedCrudHandler(organizationId, userId, db)

      const headerValues = defined({
        vendor_bill_vendor: run.vendorRecordId,
        vendor_bill_purchase_order: run.purchaseOrderRecordId,
        vendor_bill_number: transcription.invoiceNumber,
        vendor_bill_billed_at: parseIntakeDate(transcription.invoiceDate),
        vendor_bill_due_at: parseIntakeDate(transcription.dueDate),
        vendor_bill_currency: currency,
        vendor_bill_subtotal: parseIntakeTotal(transcription.subtotalText, currency),
        vendor_bill_shipping_total: parseIntakeTotal(transcription.shippingText, currency),
        vendor_bill_tax_total: parseIntakeTotal(transcription.taxText, currency),
        vendor_bill_discount: parseIntakeTotal(transcription.discountText, currency),
        vendor_bill_total: parseIntakeTotal(transcription.totalText, currency),
        // The single-file slot, not `attachments` - the array shape mirrors how
        // `intake/commit.ts` writes a FILE field's value.
        vendor_bill_document: [{ ref: run.assetRef }],
      })

      const bill = await handler.create('vendor_bill', headerValues)
      const vendorBillRecordId = bill.recordId
      const vendorBillInstanceId = bill.instance.id

      let unreadQuantityCount = 0
      const linkedOrderLineInstanceIds: string[] = []
      const vendorBillLineRecordIds: RecordId[] = []

      for (const [index, printed] of transcription.lines.entries()) {
        const proposal = run.proposals[index]
        const quantity = isReadableQuantity(printed.quantity) ? printed.quantity : null
        if (quantity === null) unreadQuantityCount += 1

        const linkedOrderLineRecordId = proposal?.linkedOrderLineRecordId ?? null
        let partRecordId: RecordId | null = null
        if (linkedOrderLineRecordId) {
          linkedOrderLineInstanceIds.push(parseRecordId(linkedOrderLineRecordId).entityInstanceId)
          partRecordId =
            proposal?.candidates.find(
              (candidate) => candidate.orderLineRecordId === linkedOrderLineRecordId
            )?.partRecordId ?? null
        }

        const lineValues = defined({
          vendor_bill_line_vendor_bill: vendorBillRecordId,
          vendor_bill_line_purchase_order_line: linkedOrderLineRecordId,
          vendor_bill_line_part: partRecordId,
          vendor_bill_line_vendor_code: printed.vendorCode,
          vendor_bill_line_description: printed.description,
          // Absent, not zero: the registry default of 1 lands, and the
          // `quantity_unread` warning below names how many lines this happened to.
          vendor_bill_line_quantity_billed: quantity,
          vendor_bill_line_unit_price: resolveIntakeUnitPrice(printed, quantity ?? 0, currency),
          vendor_bill_line_line_total: parseIntakeTotal(printed.lineTotalText, currency),
          vendor_bill_line_gl_account: linkedOrderLineRecordId ? grniAccountId : null,
          vendor_bill_line_sort_order: index,
        })

        // `absorbInto` on every line, never `bulkCreate` - the bill's own
        // `record:created` announces them.
        const line = await handler.create('vendor_bill_line', lineValues, {
          absorbInto: vendorBillRecordId,
        })
        vendorBillLineRecordIds.push(line.recordId)
      }

      if (unreadQuantityCount > 0) {
        warnings.push({
          code: 'quantity_unread',
          message: `${unreadQuantityCount} line${unreadQuantityCount === 1 ? '' : 's'} printed no quantity`,
        })
      }

      // The run is marked `created` AFTER the bill and its lines exist and
      // BEFORE anything else, for the same reason `commit.ts:222-244`
      // documents: marking before the create would strand a run whose create
      // failed; marking after the best-effort tail would leave a window where
      // a retry mints a second bill.
      const marked = await markBillIntakeRunCreated(organizationId, run.id, {
        vendorBillInstanceId,
        vendorBillRecordId,
        vendorBillLineRecordIds,
        warnings,
      })
      if (marked.isErr()) throw marked.error

      // EVERYTHING FROM HERE DOWN IS BEST-EFFORT. The bill is the thing the
      // person asked for and it already exists with a real number; reporting
      // failure for work that succeeded would send them to create it by hand,
      // which is the duplicate bill this ordering exists to prevent, arriving
      // through the front door instead.

      const { sourceType, id: assetId } = parseFileRef(run.assetRef as never)
      if (sourceType === 'asset' && assetId) {
        try {
          const converted = await convertTempAssetToPermanent(
            { db, organizationId },
            assetId,
            'DOCUMENT'
          )
          if (converted.isErr()) throw converted.error
        } catch (error) {
          logger.error('Created a bill but could not make its attachment permanent', {
            error,
            organizationId,
            runId: run.id,
            assetId,
            vendorBillInstanceId,
          })
        }
      }

      // 🛑 §0.3 / §4.5: the billed roll-up's lifecycle door
      // (`purchasing-vendor-bill-lines-created`) does not fire for an absorbed
      // create - `tx-write-flush.ts` drops absorbed creates from the replay -
      // so it is called explicitly here rather than relied on.
      if (linkedOrderLineInstanceIds.length > 0) {
        try {
          await recalculatePurchaseOrderLineRollups(
            organizationId,
            linkedOrderLineInstanceIds,
            PURCHASE_ORDER_LINE_ROLLUPS.billed
          )
        } catch (error) {
          logger.error(
            'Created a bill but could not recalculate the purchase order line billed roll-up',
            { error, organizationId, runId: run.id, vendorBillInstanceId }
          )
        }
      }

      // Once, after every line exists, so the stored verdict is the whole
      // bill's and not the last line's.
      try {
        await rematchBill({ organizationId, userId, vendorBillInstanceId, db })
      } catch (error) {
        logger.error('Created a bill but could not run its three-way match', {
          error,
          organizationId,
          runId: run.id,
          vendorBillInstanceId,
        })
      }

      logger.info('Created a vendor bill from an invoice read', {
        organizationId,
        runId: run.id,
        vendorBillInstanceId,
        lines: vendorBillLineRecordIds.length,
        linkedLines: linkedOrderLineInstanceIds.length,
      })

      return {
        vendorBillInstanceId,
        vendorBillRecordId,
        vendorBillLineRecordIds,
        warnings,
      }
    },
    'Failed to create a vendor bill from an invoice read',
    { organizationId, runId: run.id }
  )
}
