// packages/lib/src/money/purchase-order-lifecycle.ts

import { database, schema } from '@auxx/database'
import type { RecordId, TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, sql } from 'drizzle-orm'
import { getEntityDefIdResolver, getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import type { MoneyMutationInput } from './types'

/**
 * Input for `markPurchaseOrderSent`.
 *
 * Declared here rather than in `money/types.ts` for the same reason
 * `purchase-order-lifecycle.ts` is its own module: `use-document-send-actions.ts:20`
 * records that **lifecycle mutations stay per-document** — only the send flow and the
 * status guard are shared. A third `…LifecycleInput` alias in the shared types file would
 * imply a shared shape that the three mutations deliberately do not have.
 */
export interface PurchaseOrderLifecycleInput extends MoneyMutationInput {
  /** EntityInstance id of the purchase order (not the RecordId). */
  purchaseOrderInstanceId: string
}

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Assert the order is currently at `expected` status, else reject with a clear message. */
function assertStatus(status: string | undefined, expected: string, action: string): void {
  if (status !== expected) {
    throw new BadRequestError(
      `Cannot ${action} — purchase order must be '${expected}' (currently '${status ?? 'unknown'}')`
    )
  }
}

/** Read a purchase order's current `purchase_order_status` and `purchase_order_expected_at`. */
async function getStatusAndExpectedAt(
  handler: UnifiedCrudHandler,
  organizationId: string,
  purchaseOrderRecordId: RecordId
): Promise<{ status: string | undefined; expectedAt: unknown }> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['purchase_order_status', 'purchase_order_expected_at'] as const)

  const fieldIds = [cf.purchase_order_status, cf.purchase_order_expected_at]
    .filter(Boolean)
    .map((f) => f!.id)
  const values = await handler.getFieldValues(purchaseOrderRecordId, fieldIds)

  const statusTyped = cf.purchase_order_status
    ? firstTyped(values.get(cf.purchase_order_status.id))
    : undefined
  const expectedTyped = cf.purchase_order_expected_at
    ? firstTyped(values.get(cf.purchase_order_expected_at.id))
    : undefined

  return {
    status: statusTyped ? (extractValue(statusTyped) as string) : undefined,
    expectedAt: expectedTyped ? extractValue(expectedTyped) : undefined,
  }
}

/**
 * The longest `vendor_part_lead_time` (in days) reachable from this order's lines, or
 * `null` when no line carries one.
 *
 * There is no lead time at the PO level; the only one in the system is on the supplier's
 * catalogue entry, reachable through `purchase_order_line_vendor_part`
 * (plans/purchasing/07-purchase-order-send-and-status.md §6.2).
 *
 * ⚠️ `purchase_order_line_vendor_part` is nullable and frequently unset — a one-off buy
 * from a supplier with no maintained price list is a legitimate line — so most lines
 * contribute nothing. That is the normal case, not a failure, which is why this is an inner
 * join returning `null` for an empty set rather than anything that reports a problem.
 *
 * One statement rather than a walk down the two relationships: a fifty-line order would
 * otherwise open a hundred round trips to compute a single MAX. The `organizationId`
 * predicate on every leg plus field ids that only exist on their own entity is the scope.
 */
async function readMaxLineLeadTimeDays(
  organizationId: string,
  purchaseOrderInstanceId: string
): Promise<number | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'purchase_order_line_purchase_order',
      'purchase_order_line_vendor_part',
      'vendor_part_lead_time',
    ] as const)

  const orderRelField = cf.purchase_order_line_purchase_order
  const vendorPartRelField = cf.purchase_order_line_vendor_part
  const leadTimeField = cf.vendor_part_lead_time
  if (!orderRelField || !vendorPartRelField || !leadTimeField) return null

  // Two self-joins on FieldValue, the `recalculatePurchaseOrderLineRollup` shape:
  // line -> its vendor_part -> that row's lead time.
  const [row] = await database
    .select({ maxLeadTime: sql<string | null>`MAX(lead."valueNumber")` })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" vp`,
      sql`vp."entityId" = ${schema.FieldValue.entityId}
        AND vp."fieldId" = ${vendorPartRelField.id}
        AND vp."organizationId" = ${organizationId}`
    )
    .innerJoin(
      sql`"FieldValue" lead`,
      sql`lead."entityId" = vp."relatedEntityId"
        AND lead."fieldId" = ${leadTimeField.id}
        AND lead."organizationId" = ${organizationId}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, orderRelField.id),
        eq(schema.FieldValue.relatedEntityId, purchaseOrderInstanceId),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )

  const maxLeadTime = row?.maxLeadTime
  if (maxLeadTime === null || maxLeadTime === undefined) return null
  const days = Number(maxLeadTime)
  return Number.isFinite(days) && days > 0 ? days : null
}

/**
 * Mark a draft purchase order as sent to its vendor
 * (plans/purchasing/07-purchase-order-send-and-status.md §3.4, §6.2, §6.4).
 *
 * Writes `purchase_order_status = 'issued'`. There is no separate `sent` value and none is
 * wanted: for a purchase order *issued* **is** *sent to the vendor*, one event, and the
 * accounting word is the better one. `issued` means SENT and nothing more — deliberately
 * not "the vendor has accepted", which is a later `confirmed` state that belongs to vendor
 * order confirmation (§6.4, reserved and not built).
 *
 * 🛑 **`issued` is guarded on BOTH hook chains, so this write clears both.** Going through
 * `FieldValueService` rather than `UnifiedCrudHandler` is what clears the system pre-hook
 * (`resources/hooks/purchasing-hooks.ts`), which never runs for a `FieldValueService` write
 * — the same mechanism `markQuoteSent` and `markInvoiceSent` rely on, and routing this
 * through the CRUD handler would make the action reject itself. But that chain is not the
 * one a drawer edit or a kanban drag takes, so `purchase_order_status` also carries a field
 * pre-hook (`field-hooks/pre/purchase-order-status-guard.ts`) that DOES see this write —
 * which is why `bypassFieldGuards` below is not optional. Without it the Send action is
 * refused by the guard that exists to protect it.
 *
 * The bypass set is deliberately identical to the one `derivePurchaseOrderStatuses`
 * (`purchasing/purchase-order-status-writer.ts`) passes for §6.1's `draft -> issued`
 * pull-forward: two sanctioned writers, one idiom, one attribute named and nothing else.
 *
 * Deliberately NOT abstracted into a shared `markXSent`: `use-document-send-actions.ts:20`
 * records that lifecycle mutations stay per-document, and the assertion plus what each one
 * mirrors IS the body — a quote mirrors its `service_request` to `quoted`, an invoice
 * stamps `issued_at`, and this one derives an expected-delivery default. The shared parts
 * (the send flow, the status guard) are already shared.
 *
 * @param input - Org, user, and the purchase order's EntityInstance id.
 * @throws BadRequestError when the order is not currently `draft`.
 */
export async function markPurchaseOrderSent(input: PurchaseOrderLifecycleInput): Promise<void> {
  const { organizationId, userId, purchaseOrderInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const purchaseOrderRecordId = toRecordId('purchase_order', purchaseOrderInstanceId)

  const { status, expectedAt } = await getStatusAndExpectedAt(
    handler,
    organizationId,
    purchaseOrderRecordId
  )
  assertStatus(status, 'draft', 'mark as sent')

  const writes: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'purchase_order_status', value: 'issued' },
  ]

  // `purchase_order_expected_at` as an OVERWRITABLE DEFAULT (§6.2): filled only when the
  // field is empty, so a date somebody typed is never overwritten — the person who spoke to
  // the vendor outranks the catalogue.
  //
  // ✅ When no line carries a lead time the field is left EMPTY on purpose. An invented
  // date is worse than a missing one here: 05 §6.1 ages an `awaiting_receipt` exception off
  // this field, so a fabricated expected date produces fabricated exceptions — a queue full
  // of late orders that were never actually late. Absence is honest and the expediting list
  // can say "no promised date"; a guess cannot be told apart from a real promise.
  if (expectedAt === undefined || expectedAt === null || expectedAt === '') {
    const leadTimeDays = await readMaxLineLeadTimeDays(organizationId, purchaseOrderInstanceId)
    if (leadTimeDays !== null) {
      const expected = new Date(Date.now() + leadTimeDays * 24 * 60 * 60 * 1000)
      writes.push({
        fieldId: 'purchase_order_expected_at',
        value: expected.toISOString().split('T')[0],
      })
    }
  }

  // Resolve the type-slug to the real `entityDefinitionId` UUID before writing — the
  // `markInvoiceSent` note applies verbatim: an unresolved `purchase_order:<id>` RecordId
  // makes `setValuesForEntity`'s field-change hook dispatch resolve to no cached resource,
  // so `entitySlug` comes back `''` and every field-change hook silently no-ops even though
  // the write itself succeeds.
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  // `bypassFieldGuards` names `purchase_order_status` and nothing else: this IS the
  // sanctioned writer of `issued`, so the field pre-hook that rejects a MANUAL `issued` must
  // not reject it. `FieldValueService` forwards this straight to `createFieldValueContext`,
  // so it is the same construction the status writer performs by hand.
  const fieldValueService = new FieldValueService(organizationId, userId, undefined, undefined, {
    bypassFieldGuards: new Set<SystemAttribute>(['purchase_order_status']),
  })
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId(resolveDefId('purchase_order'), purchaseOrderInstanceId),
    values: writes,
  })
}
