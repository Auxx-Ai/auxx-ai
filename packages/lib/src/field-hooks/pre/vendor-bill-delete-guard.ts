// packages/lib/src/field-hooks/pre/vendor-bill-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import { settledPeriodsFor } from '../../postings/settled-periods'
import { UnifiedCrudHandler } from '../../resources/crud'
import { VendorBillStatus } from '../../resources/registry/enum-values'
import type { EntityPreDeleteEvent, EntityPreDeleteHandler } from '../types'

/**
 * The bill statuses that mean the document is already in the books or already
 * part-settled with the vendor.
 *
 * `posted` is usually implied by the period predicates below, but not always — a
 * bill can be marked posted before its month closes — so it is checked
 * explicitly rather than reasoned about.
 */
const SETTLED_BILL_STATUSES: ReadonlySet<string> = new Set([
  VendorBillStatus.POSTED,
  VendorBillStatus.PARTIALLY_PAID,
  VendorBillStatus.PAID,
])

/**
 * Pre-delete guard for `vendor-bills`
 * (plans/money/tasks/21-money-parent-delete-safety.md §5). Fires inside
 * `deleteEntity` for EVERY delete path, because `vendor-bills` is
 * `isVisible: true` and has carried an ordinary row delete and bulk delete since
 * the day it shipped.
 *
 * **The shape difference from the other three guards: a bill has no movements of
 * its own.** Its accounting date is its own field, `vendor_bill_billed_at` —
 * whose description states outright that it is *"the ACCOUNTING date"* and that
 * `createdAt` "is routinely a different period". So the settled test runs on one
 * date rather than over a set of children.
 *
 * Three refusals and one cascade:
 *
 *   1. **REFUSE on status** — `posted`, `partially_paid`, `paid`.
 *   2. **REFUSE when any `vendor_payment_allocation` names this bill.** Money has
 *      been applied. The relation is `required: true`, so the allocation cannot
 *      survive meaningfully — and it must not be silently cascaded either,
 *      because deleting it changes what a vendor payment paid for with no record.
 *   3. **REFUSE when the bill date's period is settled.**
 *   4. **CASCADE `vendor_bill_line`** — `required: true` again.
 *
 * 🛑 **The cascade suppresses post-delete hooks, unlike the part, build and
 * purchase-order guards.** `registerEntityPostDeleteHooks('vendor-bill-lines',
 * [rematchAfterBillLineDelete])` re-projects **the bill being deleted**
 * (`purchasing/match-hook.ts` → `markOrRematchBill(…, vendorBillInstanceId)`),
 * so leaving it live runs the whole three-way match once per line against a
 * document that is about to vanish.
 *
 * ⚠️ **That is the trap in this whole task, and it is invisible at the call
 * site.** The rule: suppress when the hook re-projects the document being
 * deleted (here, and the existing invoice/order guards); do NOT suppress when it
 * lands on a surviving record (parts, builds, purchase orders — where the
 * recompute is the entire integration).
 */
export const guardVendorBillDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event
  const { entityInstanceId: billInstanceId } = parseRecordId(recordId)
  const handler = new UnifiedCrudHandler(organizationId, userId)

  // Refuse BEFORE any cascade, so a rejected delete mutates nothing.
  refuseOnStatus(event)
  await refuseIfAllocated(handler, organizationId, recordId)

  const billedAt = await resolveAccountingDate(organizationId, billInstanceId, event)
  const settled = await settledPeriodsFor(organizationId, [billedAt])
  if (settled.size > 0) {
    throw new BadRequestError(
      `This vendor bill is dated in ${[...settled.keys()].join(', ')}, which has been ` +
        `closed or posted. A posted period is corrected by reversing an entry, never by ` +
        `deleting its history — archive the bill instead.`,
      { organizationId, recordId, periods: [...settled.keys()] }
    )
  }

  await cascadeLines(handler, recordId)
}

/** The status wall, read off the values `deleteEntity` already captured. */
function refuseOnStatus(event: EntityPreDeleteEvent): void {
  const status = unwrapStatus(event.values.vendor_bill_status)
  if (status !== null && SETTLED_BILL_STATUSES.has(status)) {
    throw new BadRequestError(
      `This vendor bill is ${status.replace(/_/g, ' ')}. A bill that is in the books or ` +
        `part-paid is corrected by reversing it, never by deleting it — archive it instead.`,
      { organizationId: event.organizationId, recordId: event.recordId, status }
    )
  }
}

/**
 * A captured SINGLE_SELECT value, reduced to its option id.
 *
 * ⚠️ Captured values are not uniformly bare strings — `rematchAfterBillLineDelete`
 * has to unwrap a `RecordId` from the same source, and a select arrives as
 * `{ type: 'option', optionId }` on the field chain. Both shapes are handled
 * rather than assumed, because a guard that compares the wrong shape is inert
 * and reads perfectly in review (`pre/build-status-guard.ts` documents that
 * exact trap).
 */
function unwrapStatus(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (Array.isArray(value)) return unwrapStatus(value[0])
  if (value && typeof value === 'object') {
    if ('optionId' in value) return unwrapStatus((value as { optionId: unknown }).optionId)
    if ('value' in value) return unwrapStatus((value as { value: unknown }).value)
  }
  return null
}

/** Refuse when a vendor payment has been applied to this bill. */
async function refuseIfAllocated(
  handler: UnifiedCrudHandler,
  organizationId: string,
  recordId: RecordId
): Promise<void> {
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'vendor_payment_allocation',
    filters: [
      {
        id: 'bill-allocations',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'bill-allocations-bill',
            fieldId: 'vendor_payment_allocation:vendorBill',
            operator: 'is',
            value: recordId,
          },
        ],
      },
    ],
    limit: 1000,
  })

  if (ids.length > 0) {
    throw new BadRequestError(
      `This vendor bill has ${ids.length} payment ${ids.length === 1 ? 'allocation' : 'allocations'} ` +
        `against it. Deleting it would change what a vendor payment paid for, with no record — ` +
        `unallocate the payment first, or archive the bill instead.`,
      { organizationId, recordId, allocationIds: ids }
    )
  }
}

/**
 * The bill's accounting date: `billedAt` when set, otherwise the row's
 * `createdAt`.
 *
 * 🛑 **The fallback matters and must not be "unset means open".** `billedAt` is
 * nullable, and reading a missing one as "no period" would make an
 * un-transcribed bill the easiest one to delete — while `createdAt` is exactly
 * what the field's own description warns is "routinely a different period", so
 * it is a fallback and never the primary. This mirrors the movement read's
 * `occurredAt`-coalesced-onto-`createdAt` rule rather than inventing a second
 * convention.
 */
async function resolveAccountingDate(
  organizationId: string,
  billInstanceId: string,
  event: EntityPreDeleteEvent
): Promise<Date> {
  const billedAt = event.values.vendor_bill_billed_at
  if (typeof billedAt === 'string' || billedAt instanceof Date) {
    const parsed = new Date(billedAt)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const [row] = await database
    .select({ createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, billInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )

  return row?.createdAt ?? new Date()
}

/** The bill's own lines. See the class docblock for why this one suppresses. */
async function cascadeLines(handler: UnifiedCrudHandler, recordId: RecordId): Promise<void> {
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'vendor_bill_line',
    filters: [
      {
        id: 'bill-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'bill-lines-bill',
            fieldId: 'vendor_bill_line:vendorBill',
            operator: 'is',
            value: recordId,
          },
        ],
      },
    ],
    limit: 1000,
  })

  for (const id of ids) {
    await handler.delete(toRecordId('vendor_bill_line', id), { suppressPostDeleteHooks: true })
  }
}
